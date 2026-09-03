import React, {useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Modal,
  Animated,
  PanResponder,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {getAllEventColors} from './AddEventModal';
import {getAllEventPhotoCounts} from '../services/eventPhotoService';
import {cancelEventNotification, getEventIdsWithTriggerNotifications} from '../services/notificationService';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {fetchWeather, WeatherDay} from '../services/weatherService';
import {useTheme} from '../theme/ThemeContext';
import {useTranslation} from 'react-i18next';
import {eventDayKeys, eventDayRange} from '../utils/eventDays';
import {CalendarEventStore} from '../types/calendarEventStore';

const MONTH_ANCHOR = 120; // Center index for infinite-like scrolling
// Container has paddingHorizontal: 12 (both sides = 24) total. The real grid
// width is measured at runtime — see gridWidth — because the app runs in a
// resizable window on iPad; these only seed the first paint.
const GRID_HORIZONTAL_PADDING = 24;
const HEIGHT_CHROME = 280; // header, weekday row, margins, safe area, tab bar
const EVENT_BAR_HEIGHT = 36; // Height of multi-day event bar
const DAY_NUMBER_HEIGHT = 20; // Space for day number


interface CalendarProps {
  onDateSelect?: (date: Date) => void;
  onDateDoubleSelect?: (date: Date) => void;
  onEventPress?: (event: CalendarEventReadable) => void;
  onDateRangeSelect?: (startDate: Date, endDate: Date) => void;
  onMonthChange?: (date: Date) => void;
  hasPermission?: boolean;
  fullscreenMode?: boolean;
  /** When set, only events whose resolved color matches are rendered. */
  filterColor?: string | null;
  /**
   * Bulk-selection mode: tapping an event marks it instead of opening it, and
   * the gestures that would compete for the same tap (day sheet, date-range
   * drag) are suspended.
   */
  selectionMode?: boolean;
  /** Keys from eventOccurrenceKey — one entry per selected occurrence. */
  selectedEventKeys?: ReadonlySet<string>;
  onToggleEventSelection?: (event: CalendarEventReadable) => void;
  /**
   * Long-pressing an event outside selection mode used to start a
   * drag-to-move; it now hands the event here so the caller can enter
   * selection mode with this event pre-selected instead.
   */
  onEventLongPressSelect?: (event: CalendarEventReadable) => void;
  /** Uses the identical calendar UI with a non-EventKit backing store. */
  eventStore?: CalendarEventStore;
}

export interface CalendarRef {
  refreshEvents: () => void;
  goToToday: () => void;
}

/**
 * Identifies one *occurrence*, not one event.
 *
 * Every occurrence of a recurring series carries the same id — occurrenceDate
 * is what tells them apart. Keying a selection by id alone would make tapping
 * one week's shift mark every week's, and delete the whole series with it.
 */
export const eventOccurrenceKey = (event: CalendarEventReadable): string =>
  `${event.id}::${event.occurrenceDate ?? event.startDate ?? ''}`;

/** A multi-day event's span within one week row, and the row it stacks on. */
type MultiDayBar = {
  event: CalendarEventReadable;
  startDayIndex: number;
  endDayIndex: number;
  rowIndex: number;
};

/** Everything a month page derives from its month and events — see getPageModel. */
type PageModel = {
  days: Array<{day: number; isCurrentMonth: boolean; date: Date | null}>;
  weeks: number;
  getEventsForDate: (date: Date) => CalendarEventReadable[];
  multiDayByWeek: MultiDayBar[][];
};

/**
 * The first and last calendar day an event occupies, inclusive, as midnights.
 *
 * All-day events from iCal/EventKit end at next-day 00:00, so the end is pulled
 * back a millisecond before the day is taken — without that they read as one
 * day longer than they are. Every place that maps an event onto day cells must
 * go through here; having the adjustment in some of them and not others is what
 * made all-day bars overhang by a day.
 *
 * Returns null for events missing either endpoint, so callers can skip them.
 */
// Wraps the month grid in a vertical ScrollView when fullscreen mode is on,
// so days with many events can grow tall and the user can scroll.
const ConditionalScroll: React.FC<{fullscreen: boolean; children: React.ReactNode}> = ({fullscreen, children}) =>
  fullscreen
    ? <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 80}} nestedScrollEnabled>{children}</ScrollView>
    : <>{children}</>;

export const Calendar = forwardRef<CalendarRef, CalendarProps>(({onDateSelect, onDateDoubleSelect, onEventPress, onDateRangeSelect, onMonthChange, hasPermission: hasPermissionProp, fullscreenMode, filterColor, selectionMode, selectedEventKeys, onToggleEventSelection, onEventLongPressSelect, eventStore}, ref) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  // Seeds for the first paint only; both are replaced by the measured grid
  // below as soon as it lays out. The window is resizable on iPad, so nothing
  // may be derived from a size captured once.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const [today, setToday] = useState(() => new Date());

  // Update 'today' when the date changes (e.g. app stays open past midnight)
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      if (cancelled) return;
      const now = new Date();
      const msUntilMidnight =
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        setToday(new Date());
        scheduleNext();
      }, msUntilMidnight + 1000);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [hasPermissionInternal, setHasPermissionInternal] = useState(false);
  const hasPermission = eventStore ? true : (hasPermissionProp ?? hasPermissionInternal);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache version - increment to trigger re-render when cache updates
  const [cacheVersion, setCacheVersion] = useState(0);

  // Event cache by month key (e.g., "2026-2" for March 2026)
  const eventsCache = useRef<Map<string, CalendarEventReadable[]>>(new Map());
  const eventColorsCache = useRef<Record<string, string> | null>(null);
  const isFetching = useRef(false);
  const [showDayEvents, setShowDayEvents] = useState(false);
  const [dayEventsDate, setDayEventsDate] = useState<Date | null>(null);
  const bottomSheetAnim = useState(new Animated.Value(0))[0];
  const [eventColors, setEventColors] = useState<Record<string, string>>({});
  // eventId → photo count, for the 📷 badge on the month grid (⑦ 写真ライフログ)
  const [eventPhotos, setEventPhotos] = useState<Record<string, number>>({});
  // Event ids with an in-app reminder scheduled, for the 🔔 badge on the
  // month grid. An OS-alarm reminder doesn't need this — it's read straight
  // off event.alarms at render time (see hasReminder below).
  const [eventNotifIds, setEventNotifIds] = useState<Set<string>>(new Set());
  const [weatherData, setWeatherData] = useState<Map<string, WeatherDay>>(new Map());

  // Drag selection state
  const [dragStartDate, setDragStartDate] = useState<Date | null>(null);
  const [dragEndDate, setDragEndDate] = useState<Date | null>(null);
  const gridLayoutRef = useRef<{x: number; y: number; width: number; height: number} | null>(null);
  const calendarDaysRef = useRef<Array<{day: number; date: Date | null; isCurrentMonth: boolean}>>([]);
  const numberOfWeeksRef = useRef(5);

  const dragModeRef = useRef<'dateRange' | null>(null);

  // Swipe gesture for month navigation and drag selection
  const currentDateRef = useRef(currentDate);
  const isDraggingRef = useRef(false);
  const dragStartDateRef = useRef<Date | null>(null);
  const dragEndDateRef = useRef<Date | null>(null);
  const onDateRangeSelectRef = useRef(onDateRangeSelect);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEventsRef = useRef<(forceRefresh?: boolean) => void>(() => {});
  const dayHeightRef = useRef(Math.floor((windowHeight - HEIGHT_CHROME) / 5));
  // Actual space available for the grid, measured at runtime so the last week
  // never gets clipped by the tab bar (the window-derived value is only a
  // first-paint fallback and is wrong on some devices).
  const [gridHeight, setGridHeight] = useState(windowHeight - HEIGHT_CHROME);
  // Same story horizontally: month pages, day cells and the touch-to-date math
  // are all sized from this, so it must follow window resizes.
  const [gridWidth, setGridWidth] = useState(windowWidth - GRID_HORIZONTAL_PADDING);

  // FlatList month paging
  const monthListRef = useRef<FlatList>(null);
  const [baseDate] = useState(() => new Date()); // Fixed reference date
  const monthData = useMemo(() => Array.from({length: MONTH_ANCHOR * 2 + 1}, (_, i) => i), []);

  const getMonthForIndex = useCallback((index: number) => {
    const offset = index - MONTH_ANCHOR;
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
    return {year: d.getFullYear(), month: d.getMonth()};
  }, [baseDate]);

  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);
  useEffect(() => { onDateRangeSelectRef.current = onDateRangeSelect; }, [onDateRangeSelect]);
  useEffect(() => { dragEndDateRef.current = dragEndDate; }, [dragEndDate]);
  useEffect(() => { onMonthChange?.(currentDate); }, [currentDate, onMonthChange]);

  // A width change re-lays out every month page, which leaves the pager resting
  // between two of them. Snap back to the month that is actually selected.
  useEffect(() => {
    const cur = currentDateRef.current;
    const idx =
      MONTH_ANCHOR +
      (cur.getFullYear() - baseDate.getFullYear()) * 12 +
      (cur.getMonth() - baseDate.getMonth());
    monthListRef.current?.scrollToIndex({index: idx, animated: false});
    // Only re-snap when the page width changes; normal paging scrolls itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridWidth]);

  // Get date from touch position (uses ref to avoid stale closure)
  const getDateFromPosition = useCallback((pageX: number, pageY: number): Date | null => {
    const layout = gridLayoutRef.current;
    if (!layout) return null;

    const x = pageX - layout.x;
    const y = pageY - layout.y;

    if (x < 0 || y < 0 || x > layout.width || y > layout.height) return null;

    // Derive the column from the grid's own measured width. Using a width
    // captured at startup would map the touch to the wrong day after an iPad
    // window resize.
    const dayIndex = Math.min(6, Math.floor((x / layout.width) * 7));
    const weekIndex = Math.floor(y / dayHeightRef.current);
    const cellIndex = weekIndex * 7 + dayIndex;

    const days = calendarDaysRef.current;
    if (cellIndex >= 0 && cellIndex < days.length && days[cellIndex]?.date) {
      return days[cellIndex].date;
    }
    return null;
  }, []);

  // Long-pressing an event outside selection mode enters selection mode with
  // this event pre-selected, rather than starting a drag-to-move.
  const handleEventLongPress = useCallback((event: CalendarEventReadable) => {
    if (!event.id) return;
    onEventLongPressSelect?.(event);
  }, [onEventLongPressSelect]);

  // A tap on an event marks it while bulk-selection is on, and opens it
  // otherwise. Events the calendar has no id for can't be tracked in the
  // selection, so they stay inert rather than looking selectable.
  const handleEventTap = useCallback((event: CalendarEventReadable) => {
    if (selectionMode) {
      if (event.id) onToggleEventSelection?.(event);
      return;
    }
    onEventPress?.(event);
  }, [selectionMode, onToggleEventSelection, onEventPress]);

  const isEventSelected = useCallback(
    (event: CalendarEventReadable) => !!(event.id && selectedEventKeys?.has(eventOccurrenceKey(event))),
    [selectedEventKeys],
  );

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, _gestureState) => {
      return isDraggingRef.current;
    },
    onPanResponderGrant: (evt) => {
      const startPageX = evt.nativeEvent.pageX;
      const startPageY = evt.nativeEvent.pageY;
      isDraggingRef.current = false;

      // Start long press timer for drag selection
      longPressTimer.current = setTimeout(() => {
        const date = getDateFromPosition(startPageX, startPageY);
        if (date) {
          isDraggingRef.current = true;
          dragModeRef.current = 'dateRange';
          dragStartDateRef.current = date;
          setDragStartDate(date);
          setDragEndDate(date);
        }
      }, 300);
    },
    onPanResponderMove: (evt, gestureState) => {
      // Cancel long press if moved too much before timer fires
      if (!isDraggingRef.current && (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10)) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }

      // If dragging for date selection, update end date
      if (isDraggingRef.current && dragModeRef.current === 'dateRange') {
        const date = getDateFromPosition(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        if (date) {
          setDragEndDate(date);
        }
        return;
      }

    },
    onPanResponderRelease: (_, _gestureState) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      // If was dragging for date selection, call onDateRangeSelect
      if (isDraggingRef.current && dragStartDateRef.current) {
        const startDate = dragStartDateRef.current;
        const endDate = dragEndDateRef.current || startDate;

        const [finalStart, finalEnd] = startDate <= endDate
          ? [startDate, endDate]
          : [endDate, startDate];

        const endWithTime = new Date(finalEnd);
        endWithTime.setHours(23, 59, 59, 999);

        if (onDateRangeSelectRef.current) {
          onDateRangeSelectRef.current(finalStart, endWithTime);
        }

        setDragStartDate(null);
        setDragEndDate(null);
        isDraggingRef.current = false;
        dragStartDateRef.current = null;
        dragEndDateRef.current = null;
        return;
      }

      // Month swipe is handled by FlatList paging
    },
    onPanResponderTerminate: () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setDragStartDate(null);
      setDragEndDate(null);
      isDraggingRef.current = false;
      dragStartDateRef.current = null;
      dragEndDateRef.current = null;
    },
  }), [getDateFromPosition]);

  // Check if date is in drag selection range
  const isInDragRange = useCallback((date: Date): boolean => {
    if (!dragStartDate || !dragEndDate) return false;
    const start = dragStartDate <= dragEndDate ? dragStartDate : dragEndDate;
    const end = dragStartDate <= dragEndDate ? dragEndDate : dragStartDate;
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    const e = new Date(end);
    e.setHours(0, 0, 0, 0);
    return d >= s && d <= e;
  }, [dragStartDate, dragEndDate]);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const translatedWeekdays = t('weekdaysSingle', {returnObjects: true}) as string[];
  const translatedMonths = t('monthNames', {returnObjects: true}) as string[];

  // Request calendar permission (only if not provided via prop)
  useEffect(() => {
    if (hasPermissionProp !== undefined) return;
    const requestPermission = async () => {
      try {
        const status = await RNCalendarEvents.requestPermissions();
        if (status === 'authorized' || (status as string) === 'fullAccess') {
          setHasPermissionInternal(true);
        }
      } catch {
        // Permission request failed, non-critical
      }
    };
    requestPermission();
  }, [hasPermissionProp]);

  // Fetch weather data on mount
  useEffect(() => {
    fetchWeather()
      .then(data => setWeatherData(data))
      .catch(() => {});
  }, []);

  // Helper to get cache key for a month
  const getMonthKey = useCallback((year: number, month: number) => `${year}-${month}`, []);

  // Get current month's events from cache (derived state)
  // This re-computes when currentYear, currentMonth, or cacheVersion changes
  const events = useMemo(() => {
    const cacheKey = getMonthKey(currentYear, currentMonth);
    return eventsCache.current.get(cacheKey) || [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, currentMonth, cacheVersion, getMonthKey]);

  // Fetch events for a specific month (with caching)
  const fetchMonthEvents = useCallback(async (year: number, month: number, forceRefresh = false): Promise<CalendarEventReadable[]> => {
    const cacheKey = getMonthKey(year, month);

    // Return cached data if available and not forcing refresh
    if (!forceRefresh && eventsCache.current.has(cacheKey)) {
      return eventsCache.current.get(cacheKey)!;
    }

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59);

    const calendarEvents = eventStore
      ? eventStore.events.filter(event =>
          !!event.startDate && !!event.endDate &&
          new Date(event.startDate).getTime() <= endDate.getTime() &&
          new Date(event.endDate).getTime() >= startDate.getTime())
      : await RNCalendarEvents.fetchAllEvents(startDate.toISOString(), endDate.toISOString());

    // Filter out holiday/subscription calendar events (e.g. 日本の祝日)
    const filteredEvents = calendarEvents.filter(event => {
      const cal = event.calendar;
      if (!cal) return true;
      // Filter by calendar title (holiday calendars)
      const title = (cal.title || '').toLowerCase();
      if (title.includes('祝日') || title.includes('holiday') || title.includes('holidays')) return false;
      // Filter by read-only subscription calendars
      if (cal.allowsModifications === false && event.allDay) return false;
      return true;
    });

    // Store in cache
    eventsCache.current.set(cacheKey, filteredEvents);
    return filteredEvents;
  }, [getMonthKey, eventStore]);

  // Prefetch multiple months around the given month
  const prefetchMonths = useCallback(async (year: number, month: number, range: number = 2) => {
    if (!hasPermission) return;

    const monthsToFetch: Array<{year: number; month: number}> = [];

    for (let i = -range; i <= range; i++) {
      if (i === 0) continue; // Skip current month
      let targetMonth = month + i;
      let targetYear = year;

      while (targetMonth < 0) {
        targetMonth += 12;
        targetYear -= 1;
      }
      while (targetMonth > 11) {
        targetMonth -= 12;
        targetYear += 1;
      }

      // Only fetch if not already cached
      const cacheKey = getMonthKey(targetYear, targetMonth);
      if (!eventsCache.current.has(cacheKey)) {
        monthsToFetch.push({year: targetYear, month: targetMonth});
      }
    }

    if (monthsToFetch.length > 0) {
      await Promise.all(
        monthsToFetch.map(({year: y, month: m}) => fetchMonthEvents(y, m))
      );
      // Adjacent months have just landed in eventsCache, which is a ref and so
      // cannot trigger a render on its own. Bump the version that everything
      // derived from it keys off — a page rendered while its month was still
      // unfetched would otherwise stay empty until some other change bumped it.
      // Nothing here depends on cacheVersion, so this cannot re-enter: the next
      // call finds the months cached and fetches nothing.
      setCacheVersion(v => v + 1);
    }
  }, [hasPermission, fetchMonthEvents, getMonthKey]);

  // Track if initial load is complete
  const initialLoadComplete = useRef(false);
  // Track the last fetched month to avoid redundant fetches
  const lastFetchedMonth = useRef<string | null>(null);

  // Fetch events for the current month (only if not in cache)
  const fetchEvents = useCallback(async (forceRefresh = false) => {
    if (!hasPermission) return;

    const currentCacheKey = getMonthKey(currentYear, currentMonth);

    // Prevent redundant fetches for the same month
    if (!forceRefresh && lastFetchedMonth.current === currentCacheKey) {
      return;
    }

    // Check cache first
    if (eventsCache.current.has(currentCacheKey) && !forceRefresh) {
      // Cache hit - data is already available via useMemo
      if (eventColorsCache.current) {
        setEventColors(eventColorsCache.current);
      }
      getAllEventPhotoCounts().then(setEventPhotos).catch(() => {});
      getEventIdsWithTriggerNotifications().then(setEventNotifIds).catch(() => {});
      lastFetchedMonth.current = currentCacheKey;
      // Prefetch in background
      prefetchMonths(currentYear, currentMonth, 2);
      return;
    }

    // Prevent concurrent fetches
    if (isFetching.current && !forceRefresh) return;

    isFetching.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Fetch colors if not cached
      if (!eventColorsCache.current || forceRefresh) {
        const fetchedColors = eventStore ? eventStore.colors : await getAllEventColors();
        eventColorsCache.current = fetchedColors;
        setEventColors(fetchedColors);
      }
      getAllEventPhotoCounts().then(setEventPhotos).catch(() => {});
      getEventIdsWithTriggerNotifications().then(setEventNotifIds).catch(() => {});

      // Fetch current month events (this also stores in cache)
      await fetchMonthEvents(currentYear, currentMonth, forceRefresh);
      // Trigger re-render to pick up cached data
      setCacheVersion(v => v + 1);
      lastFetchedMonth.current = currentCacheKey;

      // Prefetch adjacent months and WAIT for completion
      await prefetchMonths(currentYear, currentMonth, 3);
      initialLoadComplete.current = true;
    } catch {
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
      isFetching.current = false;
    }
  }, [hasPermission, currentYear, currentMonth, getMonthKey, fetchMonthEvents, prefetchMonths, t, eventStore]);

  useEffect(() => {
    if (!eventStore) return;
    clearCache();
    fetchEvents(true);
  }, [eventStore?.events, eventStore?.colors]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep refs in sync for PanResponder callbacks
  useEffect(() => { fetchEventsRef.current = fetchEvents; }, [fetchEvents]);

  // Run fetchEvents whenever month changes
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Clear cache on permission change or when explicitly refreshing
  const clearCache = useCallback(() => {
    eventsCache.current.clear();
    eventColorsCache.current = null;
    initialLoadComplete.current = false;
  }, []);

  // Expose refreshEvents to parent
  useImperativeHandle(ref, () => ({
    refreshEvents: () => {
      clearCache();
      if (eventStore) eventStore.refresh().catch(() => {});
      fetchEvents(true);
    },
    goToToday: () => {
      const now = new Date();
      setCurrentDate(now);
      const idx = MONTH_ANCHOR + (now.getFullYear() - baseDate.getFullYear()) * 12 + (now.getMonth() - baseDate.getMonth());
      monthListRef.current?.scrollToIndex({index: idx, animated: true});
    },
  }), [fetchEvents, clearCache, baseDate, eventStore]);

  const getDaysInMonth = useCallback((year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  }, []);

  const getFirstDayOfMonth = useCallback((year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  }, []);

  // Helper function to calculate days for any month
  const getCalendarDaysForMonth = useCallback((year: number, month: number) => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const days: Array<{day: number; isCurrentMonth: boolean; date: Date | null}> = [];

    // Empty cells for days before the 1st
    for (let i = 0; i < firstDay; i++) {
      days.push({
        day: 0,
        isCurrentMonth: false,
        date: null,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i),
      });
    }

    // Fill remaining cells to complete the last week (empty)
    const remainingDays = (7 - (days.length % 7)) % 7;
    for (let i = 0; i < remainingDays; i++) {
      days.push({
        day: 0,
        isCurrentMonth: false,
        date: null,
      });
    }

    return days;
  }, [getDaysInMonth, getFirstDayOfMonth]);

  const calendarDays = useMemo(() => {
    return getCalendarDaysForMonth(currentYear, currentMonth);
  }, [currentYear, currentMonth, getCalendarDaysForMonth]);

  // Calculate number of weeks to display
  const numberOfWeeks = useMemo(() => {
    return Math.ceil(calendarDays.length / 7);
  }, [calendarDays]);

  // Dynamic day height based on number of weeks
  const dayHeight = useMemo(() => {
    return Math.floor(gridHeight / numberOfWeeks);
  }, [numberOfWeeks, gridHeight]);

  // Keep dayHeightRef in sync
  useEffect(() => { dayHeightRef.current = dayHeight; }, [dayHeight]);

  // Update refs for drag selection
  useEffect(() => {
    calendarDaysRef.current = calendarDays;
    numberOfWeeksRef.current = numberOfWeeks;
  }, [calendarDays, numberOfWeeks]);

  // Pre-compute events by date for O(1) lookup instead of O(n) filtering
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventReadable[]>();

    events.forEach(event => {
      const range = eventDayRange(event);
      if (!range) return;

      const currentDate = new Date(range.firstDay);
      const endDate = range.lastDay;

      while (currentDate <= endDate) {
        const dateKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`;
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(event);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return map;
  }, [events]);

  const getEventsForDate = useCallback(
    (date: Date) => {
      const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      return eventsByDate.get(dateKey) || [];
    },
    [eventsByDate],
  );

  // Everything a month page needs that depends only on the month and its
  // events, computed once per month instead of on every page render.
  //
  // eventsByDate above indexes only the month in view, but the FlatList keeps
  // three pages mounted, so the page path used to re-derive all of this inline
  // — re-filtering the month's event list for all 42 day cells, twice over.
  // Months are built lazily; the whole cache is dropped when the events or the
  // colour filter change. eventsCache is a ref, so cacheVersion is the signal.
  //
  // Layout (page height, row heights) deliberately stays out of here: it
  // depends on gridHeight, which changes independently of the events.
  const getPageModel = useMemo(() => {
    const byMonth = new Map<string, PageModel>();

    const buildEventIndex = (monthKey: string) => {
      const index = new Map<string, CalendarEventReadable[]>();
      for (const event of eventsCache.current.get(monthKey) ?? []) {
        const keys = eventDayKeys(event);
        if (keys.length === 0) continue;

        // Apply the user-calendar filter on the resolved event colour.
        if (filterColor) {
          const resolved = (event.id && eventColors[event.id]) || event.calendar?.color;
          if (resolved?.toUpperCase() !== filterColor.toUpperCase()) continue;
        }

        for (const dateKey of keys) {
          const bucket = index.get(dateKey);
          if (bucket) bucket.push(event);
          else index.set(dateKey, [event]);
        }
      }
      return index;
    };

    // Lay multi-day bars out into rows per week, so bars that overlap in time
    // stack instead of colliding.
    const buildMultiDayByWeek = (
      days: ReturnType<typeof getCalendarDaysForMonth>,
      weeks: number,
      eventsForDate: (d: Date) => CalendarEventReadable[],
    ) => {
      const byWeek: MultiDayBar[][] = [];
      for (let wi = 0; wi < weeks; wi++) {
        const weekDays = days.slice(wi * 7, (wi + 1) * 7);
        const bars: MultiDayBar[] = [];
        const daySlots: number[][] = Array.from({length: 7}, () => []);
        const seen = new Set<string>();

        // Precompute each column's midnight once, instead of per candidate bar.
        const columnDays = weekDays.map(item => {
          if (!item.date) return null;
          const d = new Date(item.date);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        });

        weekDays.forEach(item => {
          if (!item.date) return;
          for (const ev of eventsForDate(item.date)) {
            if (!ev.id) continue;
            if (seen.has(ev.id)) continue;

            const range = eventDayRange(ev);
            if (!range) continue;

            const from = range.firstDay.getTime(), to = range.lastDay.getTime();
            const isMulti = ev.allDay || from !== to;
            if (!isMulti) continue;
            seen.add(ev.id);
            let startIdx = -1, endIdx = -1;
            for (let k = 0; k < 7; k++) {
              const col = columnDays[k];
              if (col === null) continue;
              if (col >= from && col <= to) {
                if (startIdx === -1) startIdx = k;
                endIdx = k;
              }
            }
            if (startIdx < 0) continue;

            let rowIndex = 0;
            for (;;) {
              let free = true;
              for (let k = startIdx; k <= endIdx; k++) {
                if (daySlots[k].includes(rowIndex)) { free = false; break; }
              }
              if (free) break;
              rowIndex++;
            }
            for (let k = startIdx; k <= endIdx; k++) daySlots[k].push(rowIndex);
            bars.push({event: ev, startDayIndex: startIdx, endDayIndex: endIdx, rowIndex});
          }
        });

        byWeek.push(bars);
      }
      return byWeek;
    };

    return (year: number, month: number): PageModel => {
      const monthKey = `${year}-${month}`;
      const cached = byMonth.get(monthKey);
      if (cached) return cached;

      const days = getCalendarDaysForMonth(year, month);
      const weeks = Math.ceil(days.length / 7);
      const eventIndex = buildEventIndex(monthKey);
      const getEvents = (d: Date) =>
        eventIndex.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];

      const model: PageModel = {
        days,
        weeks,
        getEventsForDate: getEvents,
        multiDayByWeek: buildMultiDayByWeek(days, weeks, getEvents),
      };
      byMonth.set(monthKey, model);
      return model;
    };
  // cacheVersion is deliberately a dependency even though the body never reads
  // it: bumping it is how a refresh invalidates the memoised month models.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion, filterColor, eventColors, getCalendarDaysForMonth]);

  // NOTE: a second multi-day layout pass and a "next upcoming event" lookup
  // used to sit here. Both were superseded — multi-day bars are built by
  // buildMultiDayByWeek in the month model above, and nothing rendered the
  // upcoming event — but they were still recomputed on every render of the
  // app's hottest screen, walking every week and every event for nothing.

  const getIndexForDate = useCallback((d: Date) => {
    return MONTH_ANCHOR + (d.getFullYear() - baseDate.getFullYear()) * 12 + (d.getMonth() - baseDate.getMonth());
  }, [baseDate]);

  const scrollToMonth = useCallback((d: Date) => {
    const idx = getIndexForDate(d);
    monthListRef.current?.scrollToIndex({index: idx, animated: true});
  }, [getIndexForDate]);

  const goToPreviousMonth = useCallback(() => {
    const d = new Date(currentYear, currentMonth - 1, 1);
    setCurrentDate(d);
    scrollToMonth(d);
  }, [currentYear, currentMonth, scrollToMonth]);

  const goToNextMonth = useCallback(() => {
    const d = new Date(currentYear, currentMonth + 1, 1);
    setCurrentDate(d);
    scrollToMonth(d);
  }, [currentYear, currentMonth, scrollToMonth]);

  const goToToday = useCallback(() => {
    const now = new Date();
    setCurrentDate(now);
    scrollToMonth(now);
  }, [scrollToMonth]);

  // Bottom sheet functions - defined before handleDateSelect which uses them
  const openDayEventsSheet = useCallback((date: Date) => {
    setDayEventsDate(date);
    setShowDayEvents(true);
    Animated.spring(bottomSheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  }, [bottomSheetAnim]);

  const closeDayEventsSheet = useCallback(() => {
    Animated.timing(bottomSheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowDayEvents(false);
      setDayEventsDate(null);
    });
  }, [bottomSheetAnim]);

  const handleDateSelect = useCallback(
    (date: Date) => {
      // No "selected date" concept: a single tap opens the screen directly —
      // the day-events sheet when the day has timed events, otherwise the
      // add-event screen. Still sync the parent's current date for context
      // (e.g. the "+" button / stats default to this day).
      onDateSelect?.(date);
      const dayEvents = getEventsForDate(date).filter(e => !e.allDay);
      if (dayEvents.length > 0) {
        openDayEventsSheet(date);
      } else {
        onDateDoubleSelect?.(date);
      }
    },
    [onDateSelect, onDateDoubleSelect, getEventsForDate, openDayEventsSheet],
  );

  const isToday = useCallback(
    (date: Date) => {
      return (
        date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear()
      );
    },
    [today],
  );

  const isSunday = (index: number) => index % 7 === 0;
  const isSaturday = (index: number) => index % 7 === 6;

  // Bottom sheet swipe-to-dismiss
  const bottomSheetPanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Respond to downward vertical swipes
      return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 50) {
        // Swipe down enough - close the sheet
        Animated.timing(bottomSheetAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setShowDayEvents(false);
          setDayEventsDate(null);
        });
      }
    },
  })).current;

  // Get events for the selected day in bottom sheet (show all events including past)
  const dayEventsForSheet = useMemo(() => {
    if (!dayEventsDate) return [];
    return getEventsForDate(dayEventsDate);
  }, [dayEventsDate, getEventsForDate]);

  // Format date for bottom sheet header
  const formatSheetDate = useCallback((date: Date) => {
    const weekday = translatedWeekdays[date.getDay()];
    return t('dateDayOfWeek', {month: date.getMonth() + 1, day: date.getDate(), weekday: weekday});
  }, [t, translatedWeekdays]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  // Compact time format for calendar cells (no leading zero on hours)
  const formatTimeCompact = (dateString: string) => {
    const date = new Date(dateString);
    const h = date.getHours();
    const m = date.getMinutes();
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  // Navigate to previous day in bottom sheet
  const goToPreviousDay = useCallback(() => {
    if (!dayEventsDate) return;
    const prevDay = new Date(dayEventsDate);
    prevDay.setDate(prevDay.getDate() - 1);
    setDayEventsDate(prevDay);
    // Switch month if needed
    if (prevDay.getMonth() !== currentMonth || prevDay.getFullYear() !== currentYear) {
      setCurrentDate(new Date(prevDay.getFullYear(), prevDay.getMonth(), 1));
    }
  }, [dayEventsDate, currentMonth, currentYear]);

  // Navigate to next day in bottom sheet
  const goToNextDay = useCallback(() => {
    if (!dayEventsDate) return;
    const nextDay = new Date(dayEventsDate);
    nextDay.setDate(nextDay.getDate() + 1);
    setDayEventsDate(nextDay);
    // Switch month if needed
    if (nextDay.getMonth() !== currentMonth || nextDay.getFullYear() !== currentYear) {
      setCurrentDate(new Date(nextDay.getFullYear(), nextDay.getMonth(), 1));
    }
  }, [dayEventsDate, currentMonth, currentYear]);

  return (
    <View style={styles.scrollView}>
      <View style={[styles.container, {backgroundColor: colors.surface}]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={goToPreviousMonth}
            style={styles.navButton}
            accessibilityLabel="前の月"
            accessibilityRole="button">
            <Text style={[styles.navButtonText, {color: colors.primary}]}>{'<'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={goToToday}
            accessibilityLabel={t('goToToday')}
            accessibilityRole="button">
            <Text style={[styles.headerTitle, {color: colors.text}]}>
              {t('yearMonthFormat', {year: currentYear, month: translatedMonths[currentMonth]})}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={goToNextMonth}
            style={styles.navButton}
            accessibilityLabel="次の月"
            accessibilityRole="button">
            <Text style={[styles.navButtonText, {color: colors.primary}]}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Loading indicator */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}

        {/* Error display */}
        {error && (
          <TouchableOpacity style={[styles.errorContainer, {backgroundColor: colors.errorBackground, borderColor: colors.error}]} onPress={() => fetchEvents(true)}>
            <Text style={[styles.errorText, {color: colors.error}]}>{error}</Text>
            <Text style={[styles.retryText, {color: colors.textSecondary}]}>{t('tapToReload')}</Text>
          </TouchableOpacity>
        )}

        {/* Weekday headers */}
        <View style={[styles.weekdayRow, {borderColor: colors.border}]}>
          {translatedWeekdays.map((day, index) => (
            <View key={day} style={[styles.weekdayCell, {borderColor: colors.border}]}>
              <Text
                style={[
                  styles.weekdayText,
                  {color: colors.textSecondary},
                  index === 0 && {color: colors.sunday},
                  index === 6 && {color: colors.saturday},
                ]}>
                {day}
              </Text>
            </View>
          ))}
        </View>

        {/* Calendar grid - horizontal FlatList for smooth month swiping.
            Wrapped in a flex:1 View whose measured height drives the grid so
            the last week is never clipped by the tab bar. */}
        <View
          style={styles.gridWrapper}
          onLayout={(e) => {
            const {height: h, width: w} = e.nativeEvent.layout;
            if (h > 0 && Math.abs(h - gridHeight) > 1) setGridHeight(h);
            if (w > 0 && Math.abs(w - gridWidth) > 1) setGridWidth(w);
          }}>
        <FlatList
          ref={monthListRef}
          data={monthData}
          keyExtractor={(item) => item.toString()}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={MONTH_ANCHOR}
          getItemLayout={(_, index) => ({length: gridWidth, offset: gridWidth * index, index})}
          extraData={gridWidth}
          windowSize={3}
          maxToRenderPerBatch={1}
          removeClippedSubviews
          onMomentumScrollEnd={(e) => {
            const idx = Math.floor(e.nativeEvent.contentOffset.x / gridWidth + 0.5);
            const {year, month} = getMonthForIndex(idx);
            const cur = currentDateRef.current;
            if (year !== cur.getFullYear() || month !== cur.getMonth()) {
              const newDate = new Date(year, month, 1);
              setCurrentDate(newDate);
              // Prefetch adjacent months
              prefetchMonths(year, month, 2);
              // Fetch current month if not cached
              fetchMonthEvents(year, month).then(() => setCacheVersion(v => v + 1));
            }
          }}
          style={{height: gridHeight}}
          renderItem={({index: pageIndex}) => {
            const {year: pageYear, month: pageMonth} = getMonthForIndex(pageIndex);
            const {
              days: pageDays,
              weeks: pageWeeks,
              getEventsForDate: pageGetEventsForDate,
              multiDayByWeek: pageMultiDayByWeek,
            } = getPageModel(pageYear, pageMonth);
            const pageDayHeight = Math.floor(gridHeight / pageWeeks);

            return (
              <View
                style={{width: gridWidth, backgroundColor: colors.surface}}
                {...(!selectionMode && pageYear === currentYear && pageMonth === currentMonth ? panResponder.panHandlers : {})}
                onLayout={pageYear === currentYear && pageMonth === currentMonth ? (e) => {
                  e.target.measure((_x, _y, width, height, pageX, pageY) => {
                    gridLayoutRef.current = {x: pageX, y: pageY, width, height};
                  });
                } : undefined}>
                <ConditionalScroll fullscreen={!!fullscreenMode}>
                <View style={[styles.calendarGrid, {borderColor: colors.border}]}>
                  {Array.from({length: pageWeeks}).map((_, weekIndex) => {
                    const weekDays = pageDays.slice(weekIndex * 7, (weekIndex + 1) * 7);
                    return (
                      <View key={weekIndex} style={[styles.weekRow, fullscreenMode ? {minHeight: pageDayHeight, position: 'relative'} : {height: pageDayHeight, position: 'relative'}]}>
                        {weekDays.map((item, dayIndex) => {
                          const globalIndex = weekIndex * 7 + dayIndex;
                          if (!item.date) {
                            return <View key={`empty-${globalIndex}`} style={[styles.dayCell, fullscreenMode ? {minHeight: pageDayHeight, borderColor: colors.border} : {height: pageDayHeight, borderColor: colors.border}]} />;
                          }

                          const dayEvts = pageGetEventsForDate(item.date);
                          const singleDayEvents = dayEvts.filter(e => {
                            if (!e.startDate || !e.endDate) return false;
                            if (e.allDay) return false;
                            const s = new Date(e.startDate); const en = new Date(e.endDate);
                            s.setHours(0,0,0,0); en.setHours(0,0,0,0);
                            return s.getTime() === en.getTime();
                          });
                          const multiDayRowCount = pageMultiDayByWeek[weekIndex]?.reduce((max, md) => {
                            if (dayIndex >= md.startDayIndex && dayIndex <= md.endDayIndex) return Math.max(max, md.rowIndex + 1);
                            return max;
                          }, 0) || 0;
                          const multiDayOffset = multiDayRowCount * (EVENT_BAR_HEIGHT + 2);

                          const inDragRange = item.date && isInDragRange(item.date);

                          return (
                            <TouchableOpacity
                              key={`${item.date.toISOString()}-${globalIndex}`}
                              style={[
                                styles.dayCell,
                                fullscreenMode ? {minHeight: pageDayHeight, borderColor: colors.border} : {height: pageDayHeight, borderColor: colors.border},
                                isToday(item.date) && {
                                  backgroundColor: colors.today,
                                  borderColor: colors.primary,
                                  // Override the base cell's 0.5px right/bottom grid lines so the
                                  // highlight ring is uniform on all four sides (otherwise the
                                  // thicker top/left edges read as an asymmetric drop shadow).
                                  borderWidth: 2,
                                  borderTopWidth: 2,
                                  borderRightWidth: 2,
                                  borderBottomWidth: 2,
                                  borderLeftWidth: 2,
                                },
                                inDragRange && {backgroundColor: colors.dragRange},
                              ]}
                              onPress={selectionMode ? undefined : () => handleDateSelect(item.date!)}
                              accessibilityRole="button">
                              <View style={styles.dayHeader}>
                                <Text style={[
                                  styles.dayText,
                                  {color: colors.text},
                                  isSunday(globalIndex) && {color: colors.sunday},
                                  isSaturday(globalIndex) && {color: colors.saturday},
                                  isToday(item.date) && {color: colors.primary, fontWeight: 'bold'},
                                ]}>
                                  {item.day}
                                </Text>
                                {(() => {
                                  if (!item.date) return null;
                                  const dateKey = `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, '0')}-${String(item.date.getDate()).padStart(2, '0')}`;
                                  const w = weatherData.get(dateKey);
                                  if (!w) return null;
                                  return <Ionicons name={w.iconName} size={10} color={w.iconColor} style={{marginLeft: 6}} />;
                                })()}
                              </View>
                              {(() => {
                                // Cap total visible rows (multi-day bars + single-day events) to 2
                                // when not in fullscreen mode. Multi-day bars take priority since they
                                // are anchored to the row.
                                const visibleSingleCount = fullscreenMode
                                  ? singleDayEvents.length
                                  : Math.max(0, 2 - multiDayRowCount);
                                const visibleSingle = singleDayEvents.slice(0, visibleSingleCount);
                                const hiddenCount = singleDayEvents.length - visibleSingle.length;
                                if (visibleSingle.length === 0 && hiddenCount === 0) return null;
                                return (
                                  <View style={[styles.singleDayEventsContainer, {marginTop: multiDayOffset > 0 ? multiDayOffset + 2 : 2}]}>
                                    {visibleSingle.map(event => {
                                      const selected = isEventSelected(event);
                                      return (
                                        <TouchableOpacity
                                          key={event.id}
                                          style={[
                                            styles.singleDayEventBox,
                                            {backgroundColor: (event.id && eventColors[event.id]) || event.calendar?.color || colors.primary},
                                            // Fade what is not picked so the selection reads at a
                                            // glance — the chips are too small for a checkbox.
                                            selectionMode && !selected && styles.unselectedEvent,
                                            selected && styles.selectedEvent,
                                          ]}
                                          onPress={() => handleEventTap(event)}
                                          onLongPress={selectionMode ? undefined : () => handleEventLongPress(event)}
                                          delayLongPress={200}>
                                          <Text style={[styles.singleDayEventTime, {color: colors.onEvent}]}>
                                            {event.startDate && formatTimeCompact(event.startDate)}
                                          </Text>
                                          <Text style={[styles.singleDayEventTime, {color: colors.onEvent}]}>
                                            {event.endDate && formatTimeCompact(event.endDate)}
                                          </Text>
                                          <Text style={[styles.singleDayEventTitle, {color: colors.onEvent}]} numberOfLines={1} ellipsizeMode="clip">
                                            {event.title}
                                          </Text>
                                          {selected ? (
                                            <View style={[styles.selectedBadge, {backgroundColor: colors.onEvent}]}>
                                              <Ionicons name="checkmark" size={9} color={(event.id && eventColors[event.id]) || event.calendar?.color || colors.primary} />
                                            </View>
                                          ) : !!(event.id && eventPhotos[event.id]) && (
                                            <View style={styles.photoBadge}>
                                              <Ionicons name="camera" size={10} color="#fff" />
                                            </View>
                                          )}
                                          {/* Independent of the selected/photo badge above (which
                                              share the top-right corner) so a reminder is always
                                              visible regardless of selection or photo state. */}
                                          {!!(event.alarms?.length || (event.id && eventNotifIds.has(event.id))) && (
                                            <View style={styles.reminderBadge}>
                                              <Ionicons name="notifications" size={9} color="#fff" />
                                            </View>
                                          )}
                                        </TouchableOpacity>
                                      );
                                    })}
                                    {!fullscreenMode && hiddenCount > 0 && (
                                      <Text style={[styles.cellEventMore, {color: colors.textSecondary}]}>{t('totalEvents', {count: hiddenCount})}</Text>
                                    )}
                                  </View>
                                );
                              })()}
                            </TouchableOpacity>
                          );
                        })}
                        {/* 連続予定バー */}
                        {pageMultiDayByWeek[weekIndex]?.map((mdEvent, mdIdx) => {
                          const evColor = (mdEvent.event.id && eventColors[mdEvent.event.id]) || mdEvent.event.calendar?.color || colors.primary;
                          const dayWidth = gridWidth / 7;
                          const left = mdEvent.startDayIndex * dayWidth;
                          const width = (mdEvent.endDayIndex - mdEvent.startDayIndex + 1) * dayWidth - 2;
                          // Position multi-day bars below the day number row (top of cell)
                          // so they no longer compete with single-day events for the cell's bottom space.
                          const posStyle = {top: DAY_NUMBER_HEIGHT + 2 + mdEvent.rowIndex * (EVENT_BAR_HEIGHT + 2)};

                          const evStart = mdEvent.event.startDate ? new Date(mdEvent.event.startDate) : null;
                          const evEnd = mdEvent.event.endDate ? new Date(mdEvent.event.endDate) : null;
                          const firstWeekDay = weekDays[mdEvent.startDayIndex]?.date;
                          const lastWeekDay = weekDays[mdEvent.endDayIndex]?.date;
                          const isFirstDay = evStart && firstWeekDay && evStart.getFullYear() === firstWeekDay.getFullYear() && evStart.getMonth() === firstWeekDay.getMonth() && evStart.getDate() === firstWeekDay.getDate();
                          const isLastDay = evEnd && lastWeekDay && evEnd.getFullYear() === lastWeekDay.getFullYear() && evEnd.getMonth() === lastWeekDay.getMonth() && evEnd.getDate() === lastWeekDay.getDate();

                          const mdSelected = isEventSelected(mdEvent.event);

                          return (
                            <TouchableOpacity
                              key={`md-${mdEvent.event.id}-${mdIdx}`}
                              style={[
                                {position: 'absolute', left: left + (isFirstDay ? 1 : 0), ...posStyle, width: width - (isFirstDay ? 1 : 0) - (isLastDay ? 1 : 0), height: EVENT_BAR_HEIGHT - 2, backgroundColor: evColor + 'CC', borderTopLeftRadius: isFirstDay ? 6 : 0, borderBottomLeftRadius: isFirstDay ? 6 : 0, borderTopRightRadius: isLastDay ? 6 : 0, borderBottomRightRadius: isLastDay ? 6 : 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, paddingVertical: 2, zIndex: 10},
                                selectionMode && !mdSelected && styles.unselectedEvent,
                                mdSelected && styles.selectedEvent,
                              ]}
                              activeOpacity={0.7}
                              onPress={() => handleEventTap(mdEvent.event)}
                              onLongPress={selectionMode ? undefined : () => handleEventLongPress(mdEvent.event)}>
                              {mdSelected && (
                                <View style={[styles.selectedBadge, {backgroundColor: colors.onEvent}]}>
                                  <Ionicons name="checkmark" size={9} color={evColor} />
                                </View>
                              )}
                              {isFirstDay && evStart && !mdEvent.event.allDay && (
                                <Text style={[styles.singleDayEventTime, {color: colors.onEvent}]}>{formatTimeCompact(mdEvent.event.startDate!)}</Text>
                              )}
                              {isLastDay && evEnd && !mdEvent.event.allDay && (
                                <Text style={[styles.singleDayEventTime, {color: colors.onEvent}]}>{formatTimeCompact(mdEvent.event.endDate!)}</Text>
                              )}
                              <Text style={[styles.singleDayEventTitle, {color: colors.onEvent}]} numberOfLines={1} ellipsizeMode="clip">{mdEvent.event.title || ''}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
                </ConditionalScroll>
              </View>
            );
          }}
        />
        </View>

      </View>

      {/* Day Events Bottom Sheet */}
      <Modal
        visible={showDayEvents}
        transparent
        animationType="none"
        onRequestClose={closeDayEventsSheet}>
        <View style={styles.bottomSheetOverlay}>
          <TouchableOpacity
            style={[styles.bottomSheetBackdrop, {backgroundColor: colors.overlay}]}
            activeOpacity={1}
            onPress={closeDayEventsSheet}
          />
          <Animated.View
            style={[
              styles.bottomSheetContainer,
              {backgroundColor: colors.surface},
              {
                transform: [{
                  translateY: bottomSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [400, 0],
                  }),
                }],
              },
            ]}
            {...bottomSheetPanResponder.panHandlers}>
            <View style={[styles.bottomSheetHandle, {backgroundColor: colors.border}]} />
            <View style={styles.bottomSheetHeader}>
              <TouchableOpacity
                style={styles.bottomSheetNavButton}
                onPress={goToPreviousDay}>
                <Text style={[styles.bottomSheetNavButtonText, {color: colors.primary}]}>{'<'}</Text>
              </TouchableOpacity>
              <Text style={[styles.bottomSheetTitle, {color: colors.text}]}>
                {dayEventsDate && formatSheetDate(dayEventsDate)}
              </Text>
              <TouchableOpacity
                style={styles.bottomSheetNavButton}
                onPress={goToNextDay}>
                <Text style={[styles.bottomSheetNavButtonText, {color: colors.primary}]}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.bottomSheetAddButton, {backgroundColor: colors.primary}]}
              onPress={() => {
                const dateToAdd = dayEventsDate;
                Animated.timing(bottomSheetAnim, {
                  toValue: 0,
                  duration: 200,
                  useNativeDriver: true,
                }).start(() => {
                  setShowDayEvents(false);
                  setDayEventsDate(null);
                  if (dateToAdd) {
                    onDateDoubleSelect?.(dateToAdd);
                  }
                });
              }}>
              <Text style={styles.bottomSheetAddButtonText}>{t('addEventBtn')}</Text>
            </TouchableOpacity>
            <ScrollView style={styles.bottomSheetContent}>
              {dayEventsForSheet.length === 0 ? (
                <Text style={[styles.bottomSheetNoEvents, {color: colors.textTertiary}]}>{t('noEvents')}</Text>
              ) : (
                dayEventsForSheet.map((event) => (
                  <View key={event.id} style={[styles.bottomSheetEventItem, {backgroundColor: colors.surfaceSecondary}]}>
                    <TouchableOpacity
                      style={styles.bottomSheetEventTouchable}
                      onPress={() => {
                        // Close bottom sheet first, then open event detail after animation
                        Animated.timing(bottomSheetAnim, {
                          toValue: 0,
                          duration: 200,
                          useNativeDriver: true,
                        }).start(() => {
                          setShowDayEvents(false);
                          setDayEventsDate(null);
                          // Open event detail after sheet is closed
                          onEventPress?.(event);
                        });
                      }}>
                      <View
                        style={[
                          styles.bottomSheetEventColor,
                          {backgroundColor: (event.id && eventColors[event.id]) || event.calendar?.color || colors.primary},
                        ]}
                      />
                      <View style={styles.bottomSheetEventContent}>
                        <Text style={[styles.bottomSheetEventTitle, {color: colors.text}]} numberOfLines={1}>
                          {event.title}
                        </Text>
                        <Text style={[styles.bottomSheetEventTime, {color: colors.textSecondary}]}>
                          {event.allDay
                            ? t('allDay')
                            : event.startDate && event.endDate
                              ? `${formatTime(event.startDate)} - ${formatTime(event.endDate)}`
                              : ''}
                        </Text>
                        {event.location && (
                          <Text style={[styles.bottomSheetEventLocation, {color: colors.textTertiary}]} numberOfLines={1}>
                            📍 {event.location}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.bottomSheetDeleteButton}
                      onPress={async () => {
                        try {
                          await RNCalendarEvents.removeEvent(event.id!);
                          cancelEventNotification(event.id!).catch(() => {});
                          // Clear cache for current month so deleted event is removed
                          const cacheKey = getMonthKey(currentYear, currentMonth);
                          eventsCache.current.delete(cacheKey);
                          fetchEvents(true);
                        } catch {
                          // Deletion failed silently
                        }
                      }}>
                      <Text style={[styles.bottomSheetDeleteButtonText, {color: colors.error}]}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingTop: 2,
  },
  gridWrapper: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  navButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  navButtonText: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  loadingContainer: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
    paddingVertical: 4,
  },
  errorContainer: {
    backgroundColor: '#FFF3F3',
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#FF3B30',
    fontWeight: '500',
  },
  retryText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  weekdayRow: {
    flexDirection: 'row',
    borderLeftWidth: 0.5,
    borderTopWidth: 0.5,
    borderColor: '#e0e0e0',
  },
  weekdayCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 3,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#e0e0e0',
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  calendarGridContainer: {
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#fff',
  },
  calendarGridAnimated: {
    width: '100%',
    backgroundColor: '#fff',
  },
  calendarGrid: {
    flexDirection: 'column',
    borderLeftWidth: 0.5,
    borderTopWidth: 0.5,
    borderColor: '#e0e0e0',
  },
  weekRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  dayCell: {
    // A seventh of the week row, so cells follow the measured grid width.
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingTop: 2,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    overflow: 'hidden',
    borderColor: '#e0e0e0',
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: DAY_NUMBER_HEIGHT,
  },
  dayText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '700',
    lineHeight: DAY_NUMBER_HEIGHT,
  },
  otherMonthText: {
    color: '#ccc',
  },
  sundayText: {
    color: '#FF3B30',
  },
  saturdayText: {
    color: '#007AFF',
  },
  todayCell: {
    backgroundColor: '#E8F4FD',
  },
  todayText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  selectedCell: {
    backgroundColor: '#E3F2FD',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  selectedText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  dragRangeCell: {
    backgroundColor: '#B3E5FC',
  },
  // Multi-day event bar styles
  multiDayEventBar: {
    position: 'absolute',
    height: EVENT_BAR_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 4,
    zIndex: 10,
  },
  multiDayEventBarStart: {
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  multiDayEventBarEnd: {
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  multiDayEventBarContinueLeft: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    marginLeft: -2,
    paddingLeft: 6,
  },
  multiDayEventBarContinueRight: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    marginRight: -2,
  },
  multiDayEventTitle: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  // All-day event styles
  allDayEventBox: {
    borderRadius: 3,
    paddingVertical: 1,
    paddingHorizontal: 3,
    width: '100%',
  },
  allDayEventTitle: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 12,
  },
  // Single-day event styles
  singleDayEventsContainer: {
    width: '100%',
    paddingHorizontal: 1,
    paddingTop: 2,
    gap: 1,
  },
  singleDayEventBox: {
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 2,
    width: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  photoBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Top-left, deliberately not sharing photoBadge/selectedBadge's top-right
  // corner — a reminder should stay visible even on a photo-attached or
  // currently-selected event, not get silently hidden by the other badge.
  reminderBadge: {
    position: 'absolute',
    top: 1,
    left: 1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bulk-selection states. The chips are only a few millimetres tall, so the
  // signal is the contrast between picked and not-picked rather than a control
  // drawn inside each chip.
  unselectedEvent: {
    opacity: 0.35,
  },
  selectedEvent: {
    borderWidth: 2,
    borderColor: '#fff',
  },
  selectedBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  singleDayEventTime: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 11,
  },
  singleDayEventSeparator: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.7)',
  },
  singleDayEventTitle: {
    fontSize: 8,
    color: '#fff',
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
  },
  cellEventMore: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
    textAlign: 'center',
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF3B30',
    position: 'absolute',
    bottom: 4,
  },
  eventsSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  eventsSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  noEventsText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  eventItem: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    overflow: 'hidden',
  },
  eventColorBar: {
    width: 4,
  },
  eventContent: {
    flex: 1,
    padding: 12,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  eventTime: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  eventLocation: {
    fontSize: 12,
    color: '#999',
  },
  // Date grouped events styles
  dateGroup: {
    marginBottom: 16,
  },
  dateHeader: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  todayDateHeader: {
    backgroundColor: '#007AFF',
  },
  dateHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  todayDateHeaderText: {
    color: '#fff',
  },
  eventItemWithTime: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    overflow: 'hidden',
  },
  eventTimeColumn: {
    width: 60,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTimeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },
  eventTimeSeparator: {
    fontSize: 10,
    color: '#ccc',
    marginVertical: 1,
  },
  eventContentCompact: {
    flex: 1,
    paddingVertical: 10,
    paddingRight: 12,
  },
  multiDayEventItem: {
    backgroundColor: '#f0f7ff',
  },
  multiDayTimeContainer: {
    alignItems: 'center',
  },
  eventDateRange: {
    fontSize: 11,
    color: '#007AFF',
    marginTop: 2,
  },
  // Single event prominent display styles
  singleEventContainer: {
    flexDirection: 'row',
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  singleEventColorBar: {
    width: 6,
  },
  singleEventContent: {
    flex: 1,
    padding: 16,
  },
  singleEventTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  singleEventTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  singleEventTimeLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
    fontWeight: '500',
  },
  singleEventTime: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  singleEventLocationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  singleEventLocationLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
    fontWeight: '500',
  },
  singleEventLocation: {
    fontSize: 14,
    color: '#333',
  },
  // Bottom sheet styles
  bottomSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bottomSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  bottomSheetContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 34, // Safe area
  },
  bottomSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bottomSheetNavButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomSheetNavButtonText: {
    fontSize: 22,
    color: '#007AFF',
    fontWeight: '600',
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  bottomSheetAddButton: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 10,
    backgroundColor: '#007AFF',
    borderRadius: 20,
    alignItems: 'center',
  },
  bottomSheetAddButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  bottomSheetContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  bottomSheetNoEvents: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 40,
  },
  bottomSheetEventItem: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
    alignItems: 'center',
  },
  bottomSheetEventTouchable: {
    flex: 1,
    flexDirection: 'row',
  },
  bottomSheetEventColor: {
    width: 4,
  },
  bottomSheetEventContent: {
    flex: 1,
    padding: 12,
  },
  bottomSheetDeleteButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomSheetDeleteButtonText: {
    fontSize: 22,
    color: '#FF3B30',
    fontWeight: '300',
  },
  bottomSheetEventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  bottomSheetEventTime: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  bottomSheetEventLocation: {
    fontSize: 13,
    color: '#999',
  },
  weatherContainer: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    alignItems: 'center',
  },
  weatherTemp: {
    fontSize: 8,
    color: '#666',
    fontWeight: '600',
  },
});

// Memoised: App re-renders on every tab switch, and without this each
// tab's whole subtree would re-render even while hidden.
export default React.memo(Calendar);
