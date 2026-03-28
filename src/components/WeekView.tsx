import React, {useState, useCallback, useRef, useEffect, useMemo, forwardRef, useImperativeHandle} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  PanResponder,
  Vibration,
  Alert,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {getAllEventColors} from './AddEventModal';
import {useTheme} from '../theme/ThemeContext';
import {SleepSettings, getSettingsForDate} from '../services/sleepSettingsService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TIME_LABEL_WIDTH = 48;
const DAY_WIDTH = (SCREEN_WIDTH - TIME_LABEL_WIDTH) / 7;
const HOUR_HEIGHT = 44;
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

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
}

export const WeekView = forwardRef<WeekViewRef, WeekViewProps>(({
  currentDate,
  onEventPress,
  onTimeRangeSelect,
  onDayChange,
  hasPermission,
  sleepSettings,
}, ref) => {
  const {colors, isDark} = useTheme();
  const scrollViewRef = useRef<ScrollView>(null);
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [eventColors, setEventColors] = useState<Record<string, string>>({});
  const hasScrolledRef = useRef(false);
  const scrollOffsetRef = useRef(0);

  // Long-press creation state
  const [creatingEvent, setCreatingEvent] = useState<{
    dayIndex: number;
    startMin: number;
    endMin: number;
  } | null>(null);
  const creatingEventRef = useRef(creatingEvent);
  useEffect(() => { creatingEventRef.current = creatingEvent; }, [creatingEvent]);

  // Swipe-to-delete state
  const [swipingEventId, setSwipingEventId] = useState<string | null>(null);
  const swipeOffsets = useRef<Map<string, number>>(new Map());
  const [, forceRender] = useState(0);

  // Long-press refs
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpActiveRef = useRef(false);
  const lpStartMinRef = useRef(0);
  const lpDayIndexRef = useRef(0);
  const lpTouchYRef = useRef(0);
  const lpTouchXRef = useRef(0);
  const lpWasDragRef = useRef(false);
  const lpTouchTimeRef = useRef(0);
  const scrollingRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridTopOnScreenRef = useRef(0);
  const timelineRef = useRef<View>(null);

  // Grid colors — subtle so events stand out
  const gridColor = isDark ? '#2c2c2e' : '#e0e0e0';

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({length: 7}, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  // Display hour range based on sleep settings
  const {displayStartHour, displayEndHour} = useMemo(() => {
    if (!sleepSettings) return {displayStartHour: 0, displayEndHour: 24};
    // Use the earlier wake time and later sleep time across weekday/weekend
    const wakeHour = Math.min(sleepSettings.weekday.wakeUpHour, sleepSettings.weekend.wakeUpHour);
    const sleepHour = Math.max(sleepSettings.weekday.sleepHour, sleepSettings.weekend.sleepHour);
    return {
      displayStartHour: Math.max(0, wakeHour),
      displayEndHour: Math.min(25, sleepHour + 1), // +1 for buffer
    };
  }, [sleepSettings]);

  const totalDisplayHours = displayEndHour - displayStartHour;

  const fetchEvents = useCallback(async () => {
    if (!hasPermission) return;
    try {
      const start = new Date(weekStart);
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 7);
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
      const fetchedColors = await getAllEventColors();
      setEventColors(fetchedColors);
    } catch {
      // ignore
    }
  }, [hasPermission, weekStart]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  useEffect(() => {
    if (!hasScrolledRef.current) {
      const now = new Date();
      const scrollY = Math.max(0, (now.getHours() - displayStartHour - 1) * HOUR_HEIGHT);
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({y: scrollY, animated: false});
      }, 100);
      hasScrolledRef.current = true;
    }
  }, [displayStartHour]);

  useImperativeHandle(ref, () => ({
    refreshEvents: fetchEvents,
  }), [fetchEvents]);

  // ── Helper: pageY → minutes ──
  const pageYToMinutes = useCallback((pageY: number) => {
    const relativeY = pageY - gridTopOnScreenRef.current + scrollOffsetRef.current;
    const minutes = (relativeY / HOUR_HEIGHT) * 60 + displayStartHour * 60;
    return Math.round(minutes / 5) * 5; // snap to 5 min
  }, [displayStartHour]);

  // ── Helper: pageX → dayIndex ──
  const pageXToDayIndex = useCallback((pageX: number) => {
    const relativeX = pageX - TIME_LABEL_WIDTH;
    const index = Math.floor(relativeX / DAY_WIDTH);
    return Math.max(0, Math.min(6, index));
  }, []);

  // ── Long press creation handlers ──
  const handleTouchStart = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;
    lpTouchYRef.current = pageY;
    lpTouchXRef.current = pageX;
    lpTouchTimeRef.current = Date.now();
    lpActiveRef.current = false;
    lpWasDragRef.current = false;

    // Only start long press if touch is in grid area
    if (pageX < TIME_LABEL_WIDTH) return;

    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null;
      lpActiveRef.current = true;
      lpWasDragRef.current = true;
      Vibration.vibrate(50);

      const dayIndex = pageXToDayIndex(pageX);
      const minutes = pageYToMinutes(pageY);
      const snappedMin = Math.max(0, Math.min(23 * 60 + 55, minutes));

      lpDayIndexRef.current = dayIndex;
      lpStartMinRef.current = snappedMin;
      setCreatingEvent({dayIndex, startMin: snappedMin, endMin: snappedMin + 30});
    }, 300);
  }, [pageYToMinutes, pageXToDayIndex]);

  const handleTouchMove = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;

    if (!lpActiveRef.current) {
      // Cancel long press if moved too far
      if (lpTimerRef.current) {
        if (Math.abs(pageY - lpTouchYRef.current) > 10 || Math.abs(pageX - lpTouchXRef.current) > 10) {
          clearTimeout(lpTimerRef.current);
          lpTimerRef.current = null;
        }
      }
      return;
    }

    // Update creation preview
    const endMin = pageYToMinutes(pageY);
    const startMin = lpStartMinRef.current;
    const clampedEnd = Math.max(startMin + 5, Math.min(24 * 60, endMin));
    setCreatingEvent({
      dayIndex: lpDayIndexRef.current,
      startMin,
      endMin: clampedEnd,
    });

    // Auto-scroll
    const screenH = Dimensions.get('window').height;
    if (pageY > screenH - 80) {
      scrollViewRef.current?.scrollTo({
        y: scrollOffsetRef.current + 20,
        animated: false,
      });
    } else if (pageY < 150) {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, scrollOffsetRef.current - 20),
        animated: false,
      });
    }
  }, [pageYToMinutes]);

  const handleTouchEnd = useCallback((e: any) => {
    const {pageX, pageY} = e.nativeEvent;

    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }

    if (lpActiveRef.current) {
      lpActiveRef.current = false;
      const ce = creatingEventRef.current;
      if (ce && ce.endMin - ce.startMin >= 5 && onTimeRangeSelect) {
        const day = weekDays[ce.dayIndex];
        const s = new Date(day);
        s.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
        const ed = new Date(day);
        ed.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
        onTimeRangeSelect(s, ed);
      }
      setCreatingEvent(null);
      return;
    }

    // Single tap on empty slot → create 1-hour event
    // Must be: quick tap (< 250ms), no movement, not scrolling
    const tapDuration = Date.now() - lpTouchTimeRef.current;
    if (!lpWasDragRef.current && !scrollingRef.current && tapDuration < 250 && pageX > TIME_LABEL_WIDTH) {
      const dx = Math.abs(pageX - lpTouchXRef.current);
      const dy = Math.abs(pageY - lpTouchYRef.current);
      if (dx < 5 && dy < 5 && onTimeRangeSelect) {
        const dayIndex = pageXToDayIndex(pageX);
        const minutes = pageYToMinutes(pageY);
        const snappedMin = Math.round(minutes / 30) * 30; // snap to 30min
        const day = weekDays[dayIndex];
        const s = new Date(day);
        s.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
        const ed = new Date(s.getTime() + 60 * 60 * 1000); // 1 hour
        onTimeRangeSelect(s, ed);
        return;
      }
    }
  }, [weekDays, onTimeRangeSelect]);

  // ── Swipe-to-delete for events ──
  const eventSwipeRefs = useRef<Map<string, {startX: number; startY: number; active: boolean}>>(new Map());

  const handleEventTouchStart = useCallback((eventId: string, pageX: number, pageY: number) => {
    eventSwipeRefs.current.set(eventId, {startX: pageX, startY: pageY, active: false});
    swipeOffsets.current.set(eventId, 0);
  }, []);

  const handleEventTouchMove = useCallback((eventId: string, pageX: number, pageY: number) => {
    const ref = eventSwipeRefs.current.get(eventId);
    if (!ref) return;

    const dx = pageX - ref.startX;
    const dy = pageY - ref.startY;

    // Only horizontal swipe
    if (!ref.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      ref.active = true;
    }

    if (ref.active && dx < 0) {
      swipeOffsets.current.set(eventId, dx);
      setSwipingEventId(eventId);
      forceRender(v => v + 1);
    }
  }, []);

  const handleEventTouchEnd = useCallback((eventId: string, event: CalendarEventReadable) => {
    const offset = swipeOffsets.current.get(eventId) || 0;
    const ref = eventSwipeRefs.current.get(eventId);

    if (ref?.active && offset < -60) {
      // Show delete confirmation
      Alert.alert(
        '予定を削除',
        `「${event.title}」を削除しますか？`,
        [
          {
            text: 'キャンセル',
            style: 'cancel',
            onPress: () => {
              swipeOffsets.current.set(eventId, 0);
              setSwipingEventId(null);
              forceRender(v => v + 1);
            },
          },
          {
            text: '削除',
            style: 'destructive',
            onPress: async () => {
              try {
                await RNCalendarEvents.removeEvent(eventId);
                fetchEvents();
              } catch {
                Alert.alert('エラー', '削除に失敗しました');
              }
              swipeOffsets.current.set(eventId, 0);
              setSwipingEventId(null);
            },
          },
        ],
      );
    } else {
      swipeOffsets.current.set(eventId, 0);
      setSwipingEventId(null);
      forceRender(v => v + 1);

      // If not a swipe, treat as tap
      if (!ref?.active) {
        onEventPress?.(event);
      }
    }

    eventSwipeRefs.current.delete(eventId);
  }, [fetchEvents, onEventPress]);

  // ── Swipe week navigation ──
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => {
      if (lpActiveRef.current) return false;
      return Math.abs(gs.dx) > 30 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
    },
    onPanResponderRelease: (_, gs) => {
      if (lpActiveRef.current) return;
      const threshold = SCREEN_WIDTH * 0.2;
      if (Math.abs(gs.dx) > threshold) {
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() + (gs.dx > 0 ? -7 : 7));
        onDayChange?.(newDate);
      }
    },
  }), [currentDate, onDayChange]);

  // ── Event grouping ──
  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEventReadable[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);

    events.forEach(event => {
      if (!event.startDate || !event.endDate || event.allDay) return;
      const eventStart = new Date(event.startDate);
      for (let i = 0; i < 7; i++) {
        const day = weekDays[i];
        if (
          eventStart.getFullYear() === day.getFullYear() &&
          eventStart.getMonth() === day.getMonth() &&
          eventStart.getDate() === day.getDate()
        ) {
          map.get(i)!.push(event);
          break;
        }
      }
    });
    return map;
  }, [events, weekDays]);

  const allDayEventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEventReadable[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);

    events.forEach(event => {
      if (!event.startDate || !event.allDay) return;
      const eventStart = new Date(event.startDate);
      for (let i = 0; i < 7; i++) {
        const day = weekDays[i];
        if (
          eventStart.getFullYear() === day.getFullYear() &&
          eventStart.getMonth() === day.getMonth() &&
          eventStart.getDate() === day.getDate()
        ) {
          map.get(i)!.push(event);
          break;
        }
      }
    });
    return map;
  }, [events, weekDays]);

  const hasAllDayEvents = useMemo(() => {
    for (let i = 0; i < 7; i++) {
      if ((allDayEventsByDay.get(i) || []).length > 0) return true;
    }
    return false;
  }, [allDayEventsByDay]);

  const today = new Date();
  const isToday = useCallback((date: Date) =>
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate(),
  [today]);

  const currentTimeOffset = useMemo(() => {
    const now = new Date();
    return (now.getHours() + now.getMinutes() / 60 - displayStartHour) * HOUR_HEIGHT;
  }, [displayStartHour]);

  const todayColumnIndex = useMemo(() => {
    for (let i = 0; i < 7; i++) {
      if (isToday(weekDays[i])) return i;
    }
    return -1;
  }, [weekDays, isToday]);

  const monthDisplay = useMemo(() => {
    const startMonth = weekStart.getMonth() + 1;
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    const endMonth = endDate.getMonth() + 1;
    if (startMonth === endMonth) return `${startMonth}月`;
    return `${startMonth}-${endMonth}月`;
  }, [weekStart]);

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]} {...panResponder.panHandlers}>
      {/* Week header */}
      <View style={[styles.header, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
        <View style={styles.timeCorner}>
          <Text style={[styles.monthLabel, {color: colors.textSecondary}]}>
            {monthDisplay}
          </Text>
        </View>
        {weekDays.map((day, i) => {
          const isTodayDate = isToday(day);
          const dayOfWeek = day.getDay();
          return (
            <View key={i} style={styles.headerDayWrapper}>
              <TouchableOpacity
                style={styles.headerDay}
                onPress={() => onDayChange?.(weekDays[i])}
                activeOpacity={0.6}>
                <Text style={[
                  styles.headerWeekday,
                  {color: colors.textTertiary},
                  dayOfWeek === 0 && {color: colors.sunday},
                  dayOfWeek === 6 && {color: colors.saturday},
                  isTodayDate && {color: colors.primary},
                ]}>
                  {WEEKDAYS_JA[dayOfWeek]}
                </Text>
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
                    {day.getDate()}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* All-day events row */}
      {hasAllDayEvents && (
        <View style={[styles.allDayRow, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
          <View style={styles.allDayLabel}>
            <Text style={[styles.allDayLabelText, {color: colors.textTertiary}]}>終日</Text>
          </View>
          {weekDays.map((_, i) => {
            const dayAllDay = allDayEventsByDay.get(i) || [];
            return (
              <View key={i} style={styles.allDayCell}>
                {dayAllDay.slice(0, 2).map(event => (
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
            );
          })}
        </View>
      )}

      {/* Timeline */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        scrollEnabled={!lpActiveRef.current}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
          scrollingRef.current = true;
          if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = setTimeout(() => { scrollingRef.current = false; }, 150);
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View
          ref={timelineRef}
          style={[styles.timelineContainer, {height: totalDisplayHours * HOUR_HEIGHT + 1}]}
          onLayout={() => {
            timelineRef.current?.measureInWindow((_x: number, y: number) => {
              gridTopOnScreenRef.current = y;
            });
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => {
            if (lpTimerRef.current) { clearTimeout(lpTimerRef.current); lpTimerRef.current = null; }
            lpActiveRef.current = false;
            setCreatingEvent(null);
          }}>

          {/* Today column highlight */}
          {todayColumnIndex >= 0 && (
            <View
              style={[
                styles.todayColumnHighlight,
                {
                  left: TIME_LABEL_WIDTH + todayColumnIndex * DAY_WIDTH + 1,
                  width: DAY_WIDTH - 1,
                  backgroundColor: isDark ? 'rgba(10, 132, 255, 0.08)' : 'rgba(0, 122, 255, 0.04)',
                },
              ]}
            />
          )}

          {/* Horizontal grid lines */}
          {Array.from({length: totalDisplayHours + 1}, (_, i) => (
            <View key={i} style={[styles.gridLineH, {
              top: i * HOUR_HEIGHT,
              backgroundColor: gridColor,
              left: TIME_LABEL_WIDTH,
            }]} />
          ))}

          {/* Vertical column lines */}
          {Array.from({length: 8}, (_, i) => (
            <View
              key={`col-${i}`}
              style={[styles.gridLineV, {
                left: TIME_LABEL_WIDTH + i * DAY_WIDTH,
                backgroundColor: gridColor,
              }]}
            />
          ))}

          {/* Time labels */}
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

          {/* Events */}
          {Array.from({length: 7}, (_, dayIndex) => {
            const dayEvents = eventsByDay.get(dayIndex) || [];
            return dayEvents.map(event => {
              if (!event.startDate || !event.endDate || !event.id) return null;
              const start = new Date(event.startDate);
              const end = new Date(event.endDate);
              const startMinutes = start.getHours() * 60 + start.getMinutes();
              const endMinutes = end.getHours() * 60 + end.getMinutes();
              const duration = Math.max(endMinutes - startMinutes, 15);

              const top = ((startMinutes - displayStartHour * 60) / 60) * HOUR_HEIGHT;
              const height = Math.max((duration / 60) * HOUR_HEIGHT, 20);
              const baseLeft = TIME_LABEL_WIDTH + dayIndex * DAY_WIDTH + 2;
              const width = DAY_WIDTH - 4;

              const eventColor = event.id && eventColors[event.id]
                ? eventColors[event.id]
                : event.calendar?.color || colors.primary;

              const isShort = height < 30;
              const swipeX = swipeOffsets.current.get(event.id) || 0;

              return (
                <View
                  key={`${event.id}-${dayIndex}`}
                  style={[styles.eventContainer, {top, height, left: baseLeft, width}]}>
                  {/* Delete background */}
                  {swipeX < -10 && (
                    <View style={[styles.deleteBackground, {backgroundColor: colors.delete}]}>
                      <Text style={styles.deleteBackgroundText}>削除</Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.event,
                      {
                        height,
                        width: width,
                        backgroundColor: eventColor + 'E8',
                        borderLeftWidth: 3,
                        borderLeftColor: eventColor,
                        transform: [{translateX: Math.min(0, swipeX)}],
                      },
                    ]}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      handleEventTouchStart(event.id, e.nativeEvent.pageX, e.nativeEvent.pageY);
                    }}
                    onTouchMove={(e) => {
                      e.stopPropagation();
                      handleEventTouchMove(event.id, e.nativeEvent.pageX, e.nativeEvent.pageY);
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      handleEventTouchEnd(event.id, event);
                    }}>
                    <Text style={[styles.eventTitle, isShort && {fontSize: 10}]} numberOfLines={isShort ? 1 : 2}>
                      {event.title}
                    </Text>
                    {!isShort && (
                      <Text style={styles.eventTime}>
                        {start.getHours().toString().padStart(2, '0')}:{start.getMinutes().toString().padStart(2, '0')}
                      </Text>
                    )}
                  </View>
                </View>
              );
            });
          })}

          {/* Creation preview */}
          {creatingEvent && (
            <View style={[
              styles.creationPreview,
              {
                top: ((creatingEvent.startMin - displayStartHour * 60) / 60) * HOUR_HEIGHT,
                height: Math.max(((creatingEvent.endMin - creatingEvent.startMin) / 60) * HOUR_HEIGHT, 10),
                left: TIME_LABEL_WIDTH + creatingEvent.dayIndex * DAY_WIDTH + 2,
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

          {/* Current time indicator */}
          {todayColumnIndex >= 0 && (
            <>
              <View style={[styles.currentTimeLabelBg, {
                top: currentTimeOffset - 8,
                backgroundColor: colors.currentTimeIndicator,
              }]}>
                <Text style={styles.currentTimeLabelText}>
                  {new Date().getHours().toString().padStart(2, '0')}:{new Date().getMinutes().toString().padStart(2, '0')}
                </Text>
              </View>
              <View style={[styles.currentTimeBar, {
                top: currentTimeOffset,
                backgroundColor: colors.currentTimeIndicator,
              }]} />
              <View style={[styles.currentTimeDot, {
                top: currentTimeOffset - 4,
                left: TIME_LABEL_WIDTH + todayColumnIndex * DAY_WIDTH - 4,
                backgroundColor: colors.currentTimeIndicator,
              }]} />
            </>
          )}
        </View>
      </ScrollView>
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
    alignItems: 'center',
  },
  timeCorner: {
    width: TIME_LABEL_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
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
  headerWeekday: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
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
  allDayRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    minHeight: 28,
    alignItems: 'center',
  },
  allDayLabel: {
    width: TIME_LABEL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allDayLabelText: {
    fontSize: 10,
    fontWeight: '500',
  },
  allDayCell: {
    width: DAY_WIDTH,
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
  scrollView: {
    flex: 1,
  },
  timelineContainer: {
    position: 'relative',
  },
  gridLineH: {
    position: 'absolute',
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  todayColumnHighlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
  deleteBackground: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 6,
  },
  deleteBackgroundText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
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
  currentTimeLabelBg: {
    position: 'absolute',
    left: 2,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 101,
    width: TIME_LABEL_WIDTH - 4,
    alignItems: 'center',
  },
  currentTimeLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  currentTimeBar: {
    position: 'absolute',
    left: TIME_LABEL_WIDTH,
    right: 0,
    height: 2,
    zIndex: 100,
  },
  currentTimeDot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    zIndex: 101,
  },
});

export default WeekView;
