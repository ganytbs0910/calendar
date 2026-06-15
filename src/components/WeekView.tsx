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
  useWindowDimensions,
  Vibration,
  Platform,
  PanResponder,
  Animated,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {getAllEventColors} from './AddEventModal';
import {useTheme} from '../theme/ThemeContext';
import {useTranslation} from 'react-i18next';
import {SleepSettings, getSettingsForDate} from '../services/sleepSettingsService';
import TaskBottomSheet, {TaskBottomSheetRef} from './TaskBottomSheet';

const TIME_LABEL_WIDTH = 48;
const DEFAULT_HOUR_HEIGHT = 44;
const MIN_HOUR_HEIGHT = 30;
const MAX_HOUR_HEIGHT = 200;
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
  onJumpToToday?: () => void;
  /** When set, only events whose resolved color matches are rendered. */
  filterColor?: string | null;
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
  onJumpToToday,
  filterColor,
}, ref) => {
  const {colors, isDark} = useTheme();
  const {t} = useTranslation();
  const WEEKDAYS_JA = t('weekdaysSingle', {returnObjects: true}) as string[];

  // Responsive to rotation / iPad multitasking via useWindowDimensions
  const {width: screenWidth} = useWindowDimensions();
  const dayWidth = useMemo(() => (screenWidth - TIME_LABEL_WIDTH) / 7, [screenWidth]);

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

  // ── Pinch-to-zoom on the time axis ──
  const [hourHeight, setHourHeight] = useState(DEFAULT_HOUR_HEIGHT);
  const hourHeightRef = useRef(hourHeight);
  useEffect(() => { hourHeightRef.current = hourHeight; }, [hourHeight]);

  // ── Refs ──
  const headerListRef = useRef<FlatList>(null);
  const bodyListRef = useRef<FlatList>(null);
  const verticalScrollRef = useRef<ScrollView>(null);
  const verticalOffsetRef = useRef<number>(0);
  const gridTopOnScreenRef = useRef<number>(0);
  const scrollingRef = useRef<boolean>(false);
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskSheetRef = useRef<TaskBottomSheetRef>(null);

  // Pinch-zoom refs (must follow verticalScrollRef declaration above)
  const pinchActiveRef = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartHourHeightRef = useRef(DEFAULT_HOUR_HEIGHT);
  const pinchStartOffsetRef = useRef(0);
  const pinchLastScaleRef = useRef(1);
  // During the pinch we DON'T re-render per frame (that's what made it janky).
  // Instead we preview the zoom with a native scaleY transform on the grid and
  // only commit the real hourHeight (one re-layout) when the fingers lift.
  // scaleY is anchored to the top of the grid; translateY keeps the time that
  // was at the top of the viewport pinned there while scaling.
  const pinchScaleY = useRef(new Animated.Value(1)).current;
  const pinchTranslateY = useRef(new Animated.Value(0)).current;

  const commitPinch = useCallback(() => {
    if (!pinchActiveRef.current) return;
    pinchActiveRef.current = false;
    const startH = pinchStartHourHeightRef.current;
    const finalScale = pinchLastScaleRef.current;
    const newHeight = Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, startH * finalScale));
    const newOffset = pinchStartOffsetRef.current * (newHeight / startH);
    // Reset the preview transform and commit the real layout in the same JS
    // task so they land in one UI frame (no flash on the new architecture).
    pinchScaleY.setValue(1);
    pinchTranslateY.setValue(0);
    pinchLastScaleRef.current = 1;
    setHourHeight(newHeight);
    verticalScrollRef.current?.scrollTo({y: newOffset, animated: false});
    setInteractionLocked(false);
  }, [pinchScaleY, pinchTranslateY]);

  const pinchPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (e) => {
        const ts = e.nativeEvent.touches;
        if (ts.length >= 2) {
          const dx = ts[0].pageX - ts[1].pageX;
          const dy = ts[0].pageY - ts[1].pageY;
          pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
          pinchStartHourHeightRef.current = hourHeightRef.current;
          pinchStartOffsetRef.current = verticalOffsetRef.current;
          pinchLastScaleRef.current = 1;
          pinchActiveRef.current = true;
          setInteractionLocked(true);
        }
      },
      onPanResponderMove: (e) => {
        const ts = e.nativeEvent.touches;
        if (ts.length >= 2 && pinchActiveRef.current && pinchStartDistRef.current > 0) {
          const dx = ts[0].pageX - ts[1].pageX;
          const dy = ts[0].pageY - ts[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const startH = pinchStartHourHeightRef.current;
          // Clamp the scale so the resulting hour-height stays within bounds.
          const minScale = MIN_HOUR_HEIGHT / startH;
          const maxScale = MAX_HOUR_HEIGHT / startH;
          const scale = Math.max(minScale, Math.min(maxScale, dist / pinchStartDistRef.current));
          pinchLastScaleRef.current = scale;
          // Smooth, native-driven preview — no React re-render this frame.
          pinchScaleY.setValue(scale);
          pinchTranslateY.setValue(pinchStartOffsetRef.current * (1 - scale));
        }
      },
      onPanResponderRelease: commitPinch,
      onPanResponderTerminate: commitPinch,
    })
  ).current;

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
  const timelineHeight = totalDisplayHours * hourHeight + 1;

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

    const newLeftIdx = Math.round(x / dayWidth);
    if (newLeftIdx !== leftVisibleIndexRef.current) {
      leftVisibleIndexRef.current = newLeftIdx;
      const newLabel = computeMonthLabel(newLeftIdx);
      setMonthLabel(prev => (prev === newLabel ? prev : newLabel));
    }
  }, [computeMonthLabel, dayWidth]);

  // ── After a horizontal flick settles, update parent + consider a refetch. ──
  const onHorizontalMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const leftIdx = Math.round(x / dayWidth);
    const centerIdx = leftIdx + 3;

    const centerDate = getDateForIndex(centerIdx);
    const targetDate = new Date(centerDate);
    targetDate.setHours(currentDate.getHours(), currentDate.getMinutes(), 0, 0);
    onDayChange?.(targetDate);
    setSheetDate(targetDate);

    if (Math.abs(centerIdx - lastFetchCenterRef.current) > REFETCH_THRESHOLD) {
      fetchEventsForCenter(centerIdx);
    }
  }, [getDateForIndex, currentDate, onDayChange, fetchEventsForCenter, dayWidth]);

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
    const y = Math.max(0, (now.getHours() - displayStartHour - 1) * hourHeight);
    setTimeout(() => {
      verticalScrollRef.current?.scrollTo({y, animated: false});
      verticalOffsetRef.current = y;
    }, 50);
  }, [displayStartHour]);

  // ── Event lookups: group by day key once, reuse across columns. ──
  const matchesFilter = useCallback((event: CalendarEventReadable): boolean => {
    if (!filterColor) return true;
    const resolved = (event.id && eventColors[event.id]) || event.calendar?.color;
    return resolved?.toUpperCase() === filterColor.toUpperCase();
  }, [filterColor, eventColors]);

  const timedEventsByKey = useMemo(() => {
    const map = new Map<string, CalendarEventReadable[]>();
    events.forEach(event => {
      if (!event.startDate || !event.endDate || event.allDay) return;
      if (!matchesFilter(event)) return;
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
  }, [events, matchesFilter]);

  const allDayEventsByKey = useMemo(() => {
    const map = new Map<string, CalendarEventReadable[]>();
    events.forEach(event => {
      if (!event.allDay || !event.startDate) return;
      if (!matchesFilter(event)) return;
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
    length: dayWidth,
    offset: dayWidth * index,
    index,
  }), [dayWidth]);

  // Resync scroll position after window width changes (rotation / iPad split)
  useEffect(() => {
    const idx = leftVisibleIndexRef.current;
    requestAnimationFrame(() => {
      bodyListRef.current?.scrollToIndex({index: idx, animated: false});
      headerListRef.current?.scrollToIndex({index: idx, animated: false});
    });
  }, [dayWidth]);

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
      <View style={{width: dayWidth}}>
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
            isTodayDate && {borderWidth: 2, borderColor: colors.primary, borderRadius: 6},
          ]}>
            <Text style={[
              styles.headerDate,
              {color: colors.text},
              dayOfWeek === 0 && !isTodayDate && {color: colors.sunday},
              dayOfWeek === 6 && !isTodayDate && {color: colors.saturday},
              isTodayDate && {color: colors.primary, fontWeight: '700'},
            ]}>
              {date.getDate()}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={[styles.allDayCell, {width: dayWidth, borderBottomColor: colors.border}]}>
          {allDayList.slice(0, 2).map(event => {
            const evColor = eventColors[event.id] || event.calendar?.color || colors.primary;
            return (
              <TouchableOpacity
                key={event.id}
                style={[styles.allDayEvent, {backgroundColor: evColor + '22', borderLeftColor: evColor}]}
                onPress={() => onEventPress?.(event)}>
                <Text style={[styles.allDayEventText, {color: evColor}]} numberOfLines={1}>
                  {event.title}
                </Text>
              </TouchableOpacity>
            );
          })}
          {allDayList.length > 2 && (
            <Text style={{fontSize: 9, color: colors.textTertiary, textAlign: 'center'}}>
              +{allDayList.length - 2}
            </Text>
          )}
        </View>
      </View>
    );
  }, [getDateForIndex, timedEventsByKey, allDayEventsByKey, colors, isSameDay, today, WEEKDAYS_JA, currentDate, onDayChange, onEventPress, dayWidth]);

  const renderBodyItem = useCallback(({index}: {index: number}) => {
    const date = getDateForIndex(index);
    return (
      <DayColumn
        date={date}
        dayWidth={dayWidth}
        dayEvents={timedEventsByKey.get(dayKey(date)) || []}
        eventColors={eventColors}
        displayStartHour={displayStartHour}
        totalDisplayHours={totalDisplayHours}
        timelineHeight={timelineHeight}
        hourHeight={hourHeight}
        colors={colors}
        isDark={isDark}
        isToday={isSameDay(date, today)}
        onEventPress={onEventPress}
        onTimeRangeSelect={onTimeRangeSelect}
        onTapSelectDay={(d) => {
          const merged = new Date(d);
          merged.setHours(currentDate.getHours(), currentDate.getMinutes(), 0, 0);
          onDayChange?.(merged);
        }}
        onEventMoved={(eventId, newStart, newEnd) => {
          setEvents(prev => prev.map(ev =>
            ev.id === eventId
              ? {...ev, startDate: newStart.toISOString(), endDate: newEnd.toISOString()}
              : ev
          ));
        }}
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
  }, [getDateForIndex, timedEventsByKey, eventColors, displayStartHour, totalDisplayHours, timelineHeight, hourHeight, colors, isDark, isSameDay, today, onEventPress, onTimeRangeSelect, fetchEventsForCenter, lockInteraction, unlockInteraction, sleepSettings, onOpenSleepSettings, dayWidth, currentDate, onDayChange]);

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]}>
      {/* Fixed header row: corner + horizontal list of day headers */}
      <View style={[styles.header, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
        <TouchableOpacity
          style={styles.timeCorner}
          activeOpacity={0.6}
          onPress={onJumpToToday}>
          <Text style={[styles.monthLabel, {color: onJumpToToday ? colors.primary : colors.textSecondary}]}>
            {monthLabel}
          </Text>
          {onJumpToToday && (
            <Text style={[styles.jumpTodayHint, {color: colors.primary}]}>{t('today')}</Text>
          )}
        </TouchableOpacity>
        <FlatList
          ref={headerListRef}
          style={{width: screenWidth - TIME_LABEL_WIDTH}}
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
        <Animated.View
          style={[
            styles.bodyContent,
            {height: timelineHeight, transformOrigin: 'top', transform: [{translateY: pinchTranslateY}, {scaleY: pinchScaleY}]},
          ]}
          {...pinchPanResponder.panHandlers}
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
                <View key={`label-${h}`} style={[styles.timeLabel, {top: i * hourHeight - 7}]}>
                  <Text style={[styles.timeLabelText, {color: colors.textTertiary}]}>
                    {h.toString().padStart(2, '0')}:00
                  </Text>
                </View>
              ) : null;
            })}

            {/* Wake / sleep time tags (uses the weekday setting as the reference) */}
            {sleepSettings && (() => {
              const wd = sleepSettings.weekday;
              const wakeY = (wd.wakeUpHour + wd.wakeUpMinute / 60 - displayStartHour) * hourHeight;
              const sleepY = (wd.sleepHour + wd.sleepMinute / 60 - displayStartHour) * hourHeight;
              const maxY = totalDisplayHours * hourHeight;
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
                      <Text style={styles.sleepTimeTagLabel}>{`☀️${t('wakeLabel')}`}</Text>
                      <Text style={styles.sleepTimeTagText}>{fmt(wd.wakeUpHour, wd.wakeUpMinute)}</Text>
                    </TouchableOpacity>
                  )}
                  {sleepY >= 0 && sleepY <= maxY && (
                    <TouchableOpacity
                      activeOpacity={0.6}
                      onPress={onOpenSleepSettings}
                      style={[styles.sleepTimeTag, {top: sleepTop, backgroundColor: '#5856D6'}]}>
                      <Text style={styles.sleepTimeTagLabel}>{`🌙${t('bedLabel')}`}</Text>
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
            style={{width: screenWidth - TIME_LABEL_WIDTH, height: timelineHeight}}
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
            snapToInterval={dayWidth}
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
        </Animated.View>
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
// DayColumn — one dayWidth-wide, timelineHeight-tall column
// ──────────────────────────────────────────────────────────────

interface DayColumnProps {
  date: Date;
  dayWidth: number;
  dayEvents: CalendarEventReadable[];
  eventColors: Record<string, string>;
  displayStartHour: number;
  totalDisplayHours: number;
  timelineHeight: number;
  hourHeight: number;
  colors: any;
  isDark: boolean;
  isToday: boolean;
  onEventPress?: (event: CalendarEventReadable) => void;
  onTimeRangeSelect?: (startDate: Date, endDate: Date) => void;
  onTapSelectDay?: (date: Date) => void;
  onEventMoved?: (eventId: string, newStartDate: Date, newEndDate: Date) => void;
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
  dayWidth,
  dayEvents,
  eventColors,
  displayStartHour,
  totalDisplayHours,
  timelineHeight,
  hourHeight,
  colors,
  isDark,
  isToday,
  onEventPress,
  onTimeRangeSelect,
  onTapSelectDay,
  onEventMoved,
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
  const [creatingEvent, setCreatingEvent] = useState<{startMin: number; endMin: number; extraDays: number} | null>(null);
  const creatingEventRef = useRef(creatingEvent);
  useEffect(() => { creatingEventRef.current = creatingEvent; }, [creatingEvent]);

  // Moving event state
  const [movingEvent, setMovingEvent] = useState<{event: CalendarEventReadable; startMin: number; durationMin: number} | null>(null);
  const movingEventRef = useRef(movingEvent);
  useEffect(() => { movingEventRef.current = movingEvent; }, [movingEvent]);
  const lpDragModeRef = useRef<'create' | 'move'>('create');
  const lpHitEventRef = useRef<CalendarEventReadable | null>(null);
  // Suppress event TouchableOpacity onPress immediately after a long-press move
  const suppressEventPressRef = useRef(false);

  // Long-press state
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpActiveRef = useRef(false);
  const lpStartMinRef = useRef(0);
  const lpTouchYRef = useRef(0);
  const lpTouchXRef = useRef(0);
  const lpWasDragRef = useRef(false);
  const lpTouchTimeRef = useRef(0);
  const lpOffsetMinRef = useRef(0);
  const lpStartPageXRef = useRef(0);

  // ── pageY → minutes ──
  const pageYToMinutes = useCallback((pageY: number) => {
    const relativeY = pageY - gridTopOnScreenRef.current + verticalOffsetRef.current;
    const minutes = (relativeY / hourHeight) * 60 + displayStartHour * 60;
    return Math.round(minutes / 15) * 15;
  }, [displayStartHour, hourHeight, gridTopOnScreenRef, verticalOffsetRef]);

  const handleTouchStart = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;
    lpTouchYRef.current = pageY;
    lpTouchXRef.current = pageX;
    lpStartPageXRef.current = pageX;
    lpTouchTimeRef.current = Date.now();
    lpActiveRef.current = false;
    lpWasDragRef.current = false;
    lpHitEventRef.current = null;

    // Check if touch is on an existing event
    const touchMin = pageYToMinutes(pageY);
    for (const ev of dayEvents) {
      if (!ev.startDate || !ev.endDate || ev.allDay) continue;
      const s = new Date(ev.startDate);
      const eEnd = new Date(ev.endDate);
      const evStartMin = s.getHours() * 60 + s.getMinutes();
      const evEndMin = eEnd.getHours() * 60 + eEnd.getMinutes();
      if (touchMin >= evStartMin && touchMin <= evEndMin) {
        lpHitEventRef.current = ev;
        lpOffsetMinRef.current = touchMin - evStartMin;
        break;
      }
    }

    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null;
      lpActiveRef.current = true;
      lpWasDragRef.current = true;
      onLockInteraction();

      if (lpHitEventRef.current) {
        // Move existing event
        lpDragModeRef.current = 'move';
        const ev = lpHitEventRef.current;
        const s = new Date(ev.startDate!);
        const eEnd = new Date(ev.endDate!);
        const evStartMin = s.getHours() * 60 + s.getMinutes();
        const evEndMin = eEnd.getHours() * 60 + eEnd.getMinutes();
        setMovingEvent({event: ev, startMin: evStartMin, durationMin: evEndMin - evStartMin});
      } else {
        // Create new event
        lpDragModeRef.current = 'create';
        const minutes = pageYToMinutes(pageY);
        const snappedMin = Math.max(0, Math.min(23 * 60 + 55, minutes));
        lpStartMinRef.current = snappedMin;
        setCreatingEvent({startMin: snappedMin, endMin: snappedMin + 30, extraDays: 0});
      }
    }, 200);
  }, [pageYToMinutes, onLockInteraction, dayEvents]);

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

    if (lpDragModeRef.current === 'move') {
      // Move event: update start position
      const touchMin = pageYToMinutes(pageY);
      const me = movingEventRef.current;
      if (me) {
        const newStart = Math.max(0, Math.min(24 * 60 - me.durationMin, touchMin - lpOffsetMinRef.current));
        const snappedStart = Math.round(newStart / 15) * 15;
        setMovingEvent({...me, startMin: snappedStart});
      }
    } else {
      // Create event - support multi-day by tracking horizontal offset
      const dxFromOrigin = Math.abs(pageX - lpTouchXRef.current);
      const dyFromOrigin = Math.abs(pageY - lpTouchYRef.current);
      const returnedToOrigin = dxFromOrigin < 15 && dyFromOrigin < 15;
      if (returnedToOrigin) {
        if (creatingEventRef.current !== null) setCreatingEvent(null);
      } else {
        const endMin = pageYToMinutes(pageY);
        const startMin = lpStartMinRef.current;
        const dx = pageX - lpStartPageXRef.current;
        const extraDays = Math.max(0, Math.round(dx / dayWidth));
        const clampedEnd = Math.max(startMin + 30, endMin);
        setCreatingEvent({startMin, endMin: clampedEnd, extraDays});
      }
    }

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

      if (lpDragModeRef.current === 'move') {
        // Save moved event
        const me = movingEventRef.current;
        if (me && me.event.id) {
          const newStart = new Date(date);
          newStart.setHours(Math.floor(me.startMin / 60), me.startMin % 60, 0, 0);
          const newEnd = new Date(date);
          const endMin = me.startMin + me.durationMin;
          newEnd.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
          // Optimistic UI update first
          onEventMoved?.(me.event.id, newStart, newEnd);
          // Save in background
          RNCalendarEvents.saveEvent(me.event.title || '', {
            id: me.event.id,
            calendarId: me.event.calendar?.id,
            startDate: newStart.toISOString(),
            endDate: newEnd.toISOString(),
            allDay: me.event.allDay,
          }).catch(() => {});
        }
        setMovingEvent(null);
        // Block the next TouchableOpacity onPress so the edit modal doesn't open
        suppressEventPressRef.current = true;
        setTimeout(() => { suppressEventPressRef.current = false; }, 300);
      } else {
        // Finish creating event (supports multi-day)
        const ce = creatingEventRef.current;
        // Cancel creation if released near the original long-press position
        const dxFromOrigin = Math.abs(pageX - lpTouchXRef.current);
        const dyFromOrigin = Math.abs(pageY - lpTouchYRef.current);
        const returnedToOrigin = dxFromOrigin < 15 && dyFromOrigin < 15;
        if (!returnedToOrigin && ce && (ce.endMin - ce.startMin >= 30 || ce.extraDays > 0) && onTimeRangeSelect) {
          const s = new Date(date);
          s.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
          const ed = new Date(date);
          ed.setDate(ed.getDate() + ce.extraDays);
          ed.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
          if (ed > s) {
            onTimeRangeSelect(s, ed);
          }
        }
        setCreatingEvent(null);
      }
      return;
    }

    const tapDuration = Date.now() - lpTouchTimeRef.current;
    if (!lpWasDragRef.current && !scrollingRef.current && tapDuration < 250) {
      const dx = Math.abs(pageX - lpTouchXRef.current);
      const dy = Math.abs(pageY - lpTouchYRef.current);
      if (dx < 5 && dy < 5) {
        onTapSelectDay?.(date);
      }
    }
  }, [date, onTapSelectDay, onEventMoved, pageYToMinutes, scrollingRef, onUnlockInteraction]);

  // ── Current time indicator ──
  const now = new Date();
  const currentTimeOffset = (now.getHours() + now.getMinutes() / 60 - displayStartHour) * hourHeight;

  // ── Wake / sleep markers for this specific day ──
  const daySleep = sleepSettings ? getSettingsForDate(sleepSettings, date) : null;
  const wakeTopY = daySleep
    ? (daySleep.wakeUpHour + daySleep.wakeUpMinute / 60 - displayStartHour) * hourHeight
    : null;
  const sleepTopY = daySleep
    ? (daySleep.sleepHour + daySleep.sleepMinute / 60 - displayStartHour) * hourHeight
    : null;
  const formatHM = (h: number, m: number) =>
    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

  return (
    <View
      style={[
        styles.dayColumn,
        {
          width: dayWidth,
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
        setMovingEvent(null);
      }}>

      {/* Horizontal grid lines */}
      {Array.from({length: totalDisplayHours + 1}, (_, i) => (
        <View
          key={`h-${i}`}
          style={[styles.gridLineH, {top: i * hourHeight, backgroundColor: gridColor}]}
        />
      ))}

      {/* Wake / sleep markers — thick horizontal line spanning the day column */}
      {daySleep && wakeTopY !== null && wakeTopY >= 0 && wakeTopY <= totalDisplayHours * hourHeight && (
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={onOpenSleepSettings}
          style={[styles.sleepMarkerHit, {top: wakeTopY - 10}]}>
          <View style={[styles.sleepMarkerLine, {backgroundColor: '#FF9500'}]} />
        </TouchableOpacity>
      )}
      {daySleep && sleepTopY !== null && sleepTopY >= 0 && sleepTopY <= totalDisplayHours * hourHeight && (
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

        let top = ((startMinutes - displayStartHour * 60) / 60) * hourHeight;
        let height = Math.max((duration / 60) * hourHeight, 20);
        if (top < 0) {
          height = height + top;
          top = 0;
        }
        if (height <= 0 || top > totalDisplayHours * hourHeight) return null;

        const width = dayWidth - 4;
        const eventColor = event.id && eventColors[event.id]
          ? eventColors[event.id]
          : event.calendar?.color || colors.primary;
        const isShort = height < 30;

        const isBeingMoved = movingEvent?.event.id === event.id;

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
                opacity: isBeingMoved ? 0.3 : 1,
              },
            ]}
            onPress={() => {
              if (suppressEventPressRef.current) {
                suppressEventPressRef.current = false;
                return;
              }
              onEventPress?.(event);
            }}>
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
      {creatingEvent && (() => {
        const totalDays = creatingEvent.extraDays;
        const endMinInLastDay = creatingEvent.endMin;
        const startMin = creatingEvent.startMin;
        const displayStart = displayStartHour * 60;
        const fmtTime = (m: number) => `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;

        if (totalDays === 0) {
          // Single day - simple rectangle
          return (
            <View style={[
              styles.creationPreview,
              {
                top: ((startMin - displayStart) / 60) * hourHeight,
                height: Math.max(((creatingEvent.endMin - startMin) / 60) * hourHeight, 10),
                left: 2,
                width: dayWidth - 4,
                backgroundColor: colors.primary + '40',
                borderColor: colors.primary,
                zIndex: 50,
              },
            ]}>
              <Text style={[styles.creationPreviewText, {color: colors.primary}]}>
                {fmtTime(startMin)} - {fmtTime(creatingEvent.endMin)}
              </Text>
            </View>
          );
        }

        // Multi-day: render separate preview for each day
        const previews = [];
        // First day: startMin to end of day
        const firstDayEnd = 24 * 60;
        previews.push(
          <View key="day-0" style={[
            styles.creationPreview,
            {
              top: ((startMin - displayStart) / 60) * hourHeight,
              height: Math.max(((firstDayEnd - startMin) / 60) * hourHeight, 10),
              left: 2,
              width: dayWidth - 4,
              backgroundColor: colors.primary + '40',
              borderColor: colors.primary,
              zIndex: 50,
            },
          ]}>
            <Text style={[styles.creationPreviewText, {color: colors.primary}]}>
              {fmtTime(startMin)} -
            </Text>
          </View>
        );
        // Middle full days
        for (let d = 1; d < totalDays; d++) {
          previews.push(
            <View key={`day-${d}`} style={[
              styles.creationPreview,
              {
                top: ((0 - displayStart) / 60) * hourHeight,
                height: (24 * 60 / 60) * hourHeight,
                left: d * dayWidth + 2,
                width: dayWidth - 4,
                backgroundColor: colors.primary + '30',
                borderColor: colors.primary,
                zIndex: 50,
              },
            ]} />
          );
        }
        // Last day: start of day to endMinInLastDay
        if (endMinInLastDay > 0) {
          previews.push(
            <View key={`day-${totalDays}`} style={[
              styles.creationPreview,
              {
                top: ((0 - displayStart) / 60) * hourHeight,
                height: Math.max((endMinInLastDay / 60) * hourHeight, 10),
                left: totalDays * dayWidth + 2,
                width: dayWidth - 4,
                backgroundColor: colors.primary + '40',
                borderColor: colors.primary,
                zIndex: 50,
              },
            ]}>
              <Text style={[styles.creationPreviewText, {color: colors.primary}]}>
                - {fmtTime(endMinInLastDay)}
              </Text>
            </View>
          );
        }
        return <>{previews}</>;
      })()}

      {/* Move event preview */}
      {movingEvent && (() => {
        const moveColor = (movingEvent.event.id && eventColors[movingEvent.event.id])
          || movingEvent.event.calendar?.color || colors.primary;
        const moveTop = ((movingEvent.startMin - displayStartHour * 60) / 60) * hourHeight;
        const moveHeight = Math.max((movingEvent.durationMin / 60) * hourHeight, 20);
        const moveEndMin = movingEvent.startMin + movingEvent.durationMin;
        return (
          <View style={[
            styles.eventContainer,
            styles.event,
            {
              top: moveTop,
              height: moveHeight,
              left: 2,
              width: dayWidth - 4,
              backgroundColor: moveColor + 'CC',
              borderLeftWidth: 3,
              borderLeftColor: moveColor,
              zIndex: 100,
            },
          ]}>
            <Text style={styles.eventTitle} numberOfLines={1}>{movingEvent.event.title}</Text>
            <Text style={styles.eventTime}>
              {Math.floor(movingEvent.startMin / 60).toString().padStart(2, '0')}:
              {(movingEvent.startMin % 60).toString().padStart(2, '0')}
              {' - '}
              {Math.floor(moveEndMin / 60).toString().padStart(2, '0')}:
              {(moveEndMin % 60).toString().padStart(2, '0')}
            </Text>
          </View>
        );
      })()}

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
  jumpTodayHint: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
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
    minHeight: ALL_DAY_ROW_HEIGHT,
    paddingHorizontal: 1,
    paddingVertical: 2,
    gap: 2,
  },
  allDayEvent: {
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderLeftWidth: 2,
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
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 11,
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
