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
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Container has margin: 16 (both sides = 32) + padding: 16 (both sides = 32) = 64 total
const DAY_WIDTH = Math.floor((SCREEN_WIDTH - 64) / 7);
const DAY_HEIGHT = 75; // Taller cells to show event times

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

interface CalendarProps {
  onDateSelect?: (date: Date) => void;
  onDateDoubleSelect?: (date: Date) => void;
  onEventPress?: (event: CalendarEventReadable) => void;
}

export interface CalendarRef {
  refreshEvents: () => void;
}

export const Calendar = forwardRef<CalendarRef, CalendarProps>(({onDateSelect, onDateDoubleSelect, onEventPress}, ref) => {
  const today = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDayEvents, setShowDayEvents] = useState(false);
  const [dayEventsDate, setDayEventsDate] = useState<Date | null>(null);
  const bottomSheetAnim = useState(new Animated.Value(0))[0];

  // Swipe gesture for month navigation
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const currentDateRef = useRef(currentDate);
  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Only respond to horizontal swipes (more horizontal than vertical)
      return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 20;
    },
    onPanResponderGrant: (evt) => {
      swipeStartX.current = evt.nativeEvent.pageX;
      swipeStartY.current = evt.nativeEvent.pageY;
    },
    onPanResponderRelease: (_, gestureState) => {
      const SWIPE_THRESHOLD = 50;
      const current = currentDateRef.current;
      if (gestureState.dx > SWIPE_THRESHOLD) {
        // Swipe right - go to previous month
        setCurrentDate(new Date(current.getFullYear(), current.getMonth() - 1, 1));
      } else if (gestureState.dx < -SWIPE_THRESHOLD) {
        // Swipe left - go to next month
        setCurrentDate(new Date(current.getFullYear(), current.getMonth() + 1, 1));
      }
    },
  })).current;

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Request calendar permission
  useEffect(() => {
    const requestPermission = async () => {
      try {
        const status = await RNCalendarEvents.requestPermissions();
        if (status === 'authorized' || (status as string) === 'fullAccess') {
          setHasPermission(true);
        } else {
          Alert.alert(
            'カレンダーへのアクセス',
            'カレンダーの予定を表示するには、設定でアクセスを許可してください。',
          );
        }
      } catch (err) {
        console.error('Permission error:', err);
      }
    };
    requestPermission();
  }, []);

  // Fetch events for the current month
  const fetchEvents = useCallback(async () => {
    if (!hasPermission) return;

    setIsLoading(true);
    setError(null);
    try {
      const startDate = new Date(currentYear, currentMonth, 1);
      const endDate = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

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
  }, [hasPermission, currentYear, currentMonth]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Expose refreshEvents to parent
  useImperativeHandle(ref, () => ({
    refreshEvents: fetchEvents,
  }), [fetchEvents]);

  const getDaysInMonth = useCallback((year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  }, []);

  const getFirstDayOfMonth = useCallback((year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  }, []);

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const daysInPrevMonth = getDaysInMonth(currentYear, currentMonth - 1);

    const days: Array<{day: number; isCurrentMonth: boolean; date: Date}> = [];

    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      days.push({
        day,
        isCurrentMonth: false,
        date: new Date(currentYear, currentMonth - 1, day),
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(currentYear, currentMonth, i),
      });
    }

    // Next month days
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(currentYear, currentMonth + 1, i),
      });
    }

    return days;
  }, [currentYear, currentMonth, getDaysInMonth, getFirstDayOfMonth]);

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

      // Show bottom sheet with day's events
      const dayEvents = getEventsForDate(date);
      if (dayEvents.length > 0) {
        openDayEventsSheet(date);
      }
    },
    [onDateSelect, getEventsForDate, openDayEventsSheet],
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

  // Check if an event spans multiple days
  const isMultiDayEvent = useCallback((event: CalendarEventReadable) => {
    if (!event.startDate || !event.endDate) return false;
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    return (
      start.getFullYear() !== end.getFullYear() ||
      start.getMonth() !== end.getMonth() ||
      start.getDate() !== end.getDate()
    );
  }, []);

  // Get the position of a date within a multi-day event
  const getEventDayPosition = useCallback((event: CalendarEventReadable, date: Date): 'start' | 'middle' | 'end' | 'single' => {
    if (!event.startDate || !event.endDate) return 'single';
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const currentDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (startDay.getTime() === endDay.getTime()) return 'single';
    if (currentDay.getTime() === startDay.getTime()) return 'start';
    if (currentDay.getTime() === endDay.getTime()) return 'end';
    return 'middle';
  }, []);

  return (
    <ScrollView style={styles.scrollView}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={goToPreviousMonth}
            style={styles.navButton}
            accessibilityLabel="前の月"
            accessibilityRole="button">
            <Text style={styles.navButtonText}>{'<'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={goToToday}
            accessibilityLabel="今日に移動"
            accessibilityRole="button">
            <Text style={styles.headerTitle}>
              {currentYear}年 {MONTHS[currentMonth]}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={goToNextMonth}
            style={styles.navButton}
            accessibilityLabel="次の月"
            accessibilityRole="button">
            <Text style={styles.navButtonText}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Loading indicator */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        )}

        {/* Error display */}
        {error && (
          <TouchableOpacity style={styles.errorContainer} onPress={fetchEvents}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.retryText}>タップして再読み込み</Text>
          </TouchableOpacity>
        )}

        {/* Weekday headers */}
        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((day, index) => (
            <View key={day} style={styles.weekdayCell}>
              <Text
                style={[
                  styles.weekdayText,
                  index === 0 && styles.sundayText,
                  index === 6 && styles.saturdayText,
                ]}>
                {day}
              </Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
        <View style={styles.calendarGrid} {...panResponder.panHandlers}>
          {calendarDays.map((item, index) => {
            const allDayEvents = getEventsForDate(item.date);
            // For today, filter out events that have already ended
            const now = new Date();
            const isTodayDate = isToday(item.date);
            const todayRemainingEvents = isTodayDate
              ? allDayEvents.filter(event => {
                  if (event.allDay) return true;
                  if (!event.endDate) return true;
                  return new Date(event.endDate) > now;
                })
              : allDayEvents;

            // If today has no remaining events, show next upcoming event
            const showNextEvent = isTodayDate && todayRemainingEvents.length === 0 && nextUpcomingEvent;
            const dayEvents = showNextEvent ? [nextUpcomingEvent] : todayRemainingEvents;
            const hasEvents = dayEvents.length > 0;

            return (
              <TouchableOpacity
                key={`${item.date.toISOString()}-${index}`}
                style={[
                  styles.dayCell,
                  isToday(item.date) && styles.todayCell,
                  isSelected(item.date) && styles.selectedCell,
                ]}
                onPress={() => handleDateSelect(item.date)}
                accessibilityLabel={`${item.date.getMonth() + 1}月${item.day}日${isToday(item.date) ? '、今日' : ''}${hasEvents ? `、${dayEvents.length}件の予定` : ''}`}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected(item.date)}}>
                <Text
                  style={[
                    styles.dayText,
                    !item.isCurrentMonth && styles.otherMonthText,
                    isSunday(index) && item.isCurrentMonth && styles.sundayText,
                    isSaturday(index) && item.isCurrentMonth && styles.saturdayText,
                    isToday(item.date) && styles.todayText,
                    isSelected(item.date) && styles.selectedText,
                  ]}>
                  {item.day}
                </Text>
                {hasEvents && item.isCurrentMonth && (
                  <View style={styles.cellEventsContainer}>
                    {dayEvents.slice(0, 1).map((event) => {
                      const isMultiDay = isMultiDayEvent(event);
                      const position = getEventDayPosition(event, item.date);
                      const dayIndex = index % 7;
                      const isFirstDayOfWeek = dayIndex === 0;
                      const isLastDayOfWeek = dayIndex === 6;

                      // Get cell time display
                      const getCellTimeContent = () => {
                        // Show next event with date if today has no remaining events
                        if (showNextEvent && event.startDate) {
                          const nextDate = new Date(event.startDate);
                          return (
                            <>
                              <Text style={styles.cellNextEventDate}>
                                {nextDate.getMonth() + 1}/{nextDate.getDate()}
                              </Text>
                              <Text style={styles.cellEventTimeText}>{formatTime(event.startDate)}</Text>
                            </>
                          );
                        }

                        if (event.allDay || !event.startDate || !event.endDate) {
                          return <Text style={styles.cellEventTimeText}>終日</Text>;
                        }
                        if (!isMultiDay) {
                          return (
                            <>
                              <Text style={styles.cellEventTimeText}>{formatTime(event.startDate)}</Text>
                              <Text style={styles.cellEventTimeSeparator}>~</Text>
                              <Text style={styles.cellEventTimeText}>{formatTime(event.endDate)}</Text>
                            </>
                          );
                        }
                        // Multi-day with times
                        if (position === 'start') {
                          return (
                            <>
                              <Text style={styles.cellEventTimeText}>{formatTime(event.startDate)}</Text>
                              <Text style={styles.cellEventTimeSeparator}>~</Text>
                            </>
                          );
                        }
                        if (position === 'end') {
                          return (
                            <>
                              <Text style={styles.cellEventTimeSeparator}>~</Text>
                              <Text style={styles.cellEventTimeText}>{formatTime(event.endDate)}</Text>
                            </>
                          );
                        }
                        // Middle
                        return <Text style={styles.cellEventTimeText}>終日</Text>;
                      };

                      return (
                        <View
                          key={event.id}
                          style={[
                            styles.cellEventBox,
                            {backgroundColor: showNextEvent ? '#999' : (event.calendar?.color || '#007AFF')},
                            isMultiDay && !showNextEvent && styles.cellMultiDayEventBox,
                            isMultiDay && !showNextEvent && position === 'start' && styles.cellMultiDayStart,
                            isMultiDay && !showNextEvent && position === 'end' && styles.cellMultiDayEnd,
                            isMultiDay && !showNextEvent && position === 'middle' && styles.cellMultiDayMiddle,
                            isMultiDay && !showNextEvent && position === 'middle' && isFirstDayOfWeek && styles.cellMultiDayWeekStart,
                            isMultiDay && !showNextEvent && position === 'middle' && isLastDayOfWeek && styles.cellMultiDayWeekEnd,
                            isMultiDay && !showNextEvent && position === 'start' && isLastDayOfWeek && styles.cellMultiDayWeekEnd,
                            isMultiDay && !showNextEvent && position === 'end' && isFirstDayOfWeek && styles.cellMultiDayWeekStart,
                          ]}>
                          {getCellTimeContent()}
                        </View>
                      );
                    })}
                    {dayEvents.length > 1 && !showNextEvent && (
                      <Text style={styles.cellEventMore}>+{dayEvents.length - 1}</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
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
            style={styles.bottomSheetBackdrop}
            activeOpacity={1}
            onPress={closeDayEventsSheet}
          />
          <Animated.View
            style={[
              styles.bottomSheetContainer,
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
            <View style={styles.bottomSheetHandle} />
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>
                {dayEventsDate && formatSheetDate(dayEventsDate)}
              </Text>
              <TouchableOpacity
                style={styles.bottomSheetAddButton}
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
            </View>
            <ScrollView style={styles.bottomSheetContent}>
              {dayEventsForSheet.length === 0 ? (
                <Text style={styles.bottomSheetNoEvents}>予定はありません</Text>
              ) : (
                dayEventsForSheet.map((event) => (
                  <View key={event.id} style={styles.bottomSheetEventItem}>
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
                          {backgroundColor: event.calendar?.color || '#007AFF'},
                        ]}
                      />
                      <View style={styles.bottomSheetEventContent}>
                        <Text style={styles.bottomSheetEventTitle} numberOfLines={1}>
                          {event.title}
                        </Text>
                        <Text style={styles.bottomSheetEventTime}>
                          {event.allDay
                            ? '終日'
                            : event.startDate && event.endDate
                              ? `${formatTime(event.startDate)} - ${formatTime(event.endDate)}`
                              : ''}
                        </Text>
                        {event.location && (
                          <Text style={styles.bottomSheetEventLocation} numberOfLines={1}>
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
                          fetchEvents();
                        } catch (err) {
                          console.error('Error deleting event:', err);
                        }
                      }}>
                      <Text style={styles.bottomSheetDeleteButtonText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    marginBottom: 8,
  },
  weekdayCell: {
    width: DAY_WIDTH,
    alignItems: 'center',
    paddingVertical: 8,
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: DAY_WIDTH,
    height: DAY_HEIGHT,
    alignItems: 'center',
    paddingTop: 4,
    borderRadius: 4,
  },
  dayText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
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
  cellEventsContainer: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 1,
    paddingTop: 1,
    alignItems: 'center',
  },
  cellEventBox: {
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    width: '100%',
  },
  cellMultiDayEventBox: {
    borderRadius: 0,
    marginHorizontal: -1,
    width: '110%',
  },
  cellMultiDayStart: {
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    marginLeft: 0,
    marginRight: -3,
  },
  cellMultiDayEnd: {
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    marginRight: 0,
    marginLeft: -3,
  },
  cellMultiDayMiddle: {
    marginHorizontal: -3,
    width: '120%',
  },
  cellMultiDayWeekStart: {
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    marginLeft: 0,
  },
  cellMultiDayWeekEnd: {
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    marginRight: 0,
  },
  cellNextEventDate: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '500',
  },
  cellEventTimeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
    lineHeight: 12,
  },
  cellEventTimeSeparator: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 10,
  },
  cellEventMore: {
    fontSize: 8,
    color: '#666',
    marginTop: 1,
  },
  selectedText: {
    color: '#007AFF',
    fontWeight: 'bold',
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  bottomSheetAddButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#007AFF',
    borderRadius: 16,
  },
  bottomSheetAddButtonText: {
    fontSize: 14,
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
});

export default Calendar;
