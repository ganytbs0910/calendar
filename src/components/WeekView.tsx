import React, {useState, useCallback, useRef, useEffect, useMemo, forwardRef, useImperativeHandle} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Dimensions,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {getAllEventColors} from './AddEventModal';
import {useTheme} from '../theme/ThemeContext';
import {useTranslation} from 'react-i18next';
import {SleepSettings, getSettingsForDate} from '../services/sleepSettingsService';
import TaskBottomSheet, {TaskBottomSheetRef} from './TaskBottomSheet';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TIME_LABEL_WIDTH = 48;
const DAY_WIDTH = (SCREEN_WIDTH - TIME_LABEL_WIDTH) / 7;
const HOUR_HEIGHT = 44;
const ALL_DAY_ROW_HEIGHT = 28;

// Virtual day range (±3500 days ≈ ±9.6 years). Enough that the user will
// basically never hit the edge during a session.
const TOTAL_DAYS = 7001;
const ANCHOR_INDEX = 3500;

// Event pre-fetch window around the centered day.
const FETCH_HALF_RANGE = 60;
const REFETCH_THRESHOLD = 30;

export interface WeekViewRef {
  refreshEvents: () => void;
}

interface WeekViewProps {
  currentDate: Date;
  onEventPress?: (event: CalendarEventReadable) => void;
  onTimeRangeSelect?: (startDate: Date, endDate: Date) => void;
  onDayChange?: (date: Date) => void;
  hasPermission?: boolean;
  sleepSettings?: SleepSettings | null;
  onOpenSleepSettings?: () => void;
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const stripTime = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const diffDays = (a: Date, b: Date): number => {
  const ms = stripTime(a).getTime() - stripTime(b).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
};

export const WeekView = forwardRef<WeekViewRef, WeekViewProps>(({
  currentDate,
  onEventPress,
  onTimeRangeSelect,
  onDayChange,
  hasPermission,
  sleepSettings,
  onOpenSleepSettings,
}, ref) => {
  const {colors, isDark} = useTheme();
  const {t} = useTranslation();
  const WEEKDAYS_JA = t('weekdaysSingle', {returnObjects: true}) as string[];

  // Anchor = Monday of the week containing currentDate when the component mounted.
  // All day offsets are computed relative to this, so FlatList never needs resetting.
  const anchorDate = useRef<Date>((() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  })()).current;

  const getDateForIndex = useCallback((index: number): Date => {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + (index - ANCHOR_INDEX));
    return d;
  }, [anchorDate]);

  // ── State ──
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [eventColors, setEventColors] = useState<Record<string, string>>({});
  const [monthLabel, setMonthLabel] = useState<string>('');
  // The day the bottom sheet is currently showing. Updates after horizontal scroll settles.
  const [sheetDate, setSheetDate] = useState<Date>(currentDate);
  // When a long-press event creation is active, both scroll axes are locked
  // so the in-progress drag isn't hijacked by the ScrollView / FlatList.
  const [interactionLocked, setInteractionLocked] = useState(false);
  const lockInteraction = useCallback(() => setInteractionLocked(true), []);
  const unlockInteraction = useCallback(() => setInteractionLocked(false), []);

  // ── Refs ──
  const headerListRef = useRef<FlatList>(null);
  const bodyListRef = useRef<FlatList>(null);
  const verticalScrollRef = useRef<ScrollView>(null);
  const verticalOffsetRef = useRef<number>(0);
  const gridTopOnScreenRef = useRef<number>(0);
  const scrollingRef = useRef<boolean>(false);
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskSheetRef = useRef<TaskBottomSheetRef>(null);

  // Leftmost visible day index (updates throttled during scroll).
  const leftVisibleIndexRef = useRef<number>(ANCHOR_INDEX);
  // The day index at the center of the last event fetch (drives refetching).
  const lastFetchCenterRef = useRef<number>(ANCHOR_INDEX);

  // ── Sleep-settings driven display range ──
  const {displayStartHour, displayEndHour} = useMemo(() => {
    if (!sleepSettings) return {displayStartHour: 0, displayEndHour: 24};
    const wakeHour = Math.min(sleepSettings.weekday.wakeUpHour, sleepSettings.weekend.wakeUpHour);
    const sleepHour = Math.max(sleepSettings.weekday.sleepHour, sleepSettings.weekend.sleepHour);
    return {
      displayStartHour: Math.max(0, wakeHour),
      displayEndHour: Math.min(25, sleepHour + 1),
    };
  }, [sleepSettings]);

  const totalDisplayHours = displayEndHour - displayStartHour;
  const timelineHeight = totalDisplayHours * HOUR_HEIGHT + 1;

  // ── Month label derivation ──
  const computeMonthLabel = useCallback((leftIndex: number) => {
    const leftDate = getDateForIndex(leftIndex);
    const rightDate = getDateForIndex(leftIndex + 6);
    const startMonth = leftDate.getMonth() + 1;
    const endMonth = rightDate.getMonth() + 1;
    if (startMonth === endMonth) return t('monthFormat', {month: startMonth});
    return t('monthFormat', {month: `${startMonth}-${endMonth}`});
  }, [getDateForIndex, t]);

  useEffect(() => {
    setMonthLabel(computeMonthLabel(ANCHOR_INDEX));
  }, [computeMonthLabel]);

  // ── Event fetching ──
  const fetchEventsForCenter = useCallback(async (centerIndex: number) => {
    if (!hasPermission) return;
    try {
      const centerDate = getDateForIndex(centerIndex);
      const start = new Date(centerDate);
      start.setDate(start.getDate() - FETCH_HALF_RANGE);
      start.setHours(0, 0, 0, 0);
      const end = new Date(centerDate);
      end.setDate(end.getDate() + FETCH_HALF_RANGE);
      end.setHours(23, 59, 59);

      const calendarEvents = await RNCalendarEvents.fetchAllEvents(
        start.toISOString(),
        end.toISOString(),
      );

      const filtered = calendarEvents.filter(event => {
        const cal = event.calendar;
        if (!cal) return true;
        const title = (cal.title || '').toLowerCase();
        if (title.includes('祝日') || title.includes('holiday') || title.includes('holidays')) return false;
        if (cal.allowsModifications === false && event.allDay) return false;
        return true;
      });

      setEvents(filtered);
      lastFetchCenterRef.current = centerIndex;

      const fetchedColors = await getAllEventColors();
      setEventColors(fetchedColors);
    } catch {
      // ignore
    }
  }, [hasPermission, getDateForIndex]);

  useEffect(() => {
    fetchEventsForCenter(ANCHOR_INDEX);
  }, [fetchEventsForCenter]);

  useImperativeHandle(ref, () => ({
    refreshEvents: () => fetchEventsForCenter(leftVisibleIndexRef.current + 3),
  }), [fetchEventsForCenter]);

  // ── External currentDate sync (e.g. month view tap) ──
  useEffect(() => {
    const targetIndex = ANCHOR_INDEX + diffDays(currentDate, anchorDate);
    // Only scroll if the target day isn't already within the visible 7-day window.
    const left = leftVisibleIndexRef.current;
    if (targetIndex >= left && targetIndex <= left + 6) return;

    leftVisibleIndexRef.current = targetIndex;
    bodyListRef.current?.scrollToIndex({index: targetIndex, animated: true});
    headerListRef.current?.scrollToIndex({index: targetIndex, animated: true});
    setMonthLabel(computeMonthLabel(targetIndex));
  }, [currentDate, anchorDate, computeMonthLabel]);

  // ── Initial horizontal scroll position (anchor Monday as leftmost day). ──
  // FlatList's initialScrollIndex handles this, but we also need to correct for
  // the case where currentDate isn't exactly Monday: scroll so currentDate is
  // within the first visible window.
  // (Anchor is already Monday of currentDate's week, so ANCHOR_INDEX works.)

  // ── Horizontal scroll sync ──
  // Only the body FlatList is user-scrollable; the header is driven imperatively
  // by the body's scroll events, so there's no feedback loop to guard against.
  const onBodyHScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;

    scrollingRef.current = true;
    if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current);
    scrollStopTimerRef.current = setTimeout(() => {
      scrollingRef.current = false;
    }, 150);

    headerListRef.current?.scrollToOffset({offset: x, animated: false});

    const newLeftIdx = Math.round(x / DAY_WIDTH);
    if (newLeftIdx !== leftVisibleIndexRef.current) {
      leftVisibleIndexRef.current = newLeftIdx;
      const newLabel = computeMonthLabel(newLeftIdx);
      setMonthLabel(prev => (prev === newLabel ? prev : newLabel));
    }
  }, [computeMonthLabel]);

  // ── After a horizontal flick settles, update parent + consider a refetch. ──
  const onHorizontalMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const leftIdx = Math.round(x / DAY_WIDTH);
    const centerIdx = leftIdx + 3;

    const centerDate = getDateForIndex(centerIdx);
    const targetDate = new Date(centerDate);
    targetDate.setHours(currentDate.getHours(), currentDate.getMinutes(), 0, 0);
    onDayChange?.(targetDate);
    setSheetDate(targetDate);

    if (Math.abs(centerIdx - lastFetchCenterRef.current) > REFETCH_THRESHOLD) {
      fetchEventsForCenter(centerIdx);
    }
  }, [getDateForIndex, currentDate, onDayChange, fetchEventsForCenter]);

  // Keep sheetDate in sync when the parent changes currentDate (e.g. day header tap)
  useEffect(() => {
    setSheetDate(prev =>
      prev.getFullYear() === currentDate.getFullYear() &&
      prev.getMonth() === currentDate.getMonth() &&
      prev.getDate() === currentDate.getDate()
        ? prev
        : currentDate
    );
  }, [currentDate]);

  // ── Vertical scroll tracking (shared across all day columns naturally). ──
  const onVScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    verticalOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  // ── Initial vertical scroll: show current hour near top. ──
  useEffect(() => {
    const now = new Date();
    const y = Math.max(0, (now.getHours() - displayStartHour - 1) * HOUR_HEIGHT);
    setTimeout(() => {
      verticalScrollRef.current?.scrollTo({y, animated: false});
      verticalOffsetRef.current = y;
    }, 50);
  }, [displayStartHour]);

  // ── Event lookups: group by day key once, reuse across columns. ──
  const timedEventsByKey = useMemo(() => {
    const map = new Map<string, CalendarEventReadable[]>();
    events.forEach(event => {
      if (!event.startDate || !event.endDate || event.allDay) return;
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);

      const firstDay = stripTime(start);
      const lastDay = stripTime(end);
      // Include events spanning multiple days in each day they touch.
      const cursor = new Date(firstDay);
      while (cursor <= lastDay) {
        const key = dayKey(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(event);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [events]);

  const allDayEventsByKey = useMemo(() => {
    const map = new Map<string, CalendarEventReadable[]>();
    events.forEach(event => {
      if (!event.allDay || !event.startDate) return;
      const start = new Date(event.startDate);
      const key = dayKey(start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    });
    return map;
  }, [events]);

  // Events for the day the bottom sheet is showing.
  const sheetDateEvents = useMemo(() => {
    const k = dayKey(sheetDate);
    const timed = timedEventsByKey.get(k) || [];
    const allDay = allDayEventsByKey.get(k) || [];
    return [...allDay, ...timed];
  }, [sheetDate, timedEventsByKey, allDayEventsByKey]);

  // ── FlatList plumbing ──
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: DAY_WIDTH,
    offset: DAY_WIDTH * index,
    index,
  }), []);

  const keyExtractorHeader = useCallback((_: any, index: number) => `h-${index}`, []);
  const keyExtractorBody = useCallback((_: any, index: number) => `b-${index}`, []);

  const today = useMemo(() => new Date(), []);
  const isSameDay = useCallback((a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate(),
  []);

  const renderHeaderItem = useCallback(({index}: {index: number}) => {
    const date = getDateForIndex(index);
    const k = dayKey(date);
    const dayOfWeek = date.getDay();
    const isTodayDate = isSameDay(date, today);
    const timedCount = (timedEventsByKey.get(k) || []).length;
    const allDayList = allDayEventsByKey.get(k) || [];
    const eventCount = timedCount + allDayList.length;

    return (
      <View style={styles.headerDayWrapper}>
        <TouchableOpacity
          style={styles.headerDay}
          onPress={() => {
            const d = new Date(date);
            d.setHours(currentDate.getHours(), currentDate.getMinutes(), 0, 0);
            onDayChange?.(d);
          }}
          activeOpacity={0.6}>
          <View style={styles.headerWeekdayRow}>
            <Text style={[
              styles.headerWeekday,
              {color: colors.textTertiary},
              dayOfWeek === 0 && {color: colors.sunday},
              dayOfWeek === 6 && {color: colors.saturday},
              isTodayDate && {color: colors.primary},
            ]}>
              {WEEKDAYS_JA[dayOfWeek]}
            </Text>
            {eventCount > 0 && (
              <View style={[styles.headerBadge, {backgroundColor: colors.error}]}>
                <Text style={styles.headerBadgeText}>{eventCount}</Text>
              </View>
            )}
          </View>
          <View style={[
            styles.headerDateCircle,
            isTodayDate && {backgroundColor: colors.primary},
          ]}>
            <Text style={[
              styles.headerDate,
              {color: colors.text},
              dayOfWeek === 0 && !isTodayDate && {color: colors.sunday},
              dayOfWeek === 6 && !isTodayDate && {color: colors.saturday},
              isTodayDate && {color: '#fff'},
            ]}>
              {date.getDate()}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={[styles.allDayCell, {borderBottomColor: colors.border}]}>
          {allDayList.slice(0, 2).map(event => (
            <TouchableOpacity
              key={event.id}
              style={[styles.allDayEvent, {backgroundColor: colors.allDayEvent}]}
              onPress={() => onEventPress?.(event)}>
              <Text style={[styles.allDayEventText, {color: colors.allDayEventText}]} numberOfLines={1}>
                {event.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }, [getDateForIndex, timedEventsByKey, allDayEventsByKey, colors, isSameDay, today, WEEKDAYS_JA, currentDate, onDayChange, onEventPress]);

  const renderBodyItem = useCallback(({index}: {index: number}) => {
    const date = getDateForIndex(index);
    return (
      <DayColumn
        date={date}
        dayEvents={timedEventsByKey.get(dayKey(date)) || []}
        eventColors={eventColors}
        displayStartHour={displayStartHour}
        totalDisplayHours={totalDisplayHours}
        timelineHeight={timelineHeight}
        colors={colors}
        isDark={isDark}
        isToday={isSameDay(date, today)}
        onEventPress={onEventPress}
        onTimeRangeSelect={onTimeRangeSelect}
        verticalOffsetRef={verticalOffsetRef}
        gridTopOnScreenRef={gridTopOnScreenRef}
        scrollingRef={scrollingRef}
        verticalScrollRef={verticalScrollRef}
        onLockInteraction={lockInteraction}
        onUnlockInteraction={unlockInteraction}
        sleepSettings={sleepSettings}
        onOpenSleepSettings={onOpenSleepSettings}
      />
    );
  }, [getDateForIndex, timedEventsByKey, eventColors, displayStartHour, totalDisplayHours, timelineHeight, colors, isDark, isSameDay, today, onEventPress, onTimeRangeSelect, lockInteraction, unlockInteraction, sleepSettings, onOpenSleepSettings]);

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]}>
      {/* Fixed header row: corner + horizontal list of day headers */}
      <View style={[styles.header, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
        <View style={styles.timeCorner}>
          <Text style={[styles.monthLabel, {color: colors.textSecondary}]}>
            {monthLabel}
          </Text>
        </View>
        <FlatList
          ref={headerListRef}
          style={{width: SCREEN_WIDTH - TIME_LABEL_WIDTH}}
          data={Array.from({length: TOTAL_DAYS})}
          keyExtractor={keyExtractorHeader}
          renderItem={renderHeaderItem}
          horizontal
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={ANCHOR_INDEX}
          getItemLayout={getItemLayout}
          initialNumToRender={8}
          windowSize={3}
          maxToRenderPerBatch={8}
          removeClippedSubviews
          scrollEnabled={false}
        />
      </View>

      {/* Body: time label column (scrolls vertically with the grid) + day columns */}
      <ScrollView
        ref={verticalScrollRef}
        style={styles.bodyScroll}
        contentContainerStyle={{paddingBottom: 60}}
        onScroll={onVScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        directionalLockEnabled
        scrollEnabled={!interactionLocked}>
        <View
          style={[styles.bodyContent, {height: timelineHeight}]}
          onLayout={() => {
            // Measure the grid's top Y in the window for long-press coordinate math.
            // We rely on the view tree being stable after initial layout.
          }}>
          {/* Time label column (absolute grid-lines drawn via the day columns) */}
          <View
            style={[styles.timeLabelColumn, {height: timelineHeight}]}
            onLayout={(e) => {
              // Use this column as the reference for grid-top measurement.
              // measureInWindow is asynchronous, but the computed y is good enough.
              // It's set once after initial layout.
              const target = e.target as any;
              if (target && target.measureInWindow) {
                target.measureInWindow((_x: number, y: number) => {
                  gridTopOnScreenRef.current = y;
                });
              }
            }}>
            {Array.from({length: totalDisplayHours}, (_, i) => {
              const h = displayStartHour + i;
              return i > 0 ? (
                <View key={`label-${h}`} style={[styles.timeLabel, {top: i * HOUR_HEIGHT - 7}]}>
                  <Text style={[styles.timeLabelText, {color: colors.textTertiary}]}>
                    {h.toString().padStart(2, '0')}:00
                  </Text>
                </View>
              ) : null;
            })}

            {/* Wake / sleep time tags (uses the weekday setting as the reference) */}
            {sleepSettings && (() => {
              const wd = sleepSettings.weekday;
              const wakeY = (wd.wakeUpHour + wd.wakeUpMinute / 60 - displayStartHour) * HOUR_HEIGHT;
              const sleepY = (wd.sleepHour + wd.sleepMinute / 60 - displayStartHour) * HOUR_HEIGHT;
              const maxY = totalDisplayHours * HOUR_HEIGHT;
              const TAG_H = 30;
              const fmt = (h: number, m: number) =>
                `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
              const wakeTop = Math.max(0, Math.min(maxY - TAG_H, wakeY - TAG_H / 2));
              const sleepTop = Math.max(0, Math.min(maxY - TAG_H, sleepY - TAG_H / 2));
              return (
                <>
                  {wakeY >= 0 && wakeY <= maxY && (
                    <TouchableOpacity
                      activeOpacity={0.6}
                      onPress={onOpenSleepSettings}
                      style={[styles.sleepTimeTag, {top: wakeTop, backgroundColor: '#FF9500'}]}>
                      <Text style={styles.sleepTimeTagLabel}>☀️起床</Text>
                      <Text style={styles.sleepTimeTagText}>{fmt(wd.wakeUpHour, wd.wakeUpMinute)}</Text>
                    </TouchableOpacity>
                  )}
                  {sleepY >= 0 && sleepY <= maxY && (
                    <TouchableOpacity
                      activeOpacity={0.6}
                      onPress={onOpenSleepSettings}
                      style={[styles.sleepTimeTag, {top: sleepTop, backgroundColor: '#5856D6'}]}>
                      <Text style={styles.sleepTimeTagLabel}>🌙就寝</Text>
                      <Text style={styles.sleepTimeTagText}>{fmt(wd.sleepHour, wd.sleepMinute)}</Text>
                    </TouchableOpacity>
                  )}
                </>
              );
            })()}
          </View>

          {/* Horizontal FlatList of day columns */}
          <FlatList
            ref={bodyListRef}
            style={{width: SCREEN_WIDTH - TIME_LABEL_WIDTH, height: timelineHeight}}
            data={Array.from({length: TOTAL_DAYS})}
            keyExtractor={keyExtractorBody}
            renderItem={renderBodyItem}
            horizontal
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={ANCHOR_INDEX}
            getItemLayout={getItemLayout}
            onScroll={onBodyHScroll}
            onMomentumScrollEnd={onHorizontalMomentumEnd}
            scrollEventThrottle={16}
            snapToInterval={DAY_WIDTH}
            decelerationRate="fast"
            initialNumToRender={8}
            windowSize={5}
            maxToRenderPerBatch={8}
            removeClippedSubviews
            nestedScrollEnabled
            directionalLockEnabled
            bounces={false}
            scrollEnabled={!interactionLocked}
          />
        </View>
      </ScrollView>

      {/* Bottom sheet — tasks + schedule for the currently centered day */}
      <TaskBottomSheet
        ref={taskSheetRef}
        date={sheetDate}
        events={sheetDateEvents}
        eventColors={eventColors}
        onEventPress={onEventPress}
        onEventsRefresh={() => fetchEventsForCenter(leftVisibleIndexRef.current + 3)}
      />
    </View>
  );
});

// ──────────────────────────────────────────────────────────────
// DayColumn — one DAY_WIDTH-wide, timelineHeight-tall column
// ──────────────────────────────────────────────────────────────

interface DayColumnProps {
  date: Date;
  dayEvents: CalendarEventReadable[];
  eventColors: Record<string, string>;
  displayStartHour: number;
  totalDisplayHours: number;
  timelineHeight: number;
  colors: any;
  isDark: boolean;
  isToday: boolean;
  onEventPress?: (event: CalendarEventReadable) => void;
  onTimeRangeSelect?: (startDate: Date, endDate: Date) => void;
  verticalOffsetRef: React.MutableRefObject<number>;
  gridTopOnScreenRef: React.MutableRefObject<number>;
  scrollingRef: React.MutableRefObject<boolean>;
  verticalScrollRef: React.RefObject<ScrollView | null>;
  onLockInteraction: () => void;
  onUnlockInteraction: () => void;
  sleepSettings?: SleepSettings | null;
  onOpenSleepSettings?: () => void;
}

const DayColumn = React.memo(function DayColumn({
  date,
  dayEvents,
  eventColors,
  displayStartHour,
  totalDisplayHours,
  timelineHeight,
  colors,
  isDark,
  isToday,
  onEventPress,
  onTimeRangeSelect,
  verticalOffsetRef,
  gridTopOnScreenRef,
  scrollingRef,
  verticalScrollRef,
  onLockInteraction,
  onUnlockInteraction,
  sleepSettings,
  onOpenSleepSettings,
}: DayColumnProps) {
  const {t} = useTranslation();

  const gridColor = isDark ? '#2c2c2e' : '#e0e0e0';

  // Creation preview
  const [creatingEvent, setCreatingEvent] = useState<{startMin: number; endMin: number} | null>(null);
  const creatingEventRef = useRef(creatingEvent);
  useEffect(() => { creatingEventRef.current = creatingEvent; }, [creatingEvent]);

  // Long-press state
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpActiveRef = useRef(false);
  const lpStartMinRef = useRef(0);
  const lpTouchYRef = useRef(0);
  const lpTouchXRef = useRef(0);
  const lpWasDragRef = useRef(false);
  const lpTouchTimeRef = useRef(0);

  // ── pageY → minutes ──
  const pageYToMinutes = useCallback((pageY: number) => {
    const relativeY = pageY - gridTopOnScreenRef.current + verticalOffsetRef.current;
    const minutes = (relativeY / HOUR_HEIGHT) * 60 + displayStartHour * 60;
    return Math.round(minutes / 15) * 15;
  }, [displayStartHour, gridTopOnScreenRef, verticalOffsetRef]);

  const handleTouchStart = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;
    lpTouchYRef.current = pageY;
    lpTouchXRef.current = pageX;
    lpTouchTimeRef.current = Date.now();
    lpActiveRef.current = false;
    lpWasDragRef.current = false;

    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null;
      lpActiveRef.current = true;
      lpWasDragRef.current = true;
      // Lock scrolling on both axes so the drag isn't stolen by the ScrollView / FlatList.
      onLockInteraction();
      const minutes = pageYToMinutes(pageY);
      const snappedMin = Math.max(0, Math.min(23 * 60 + 55, minutes));
      lpStartMinRef.current = snappedMin;
      setCreatingEvent({startMin: snappedMin, endMin: snappedMin + 30});
    }, 300);
  }, [pageYToMinutes, onLockInteraction]);

  const handleTouchMove = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;

    if (!lpActiveRef.current) {
      if (lpTimerRef.current) {
        if (Math.abs(pageY - lpTouchYRef.current) > 10 || Math.abs(pageX - lpTouchXRef.current) > 10) {
          clearTimeout(lpTimerRef.current);
          lpTimerRef.current = null;
        }
      }
      return;
    }

    const endMin = pageYToMinutes(pageY);
    const startMin = lpStartMinRef.current;
    const clampedEnd = Math.max(startMin + 5, Math.min(24 * 60, endMin));
    setCreatingEvent({startMin, endMin: clampedEnd});

    const screenH = Dimensions.get('window').height;
    if (pageY > screenH - 80) {
      verticalScrollRef.current?.scrollTo({
        y: verticalOffsetRef.current + 20,
        animated: false,
      });
    } else if (pageY < 150) {
      verticalScrollRef.current?.scrollTo({
        y: Math.max(0, verticalOffsetRef.current - 20),
        animated: false,
      });
    }
  }, [pageYToMinutes, verticalOffsetRef, verticalScrollRef]);

  const handleTouchEnd = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;

    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }

    if (lpActiveRef.current) {
      lpActiveRef.current = false;
      onUnlockInteraction();
      const ce = creatingEventRef.current;
      if (ce && ce.endMin - ce.startMin >= 5 && onTimeRangeSelect) {
        const s = new Date(date);
        s.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
        const ed = new Date(date);
        ed.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
        onTimeRangeSelect(s, ed);
      }
      setCreatingEvent(null);
      return;
    }

    const tapDuration = Date.now() - lpTouchTimeRef.current;
    if (!lpWasDragRef.current && !scrollingRef.current && tapDuration < 250) {
      const dx = Math.abs(pageX - lpTouchXRef.current);
      const dy = Math.abs(pageY - lpTouchYRef.current);
      if (dx < 5 && dy < 5 && onTimeRangeSelect) {
        const minutes = pageYToMinutes(pageY);
        const snappedMin = Math.round(minutes / 30) * 30;
        const s = new Date(date);
        s.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
        const ed = new Date(s.getTime() + 60 * 60 * 1000);
        onTimeRangeSelect(s, ed);
      }
    }
  }, [date, onTimeRangeSelect, pageYToMinutes, scrollingRef, onUnlockInteraction]);

  // ── Current time indicator ──
  const now = new Date();
  const currentTimeOffset = (now.getHours() + now.getMinutes() / 60 - displayStartHour) * HOUR_HEIGHT;

  // ── Wake / sleep markers for this specific day ──
  const daySleep = sleepSettings ? getSettingsForDate(sleepSettings, date) : null;
  const wakeTopY = daySleep
    ? (daySleep.wakeUpHour + daySleep.wakeUpMinute / 60 - displayStartHour) * HOUR_HEIGHT
    : null;
  const sleepTopY = daySleep
    ? (daySleep.sleepHour + daySleep.sleepMinute / 60 - displayStartHour) * HOUR_HEIGHT
    : null;
  const formatHM = (h: number, m: number) =>
    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

  return (
    <View
      style={[
        styles.dayColumn,
        {
          width: DAY_WIDTH,
          height: timelineHeight,
          borderRightColor: gridColor,
          backgroundColor: isToday ? (isDark ? 'rgba(10, 132, 255, 0.08)' : 'rgba(0, 122, 255, 0.04)') : 'transparent',
        },
      ]}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        if (lpTimerRef.current) { clearTimeout(lpTimerRef.current); lpTimerRef.current = null; }
        if (lpActiveRef.current) {
          lpActiveRef.current = false;
          onUnlockInteraction();
        }
        setCreatingEvent(null);
      }}>

      {/* Horizontal grid lines */}
      {Array.from({length: totalDisplayHours + 1}, (_, i) => (
        <View
          key={`h-${i}`}
          style={[styles.gridLineH, {top: i * HOUR_HEIGHT, backgroundColor: gridColor}]}
        />
      ))}

      {/* Wake / sleep markers — thick horizontal line spanning the day column */}
      {daySleep && wakeTopY !== null && wakeTopY >= 0 && wakeTopY <= totalDisplayHours * HOUR_HEIGHT && (
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={onOpenSleepSettings}
          style={[styles.sleepMarkerHit, {top: wakeTopY - 10}]}>
          <View style={[styles.sleepMarkerLine, {backgroundColor: '#FF9500'}]} />
        </TouchableOpacity>
      )}
      {daySleep && sleepTopY !== null && sleepTopY >= 0 && sleepTopY <= totalDisplayHours * HOUR_HEIGHT && (
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={onOpenSleepSettings}
          style={[styles.sleepMarkerHit, {top: sleepTopY - 10}]}>
          <View style={[styles.sleepMarkerLine, {backgroundColor: '#5856D6'}]} />
        </TouchableOpacity>
      )}

      {/* Events */}
      {dayEvents.map(event => {
        if (!event.startDate || !event.endDate || !event.id) return null;
        const start = new Date(event.startDate);
        const end = new Date(event.endDate);
        const dayStartTime = stripTime(date);
        const dayEndTime = new Date(dayStartTime);
        dayEndTime.setHours(23, 59, 59, 999);

        const clampedStart = start < dayStartTime ? dayStartTime : start;
        const clampedEnd = end > dayEndTime ? dayEndTime : end;
        const startMinutes = clampedStart.getHours() * 60 + clampedStart.getMinutes();
        let endMinutes = clampedEnd.getHours() * 60 + clampedEnd.getMinutes();
        if (endMinutes === 0 && end > dayEndTime) endMinutes = 24 * 60;
        if (clampedEnd >= dayEndTime) endMinutes = Math.max(endMinutes, 23 * 60 + 59);
        const duration = Math.max(endMinutes - startMinutes, 15);

        let top = ((startMinutes - displayStartHour * 60) / 60) * HOUR_HEIGHT;
        let height = Math.max((duration / 60) * HOUR_HEIGHT, 20);
        if (top < 0) {
          height = height + top;
          top = 0;
        }
        if (height <= 0 || top > totalDisplayHours * HOUR_HEIGHT) return null;

        const width = DAY_WIDTH - 4;
        const eventColor = event.id && eventColors[event.id]
          ? eventColors[event.id]
          : event.calendar?.color || colors.primary;
        const isShort = height < 30;

        return (
          <TouchableOpacity
            key={`${event.id}`}
            activeOpacity={0.75}
            style={[
              styles.eventContainer,
              styles.event,
              {
                top,
                height,
                left: 2,
                width,
                backgroundColor: eventColor + 'E8',
                borderLeftWidth: 3,
                borderLeftColor: eventColor,
              },
            ]}
            onPress={() => onEventPress?.(event)}>
            <Text style={[styles.eventTitle, isShort && {fontSize: 10}]} numberOfLines={isShort ? 1 : 2}>
              {event.title}
            </Text>
            {!isShort && (
              <Text style={styles.eventTime}>
                {start.getHours().toString().padStart(2, '0')}:{start.getMinutes().toString().padStart(2, '0')}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}

      {/* Creation preview */}
      {creatingEvent && (
        <View style={[
          styles.creationPreview,
          {
            top: ((creatingEvent.startMin - displayStartHour * 60) / 60) * HOUR_HEIGHT,
            height: Math.max(((creatingEvent.endMin - creatingEvent.startMin) / 60) * HOUR_HEIGHT, 10),
            left: 2,
            width: DAY_WIDTH - 4,
            backgroundColor: colors.primary + '40',
            borderColor: colors.primary,
          },
        ]}>
          <Text style={[styles.creationPreviewText, {color: colors.primary}]}>
            {Math.floor(creatingEvent.startMin / 60).toString().padStart(2, '0')}:
            {(creatingEvent.startMin % 60).toString().padStart(2, '0')}
            {' - '}
            {Math.floor(creatingEvent.endMin / 60).toString().padStart(2, '0')}:
            {(creatingEvent.endMin % 60).toString().padStart(2, '0')}
          </Text>
        </View>
      )}

      {/* Current time indicator (only in today's column) */}
      {isToday && (
        <>
          <View style={[styles.currentTimeBar, {
            top: currentTimeOffset,
            backgroundColor: colors.currentTimeIndicator,
          }]} />
          <View style={[styles.currentTimeDot, {
            top: currentTimeOffset - 4,
            backgroundColor: colors.currentTimeIndicator,
          }]} />
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    alignItems: 'flex-start',
  },
  timeCorner: {
    width: TIME_LABEL_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 4,
  },
  monthLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  headerDayWrapper: {
    width: DAY_WIDTH,
  },
  headerDay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  headerWeekdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 3,
  },
  headerWeekday: {
    fontSize: 11,
    fontWeight: '600',
  },
  headerBadge: {
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  headerBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  headerDateCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerDate: {
    fontSize: 16,
    fontWeight: '500',
  },
  allDayCell: {
    width: DAY_WIDTH,
    minHeight: ALL_DAY_ROW_HEIGHT,
    paddingHorizontal: 1,
    paddingVertical: 2,
    gap: 2,
  },
  allDayEvent: {
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  allDayEventText: {
    fontSize: 10,
    fontWeight: '600',
  },
  bodyScroll: {
    flex: 1,
  },
  bodyContent: {
    flexDirection: 'row',
  },
  timeLabelColumn: {
    width: TIME_LABEL_WIDTH,
    position: 'relative',
  },
  dayColumn: {
    position: 'relative',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  timeLabel: {
    position: 'absolute',
    left: 0,
    width: TIME_LABEL_WIDTH - 4,
    alignItems: 'flex-end',
  },
  timeLabelText: {
    fontSize: 10,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  eventContainer: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 4,
  },
  event: {
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  eventTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 13,
  },
  eventTime: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  sleepTimeTag: {
    position: 'absolute',
    left: 2,
    right: 2,
    height: 30,
    borderRadius: 6,
    paddingVertical: 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 70,
  },
  sleepTimeTagLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 12,
  },
  sleepTimeTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 13,
    fontVariant: ['tabular-nums'],
  },
  sleepMarkerHit: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 20,
    justifyContent: 'center',
    zIndex: 60,
  },
  sleepMarkerLine: {
    height: 3,
    borderRadius: 1.5,
    opacity: 0.9,
  },
  creationPreview: {
    position: 'absolute',
    borderRadius: 4,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  creationPreviewText: {
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  currentTimeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    zIndex: 100,
  },
  currentTimeDot: {
    position: 'absolute',
    left: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    zIndex: 101,
  },
});

export default WeekView;
