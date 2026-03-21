import React, {useCallback, useState, useRef, useEffect} from 'react';
import {
  StatusBar,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
  TextInput,
  FlatList,
  ScrollView,
  NativeModules,
  Platform,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import Calendar, {CalendarRef} from './src/components/Calendar';
import DayView, {DayViewRef} from './src/components/DayView';
import AddEventModal from './src/components/AddEventModal';
import EventDetailModal from './src/components/EventDetailModal';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';
import {PaywallScreen} from './src/components/PaywallScreen';
import {
  SmallWidgetPreview,
  MediumWidgetPreview,
  MonthCalendarPreview,
  UpcomingEventsPreview,
  LockScreenCircularPreview,
  LockScreenRectangularPreview,
  LockScreenInlinePreview,
} from './src/components/WidgetPreviews';
import {BannerAd, BannerAdSize, TestIds} from 'react-native-google-mobile-ads';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  SleepSettings,
  getSleepSettings,
  saveSleepSettings,
  getDefaultSettings,
} from './src/services/sleepSettingsService';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : 'ca-app-pub-4317478239934902/3522055335';

const {AppIconManager} = NativeModules;

// Custom Search Icon Component
const SearchIcon = ({size = 20, color = '#666'}: {size?: number; color?: string}) => {
  const circleSize = size * 0.65;
  const handleLength = size * 0.35;
  const strokeWidth = size * 0.12;

  return (
    <View style={{width: size, height: size, position: 'relative'}}>
      {/* Circle (lens) */}
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
      {/* Handle */}
      <View
        style={{
          width: handleLength,
          height: strokeWidth,
          backgroundColor: color,
          position: 'absolute',
          bottom: size * 0.08,
          right: size * 0.05,
          transform: [{rotate: '45deg'}],
          borderRadius: strokeWidth / 2,
        }}
      />
    </View>
  );
};

// Custom Settings Icon Component (gear)

type ViewMode = 'month' | 'day';

// Sleep Setup Modal with weekday/weekend tabs
const SleepSetupModal = ({
  visible,
  currentSettings,
  onSave,
  onCancel,
  formatTimeDisplay,
}: {
  visible: boolean;
  currentSettings: SleepSettings | null;
  onSave: (settings: SleepSettings) => void;
  onCancel?: () => void;
  formatTimeDisplay: (h: number, m: number) => string;
}) => {
  const [tab, setTab] = useState<'weekday' | 'weekend'>('weekday');
  const [settings, setSettings] = useState<SleepSettings>(getDefaultSettings());

  // Sync local state when modal opens
  useEffect(() => {
    if (visible) {
      setSettings(currentSettings || getDefaultSettings());
      setTab('weekday');
    }
  }, [visible, currentSettings]);

  const adjust = (type: 'wake' | 'sleep', field: 'hour' | 'minute', delta: number) => {
    setSettings(prev => {
      const current = prev[tab];
      const newDay = {...current};
      if (type === 'wake') {
        if (field === 'hour') {
          newDay.wakeUpHour = (current.wakeUpHour + delta + 24) % 24;
        } else {
          newDay.wakeUpMinute = (current.wakeUpMinute + delta + 60) % 60;
        }
      } else {
        if (field === 'hour') {
          newDay.sleepHour = (current.sleepHour + delta + 25) % 25;
        } else {
          newDay.sleepMinute = (current.sleepMinute + delta + 60) % 60;
        }
      }
      return {...prev, [tab]: newDay};
    });
  };

  const day = settings[tab];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.sleepSetupOverlay}>
        <View style={styles.sleepSetupContainer}>
          <Text style={styles.sleepSetupTitle}>
            {currentSettings ? '生活リズムの設定' : '生活リズムを教えてください'}
          </Text>
          <Text style={styles.sleepSetupSubtitle}>余白時間の計算に使います</Text>

          {/* Tab selector */}
          <View style={styles.setupTabRow}>
            <TouchableOpacity
              style={[styles.setupTab, tab === 'weekday' && styles.setupTabActive]}
              onPress={() => setTab('weekday')}>
              <Text style={[styles.setupTabText, tab === 'weekday' && styles.setupTabTextActive]}>平日</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.setupTab, tab === 'weekend' && styles.setupTabActive]}
              onPress={() => setTab('weekend')}>
              <Text style={[styles.setupTabText, tab === 'weekend' && styles.setupTabTextActive]}>休日</Text>
            </TouchableOpacity>
          </View>

          {/* Wake up time */}
          <View style={styles.sleepSetupSection}>
            <Text style={styles.sleepSetupLabel}>起床時間</Text>
            <View style={styles.timePickerRow}>
              <TouchableOpacity style={styles.timeAdjustBtn} onPress={() => adjust('wake', 'hour', -1)}>
                <Text style={styles.timeAdjustText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.timeDisplay}>
                {formatTimeDisplay(day.wakeUpHour, day.wakeUpMinute)}
              </Text>
              <TouchableOpacity style={styles.timeAdjustBtn} onPress={() => adjust('wake', 'hour', 1)}>
                <Text style={styles.timeAdjustText}>+</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.minuteRow}>
              <TouchableOpacity onPress={() => adjust('wake', 'minute', -30)}>
                <Text style={styles.minuteAdjustText}>-30分</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => adjust('wake', 'minute', 30)}>
                <Text style={styles.minuteAdjustText}>+30分</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Sleep time */}
          <View style={styles.sleepSetupSection}>
            <Text style={styles.sleepSetupLabel}>就寝時間</Text>
            <View style={styles.timePickerRow}>
              <TouchableOpacity style={styles.timeAdjustBtn} onPress={() => adjust('sleep', 'hour', -1)}>
                <Text style={styles.timeAdjustText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.timeDisplay}>
                {formatTimeDisplay(day.sleepHour, day.sleepMinute)}
              </Text>
              <TouchableOpacity style={styles.timeAdjustBtn} onPress={() => adjust('sleep', 'hour', 1)}>
                <Text style={styles.timeAdjustText}>+</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.minuteRow}>
              <TouchableOpacity onPress={() => adjust('sleep', 'minute', -30)}>
                <Text style={styles.minuteAdjustText}>-30分</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => adjust('sleep', 'minute', 30)}>
                <Text style={styles.minuteAdjustText}>+30分</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.sleepSetupSaveBtn} onPress={() => onSave(settings)}>
            <Text style={styles.sleepSetupSaveBtnText}>保存</Text>
          </TouchableOpacity>

          {onCancel && (
            <TouchableOpacity style={styles.sleepSetupCancelBtn} onPress={onCancel}>
              <Text style={styles.sleepSetupCancelBtnText}>キャンセル</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

function AppContent() {
  const {colors, isDark, themeMode, setThemeMode} = useTheme();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventReadable | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventReadable | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [initialStartDate, setInitialStartDate] = useState<Date | undefined>();
  const [initialEndDate, setInitialEndDate] = useState<Date | undefined>();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [hasPermission, setHasPermission] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showWidgetGuide, setShowWidgetGuide] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEventReadable[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSleepSetup, setShowSleepSetup] = useState(false);
  const [sleepSettings, setSleepSettings] = useState<SleepSettings | null>(null);
  const calendarRef = useRef<CalendarRef>(null);
  const dayViewRef = useRef<DayViewRef>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load sleep settings on mount, show setup if not configured
  useEffect(() => {
    getSleepSettings().then(settings => {
      if (settings) {
        setSleepSettings(settings);
      } else {
        setShowSleepSetup(true);
      }
    });
  }, []);

  const handleSaveSleepSettings = useCallback(async (settings: SleepSettings) => {
    await saveSleepSettings(settings);
    setSleepSettings(settings);
    setShowSleepSetup(false);
  }, []);

  const openSleepSettings = useCallback(() => {
    setShowSleepSetup(true);
  }, []);

  const handleSleepSettingsChange = useCallback(async (settings: SleepSettings) => {
    await saveSleepSettings(settings);
    setSleepSettings(settings);
  }, []);

  const formatTimeDisplay = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

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
      } catch (_error) {
        Alert.alert(
          'エラー',
          'カレンダーの権限確認中にエラーが発生しました。',
          [{text: 'OK'}],
        );
      }
    };
    checkAndRequestPermission();
  }, []);

  // Reset app icon to default (month icons disabled for now)
  useEffect(() => {
    const resetAppIcon = async () => {
      try {
        if (Platform.OS === 'ios') {
          const currentIcon = await AppIconManager.getIcon();
          if (currentIcon) {
            await AppIconManager.changeIcon(null);
          }
        }
      } catch (_e) {
        // Icon switch is non-critical, silently ignore
      }
    };
    resetAppIcon();
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
    dayViewRef.current?.refreshEvents();
  }, []);

  // Handle event tap to directly open edit modal
  const handleEventPress = useCallback((event: CalendarEventReadable) => {
    setEditingEvent(event);
    if (event.startDate) {
      setInitialStartDate(new Date(event.startDate));
    }
    if (event.endDate) {
      setInitialEndDate(new Date(event.endDate));
    }
    setShowAddModal(true);
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

  const handleEventCopied = useCallback(() => {
    calendarRef.current?.refreshEvents();
    dayViewRef.current?.refreshEvents();
  }, []);

  const handleEventDeleted = useCallback(() => {
    calendarRef.current?.refreshEvents();
    dayViewRef.current?.refreshEvents();
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'month' ? 'day' : 'month');
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    if (viewMode === 'month') {
      calendarRef.current?.goToToday();
    }
  }, [viewMode]);

  // Search functionality
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      // Search in a wide range (1 year back to 1 year ahead)
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1);

      const events = await RNCalendarEvents.fetchAllEvents(
        startDate.toISOString(),
        endDate.toISOString(),
      );

      const filtered = events.filter(event =>
        event.title?.toLowerCase().includes(query.toLowerCase())
      );

      // Sort by start date (nearest first)
      filtered.sort((a, b) => {
        const dateA = new Date(a.startDate || 0).getTime();
        const dateB = new Date(b.startDate || 0).getTime();
        return dateA - dateB;
      });

      setSearchResults(filtered.slice(0, 50)); // Limit to 50 results
    } catch (_error) {
      // Search failure is non-critical
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchResultPress = useCallback((event: CalendarEventReadable) => {
    setShowSearchModal(false);
    setSearchQuery('');
    setSearchResults([]);

    // Navigate to the event's date
    if (event.startDate) {
      const eventDate = new Date(event.startDate);
      setCurrentDate(eventDate);
      if (viewMode === 'month') {
        calendarRef.current?.goToToday(); // This will refresh, then we navigate
        setTimeout(() => {
          setCurrentDate(eventDate);
        }, 100);
      }
    }

    // Open the event for editing
    handleEventPress(event);
  }, [viewMode, handleEventPress]);

  // Handler for swipe navigation in DayView
  const handleDayChange = useCallback((newDate: Date) => {
    setCurrentDate(newDate);
  }, []);

  const dynamicStyles = {
    container: {
      ...styles.container,
      backgroundColor: colors.background,
    },
    header: {
      ...styles.header,
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={[dynamicStyles.container, {paddingBottom: 0}]}>
        <View style={dynamicStyles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={styles.todayBtn}
              onPress={goToToday}
              accessibilityLabel="今日に移動"
              accessibilityRole="button">
              <Text style={styles.todayBtnText}>今日</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSearchModal(true)}
              accessibilityLabel="予定を検索"
              accessibilityRole="button">
              <SearchIcon size={18} color="#007AFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSettingsModal(true)}
              accessibilityLabel="設定"
              accessibilityRole="button">
              <Ionicons name="settings-outline" size={22} color="#007AFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.viewToggle}
              onPress={toggleViewMode}
              accessibilityLabel={viewMode === 'month' ? '日間表示に切り替え' : '月間表示に切り替え'}
              accessibilityRole="button">
              <Text style={styles.viewToggleText}>
                {viewMode === 'month' ? '月間' : '日間'}
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

        {viewMode === 'month' ? (
            <Calendar
              ref={calendarRef}
              onDateSelect={handleDateSelect}
              onDateDoubleSelect={handleDateDoubleSelect}
              onEventPress={handleEventPress}
              onDateRangeSelect={handleTimeRangeSelect}
              hasPermission={hasPermission}
            />
        ) : (
          <DayView
            ref={dayViewRef}
            currentDate={currentDate}
            onTimeRangeSelect={handleTimeRangeSelect}
            onEventPress={handleEventPress}
            onDayChange={handleDayChange}
            hasPermission={hasPermission}
            sleepSettings={sleepSettings}
            onSleepSettingsChange={handleSleepSettingsChange}
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
          onCopied={handleEventCopied}
        />

        {/* Search Modal */}
        <Modal
          visible={showSearchModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => {
            setShowSearchModal(false);
            setSearchQuery('');
            setSearchResults([]);
          }}>
          <View style={styles.searchModalContainer}>
            <View style={styles.searchHeader}>
              <TouchableOpacity
                onPress={() => {
                  setShowSearchModal(false);
                  setSearchQuery('');
                  setSearchResults([]);
                }}>
                <Text style={styles.searchCancelBtn}>キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.searchTitle}>予定を検索</Text>
              <View style={{width: 80}} />
            </View>
            <View style={styles.searchInputContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="予定のタイトルを入力..."
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  if (searchTimerRef.current) {
                    clearTimeout(searchTimerRef.current);
                  }
                  searchTimerRef.current = setTimeout(() => {
                    handleSearch(text);
                  }, 300);
                }}
                autoFocus
                placeholderTextColor="#999"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  style={styles.searchClearBtn}
                  onPress={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}>
                  <Text style={styles.searchClearBtnText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
            {isSearching ? (
              <View style={styles.searchLoading}>
                <Text style={styles.searchLoadingText}>検索中...</Text>
              </View>
            ) : searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id || Math.random().toString()}
                renderItem={({item}) => {
                  const startDate = item.startDate ? new Date(item.startDate) : null;
                  const formatDate = (date: Date) => {
                    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                  };
                  return (
                    <TouchableOpacity
                      style={styles.searchResultItem}
                      onPress={() => handleSearchResultPress(item)}>
                      <Text style={styles.searchResultTitle}>{item.title}</Text>
                      {startDate && (
                        <Text style={styles.searchResultDate}>{formatDate(startDate)}</Text>
                      )}
                    </TouchableOpacity>
                  );
                }}
                style={styles.searchResultsList}
              />
            ) : searchQuery.length > 0 ? (
              <View style={styles.searchNoResults}>
                <Text style={styles.searchNoResultsText}>該当する予定がありません</Text>
              </View>
            ) : null}
          </View>
        </Modal>

        {/* Settings Modal */}
        <Modal
          visible={showSettingsModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => {
            if (showWidgetGuide) {
              setShowWidgetGuide(false);
            } else {
              setShowSettingsModal(false);
            }
          }}>
          <View style={styles.settingsContainer}>
            {!showWidgetGuide ? (
              <>
                {/* Settings Main View */}
                <View style={styles.settingsHeader}>
                  <View style={{width: 80}} />
                  <Text style={styles.settingsTitle}>設定</Text>
                  <TouchableOpacity onPress={() => { setShowWidgetGuide(false); setShowSettingsModal(false); }}>
                    <Text style={styles.settingsDoneBtn}>完了</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  style={styles.settingsContent}
                  data={[{key: 'settings'}]}
                  renderItem={() => (
                    <>
                      {/* Theme Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>外観</Text>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>テーマ</Text>
                          <View style={styles.themeSelector}>
                            <TouchableOpacity
                              style={[
                                styles.themeSelectorBtn,
                                themeMode === 'system' && styles.themeSelectorBtnActive,
                              ]}
                              onPress={() => setThemeMode('system')}>
                              <Text style={[
                                styles.themeSelectorText,
                                themeMode === 'system' && styles.themeSelectorTextActive,
                              ]}>自動</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.themeSelectorBtn,
                                themeMode === 'light' && styles.themeSelectorBtnActive,
                              ]}
                              onPress={() => setThemeMode('light')}>
                              <Text style={[
                                styles.themeSelectorText,
                                themeMode === 'light' && styles.themeSelectorTextActive,
                              ]}>ライト</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.themeSelectorBtn,
                                themeMode === 'dark' && styles.themeSelectorBtnActive,
                              ]}
                              onPress={() => setThemeMode('dark')}>
                              <Text style={[
                                styles.themeSelectorText,
                                themeMode === 'dark' && styles.themeSelectorTextActive,
                              ]}>ダーク</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {/* Sleep Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>生活リズム</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => {
                            setShowSettingsModal(false);
                            setTimeout(() => openSleepSettings(), 300);
                          }}>
                          <Text style={styles.settingsItemLabel}>起床・就寝時間</Text>
                          <Text style={styles.settingsItemLink}>
                            {sleepSettings
                              ? `平日 ${formatTimeDisplay(sleepSettings.weekday.wakeUpHour, sleepSettings.weekday.wakeUpMinute)}〜${formatTimeDisplay(sleepSettings.weekday.sleepHour, sleepSettings.weekday.sleepMinute)} / 休日 ${formatTimeDisplay(sleepSettings.weekend.wakeUpHour, sleepSettings.weekend.wakeUpMinute)}〜${formatTimeDisplay(sleepSettings.weekend.sleepHour, sleepSettings.weekend.sleepMinute)}`
                              : '未設定'} →
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Calendar Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>カレンダー</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => Linking.openSettings()}>
                          <Text style={styles.settingsItemLabel}>カレンダーの権限</Text>
                          <Text style={styles.settingsItemLink}>設定を開く →</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => {
                            calendarRef.current?.refreshEvents();
                            dayViewRef.current?.refreshEvents();
                            Alert.alert('完了', 'カレンダーを更新しました');
                          }}>
                          <Text style={styles.settingsItemLabel}>カレンダーを更新</Text>
                          <Text style={styles.settingsItemLink}>今すぐ更新</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Premium */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>プレミアム</Text>
                        <TouchableOpacity
                          style={[styles.settingsItem, {backgroundColor: '#007AFF10'}]}
                          onPress={() => { setShowSettingsModal(false); setShowPaywall(true); }}>
                          <Text style={[styles.settingsItemLabel, {color: '#007AFF', fontWeight: '700'}]}>プレミアムにアップグレード</Text>
                          <Text style={styles.settingsItemLink}>詳細 →</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Notification Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>通知</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => Linking.openSettings()}>
                          <Text style={styles.settingsItemLabel}>通知設定</Text>
                          <Text style={styles.settingsItemLink}>設定を開く →</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Widget Guide */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>ウィジェット</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => setShowWidgetGuide(true)}>
                          <Text style={styles.settingsItemLabel}>ウィジェットの使い方</Text>
                          <Text style={styles.settingsItemLink}>詳しく見る →</Text>
                        </TouchableOpacity>
                      </View>

                      {/* About */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>アプリについて</Text>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>バージョン</Text>
                          <Text style={styles.settingsItemValue}>1.6.0</Text>
                        </View>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>ビルド</Text>
                          <Text style={styles.settingsItemValue}>React Native 0.83</Text>
                        </View>
                      </View>

                      {/* Tips */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>使い方のヒント</Text>
                        <View style={styles.settingsTipItem}>
                          <Text style={styles.settingsTipText}>• 日付をダブルタップで新規予定作成</Text>
                        </View>
                        <View style={styles.settingsTipItem}>
                          <Text style={styles.settingsTipText}>• 日付を長押し+ドラッグで複数日選択</Text>
                        </View>
                        <View style={styles.settingsTipItem}>
                          <Text style={styles.settingsTipText}>• 左右スワイプで月を移動</Text>
                        </View>
                        <View style={styles.settingsTipItem}>
                          <Text style={styles.settingsTipText}>• 色ボタンを長押しで色を削除</Text>
                        </View>
                      </View>
                    </>
                  )}
                />
              </>
            ) : (
              <>
                {/* Widget Guide View */}
                <View style={styles.settingsHeader}>
                  <TouchableOpacity onPress={() => setShowWidgetGuide(false)}>
                    <Text style={[styles.settingsItemLink, {width: 80}]}>← 設定</Text>
                  </TouchableOpacity>
                  <Text style={styles.settingsTitle}>ウィジェット</Text>
                  <TouchableOpacity onPress={() => { setShowWidgetGuide(false); setShowSettingsModal(false); }}>
                    <Text style={styles.settingsDoneBtn}>完了</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.settingsContent}>
                  {/* Setup Guide */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>ホーム画面への追加方法</Text>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>1</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        ホーム画面の空白部分を長押しします
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>2</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        左上の「＋」ボタンをタップします
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>3</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        一覧から「理想のカレンダー」を探してタップ
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>4</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        サイズを選んで「ウィジェットを追加」をタップ
                      </Text>
                    </View>
                  </View>

                  {/* Widget 1: Today's Events */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>今日の予定 — Small / Medium</Text>
                    <View style={styles.widgetPreviewArea}>
                      <SmallWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        今日の日付と予定をコンパクトに表示します。Smallサイズでは最大3件の予定が確認できます。
                      </Text>
                    </View>
                    <View style={styles.widgetPreviewArea}>
                      <MediumWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        Mediumサイズでは左に大きな日付、右に最大4件の予定を時間付きで表示します。
                      </Text>
                    </View>
                  </View>

                  {/* Widget 2: Month Calendar */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>月間カレンダー — Large</Text>
                    <View style={styles.widgetPreviewArea}>
                      <MonthCalendarPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        月のカレンダーをグリッド表示します。今日の日付は青丸でハイライト、予定がある日にはドットが表示されます。日曜は赤、土曜は青で色分け。
                      </Text>
                    </View>
                  </View>

                  {/* Widget 3: Upcoming Events */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>今後の予定 — Medium / Large</Text>
                    <View style={styles.widgetPreviewArea}>
                      <UpcomingEventsPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        複数日にわたる予定を日別にグループ化して表示します。Mediumでは3日先まで、Largeでは7日先まで確認できます。
                      </Text>
                    </View>
                  </View>

                  {/* Widget 4: Lock Screen */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>ロック画面 — iOS 16以降</Text>
                    <View style={styles.widgetPreviewAreaDark}>
                      <View style={{alignItems: 'center', gap: 14}}>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenCircularPreview />
                          <Text style={{fontSize: 10, color: '#aaa', marginTop: 6}}>丸型</Text>
                        </View>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenRectangularPreview />
                          <Text style={{fontSize: 10, color: '#aaa', marginTop: 6}}>長方形</Text>
                        </View>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenInlinePreview />
                          <Text style={{fontSize: 10, color: '#aaa', marginTop: 6}}>インライン</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        ロック画面に日付や次の予定を表示します。丸型は曜日と日付、長方形は日付と次の予定、インラインは「10:00 チームMTG」のように1行で表示します。
                      </Text>
                    </View>
                  </View>

                  {/* Lock Screen Setup */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>ロック画面への追加方法</Text>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>1</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        ロック画面を長押しして「カスタマイズ」をタップ
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>2</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        「ロック画面」を選択し、ウィジェット欄をタップ
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>3</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        「理想のカレンダー」の「ロック画面」を追加
                      </Text>
                    </View>
                  </View>

                  {/* Notes */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>ご注意</Text>
                    <View style={styles.settingsTipItem}>
                      <Text style={styles.settingsTipText}>
                        • ウィジェットの利用にはカレンダーへのアクセス許可が必要です
                      </Text>
                    </View>
                    <View style={styles.settingsTipItem}>
                      <Text style={styles.settingsTipText}>
                        • ウィジェットは約30分ごとに自動更新されます
                      </Text>
                    </View>
                    <View style={styles.settingsTipItem}>
                      <Text style={styles.settingsTipText}>
                        • 月間カレンダーは日付変更時に更新されます
                      </Text>
                    </View>
                  </View>

                  <View style={{height: 40}} />
                </ScrollView>
              </>
            )}
          </View>
        </Modal>

        {/* Sleep Setup Modal */}
        <SleepSetupModal
          visible={showSleepSetup}
          currentSettings={sleepSettings}
          onSave={handleSaveSleepSettings}
          onCancel={sleepSettings ? () => setShowSleepSetup(false) : undefined}
          formatTimeDisplay={formatTimeDisplay}
        />
      </SafeAreaView>
      {!__DEV__ && (
        <View style={styles.bannerContainer}>
          <BannerAd
            unitId={adUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          />
        </View>
      )}
      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} />
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
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#E8F4FD',
  },
  todayBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewToggle: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
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
  // Search Modal styles
  searchModalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchCancelBtn: {
    fontSize: 17,
    color: '#007AFF',
    width: 80,
  },
  searchTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 12,
    color: '#333',
  },
  searchClearBtn: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchClearBtnText: {
    fontSize: 20,
    color: '#999',
  },
  searchLoading: {
    padding: 20,
    alignItems: 'center',
  },
  searchLoadingText: {
    fontSize: 15,
    color: '#666',
  },
  searchResultsList: {
    flex: 1,
  },
  searchResultItem: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchResultTitle: {
    fontSize: 16,
    color: '#333',
    marginBottom: 4,
  },
  searchResultDate: {
    fontSize: 13,
    color: '#666',
  },
  searchNoResults: {
    padding: 40,
    alignItems: 'center',
  },
  searchNoResultsText: {
    fontSize: 15,
    color: '#999',
  },
  // Settings Modal styles
  settingsContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  settingsTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  settingsDoneBtn: {
    fontSize: 17,
    color: '#007AFF',
    fontWeight: '600',
    width: 80,
    textAlign: 'right',
  },
  settingsContent: {
    flex: 1,
    paddingTop: 20,
  },
  settingsSection: {
    backgroundColor: '#fff',
    marginBottom: 20,
  },
  settingsSectionTitle: {
    fontSize: 13,
    color: '#666',
    paddingHorizontal: 16,
    paddingVertical: 8,
    textTransform: 'uppercase',
  },
  settingsItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  settingsItemLabel: {
    fontSize: 16,
    color: '#333',
  },
  settingsItemValue: {
    fontSize: 16,
    color: '#999',
  },
  settingsItemLink: {
    fontSize: 16,
    color: '#007AFF',
  },
  themeSelector: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 2,
  },
  themeSelectorBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  themeSelectorBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  themeSelectorText: {
    fontSize: 13,
    color: '#666',
  },
  themeSelectorTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  settingsTipItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  settingsTipText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  // Widget Guide styles
  widgetGuideStep: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 12,
  },
  widgetGuideStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  widgetGuideStepNumberText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  widgetGuideStepText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  widgetPreviewArea: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#F2F2F7',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  widgetPreviewAreaDark: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#1C1C1E',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  widgetGuideCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  widgetGuideCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  widgetGuideCardIcon: {
    fontSize: 28,
  },
  widgetGuideCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  widgetGuideCardSize: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 2,
  },
  widgetGuideCardDesc: {
    fontSize: 14,
    color: '#555',
    lineHeight: 21,
  },
  widgetGuideLockTypes: {
    marginTop: 10,
    gap: 8,
  },
  widgetGuideLockType: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingLeft: 4,
  },
  widgetGuideLockTypeTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
    width: 68,
  },
  widgetGuideLockTypeDesc: {
    flex: 1,
    fontSize: 13,
    color: '#666',
  },
bannerContainer: {
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  // Sleep Setup Modal styles
  sleepSetupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  sleepSetupContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  sleepSetupTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  sleepSetupSubtitle: {
    fontSize: 13,
    color: '#999',
    marginBottom: 16,
  },
  setupTabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  setupTab: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
  },
  setupTabActive: {
    backgroundColor: '#007AFF',
  },
  setupTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  setupTabTextActive: {
    color: '#fff',
  },
  sleepSetupSection: {
    width: '100%',
    marginBottom: 20,
    alignItems: 'center',
  },
  sleepSetupLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
  },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  timeAdjustBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F4FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeAdjustText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#007AFF',
  },
  timeDisplay: {
    fontSize: 36,
    fontWeight: '700',
    color: '#333',
    width: 130,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  minuteRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 6,
  },
  minuteAdjustText: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '500',
  },
  sleepSetupSaveBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginTop: 8,
    width: '100%',
    alignItems: 'center',
  },
  sleepSetupSaveBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  sleepSetupCancelBtn: {
    marginTop: 12,
    paddingVertical: 8,
  },
  sleepSetupCancelBtnText: {
    color: '#999',
    fontSize: 15,
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
