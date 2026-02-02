import React, {useCallback, useState, useRef, useEffect} from 'react';
import {
  StatusBar,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import Calendar, {CalendarRef} from './src/components/Calendar';
import WeekView, {WeekViewRef} from './src/components/WeekView';
import AddEventModal from './src/components/AddEventModal';
import EventDetailModal from './src/components/EventDetailModal';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';

type ViewMode = 'month' | 'week';

function AppContent() {
  const {colors, isDark} = useTheme();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventReadable | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventReadable | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [initialStartDate, setInitialStartDate] = useState<Date | undefined>();
  const [initialEndDate, setInitialEndDate] = useState<Date | undefined>();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [hasPermission, setHasPermission] = useState(false);
  const calendarRef = useRef<CalendarRef>(null);
  const weekViewRef = useRef<WeekViewRef>(null);

  // Request calendar permission
  useEffect(() => {
    const checkAndRequestPermission = async () => {
      try {
        // First check current permission status
        const currentStatus = await RNCalendarEvents.checkPermissions();
        if (currentStatus === 'authorized' || (currentStatus as string) === 'fullAccess') {
          setHasPermission(true);
          return;
        }

        // If not authorized, request permission
        const status = await RNCalendarEvents.requestPermissions();
        if (status === 'authorized' || (status as string) === 'fullAccess') {
          setHasPermission(true);
        } else if (status === 'denied') {
          Alert.alert(
            'カレンダーへのアクセス',
            'カレンダーの予定を表示するには、設定でアクセスを許可してください。',
            [
              {
                text: '閉じる',
                style: 'cancel',
              },
              {
                text: '設定を開く',
                onPress: () => Linking.openSettings(),
              },
            ],
          );
        } else if (status === 'restricted') {
          Alert.alert(
            'アクセス制限',
            'このデバイスではカレンダーへのアクセスが制限されています。',
            [{text: 'OK'}],
          );
        }
      } catch (error) {
        console.error('Permission error:', error);
        Alert.alert(
          'エラー',
          'カレンダーの権限確認中にエラーが発生しました。',
          [{text: 'OK'}],
        );
      }
    };
    checkAndRequestPermission();
  }, []);

  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    setCurrentDate(date);
  }, []);

  const handleAddEvent = useCallback(() => {
    setInitialStartDate(selectedDate || undefined);
    setInitialEndDate(undefined);
    setShowAddModal(true);
  }, [selectedDate]);

  const handleDateDoubleSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    setInitialStartDate(date);
    setInitialEndDate(undefined);
    setShowAddModal(true);
  }, []);

  // Handle drag selection from WeekView
  const handleTimeRangeSelect = useCallback((startDate: Date, endDate: Date) => {
    setInitialStartDate(startDate);
    setInitialEndDate(endDate);
    setShowAddModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowAddModal(false);
    setInitialStartDate(undefined);
    setInitialEndDate(undefined);
    setEditingEvent(null);
  }, []);

  const handleEventAdded = useCallback(() => {
    calendarRef.current?.refreshEvents();
    weekViewRef.current?.refreshEvents();
  }, []);

  // Handle event tap to show details
  const handleEventPress = useCallback((event: CalendarEventReadable) => {
    setSelectedEvent(event);
    setShowDetailModal(true);
  }, []);

  const handleCloseDetailModal = useCallback(() => {
    setShowDetailModal(false);
    setSelectedEvent(null);
  }, []);

  const handleEditEvent = useCallback((event: CalendarEventReadable) => {
    setEditingEvent(event);
    if (event.startDate) {
      setInitialStartDate(new Date(event.startDate));
    }
    if (event.endDate) {
      setInitialEndDate(new Date(event.endDate));
    }
    setShowAddModal(true);
  }, []);

  const handleEventDeleted = useCallback(() => {
    calendarRef.current?.refreshEvents();
    weekViewRef.current?.refreshEvents();
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'month' ? 'week' : 'month');
  }, []);

  const goToPreviousWeek = useCallback(() => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() - 7);
      return newDate;
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + 7);
      return newDate;
    });
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Handler for swipe navigation in WeekView
  const handleWeekChange = useCallback((newDate: Date) => {
    setCurrentDate(newDate);
  }, []);

  const formatWeekRange = (date: Date) => {
    const start = new Date(date);
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const formatDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const dynamicStyles = {
    container: {
      ...styles.container,
      backgroundColor: colors.background,
    },
    header: {
      ...styles.header,
    },
    title: {
      ...styles.title,
      color: colors.text,
    },
    weekNavigation: {
      ...styles.weekNavigation,
      backgroundColor: colors.surface,
      borderBottomColor: colors.border,
    },
    weekRangeText: {
      ...styles.weekRangeText,
      color: colors.text,
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={dynamicStyles.container}>
        <View style={dynamicStyles.header}>
          <Text style={dynamicStyles.title}>理想のカレンダー</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.viewToggle}
              onPress={toggleViewMode}
              accessibilityLabel={viewMode === 'month' ? '週表示に切り替え' : '月表示に切り替え'}
              accessibilityRole="button">
              <Text style={styles.viewToggleText}>
                {viewMode === 'month' ? '週' : '月'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddEvent}
              accessibilityLabel="予定を追加"
              accessibilityRole="button">
              <Text style={styles.addButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {viewMode === 'week' && (
          <View style={dynamicStyles.weekNavigation}>
            <TouchableOpacity
              onPress={goToPreviousWeek}
              style={styles.navButton}
              accessibilityLabel="前の週"
              accessibilityRole="button">
              <Text style={styles.navButtonText}>{'<'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goToToday}
              style={styles.todayButton}
              accessibilityLabel="今日に移動"
              accessibilityRole="button">
              <Text style={dynamicStyles.weekRangeText}>{formatWeekRange(currentDate)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={goToNextWeek}
              style={styles.navButton}
              accessibilityLabel="次の週"
              accessibilityRole="button">
              <Text style={styles.navButtonText}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {viewMode === 'month' ? (
          <Calendar
            ref={calendarRef}
            onDateSelect={handleDateSelect}
            onDateDoubleSelect={handleDateDoubleSelect}
            onEventPress={handleEventPress}
          />
        ) : (
          <WeekView
            ref={weekViewRef}
            currentDate={currentDate}
            onTimeRangeSelect={handleTimeRangeSelect}
            onEventPress={handleEventPress}
            onWeekChange={handleWeekChange}
            hasPermission={hasPermission}
          />
        )}

        <AddEventModal
          visible={showAddModal}
          onClose={handleCloseModal}
          onEventAdded={handleEventAdded}
          initialDate={initialStartDate}
          initialEndDate={initialEndDate}
          editingEvent={editingEvent}
        />

        <EventDetailModal
          visible={showDetailModal}
          event={selectedEvent}
          onClose={handleCloseDetailModal}
          onEdit={handleEditEvent}
          onDeleted={handleEventDeleted}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#E8F4FD',
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '300',
    marginTop: -2,
  },
  weekNavigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  navButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonText: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: '600',
  },
  todayButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  weekRangeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
});

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
