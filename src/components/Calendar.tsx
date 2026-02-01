import React, {useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Alert,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DAY_WIDTH = Math.floor((SCREEN_WIDTH - 32) / 7);
const DAY_HEIGHT = 75; // Taller cells to show event times

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

interface CalendarProps {
  onDateSelect?: (date: Date) => void;
  onDateDoubleSelect?: (date: Date) => void;
}

export interface CalendarRef {
  refreshEvents: () => void;
}

export const Calendar = forwardRef<CalendarRef, CalendarProps>(({onDateSelect, onDateDoubleSelect}, ref) => {
  const today = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [hasPermission, setHasPermission] = useState(false);

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
      } catch (error) {
        console.error('Permission error:', error);
      }
    };
    requestPermission();
  }, []);

  // Fetch events for the current month
  const fetchEvents = useCallback(async () => {
    if (!hasPermission) return;

    try {
      const startDate = new Date(currentYear, currentMonth, 1);
      const endDate = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

      const calendarEvents = await RNCalendarEvents.fetchAllEvents(
        startDate.toISOString(),
        endDate.toISOString(),
      );
      setEvents(calendarEvents);
    } catch (error) {
      console.error('Error fetching events:', error);
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

  const getEventsForDate = useCallback(
    (date: Date) => {
      const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
      const dateEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

      return events.filter(event => {
        if (!event.startDate || !event.endDate) return false;
        const eventStart = new Date(event.startDate);
        const eventEnd = new Date(event.endDate);

        // Event overlaps with this date if:
        // - Event starts before or on this date AND ends on or after this date
        return eventStart <= dateEnd && eventEnd >= dateStart;
      });
    },
    [events],
  );

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

  const handleDateSelect = useCallback(
    (date: Date) => {
      // Check if this date is already selected
      const isAlreadySelected = selectedDate &&
        date.getDate() === selectedDate.getDate() &&
        date.getMonth() === selectedDate.getMonth() &&
        date.getFullYear() === selectedDate.getFullYear();

      if (isAlreadySelected) {
        // Double tap - open add event modal
        onDateDoubleSelect?.(date);
      } else {
        // First tap - select the date
        setSelectedDate(date);
        onDateSelect?.(date);
      }
    },
    [onDateSelect, onDateDoubleSelect, selectedDate],
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

  // Format date range for multi-day events
  const formatDateRange = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
  };

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  return (
    <ScrollView style={styles.scrollView}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goToPreviousMonth} style={styles.navButton}>
            <Text style={styles.navButtonText}>{'<'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={goToToday}>
            <Text style={styles.headerTitle}>
              {currentYear}年 {MONTHS[currentMonth]}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={goToNextMonth} style={styles.navButton}>
            <Text style={styles.navButtonText}>{'>'}</Text>
          </TouchableOpacity>
        </View>

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
        <View style={styles.calendarGrid}>
          {calendarDays.map((item, index) => {
            const dayEvents = getEventsForDate(item.date);
            const hasEvents = dayEvents.length > 0;

            return (
              <TouchableOpacity
                key={`${item.date.toISOString()}-${index}`}
                style={[
                  styles.dayCell,
                  isToday(item.date) && styles.todayCell,
                  isSelected(item.date) && styles.selectedCell,
                ]}
                onPress={() => handleDateSelect(item.date)}>
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
                            {backgroundColor: event.calendar?.color || '#007AFF'},
                            isMultiDay && styles.cellMultiDayEventBox,
                            isMultiDay && position === 'start' && styles.cellMultiDayStart,
                            isMultiDay && position === 'end' && styles.cellMultiDayEnd,
                            isMultiDay && position === 'middle' && styles.cellMultiDayMiddle,
                            isMultiDay && position === 'middle' && isFirstDayOfWeek && styles.cellMultiDayWeekStart,
                            isMultiDay && position === 'middle' && isLastDayOfWeek && styles.cellMultiDayWeekEnd,
                            isMultiDay && position === 'start' && isLastDayOfWeek && styles.cellMultiDayWeekEnd,
                            isMultiDay && position === 'end' && isFirstDayOfWeek && styles.cellMultiDayWeekStart,
                          ]}>
                          {getCellTimeContent()}
                        </View>
                      );
                    })}
                    {dayEvents.length > 1 && (
                      <Text style={styles.cellEventMore}>+{dayEvents.length - 1}</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

      </View>
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
  cellEventTimeText: {
    fontSize: 8,
    color: '#fff',
    fontWeight: '600',
    lineHeight: 10,
  },
  cellEventTimeSeparator: {
    fontSize: 7,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 8,
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
});

export default Calendar;
