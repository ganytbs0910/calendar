import React, {useState, useCallback, useRef, useEffect, useMemo, forwardRef, useImperativeHandle} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  Vibration,
  PanResponder,
  PanResponderInstance,
  GestureResponderEvent,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';

const SCREEN_WIDTH = Dimensions.get('window').width;
const HOUR_HEIGHT = 60;
const TIME_COLUMN_WIDTH = 50;
const DAY_WIDTH = (SCREEN_WIDTH - TIME_COLUMN_WIDTH - 16) / 7;

// Auto-scroll settings
const AUTO_SCROLL_THRESHOLD = 80; // pixels from edge to trigger auto-scroll
const AUTO_SCROLL_SPEED = 8; // pixels per frame

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface WeekViewProps {
  currentDate: Date;
  onTimeRangeSelect?: (startDate: Date, endDate: Date) => void;
  onEventPress?: (event: CalendarEventReadable) => void;
  onWeekChange?: (newDate: Date) => void;
  hasPermission: boolean;
}

export interface WeekViewRef {
  refreshEvents: () => void;
  scrollToCurrentTime: () => void;
}

interface NewEvent {
  startDay: number;
  startHour: number;
  endDay: number;
  endHour: number;
}

interface DraggingEvent {
  event: CalendarEventReadable;
  originalStartDay: number;
  originalStartHour: number;
  currentDay: number;
  currentHour: number;
  duration: number; // in hours
}

export const WeekView = forwardRef<WeekViewRef, WeekViewProps>(({
  currentDate,
  onTimeRangeSelect,
  onEventPress,
  onWeekChange,
  hasPermission,
}, ref) => {
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [newEvent, setNewEvent] = useState<NewEvent | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [draggingEvent, setDraggingEvent] = useState<DraggingEvent | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const hasScrolledToCurrentTime = useRef(false);
  const draggingEventRef = useRef<DraggingEvent | null>(null);

  // Refs for latest values
  const newEventRef = useRef(newEvent);
  const isDraggingRef = useRef(isDragging);
  const onTimeRangeSelectRef = useRef(onTimeRangeSelect);

  useEffect(() => { newEventRef.current = newEvent; }, [newEvent]);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { onTimeRangeSelectRef.current = onTimeRangeSelect; }, [onTimeRangeSelect]);
  useEffect(() => { draggingEventRef.current = draggingEvent; }, [draggingEvent]);

  // Get the week's start date (Sunday)
  const getWeekStart = useCallback((date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekStart = getWeekStart(currentDate);
  const weekStartRef = useRef(weekStart);
  useEffect(() => { weekStartRef.current = weekStart; }, [weekStart]);

  // Generate week days
  const weekDays = useMemo(() => {
    return Array.from({length: 7}, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const weekDaysRef = useRef(weekDays);
  useEffect(() => { weekDaysRef.current = weekDays; }, [weekDays]);

  // Fetch events for the week
  const fetchEvents = useCallback(async () => {
    if (!hasPermission) return;

    setIsLoading(true);
    setError(null);
    try {
      const startDate = weekStart;
      const endDate = new Date(weekStart);
      endDate.setDate(endDate.getDate() + 7);

      const calendarEvents = await RNCalendarEvents.fetchAllEvents(
        startDate.toISOString(),
        endDate.toISOString(),
      );
      setEvents(calendarEvents);
    } catch (err) {
      console.error('Error fetching events:', err);
      setError('予定の読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [weekStart, hasPermission]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Scroll to current time on initial load
  const scrollToCurrentTime = useCallback(() => {
    if (scrollViewRef.current) {
      const hours = currentTime.getHours();
      const minutes = currentTime.getMinutes();
      const position = (hours + minutes / 60) * HOUR_HEIGHT;
      const scrollPosition = Math.max(0, position - 100);
      scrollViewRef.current.scrollTo({y: scrollPosition, animated: true});
    }
  }, [currentTime]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    refreshEvents: fetchEvents,
    scrollToCurrentTime,
  }), [fetchEvents, scrollToCurrentTime]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  // Check if current week includes today
  const isTodayInWeek = useMemo(() => {
    return weekDays.some(day => isToday(day));
  }, [weekDays]);

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  // Calculate current time indicator position
  const currentTimePosition = useMemo(() => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    return (hours + minutes / 60) * HOUR_HEIGHT;
  }, [currentTime]);

  // Auto-scroll to current time when week view opens (only once per mount)
  useEffect(() => {
    if (isTodayInWeek && !hasScrolledToCurrentTime.current) {
      // Delay slightly to ensure layout is complete
      const timer = setTimeout(() => {
        scrollToCurrentTime();
        hasScrolledToCurrentTime.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isTodayInWeek, scrollToCurrentTime]);

  // Convert touch coordinates to day/hour
  // locationX/Y are relative to the gridContainer
  const positionToTime = (locationX: number, locationY: number) => {
    const relativeX = locationX - TIME_COLUMN_WIDTH;
    const relativeY = locationY;

    const day = Math.floor(relativeX / DAY_WIDTH);
    // Round to nearest 15 minutes
    const rawHour = relativeY / HOUR_HEIGHT;
    const hour = Math.round(rawHour * 4) / 4;

    return {
      day: Math.max(0, Math.min(6, day)),
      hour: Math.max(0, Math.min(23.75, hour)),
    };
  };

  // Long press timer and refs
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartPos = useRef<{x: number; y: number} | null>(null);
  const gridContainerRef = useRef<View>(null);
  const gridLayoutRef = useRef<{x: number; y: number; width: number; height: number} | null>(null);
  const scrollOffsetRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPageYRef = useRef(0);
  const lastPageXRef = useRef(0);
  const lastSnapHourRef = useRef<number | null>(null);
  const dragModeRef = useRef<'create' | 'move' | null>(null);
  const onWeekChangeRef = useRef(onWeekChange);
  useEffect(() => { onWeekChangeRef.current = onWeekChange; }, [onWeekChange]);

  // Store grid layout on layout change
  const handleGridLayout = useCallback(() => {
    gridContainerRef.current?.measureInWindow((x, y, width, height) => {
      gridLayoutRef.current = {x, y, width, height};
    });
  }, []);

  // Convert page coordinates to grid-relative coordinates
  const pageToGridCoords = (pageX: number, pageY: number) => {
    const layout = gridLayoutRef.current;
    if (!layout) {
      return {
        x: pageX - 8,
        y: pageY + scrollOffsetRef.current,
      };
    }
    return {
      x: pageX - layout.x,
      y: pageY - layout.y + scrollOffsetRef.current,
    };
  };

  // Auto-scroll functions
  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  }, []);

  const lastAutoScrollUpdateRef = useRef(0);
  const AUTO_SCROLL_UPDATE_INTERVAL = 50; // Update state every 50ms instead of 16ms

  const startAutoScroll = useCallback((direction: 'up' | 'down') => {
    stopAutoScroll();

    const maxScroll = 24 * HOUR_HEIGHT - scrollViewHeightRef.current;

    autoScrollTimer.current = setInterval(() => {
      if (!isDraggingRef.current) {
        stopAutoScroll();
        return;
      }

      const currentOffset = scrollOffsetRef.current;
      let newOffset = currentOffset;

      if (direction === 'down') {
        newOffset = Math.min(currentOffset + AUTO_SCROLL_SPEED, maxScroll);
      } else {
        newOffset = Math.max(currentOffset - AUTO_SCROLL_SPEED, 0);
      }

      if (newOffset !== currentOffset) {
        scrollViewRef.current?.scrollTo({y: newOffset, animated: false});
        scrollOffsetRef.current = newOffset;

        // Throttle state updates to reduce re-renders
        const now = Date.now();
        if (now - lastAutoScrollUpdateRef.current < AUTO_SCROLL_UPDATE_INTERVAL) {
          return;
        }
        lastAutoScrollUpdateRef.current = now;

        // Update end time based on current touch position
        if (newEventRef.current) {
          const gridCoords = pageToGridCoords(lastPageXRef.current, lastPageYRef.current);
          const time = positionToTime(gridCoords.x, gridCoords.y);
          const currentEvent = newEventRef.current;

          let newEndDay = time.day;
          let newEndHour = time.hour + 0.25;

          if (newEndDay < currentEvent.startDay ||
              (newEndDay === currentEvent.startDay && newEndHour <= currentEvent.startHour)) {
            newEndDay = currentEvent.startDay;
            newEndHour = currentEvent.startHour + 0.25;
          }

          const newEventData = {
            startDay: currentEvent.startDay,
            startHour: currentEvent.startHour,
            endDay: newEndDay,
            endHour: Math.min(24, newEndHour),
          };
          newEventRef.current = newEventData;
          setNewEvent(newEventData);
        }
      }
    }, 16); // Scroll at 60fps, but state updates are throttled
  }, [stopAutoScroll]);

  // PanResponder for handling long press and drag
  const panResponder = useRef<PanResponderInstance>(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => {
        // Only take over if we're already dragging
        return isDraggingRef.current;
      },
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const {pageX, pageY} = evt.nativeEvent;
        longPressStartPos.current = {x: pageX, y: pageY};

        // Note: We use the grid layout from handleGridLayout (called on initial layout)
        // combined with scrollOffsetRef to calculate position correctly.
        // Do NOT call measureInWindow here as it would double-count the scroll offset.

        const initialPagePos = {x: pageX, y: pageY};
        const currentScrollOffset = scrollOffsetRef.current;

        // Start long press timer
        longPressTimer.current = setTimeout(() => {
          const layout = gridLayoutRef.current;
          const gridX = layout ? initialPagePos.x - layout.x : initialPagePos.x - 8;
          const gridY = layout ? initialPagePos.y - layout.y + currentScrollOffset : initialPagePos.y + currentScrollOffset;
          const time = positionToTime(gridX, gridY);

          // Vibrate to indicate block creation
          Vibration.vibrate(50);

          const newEventData = {
            startDay: time.day,
            startHour: time.hour,
            endDay: time.day,
            endHour: time.hour + 0.5,
          };
          newEventRef.current = newEventData;
          isDraggingRef.current = true;
          dragModeRef.current = 'create';
          lastSnapHourRef.current = time.hour + 0.5;
          setNewEvent(newEventData);
          setIsDragging(true);
        }, 200);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const {pageX, pageY} = evt.nativeEvent;

        // Store last touch position for auto-scroll updates
        lastPageXRef.current = pageX;
        lastPageYRef.current = pageY;

        // Cancel long press if moved too much before it triggers
        if (longPressTimer.current && longPressStartPos.current) {
          const dx = pageX - longPressStartPos.current.x;
          const dy = pageY - longPressStartPos.current.y;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
        }

        // If dragging (create mode), update end day and end time
        if (isDraggingRef.current && dragModeRef.current === 'create' && newEventRef.current) {
          const gridCoords = pageToGridCoords(pageX, pageY);
          const time = positionToTime(gridCoords.x, gridCoords.y);
          const currentEvent = newEventRef.current;

          // Calculate new end position
          let newEndDay = time.day;
          let newEndHour = time.hour + 0.25;

          // Ensure end is after start
          if (newEndDay < currentEvent.startDay ||
              (newEndDay === currentEvent.startDay && newEndHour <= currentEvent.startHour)) {
            newEndDay = currentEvent.startDay;
            newEndHour = currentEvent.startHour + 0.25;
          }

          // Vibrate when end day changes
          if (newEndDay !== currentEvent.endDay) {
            Vibration.vibrate(30);
          }

          // Vibrate when crossing 15-minute boundaries (haptic snap feedback)
          const finalEndHour = Math.min(24, newEndHour);
          if (lastSnapHourRef.current !== null && finalEndHour !== lastSnapHourRef.current) {
            Vibration.vibrate(10); // Light haptic for time snap
          }
          lastSnapHourRef.current = finalEndHour;

          const newEventData = {
            startDay: currentEvent.startDay,
            startHour: currentEvent.startHour,
            endDay: newEndDay,
            endHour: finalEndHour,
          };
          newEventRef.current = newEventData;
          setNewEvent(newEventData);
        }

        // If dragging (move mode), update event position
        if (isDraggingRef.current && dragModeRef.current === 'move' && draggingEventRef.current) {
          const gridCoords = pageToGridCoords(pageX, pageY);
          const time = positionToTime(gridCoords.x, gridCoords.y);
          const currentDrag = draggingEventRef.current;

          // Vibrate when day changes
          if (time.day !== currentDrag.currentDay) {
            Vibration.vibrate(30);
          }

          // Vibrate when crossing 15-minute boundaries
          if (lastSnapHourRef.current !== null && time.hour !== lastSnapHourRef.current) {
            Vibration.vibrate(10);
          }
          lastSnapHourRef.current = time.hour;

          const updatedDrag: DraggingEvent = {
            ...currentDrag,
            currentDay: time.day,
            currentHour: Math.max(0, Math.min(24 - currentDrag.duration, time.hour)),
          };
          draggingEventRef.current = updatedDrag;
          setDraggingEvent(updatedDrag);
        }

        // Check for auto-scroll (for both modes)
        if (isDraggingRef.current) {
          const layout = gridLayoutRef.current;
          if (layout) {
            const relativeY = pageY - layout.y;
            const scrollViewHeight = scrollViewHeightRef.current;

            if (relativeY > scrollViewHeight - AUTO_SCROLL_THRESHOLD) {
              startAutoScroll('down');
            } else if (relativeY < AUTO_SCROLL_THRESHOLD) {
              startAutoScroll('up');
            } else {
              stopAutoScroll();
            }
          }
        }
      },
      onPanResponderRelease: () => {
        // Clear long press timer
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }

        // Stop auto-scroll
        stopAutoScroll();

        // If was dragging in create mode, finalize the new event
        if (isDraggingRef.current && dragModeRef.current === 'create' && newEventRef.current) {
          const event = newEventRef.current;
          const days = weekDaysRef.current;
          const callback = onTimeRangeSelectRef.current;

          if (callback) {
            const startDate = new Date(days[event.startDay]);
            const startMinutes = Math.round((event.startHour % 1) * 60);
            startDate.setHours(Math.floor(event.startHour), startMinutes, 0, 0);

            const endDate = new Date(days[event.endDay]);
            const endMinutes = Math.round((event.endHour % 1) * 60);
            endDate.setHours(Math.floor(event.endHour), endMinutes, 0, 0);

            callback(startDate, endDate);
          }

          newEventRef.current = null;
          isDraggingRef.current = false;
          dragModeRef.current = null;
          lastSnapHourRef.current = null;
          setNewEvent(null);
          setIsDragging(false);
        }

        // If was dragging in move mode, save the moved event
        if (isDraggingRef.current && dragModeRef.current === 'move' && draggingEventRef.current) {
          const drag = draggingEventRef.current;
          const days = weekDaysRef.current;
          const originalEvent = drag.event;

          // Only update if position changed
          if (drag.currentDay !== drag.originalStartDay || drag.currentHour !== drag.originalStartHour) {
            const newStartDate = new Date(days[drag.currentDay]);
            const startMinutes = Math.round((drag.currentHour % 1) * 60);
            newStartDate.setHours(Math.floor(drag.currentHour), startMinutes, 0, 0);

            const newEndDate = new Date(days[drag.currentDay]);
            const endHour = drag.currentHour + drag.duration;
            const endMinutes = Math.round((endHour % 1) * 60);
            newEndDate.setHours(Math.floor(endHour), endMinutes, 0, 0);

            // Update the event - preserve all original properties
            setIsSaving(true);
            RNCalendarEvents.saveEvent(originalEvent.title || '', {
              id: originalEvent.id,
              calendarId: originalEvent.calendar?.id,
              startDate: newStartDate.toISOString(),
              endDate: newEndDate.toISOString(),
              allDay: originalEvent.allDay,
              // Preserve original event properties
              location: originalEvent.location,
              notes: originalEvent.notes,
              url: originalEvent.url,
              alarms: originalEvent.alarms,
              // Note: recurrence is preserved by the calendar API when updating
            }).then(() => {
              // Refresh events after update
              RNCalendarEvents.fetchAllEvents(
                weekStartRef.current.toISOString(),
                new Date(weekStartRef.current.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              ).then(setEvents);
            }).catch((err) => {
              console.error('Error updating event:', err);
              Alert.alert(
                '更新エラー',
                '予定の移動に失敗しました。もう一度お試しください。',
                [{text: 'OK'}]
              );
              // Refresh to restore original state
              RNCalendarEvents.fetchAllEvents(
                weekStartRef.current.toISOString(),
                new Date(weekStartRef.current.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              ).then(setEvents);
            }).finally(() => {
              setIsSaving(false);
            });
          }

          draggingEventRef.current = null;
          isDraggingRef.current = false;
          dragModeRef.current = null;
          lastSnapHourRef.current = null;
          setDraggingEvent(null);
          setIsDragging(false);
        }
      },
      onPanResponderTerminate: () => {
        // Clear everything if responder is terminated
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        // Stop auto-scroll
        stopAutoScroll();
        newEventRef.current = null;
        draggingEventRef.current = null;
        isDraggingRef.current = false;
        dragModeRef.current = null;
        lastSnapHourRef.current = null;
        setNewEvent(null);
        setDraggingEvent(null);
        setIsDragging(false);
      },
    })
  ).current;

  // Get events for a specific day
  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      if (!event.startDate || !event.endDate) return false;
      const eventStart = new Date(event.startDate);
      const eventEnd = new Date(event.endDate);
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      return eventStart <= dayEnd && eventEnd >= dayStart;
    });
  };

  const formatHour = (hour: number) => {
    const h = Math.floor(hour);
    const m = Math.round((hour % 1) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  // Handle long press on existing event to start dragging
  const handleEventLongPress = useCallback((event: CalendarEventReadable, dayIndex: number) => {
    if (!event.startDate || !event.endDate) return;

    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    const startHour = eventStart.getHours() + eventStart.getMinutes() / 60;
    const endHour = eventEnd.getHours() + eventEnd.getMinutes() / 60;
    const duration = event.allDay ? 24 : Math.max(endHour - startHour, 0.5);

    Vibration.vibrate(50);

    const dragData: DraggingEvent = {
      event,
      originalStartDay: dayIndex,
      originalStartHour: startHour,
      currentDay: dayIndex,
      currentHour: startHour,
      duration,
    };

    draggingEventRef.current = dragData;
    dragModeRef.current = 'move';
    isDraggingRef.current = true;
    lastSnapHourRef.current = startHour;
    setDraggingEvent(dragData);
    setIsDragging(true);
  }, []);

  // Header swipe PanResponder for week navigation
  const headerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal swipes when not dragging
        return !isDraggingRef.current &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
          Math.abs(gestureState.dx) > 20;
      },
      onPanResponderRelease: (_, gestureState) => {
        const SWIPE_THRESHOLD = 50;
        if (gestureState.dx > SWIPE_THRESHOLD) {
          // Swipe right - go to previous week
          const callback = onWeekChangeRef.current;
          if (callback) {
            const newDate = new Date(weekStartRef.current);
            newDate.setDate(newDate.getDate() - 7);
            callback(newDate);
          }
        } else if (gestureState.dx < -SWIPE_THRESHOLD) {
          // Swipe left - go to next week
          const callback = onWeekChangeRef.current;
          if (callback) {
            const newDate = new Date(weekStartRef.current);
            newDate.setDate(newDate.getDate() + 7);
            callback(newDate);
          }
        }
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      {/* Header with days */}
      <View style={styles.header} {...headerPanResponder.panHandlers}>
        <View style={styles.timeColumnHeader} />
        {weekDays.map((date, index) => (
          <View
            key={index}
            style={[
              styles.dayHeader,
              isToday(date) && styles.todayHeader,
            ]}>
            <Text style={[styles.dayName, index === 0 && styles.sundayText, index === 6 && styles.saturdayText]}>
              {WEEKDAYS[index]}
            </Text>
            <Text style={[
              styles.dayNumber,
              isToday(date) && styles.todayText,
              index === 0 && styles.sundayText,
              index === 6 && styles.saturdayText,
            ]}>
              {date.getDate()}
            </Text>
          </View>
        ))}
      </View>

      {/* Loading indicator */}
      {(isLoading || isSaving) && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
          {isSaving && <Text style={styles.savingText}>保存中...</Text>}
        </View>
      )}

      {/* Error display */}
      {error && (
        <TouchableOpacity style={styles.errorContainer} onPress={fetchEvents}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText}>タップして再読み込み</Text>
        </TouchableOpacity>
      )}

      {/* Time grid */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        scrollEventThrottle={16}
        scrollEnabled={!isDragging}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        onLayout={(e) => {
          scrollViewHeightRef.current = e.nativeEvent.layout.height;
        }}>
        <View
          ref={gridContainerRef}
          style={styles.gridContainer}
          onLayout={handleGridLayout}
          {...panResponder.panHandlers}>
          {/* Time labels */}
          <View style={styles.timeColumn}>
            {Array.from({length: 24}, (_, hour) => (
              <View key={hour} style={styles.timeSlot}>
                <Text style={styles.timeText}>
                  {hour.toString().padStart(2, '0')}:00
                </Text>
              </View>
            ))}
          </View>

          {/* Day columns */}
          <View style={styles.daysContainer}>
            {/* Current time indicator */}
            {isTodayInWeek && (
              <View
                style={[
                  styles.currentTimeIndicator,
                  {top: currentTimePosition},
                ]}
                pointerEvents="none">
                <View style={styles.currentTimeDot} />
                <View style={styles.currentTimeLine} />
              </View>
            )}
            {weekDays.map((date, dayIndex) => (
              <View key={dayIndex} style={styles.dayColumn}>
                {/* Hour cells */}
                {Array.from({length: 24}, (_, hour) => (
                  <View key={hour} style={styles.hourCell} />
                ))}

                {/* Existing events */}
                {getEventsForDay(date).map(event => {
                  if (!event.startDate || !event.endDate) return null;
                  const eventStart = new Date(event.startDate);
                  const eventEnd = new Date(event.endDate);
                  const dayStart = new Date(date);
                  dayStart.setHours(0, 0, 0, 0);
                  const dayEnd = new Date(date);
                  dayEnd.setHours(23, 59, 59, 999);

                  // Calculate proper start hour for this day
                  const startHour = eventStart < dayStart
                    ? 0
                    : eventStart.getHours() + eventStart.getMinutes() / 60;

                  // Calculate proper end hour for this day
                  let endHour: number;
                  if (eventEnd > dayEnd) {
                    // Event continues to next day
                    endHour = 24;
                  } else {
                    endHour = eventEnd.getHours() + eventEnd.getMinutes() / 60;
                    // Handle midnight edge case
                    if (endHour === 0 && eventEnd.getDate() !== dayStart.getDate()) {
                      endHour = 24;
                    }
                  }

                  const duration = event.allDay ? 24 : Math.max(endHour - startHour, 0.5);

                  // Hide original event if it's being dragged
                  const isBeingDragged = draggingEvent?.event.id === event.id;

                  return (
                    <TouchableOpacity
                      key={event.id}
                      style={[
                        styles.eventBlock,
                        {
                          top: (event.allDay ? 0 : startHour) * HOUR_HEIGHT,
                          height: duration * HOUR_HEIGHT - 2,
                          backgroundColor: event.calendar?.color || '#007AFF',
                          opacity: isBeingDragged ? 0.3 : 1,
                        },
                      ]}
                      onPress={() => onEventPress?.(event)}
                      onLongPress={() => handleEventLongPress(event, dayIndex)}
                      delayLongPress={200}
                      activeOpacity={0.7}>
                      <Text style={styles.eventTitle} numberOfLines={2}>
                        {event.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Dragging event (move mode) */}
                {draggingEvent && dayIndex === draggingEvent.currentDay && (
                  <View
                    style={[
                      styles.draggingEventBlock,
                      {
                        top: draggingEvent.currentHour * HOUR_HEIGHT,
                        height: draggingEvent.duration * HOUR_HEIGHT - 2,
                        backgroundColor: draggingEvent.event.calendar?.color || '#007AFF',
                      },
                    ]}
                    pointerEvents="none">
                    <Text style={styles.eventTitle} numberOfLines={2}>
                      {draggingEvent.event.title}
                    </Text>
                    <Text style={styles.draggingEventTime}>
                      {formatHour(draggingEvent.currentHour)} - {formatHour(draggingEvent.currentHour + draggingEvent.duration)}
                    </Text>
                  </View>
                )}

                {/* New event being created */}
                {newEvent && dayIndex >= newEvent.startDay && dayIndex <= newEvent.endDay && (
                  <View
                    style={[
                      styles.newEventBlock,
                      {
                        top: dayIndex === newEvent.startDay ? newEvent.startHour * HOUR_HEIGHT : 0,
                        height: dayIndex === newEvent.startDay && dayIndex === newEvent.endDay
                          ? (newEvent.endHour - newEvent.startHour) * HOUR_HEIGHT
                          : dayIndex === newEvent.startDay
                            ? (24 - newEvent.startHour) * HOUR_HEIGHT
                            : dayIndex === newEvent.endDay
                              ? newEvent.endHour * HOUR_HEIGHT
                              : 24 * HOUR_HEIGHT,
                      },
                      dayIndex === newEvent.startDay && styles.newEventBlockStart,
                      dayIndex === newEvent.endDay && styles.newEventBlockEnd,
                      dayIndex > newEvent.startDay && dayIndex < newEvent.endDay && styles.newEventBlockMiddle,
                    ]}
                    pointerEvents="none">
                    {dayIndex === newEvent.startDay && (
                      <Text style={styles.newEventStartTime}>
                        {formatHour(newEvent.startHour)}
                      </Text>
                    )}
                    {dayIndex === newEvent.endDay && (
                      <Text style={styles.newEventEndTime}>
                        {formatHour(newEvent.endHour)}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 8,
  },
  timeColumnHeader: {
    width: TIME_COLUMN_WIDTH,
  },
  dayHeader: {
    width: DAY_WIDTH,
    alignItems: 'center',
    paddingVertical: 4,
  },
  todayHeader: {
    backgroundColor: '#E8F4FD',
    borderRadius: 8,
  },
  dayName: {
    fontSize: 12,
    color: '#666',
  },
  dayNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  todayText: {
    color: '#007AFF',
  },
  sundayText: {
    color: '#FF3B30',
  },
  saturdayText: {
    color: '#007AFF',
  },
  loadingContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  savingText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  errorContainer: {
    backgroundColor: '#FFF3F3',
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
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
  scrollView: {
    flex: 1,
  },
  gridContainer: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: TIME_COLUMN_WIDTH,
  },
  timeSlot: {
    height: HOUR_HEIGHT,
    justifyContent: 'flex-start',
    paddingRight: 8,
    alignItems: 'flex-end',
  },
  timeText: {
    fontSize: 10,
    color: '#999',
    marginTop: -6,
  },
  daysContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  dayColumn: {
    width: DAY_WIDTH,
    borderLeftWidth: 1,
    borderLeftColor: '#f0f0f0',
    position: 'relative',
  },
  hourCell: {
    height: HOUR_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  eventBlock: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: 4,
    padding: 4,
    overflow: 'hidden',
  },
  eventTitle: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '500',
  },
  newEventBlock: {
    position: 'absolute',
    left: 1,
    right: 1,
    backgroundColor: '#007AFF',
    borderRadius: 4,
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 3,
    zIndex: 100,
  },
  newEventStartTime: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  newEventEndTime: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
    alignSelf: 'flex-end',
  },
  newEventBlockStart: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  newEventBlockEnd: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  newEventBlockMiddle: {
    borderRadius: 0,
  },
  currentTimeIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 50,
  },
  currentTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
    marginLeft: -4,
  },
  currentTimeLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#FF3B30',
  },
  draggingEventBlock: {
    position: 'absolute',
    left: 1,
    right: 1,
    borderRadius: 4,
    padding: 4,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 200,
  },
  draggingEventTime: {
    fontSize: 9,
    color: '#fff',
    opacity: 0.9,
    marginTop: 2,
  },
});

export default WeekView;
