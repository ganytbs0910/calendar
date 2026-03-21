import React, {useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Animated,
  PanResponder,
  Vibration,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {getAllEventColors} from './AddEventModal';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {fetchWeather, WeatherDay} from '../services/weatherService';
import {useTheme} from '../theme/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Container has paddingHorizontal: 12 (both sides = 24) total
const DAY_WIDTH = Math.floor((SCREEN_WIDTH - 24) / 7);
const SCREEN_HEIGHT = Dimensions.get('window').height;
// Calculate day height to fill screen (subtract header, weekday row, margins, safe area)
const CALENDAR_AVAILABLE_HEIGHT = SCREEN_HEIGHT - 280;
const EVENT_BAR_HEIGHT = 24; // Height of multi-day event bar
const DAY_NUMBER_HEIGHT = 20; // Space for day number

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

interface CalendarProps {
  onDateSelect?: (date: Date) => void;
  onDateDoubleSelect?: (date: Date) => void;
  onEventPress?: (event: CalendarEventReadable) => void;
  onDateRangeSelect?: (startDate: Date, endDate: Date) => void;
  hasPermission?: boolean;
}

export interface CalendarRef {
  refreshEvents: () => void;
  goToToday: () => void;
}

export const Calendar = forwardRef<CalendarRef, CalendarProps>(({onDateSelect, onDateDoubleSelect, onEventPress, onDateRangeSelect, hasPermission: hasPermissionProp}, ref) => {
  const {colors} = useTheme();
  const [today, setToday] = useState(() => new Date());

  // Update 'today' when the date changes (e.g. app stays open past midnight)
  useEffect(() => {
    const now = new Date();
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const timer = setTimeout(() => {
      setToday(new Date());
    }, msUntilMidnight + 1000); // 1s after midnight
    return () => clearTimeout(timer);
  }, [today]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [hasPermissionInternal, setHasPermissionInternal] = useState(false);
  const hasPermission = hasPermissionProp ?? hasPermissionInternal;
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
  const [weatherData, setWeatherData] = useState<Map<string, WeatherDay>>(new Map());

  // Drag selection state
  const [dragStartDate, setDragStartDate] = useState<Date | null>(null);
  const [dragEndDate, setDragEndDate] = useState<Date | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const gridLayoutRef = useRef<{x: number; y: number; width: number; height: number} | null>(null);
  const calendarDaysRef = useRef<Array<{day: number; date: Date | null; isCurrentMonth: boolean}>>([]);
  const numberOfWeeksRef = useRef(5);

  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  // Event drag-and-drop state
  const [draggingEvent, setDraggingEvent] = useState<{
    event: CalendarEventReadable;
    originalDate: Date;
    currentDate: Date;
  } | null>(null);
  const draggingEventRef = useRef<{
    event: CalendarEventReadable;
    originalDate: Date;
    currentDate: Date;
  } | null>(null);
  const dragModeRef = useRef<'dateRange' | 'moveEvent' | null>(null);

  // Swipe gesture for month navigation and drag selection
  const currentDateRef = useRef(currentDate);
  const isDraggingRef = useRef(false);
  const dragStartDateRef = useRef<Date | null>(null);
  const dragEndDateRef = useRef<Date | null>(null);
  const onDateRangeSelectRef = useRef(onDateRangeSelect);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEventsRef = useRef<(forceRefresh?: boolean) => void>(() => {});
  const getMonthKeyRef = useRef<(year: number, month: number) => string>((y, m) => `${y}-${m}`);
  const dayHeightRef = useRef(Math.floor(CALENDAR_AVAILABLE_HEIGHT / 5));

  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);
  useEffect(() => { onDateRangeSelectRef.current = onDateRangeSelect; }, [onDateRangeSelect]);
  useEffect(() => { dragEndDateRef.current = dragEndDate; }, [dragEndDate]);

  // Get date from touch position (uses ref to avoid stale closure)
  const getDateFromPosition = useCallback((pageX: number, pageY: number): Date | null => {
    const layout = gridLayoutRef.current;
    if (!layout) return null;

    const x = pageX - layout.x;
    const y = pageY - layout.y;

    if (x < 0 || y < 0 || x > layout.width || y > layout.height) return null;

    const dayIndex = Math.floor(x / DAY_WIDTH);
    const weekIndex = Math.floor(y / dayHeightRef.current);
    const cellIndex = weekIndex * 7 + dayIndex;

    const days = calendarDaysRef.current;
    if (cellIndex >= 0 && cellIndex < days.length && days[cellIndex]?.date) {
      return days[cellIndex].date;
    }
    return null;
  }, []);

  // Handle long press on an event to start drag-and-drop move
  const handleEventLongPress = useCallback((event: CalendarEventReadable, date: Date) => {
    if (!event.startDate || !event.endDate) return;

    // Skip all-day and multi-day events
    if (event.allDay) return;
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    const startDay = new Date(eventStart);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(eventEnd);
    endDay.setHours(0, 0, 0, 0);
    if (startDay.getTime() !== endDay.getTime()) return;

    Vibration.vibrate(50);

    const dragData = {
      event,
      originalDate: date,
      currentDate: date,
    };

    draggingEventRef.current = dragData;
    dragModeRef.current = 'moveEvent';
    isDraggingRef.current = true;
    setDraggingEvent(dragData);
    setIsDragging(true);

    // Cancel any pending long press timer for date range selection
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dx) > 5 || isDraggingRef.current;
    },
    onPanResponderGrant: (evt) => {
      // If already in moveEvent mode (started by event onLongPress), skip date-range setup
      if (dragModeRef.current === 'moveEvent') return;
      // Don't start new interactions while saving
      if (isSavingRef.current) return;

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
          setIsDragging(true);
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

      // If dragging an event to move it
      if (isDraggingRef.current && dragModeRef.current === 'moveEvent' && draggingEventRef.current) {
        const date = getDateFromPosition(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        if (date) {
          const prev = draggingEventRef.current.currentDate;
          if (prev.getTime() !== date.getTime()) {
            Vibration.vibrate(30);
          }
          draggingEventRef.current = {...draggingEventRef.current, currentDate: date};
          setDraggingEvent({...draggingEventRef.current});
        }
        return;
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
    onPanResponderRelease: (_, gestureState) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      // If was dragging an event to move it
      if (dragModeRef.current === 'moveEvent' && draggingEventRef.current) {
        const {event: originalEvent, originalDate, currentDate: targetDate} = draggingEventRef.current;

        // Clean up drag state
        draggingEventRef.current = null;
        dragModeRef.current = null;
        isDraggingRef.current = false;
        setDraggingEvent(null);
        setIsDragging(false);

        // Only save if date actually changed
        const origDay = new Date(originalDate);
        origDay.setHours(0, 0, 0, 0);
        const targetDay = new Date(targetDate);
        targetDay.setHours(0, 0, 0, 0);
        if (origDay.getTime() === targetDay.getTime()) return;

        // Prevent concurrent saves
        if (isSavingRef.current) return;
        isSavingRef.current = true;

        // Calculate new start/end preserving original time
        const eventStart = new Date(originalEvent.startDate!);
        const eventEnd = new Date(originalEvent.endDate!);
        const dayDiff = targetDay.getTime() - origDay.getTime();
        const newStartDate = new Date(eventStart.getTime() + dayDiff);
        const newEndDate = new Date(eventEnd.getTime() + dayDiff);

        RNCalendarEvents.saveEvent(originalEvent.title || '', {
          id: originalEvent.id,
          calendarId: originalEvent.calendar?.id,
          startDate: newStartDate.toISOString(),
          endDate: newEndDate.toISOString(),
          allDay: originalEvent.allDay,
          location: originalEvent.location,
          notes: originalEvent.notes,
          url: originalEvent.url,
          alarms: originalEvent.alarms,
        }).then(() => {
          // Refresh events cache for current month
          const cacheKey = getMonthKeyRef.current(currentDateRef.current.getFullYear(), currentDateRef.current.getMonth());
          eventsCache.current.delete(cacheKey);
          fetchEventsRef.current(true);
        }).catch((_err: unknown) => {
          Alert.alert(
            '更新エラー',
            '予定の移動に失敗しました。もう一度お試しください。',
            [{text: 'OK'}],
          );
          const cacheKey = getMonthKeyRef.current(currentDateRef.current.getFullYear(), currentDateRef.current.getMonth());
          eventsCache.current.delete(cacheKey);
          fetchEventsRef.current(true);
        }).finally(() => {
          isSavingRef.current = false;
        });
        return;
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
        setIsDragging(false);
        isDraggingRef.current = false;
        dragStartDateRef.current = null;
        dragEndDateRef.current = null;
        return;
      }

      // Swipe to change month (left swipe = next month, right swipe = previous month)
      const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.2;
      if (Math.abs(gestureState.dx) > SWIPE_THRESHOLD && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
        const current = currentDateRef.current;
        if (gestureState.dx > 0) {
          setCurrentDate(new Date(current.getFullYear(), current.getMonth() - 1, 1));
        } else {
          setCurrentDate(new Date(current.getFullYear(), current.getMonth() + 1, 1));
        }
      }
    },
    onPanResponderTerminate: () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      setDragStartDate(null);
      setDragEndDate(null);
      setIsDragging(false);
      isDraggingRef.current = false;
      dragStartDateRef.current = null;
      dragEndDateRef.current = null;
      // Clear event drag state
      draggingEventRef.current = null;
      dragModeRef.current = null;
      setDraggingEvent(null);
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

  // Request calendar permission (only if not provided via prop)
  useEffect(() => {
    if (hasPermissionProp !== undefined) return;
    const requestPermission = async () => {
      try {
        const status = await RNCalendarEvents.requestPermissions();
        if (status === 'authorized' || (status as string) === 'fullAccess') {
          setHasPermissionInternal(true);
        }
      } catch (_err) {
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

    const calendarEvents = await RNCalendarEvents.fetchAllEvents(
      startDate.toISOString(),
      endDate.toISOString(),
    );

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
  }, [getMonthKey]);

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
        const fetchedColors = await getAllEventColors();
        eventColorsCache.current = fetchedColors;
        setEventColors(fetchedColors);
      }

      // Fetch current month events (this also stores in cache)
      await fetchMonthEvents(currentYear, currentMonth, forceRefresh);
      // Trigger re-render to pick up cached data
      setCacheVersion(v => v + 1);
      lastFetchedMonth.current = currentCacheKey;

      // Prefetch adjacent months and WAIT for completion
      await prefetchMonths(currentYear, currentMonth, 3);
      initialLoadComplete.current = true;
    } catch (_err) {
      setError('予定の読み込みに失敗しました');
    } finally {
      setIsLoading(false);
      isFetching.current = false;
    }
  }, [hasPermission, currentYear, currentMonth, getMonthKey, fetchMonthEvents, prefetchMonths]);

  // Keep refs in sync for PanResponder callbacks
  useEffect(() => { fetchEventsRef.current = fetchEvents; }, [fetchEvents]);
  useEffect(() => { getMonthKeyRef.current = getMonthKey; }, [getMonthKey]);

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
      fetchEvents(true);
    },
    goToToday: () => {
      setCurrentDate(new Date());
      setSelectedDate(new Date());
    },
  }), [fetchEvents, clearCache]);

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
    return Math.floor(CALENDAR_AVAILABLE_HEIGHT / numberOfWeeks);
  }, [numberOfWeeks]);

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
      if (!event.startDate || !event.endDate) return;
      const eventStart = new Date(event.startDate);
      const eventEnd = new Date(event.endDate);

      // Iterate through each day the event spans
      const currentDate = new Date(eventStart);
      currentDate.setHours(0, 0, 0, 0);
      const endDate = new Date(eventEnd);
      endDate.setHours(23, 59, 59, 999);

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

  // Get the next upcoming event (for when today has no remaining events)
  const nextUpcomingEvent = useMemo(() => {
    const now = new Date();
    const futureEvents = events
      .filter(event => {
        if (!event.startDate) return false;
        return new Date(event.startDate) > now;
      })
      .sort((a, b) => {
        return new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime();
      });
    return futureEvents.length > 0 ? futureEvents[0] : null;
  }, [events]);

  // Pre-calculate multi-day events for each week
  const multiDayEventsByWeek = useMemo(() => {
    const result: Array<Array<{
      event: CalendarEventReadable;
      startDayIndex: number;
      endDayIndex: number;
      rowIndex: number;
    }>> = [];

    for (let weekIndex = 0; weekIndex < numberOfWeeks; weekIndex++) {
      const weekDays = calendarDays.slice(weekIndex * 7, (weekIndex + 1) * 7);
      const seen = new Set<string>();
      const weekEvents: typeof result[0] = [];
      const daySlots: number[][] = [[], [], [], [], [], [], []];

      weekDays.forEach((dayItem, dayIndex) => {
        if (!dayItem.date) return; // Skip empty cells
        const dayEvents = getEventsForDate(dayItem.date);
        dayEvents.forEach(event => {
          if (!event.startDate || !event.endDate || !event.id) return;
          if (seen.has(event.id)) return;

          const eventStart = new Date(event.startDate);
          const eventEnd = new Date(event.endDate);
          const eventStartDay = new Date(eventStart);
          eventStartDay.setHours(0, 0, 0, 0);
          const eventEndDay = new Date(eventEnd);
          eventEndDay.setHours(0, 0, 0, 0);

          const dayStart = new Date(dayItem.date!);
          dayStart.setHours(0, 0, 0, 0);

          // Check if this is a multi-day event
          const durationDays = Math.ceil((eventEndDay.getTime() - eventStartDay.getTime()) / (1000 * 60 * 60 * 24));
          if (durationDays < 1 && !event.allDay) return;

          // Find the first valid day in this week for start index calculation
          let firstValidDayIndex = 0;
          for (let i = 0; i < 7; i++) {
            if (weekDays[i].date) {
              firstValidDayIndex = i;
              break;
            }
          }

          // Calculate start index
          let startIdx = dayIndex;
          const firstValidDay = weekDays[firstValidDayIndex].date;
          if (firstValidDay) {
            const weekStart = new Date(firstValidDay);
            weekStart.setHours(0, 0, 0, 0);
            if (eventStartDay < weekStart) {
              startIdx = firstValidDayIndex;
            } else if (eventStartDay > dayStart) {
              return; // Event hasn't started yet
            }
          }

          // Calculate end index
          let endIdx = startIdx;
          for (let i = startIdx; i < 7; i++) {
            if (!weekDays[i].date) continue;
            const checkDate = new Date(weekDays[i].date!);
            checkDate.setHours(0, 0, 0, 0);
            if (checkDate <= eventEndDay) {
              endIdx = i;
            } else {
              break;
            }
          }

          if (endIdx >= startIdx) {
            seen.add(event.id);

            // Find available row slot
            let rowIndex = 0;
            while (true) {
              let slotFree = true;
              for (let i = startIdx; i <= endIdx; i++) {
                if (daySlots[i].includes(rowIndex)) {
                  slotFree = false;
                  break;
                }
              }
              if (slotFree) break;
              rowIndex++;
              if (rowIndex > 2) break; // Max 3 rows
            }

            if (rowIndex <= 2) {
              for (let i = startIdx; i <= endIdx; i++) {
                daySlots[i].push(rowIndex);
              }
              weekEvents.push({event, startDayIndex: startIdx, endDayIndex: endIdx, rowIndex});
            }
          }
        });
      });

      result.push(weekEvents);
    }

    return result;
  }, [calendarDays, getEventsForDate]);

  const goToPreviousMonth = useCallback(() => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  }, [currentYear, currentMonth]);

  const goToNextMonth = useCallback(() => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  }, [currentYear, currentMonth]);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  }, []);

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
      // Select the date and show events
      setSelectedDate(date);
      onDateSelect?.(date);

      // Get events for the day (excluding all-day events)
      const dayEvents = getEventsForDate(date).filter(e => !e.allDay);

      if (dayEvents.length > 0) {
        // Show bottom sheet with day's events
        openDayEventsSheet(date);
      } else {
        // No events - open add event modal
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

  const isSelected = useCallback(
    (date: Date) => {
      if (!selectedDate) return false;
      return (
        date.getDate() === selectedDate.getDate() &&
        date.getMonth() === selectedDate.getMonth() &&
        date.getFullYear() === selectedDate.getFullYear()
      );
    },
    [selectedDate],
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
    const weekday = WEEKDAYS[date.getDay()];
    return `${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
  }, []);

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
    setSelectedDate(prevDay);
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
    setSelectedDate(nextDay);
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
            accessibilityLabel="今日に移動"
            accessibilityRole="button">
            <Text style={[styles.headerTitle, {color: colors.text}]}>
              {currentYear}年 {MONTHS[currentMonth]}
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
            <Text style={[styles.retryText, {color: colors.textSecondary}]}>タップして再読み込み</Text>
          </TouchableOpacity>
        )}

        {/* Weekday headers */}
        <View style={[styles.weekdayRow, {borderColor: colors.border}]}>
          {WEEKDAYS.map((day, index) => (
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

        {/* Calendar grid container with swipe */}
        <View
          style={[styles.calendarGridContainer, {height: numberOfWeeks * dayHeight, backgroundColor: colors.surface}]}
          {...panResponder.panHandlers}
          onLayout={(e) => {
            e.target.measure((x, y, width, height, pageX, pageY) => {
              gridLayoutRef.current = {x: pageX, y: pageY, width, height};
            });
          }}>
          {/* Current month */}
          <View style={[styles.calendarGridAnimated, {backgroundColor: colors.surface}]}>
            <View style={[styles.calendarGrid, {borderColor: colors.border}]}>
              {Array.from({length: numberOfWeeks}).map((_, weekIndex) => {
                const weekDays = calendarDays.slice(weekIndex * 7, (weekIndex + 1) * 7);

                return (
                  <View key={weekIndex} style={[styles.weekRow, {height: dayHeight, position: 'relative'}]}>
                    {/* Day cells */}
                    {weekDays.map((item, dayIndex) => {
                      const globalIndex = weekIndex * 7 + dayIndex;

                      // Empty cell for days outside current month
                      if (!item.date) {
                        return (
                          <View key={`empty-${globalIndex}`} style={[styles.dayCell, {height: dayHeight, borderColor: colors.border}]} />
                        );
                      }

                      const dayEvents = getEventsForDate(item.date);
                      // Separate allDay/multi-day events from timed single-day events
                      const allDayEvents = dayEvents.filter(e => {
                        if (!e.startDate || !e.endDate) return false;
                        if (e.allDay) return true;
                        const start = new Date(e.startDate);
                        const end = new Date(e.endDate);
                        start.setHours(0, 0, 0, 0);
                        end.setHours(0, 0, 0, 0);
                        return start.getTime() !== end.getTime(); // multi-day
                      });
                      const singleDayEvents = dayEvents.filter(e => {
                        if (!e.startDate || !e.endDate) return false;
                        if (e.allDay) return false;
                        const start = new Date(e.startDate);
                        const end = new Date(e.endDate);
                        start.setHours(0, 0, 0, 0);
                        end.setHours(0, 0, 0, 0);
                        return start.getTime() === end.getTime();
                      });
                      // 連続予定はバーで表示するのでセル内はsingleDayEventsのみカウント
                      const totalEvents = singleDayEvents.length;

                      const inDragRange = item.date && isInDragRange(item.date);
                      const isEventDragTarget = draggingEvent && item.date &&
                        draggingEvent.currentDate.getFullYear() === item.date.getFullYear() &&
                        draggingEvent.currentDate.getMonth() === item.date.getMonth() &&
                        draggingEvent.currentDate.getDate() === item.date.getDate() &&
                        draggingEvent.originalDate.getTime() !== draggingEvent.currentDate.getTime();
                      const isEventDragSource = draggingEvent && item.date &&
                        draggingEvent.originalDate.getFullYear() === item.date.getFullYear() &&
                        draggingEvent.originalDate.getMonth() === item.date.getMonth() &&
                        draggingEvent.originalDate.getDate() === item.date.getDate();

                      return (
                        <TouchableOpacity
                          key={`${item.date.toISOString()}-${globalIndex}`}
                          style={[
                            styles.dayCell,
                            {height: dayHeight, borderColor: colors.border},
                            isToday(item.date) && {backgroundColor: colors.today},
                            isSelected(item.date) && {backgroundColor: colors.selected, borderColor: colors.primary},
                            inDragRange && {backgroundColor: colors.dragRange},
                            isEventDragTarget && {backgroundColor: colors.dragRange},
                          ]}
                          onPress={() => handleDateSelect(item.date!)}
                          accessibilityRole="button">
                          <Text
                            style={[
                              styles.dayText,
                              {color: colors.text},
                              isSunday(globalIndex) && {color: colors.sunday},
                              isSaturday(globalIndex) && {color: colors.saturday},
                              isToday(item.date) && {color: colors.primary, fontWeight: 'bold'},
                              isSelected(item.date) && {color: colors.primary, fontWeight: 'bold'},
                            ]}>
                            {item.day}
                          </Text>
                          {/* Weather icon */}
                          {(() => {
                            if (!item.date) return null;
                            const dateKey = `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, '0')}-${String(item.date.getDate()).padStart(2, '0')}`;
                            const weather = weatherData.get(dateKey);
                            if (!weather) return null;
                            return (
                              <View style={styles.weatherContainer}>
                                <Ionicons name={weather.iconName} size={12} color={weather.iconColor} />
                                <Text style={[styles.weatherTemp, {color: weather.iconColor}]}>{weather.tempMax}°</Text>
                              </View>
                            );
                          })()}
                          {/* Events in cell */}
                          {totalEvents > 0 && (
                            <View style={styles.singleDayEventsContainer}>
                              {/* 連続予定はバーで表示済み。セル内はsingleDayEventsのみ */}
                              {singleDayEvents.slice(0, 2).map(event => {
                                const isDraggedEvent = isEventDragSource && draggingEvent?.event.id === event.id;
                                return (
                                <TouchableOpacity
                                  key={event.id}
                                  style={[
                                    styles.singleDayEventBox,
                                    {backgroundColor: (event.id && eventColors[event.id]) || event.calendar?.color || colors.primary},
                                    isDraggedEvent && {opacity: 0.3},
                                  ]}
                                  onPress={() => onEventPress?.(event)}
                                  onLongPress={() => handleEventLongPress(event, item.date!)}
                                  delayLongPress={200}>
                                  <Text style={[styles.singleDayEventTime, {color: colors.onEvent}]}>
                                    {event.startDate && formatTimeCompact(event.startDate)}
                                  </Text>
                                  <Text style={[styles.singleDayEventTime, {color: colors.onEvent}]}>
                                    {event.endDate && formatTimeCompact(event.endDate)}
                                  </Text>
                                  <Text style={[styles.singleDayEventTitle, {color: colors.onEvent}]} numberOfLines={1}>
                                    {event.title}
                                  </Text>
                                </TouchableOpacity>);
                              })}
                              {totalEvents > 2 && (
                                <Text style={[styles.cellEventMore, {color: colors.textSecondary}]}>全{totalEvents}件</Text>
                              )}
                            </View>
                          )}
                          {/* Drag preview in target cell */}
                          {isEventDragTarget && draggingEvent && (
                            <View style={styles.singleDayEventsContainer}>
                              <View
                                style={[
                                  styles.singleDayEventBox,
                                  {
                                    backgroundColor: (draggingEvent.event.id && eventColors[draggingEvent.event.id]) || draggingEvent.event.calendar?.color || colors.primary,
                                    opacity: 0.5,
                                  },
                                ]}>
                                <Text style={styles.singleDayEventTime}>
                                  {draggingEvent.event.startDate && formatTimeCompact(draggingEvent.event.startDate)}
                                </Text>
                                <Text style={styles.singleDayEventTitle} numberOfLines={1}>
                                  {draggingEvent.event.title}
                                </Text>
                              </View>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                    {/* 連続予定バー（週をまたいで表示） */}
                    {multiDayEventsByWeek[weekIndex]?.map((mdEvent, mdIdx) => {
                      const evColor = (mdEvent.event.id && eventColors[mdEvent.event.id]) || mdEvent.event.calendar?.color || colors.primary;
                      const left = mdEvent.startDayIndex * DAY_WIDTH;
                      const width = (mdEvent.endDayIndex - mdEvent.startDayIndex + 1) * DAY_WIDTH - 2;
                      const top = DAY_NUMBER_HEIGHT + 2 + mdEvent.rowIndex * (EVENT_BAR_HEIGHT + 2);

                      // 初日・最終日の判定
                      const evStart = mdEvent.event.startDate ? new Date(mdEvent.event.startDate) : null;
                      const evEnd = mdEvent.event.endDate ? new Date(mdEvent.event.endDate) : null;
                      const firstWeekDay = weekDays[mdEvent.startDayIndex]?.date;
                      const lastWeekDay = weekDays[mdEvent.endDayIndex]?.date;
                      const isFirstDay = evStart && firstWeekDay &&
                        evStart.getFullYear() === firstWeekDay.getFullYear() &&
                        evStart.getMonth() === firstWeekDay.getMonth() &&
                        evStart.getDate() === firstWeekDay.getDate();
                      const isLastDay = evEnd && lastWeekDay &&
                        evEnd.getFullYear() === lastWeekDay.getFullYear() &&
                        evEnd.getMonth() === lastWeekDay.getMonth() &&
                        evEnd.getDate() === lastWeekDay.getDate();

                      // 表示テキスト
                      let label = mdEvent.event.title || '';
                      if (isFirstDay && evStart && !mdEvent.event.allDay) {
                        label = `${formatTimeCompact(mdEvent.event.startDate!)}〜 ${label}`;
                      }
                      if (isLastDay && evEnd && !mdEvent.event.allDay) {
                        label = `${label} 〜${formatTimeCompact(mdEvent.event.endDate!)}`;
                      }

                      return (
                        <TouchableOpacity
                          key={`md-${mdEvent.event.id}-${mdIdx}`}
                          style={{
                            position: 'absolute',
                            left: left + 1,
                            top,
                            width,
                            height: EVENT_BAR_HEIGHT - 2,
                            backgroundColor: evColor + '25',
                            borderRadius: 4,
                            borderLeftWidth: 3,
                            borderLeftColor: evColor,
                            justifyContent: 'center',
                            paddingHorizontal: 4,
                            zIndex: 10,
                          }}
                          activeOpacity={0.7}
                          onPress={() => onEventPress?.(mdEvent.event)}>
                          <Text style={{fontSize: 9, fontWeight: '600', color: evColor}} numberOfLines={1}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </View>
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
              <Text style={styles.bottomSheetAddButtonText}>+ 予定を追加</Text>
            </TouchableOpacity>
            <ScrollView style={styles.bottomSheetContent}>
              {dayEventsForSheet.length === 0 ? (
                <Text style={[styles.bottomSheetNoEvents, {color: colors.textTertiary}]}>予定はありません</Text>
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
                            ? '終日'
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
                          // Clear cache for current month so deleted event is removed
                          const cacheKey = getMonthKey(currentYear, currentMonth);
                          eventsCache.current.delete(cacheKey);
                          fetchEvents(true);
                        } catch (_err) {
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
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  navButton: {
    padding: 8,
  },
  navButtonText: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 8,
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
    width: DAY_WIDTH,
    alignItems: 'center',
    paddingVertical: 8,
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
    width: DAY_WIDTH,
    alignItems: 'center',
    paddingTop: 2,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#e0e0e0',
  },
  dayText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    height: DAY_NUMBER_HEIGHT,
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
    flex: 1,
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

export default Calendar;
