import React, {useState, useCallback, useRef, useEffect, useMemo} from 'react';
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
  PanResponderGestureState,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';

const SCREEN_WIDTH = Dimensions.get('window').width;
const HOUR_HEIGHT = 60;
const TIME_COLUMN_WIDTH = 50;
const DAY_WIDTH = (SCREEN_WIDTH - TIME_COLUMN_WIDTH - 16) / 7;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface WeekViewProps {
  currentDate: Date;
  onTimeRangeSelect?: (startDate: Date, endDate: Date) => void;
  hasPermission: boolean;
}

interface NewEvent {
  day: number;
  startHour: number;
  endHour: number;
}

export const WeekView: React.FC<WeekViewProps> = ({
  currentDate,
  onTimeRangeSelect,
  hasPermission,
}) => {
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [newEvent, setNewEvent] = useState<NewEvent | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // Refs for latest values
  const newEventRef = useRef(newEvent);
  const isDraggingRef = useRef(isDragging);
  const onTimeRangeSelectRef = useRef(onTimeRangeSelect);

  useEffect(() => { newEventRef.current = newEvent; }, [newEvent]);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { onTimeRangeSelectRef.current = onTimeRangeSelect; }, [onTimeRangeSelect]);

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
  useEffect(() => {
    const fetchEvents = async () => {
      if (!hasPermission) return;

      try {
        const startDate = weekStart;
        const endDate = new Date(weekStart);
        endDate.setDate(endDate.getDate() + 7);

        const calendarEvents = await RNCalendarEvents.fetchAllEvents(
          startDate.toISOString(),
          endDate.toISOString(),
        );
        setEvents(calendarEvents);
      } catch (error) {
        console.error('Error fetching events:', error);
      }
    };

    fetchEvents();
  }, [weekStart, hasPermission]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

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

  // PanResponder for handling long press and drag
  const panResponder = useRef<PanResponderInstance>(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only take over if we're already dragging
        return isDraggingRef.current;
      },
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const {pageX, pageY} = evt.nativeEvent;
        longPressStartPos.current = {x: pageX, y: pageY};

        // Update grid layout
        gridContainerRef.current?.measureInWindow((x, y, width, height) => {
          gridLayoutRef.current = {x, y, width, height};
        });

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
            day: time.day,
            startHour: time.hour,
            endHour: time.hour + 0.5,
          };
          newEventRef.current = newEventData;
          isDraggingRef.current = true;
          setNewEvent(newEventData);
          setIsDragging(true);
        }, 400);
      },
      onPanResponderMove: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const {pageX, pageY} = evt.nativeEvent;

        // Cancel long press if moved too much before it triggers
        if (longPressTimer.current && longPressStartPos.current) {
          const dx = pageX - longPressStartPos.current.x;
          const dy = pageY - longPressStartPos.current.y;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
        }

        // If dragging, update end time
        if (isDraggingRef.current && newEventRef.current) {
          const gridCoords = pageToGridCoords(pageX, pageY);
          const time = positionToTime(gridCoords.x, gridCoords.y);
          const currentEvent = newEventRef.current;

          const draggedHour = time.hour + 0.25;
          const endHour = Math.max(currentEvent.startHour + 0.25, draggedHour);

          const newEventData = {
            day: currentEvent.day,
            startHour: currentEvent.startHour,
            endHour: Math.min(24, endHour),
          };
          newEventRef.current = newEventData;
          setNewEvent(newEventData);
        }
      },
      onPanResponderRelease: () => {
        // Clear long press timer
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }

        // If was dragging, finalize the event
        if (isDraggingRef.current && newEventRef.current) {
          const event = newEventRef.current;
          const days = weekDaysRef.current;
          const callback = onTimeRangeSelectRef.current;

          if (callback) {
            const startDate = new Date(days[event.day]);
            const startMinutes = Math.round((event.startHour % 1) * 60);
            startDate.setHours(Math.floor(event.startHour), startMinutes, 0, 0);

            const endDate = new Date(days[event.day]);
            const endMinutes = Math.round((event.endHour % 1) * 60);
            endDate.setHours(Math.floor(event.endHour), endMinutes, 0, 0);

            callback(startDate, endDate);
          }

          newEventRef.current = null;
          isDraggingRef.current = false;
          setNewEvent(null);
          setIsDragging(false);
        }
      },
      onPanResponderTerminate: () => {
        // Clear everything if responder is terminated
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        newEventRef.current = null;
        isDraggingRef.current = false;
        setNewEvent(null);
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

  return (
    <View style={styles.container}>
      {/* Header with days */}
      <View style={styles.header}>
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

      {/* Time grid */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        scrollEventThrottle={16}
        scrollEnabled={!isDragging}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
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

                  const startHour = eventStart < dayStart
                    ? 0
                    : eventStart.getHours() + eventStart.getMinutes() / 60;
                  const endHour = eventEnd.getHours() + eventEnd.getMinutes() / 60;
                  const duration = event.allDay ? 24 : Math.max(endHour - startHour, 0.5);

                  return (
                    <View
                      key={event.id}
                      style={[
                        styles.eventBlock,
                        {
                          top: (event.allDay ? 0 : startHour) * HOUR_HEIGHT,
                          height: duration * HOUR_HEIGHT - 2,
                          backgroundColor: event.calendar?.color || '#007AFF',
                        },
                      ]}
                      pointerEvents="none">
                      <Text style={styles.eventTitle} numberOfLines={2}>
                        {event.title}
                      </Text>
                    </View>
                  );
                })}

                {/* New event being created */}
                {newEvent && newEvent.day === dayIndex && (
                  <View
                    style={[
                      styles.newEventBlock,
                      {
                        top: newEvent.startHour * HOUR_HEIGHT,
                        height: (newEvent.endHour - newEvent.startHour) * HOUR_HEIGHT,
                      },
                    ]}
                    pointerEvents="none">
                    <Text style={styles.newEventTime}>
                      {formatHour(newEvent.startHour)} - {formatHour(newEvent.endHour)}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

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
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  newEventTime: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
});

export default WeekView;
