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
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import Calendar, {CalendarRef} from './src/components/Calendar';
import WeekView, {WeekViewRef} from './src/components/WeekView';
import AddEventModal from './src/components/AddEventModal';
import EventDetailModal from './src/components/EventDetailModal';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';
import {BannerAd, BannerAdSize, TestIds} from 'react-native-google-mobile-ads';

const adUnitId = __DEV__ ? TestIds.ADAPTIVE_BANNER : 'ca-app-pub-4317478239934902/3522055335';

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
const SettingsIcon = ({size = 20, color = '#666'}: {size?: number; color?: string}) => {
  const strokeWidth = size * 0.12;
  const innerSize = size * 0.4;
  const toothSize = size * 0.15;

  return (
    <View style={{width: size, height: size, justifyContent: 'center', alignItems: 'center'}}>
      {/* Center circle */}
      <View
        style={{
          width: innerSize,
          height: innerSize,
          borderRadius: innerSize / 2,
          borderWidth: strokeWidth,
          borderColor: color,
        }}
      />
      {/* Gear teeth */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            width: toothSize,
            height: strokeWidth,
            backgroundColor: color,
            transform: [
              {rotate: `${angle}deg`},
              {translateX: size * 0.32},
            ],
          }}
        />
      ))}
    </View>
  );
};

type ViewMode = 'month' | 'week';

function AppContent() {
  const {colors, isDark, themeMode, setThemeMode} = useTheme();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEventReadable[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const calendarRef = useRef<CalendarRef>(null);
  const weekViewRef = useRef<WeekViewRef>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    weekViewRef.current?.refreshEvents();
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
    } catch (error) {
      console.error('Search error:', error);
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

  // Handler for swipe navigation in WeekView
  const handleWeekChange = useCallback((newDate: Date) => {
    setCurrentDate(newDate);
  }, []);

  const formatWeekRange = (date: Date) => {
    // currentDate is always in 1st column, so range is date to (date + 6)
    const start = new Date(date);
    const end = new Date(date);
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
              <SettingsIcon size={20} color="#007AFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.viewToggle}
              onPress={toggleViewMode}
              accessibilityLabel={viewMode === 'month' ? '週間表示に切り替え' : '月間表示に切り替え'}
              accessibilityRole="button">
              <Text style={styles.viewToggleText}>
                {viewMode === 'month' ? '週間' : '月間'}
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
            onDateRangeSelect={handleTimeRangeSelect}
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
          onRequestClose={() => setShowSettingsModal(false)}>
          <View style={styles.settingsContainer}>
            <View style={styles.settingsHeader}>
              <View style={{width: 80}} />
              <Text style={styles.settingsTitle}>設定</Text>
              <TouchableOpacity onPress={() => setShowSettingsModal(false)}>
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
                        weekViewRef.current?.refreshEvents();
                        Alert.alert('完了', 'カレンダーを更新しました');
                      }}>
                      <Text style={styles.settingsItemLabel}>カレンダーを更新</Text>
                      <Text style={styles.settingsItemLink}>今すぐ更新</Text>
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

                  {/* About */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>アプリについて</Text>
                    <View style={styles.settingsItem}>
                      <Text style={styles.settingsItemLabel}>バージョン</Text>
                      <Text style={styles.settingsItemValue}>0.0.2</Text>
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
          </View>
        </Modal>
      </SafeAreaView>
      <View style={styles.bannerContainer}>
        <BannerAd
          unitId={adUnitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        />
      </View>
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
  bannerContainer: {
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
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
