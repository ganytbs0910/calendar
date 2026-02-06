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
import {getAllEventColors} from './AddEventModal';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Container has margin: 16 (both sides = 32) + padding: 16 (both sides = 32) = 64 total
const DAY_WIDTH = Math.floor((SCREEN_WIDTH - 64) / 7);
const SCREEN_HEIGHT = Dimensions.get('window').height;
// Calculate day height to fill screen (subtract header, weekday row, margins, safe area)
const DAY_HEIGHT = Math.floor((SCREEN_HEIGHT - 220) / 5); // 5 weeks average
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
}

export interface CalendarRef {
  refreshEvents: () => void;
  goToToday: () => void;
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
  const [eventColors, setEventColors] = useState<Record<string, string>>({});

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

      const [calendarEvents, colors] = await Promise.all([
        RNCalendarEvents.fetchAllEvents(
          startDate.toISOString(),
          endDate.toISOString(),
        ),
        getAllEventColors(),
      ]);
      setEvents(calendarEvents);
      setEventColors(colors);
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
    goToToday: () => {
      setCurrentDate(new Date());
      setSelectedDate(new Date());
    },
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
        date: new Date(currentYear, currentMonth, i),
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
  }, [currentYear, currentMonth, getDaysInMonth, getFirstDayOfMonth]);

  // Calculate number of weeks to display
  const numberOfWeeks = useMemo(() => {
    return Math.ceil(calendarDays.length / 7);
  }, [calendarDays]);

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

        {/* Calendar grid - render by weeks */}
        <View style={styles.calendarGrid} {...panResponder.panHandlers}>
          {Array.from({length: numberOfWeeks}).map((_, weekIndex) => {
            const weekDays = calendarDays.slice(weekIndex * 7, (weekIndex + 1) * 7);
            const multiDayEventsInWeek = multiDayEventsByWeek[weekIndex] || [];

            return (
              <View key={weekIndex} style={styles.weekRow}>
                {/* Day cells */}
                {weekDays.map((item, dayIndex) => {
                  const globalIndex = weekIndex * 7 + dayIndex;

                  // Empty cell for days outside current month
                  if (!item.date) {
                    return (
                      <View key={`empty-${globalIndex}`} style={styles.dayCell} />
                    );
                  }

                  const dayEvents = getEventsForDate(item.date);
                  // Filter: only show timed events (not all-day), single-day only
                  const singleDayEvents = dayEvents.filter(e => {
                    if (!e.startDate || !e.endDate) return false;
                    if (e.allDay) return false; // Hide all-day events (holidays etc)
                    const start = new Date(e.startDate);
                    const end = new Date(e.endDate);
                    start.setHours(0, 0, 0, 0);
                    end.setHours(0, 0, 0, 0);
                    return start.getTime() === end.getTime();
                  });

                  return (
                    <TouchableOpacity
                      key={`${item.date.toISOString()}-${globalIndex}`}
                      style={[
                        styles.dayCell,
                        isToday(item.date) && styles.todayCell,
                        isSelected(item.date) && styles.selectedCell,
                      ]}
                      onPress={() => handleDateSelect(item.date!)}
                      accessibilityRole="button">
                      <Text
                        style={[
                          styles.dayText,
                          isSunday(globalIndex) && styles.sundayText,
                          isSaturday(globalIndex) && styles.saturdayText,
                          isToday(item.date) && styles.todayText,
                          isSelected(item.date) && styles.selectedText,
                        ]}>
                        {item.day}
                      </Text>
                      {/* Single-day events (max 2) */}
                      {singleDayEvents.length > 0 && (
                        <View style={styles.singleDayEventsContainer}>
                          {singleDayEvents.slice(0, 2).map(event => (
                            <TouchableOpacity
                              key={event.id}
                              style={[
                                styles.singleDayEventBox,
                                {backgroundColor: (event.id && eventColors[event.id]) || event.calendar?.color || '#007AFF'},
                              ]}
                              onPress={() => onEventPress?.(event)}>
                              <Text style={styles.singleDayEventTime}>
                                {event.startDate && formatTimeCompact(event.startDate)}
                              </Text>
                              <Text style={styles.singleDayEventTime}>
                                {event.endDate && formatTimeCompact(event.endDate)}
                              </Text>
                              <Text style={styles.singleDayEventTitle} numberOfLines={1}>
                                {event.title}
                              </Text>
                            </TouchableOpacity>
                          ))}
                          {singleDayEvents.length > 2 && (
                            <Text style={styles.cellEventMore}>+{singleDayEvents.length - 2}</Text>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
{/* Multi-day event bars - hidden */}
              </View>
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
              <TouchableOpacity
                style={styles.bottomSheetNavButton}
                onPress={goToPreviousDay}>
                <Text style={styles.bottomSheetNavButtonText}>{'<'}</Text>
              </TouchableOpacity>
              <Text style={styles.bottomSheetTitle}>
                {dayEventsDate && formatSheetDate(dayEventsDate)}
              </Text>
              <TouchableOpacity
                style={styles.bottomSheetNavButton}
                onPress={goToNextDay}>
                <Text style={styles.bottomSheetNavButtonText}>{'>'}</Text>
              </TouchableOpacity>
            </View>
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
                          {backgroundColor: (event.id && eventColors[event.id]) || event.calendar?.color || '#007AFF'},
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
    flexDirection: 'column',
  },
  weekRow: {
    flexDirection: 'row',
    height: DAY_HEIGHT,
    position: 'relative',
  },
  dayCell: {
    width: DAY_WIDTH,
    height: DAY_HEIGHT,
    alignItems: 'center',
    paddingTop: 2,
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
});

export default Calendar;
