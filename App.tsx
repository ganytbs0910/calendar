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
import WeekView, {WeekViewRef} from './src/components/WeekView';
import AddEventModal from './src/components/AddEventModal';
import EventDetailModal from './src/components/EventDetailModal';
import {UndoToast, UndoAction} from './src/components/UndoToast';
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
import {EventTemplate, getTemplates, deleteTemplate} from './src/services/templateService';
import {useTranslation} from 'react-i18next';
import './src/i18n/i18n';
import {loadSavedLanguage, setAppLanguage, getSavedLanguageCode, LANGUAGES} from './src/i18n/i18n';

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

type ViewMode = 'month' | 'week';

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
  const {t} = useTranslation();
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
            {currentSettings ? t('sleepSetupTitle') : t('sleepSetupTitleFirst')}
          </Text>
          <Text style={styles.sleepSetupSubtitle}>{t('sleepSetupSubtitle')}</Text>

          {/* Tab selector */}
          <View style={styles.setupTabRow}>
            <TouchableOpacity
              style={[styles.setupTab, tab === 'weekday' && styles.setupTabActive]}
              onPress={() => setTab('weekday')}>
              <Text style={[styles.setupTabText, tab === 'weekday' && styles.setupTabTextActive]}>{t('weekday')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.setupTab, tab === 'weekend' && styles.setupTabActive]}
              onPress={() => setTab('weekend')}>
              <Text style={[styles.setupTabText, tab === 'weekend' && styles.setupTabTextActive]}>{t('weekend')}</Text>
            </TouchableOpacity>
          </View>

          {/* Wake up time */}
          <View style={styles.sleepSetupSection}>
            <Text style={styles.sleepSetupLabel}>{t('wakeUpTime')}</Text>
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
                <Text style={styles.minuteAdjustText}>{t('minus30min')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => adjust('wake', 'minute', 30)}>
                <Text style={styles.minuteAdjustText}>{t('plus30min')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Sleep time */}
          <View style={styles.sleepSetupSection}>
            <Text style={styles.sleepSetupLabel}>{t('bedTime')}</Text>
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
                <Text style={styles.minuteAdjustText}>{t('minus30min')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => adjust('sleep', 'minute', 30)}>
                <Text style={styles.minuteAdjustText}>{t('plus30min')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.sleepSetupSaveBtn} onPress={() => onSave(settings)}>
            <Text style={styles.sleepSetupSaveBtnText}>{t('save')}</Text>
          </TouchableOpacity>

          {onCancel && (
            <TouchableOpacity style={styles.sleepSetupCancelBtn} onPress={onCancel}>
              <Text style={styles.sleepSetupCancelBtnText}>{t('cancel')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

function AppContent() {
  const {t} = useTranslation();
  const {colors, isDark, themeMode, setThemeMode} = useTheme();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [showLanguageModal, setShowLanguageModal] = useState(false);
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
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [initialColor, setInitialColor] = useState<string | undefined>(undefined);
  const calendarRef = useRef<CalendarRef>(null);
  const weekViewRef = useRef<WeekViewRef>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved language on mount
  useEffect(() => {
    loadSavedLanguage();
    getSavedLanguageCode().then(code => setSelectedLanguage(code));
  }, []);

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

  const loadTemplates = useCallback(async () => {
    const t = await getTemplates();
    setTemplates(t);
  }, []);

  const handleDeleteTemplate = useCallback(async (id: string) => {
    await deleteTemplate(id);
    loadTemplates();
  }, [loadTemplates]);

  const handleUseTemplate = useCallback((template: EventTemplate) => {
    setShowTemplateModal(false);
    const start = new Date(selectedDate || new Date());
    start.setHours(new Date().getHours() + 1, 0, 0, 0);
    const end = new Date(start.getTime() + template.durationMinutes * 60 * 1000);
    setInitialStartDate(start);
    setInitialEndDate(end);
    // Create a fake event object to pass template data
    const templateEvent = {
      title: template.title,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      alarms: template.reminder !== null ? [{date: template.reminder}] : [],
    } as any;
    // Don't set id so it creates a new event (copy mode behavior)
    setEditingEvent(templateEvent);
    setInitialColor(template.color);
    setShowAddModal(true);
  }, [selectedDate]);

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
            t('calendarAccess'),
            t('calendarAccessMessage'),
            [
              {
                text: t('close'),
                style: 'cancel',
              },
              {
                text: t('openSettings'),
                onPress: () => Linking.openSettings(),
              },
            ],
          );
        } else if (status === 'restricted') {
          Alert.alert(
            t('calendarAccessRestricted'),
            t('calendarAccessRestrictedMessage'),
            [{text: 'OK'}],
          );
        }
      } catch (_error) {
        Alert.alert(
          t('error'),
          t('calendarPermissionError'),
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
    setInitialColor(undefined);
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

  const refreshAllViews = useCallback(() => {
    calendarRef.current?.refreshEvents();
    weekViewRef.current?.refreshEvents();
  }, []);

  const handleEventDeleted = useCallback(() => {
    refreshAllViews();
  }, [refreshAllViews]);

  const handleUndoableDelete = useCallback(async (
    eventData: CalendarEventReadable,
    deleteType: 'single' | 'future' | 'all',
  ) => {
    if (!eventData.id) return;

    try {
      // Perform the delete
      if (deleteType === 'all') {
        await RNCalendarEvents.removeEvent(eventData.id);
      } else if (deleteType === 'future') {
        await RNCalendarEvents.removeEvent(eventData.id, {futureEvents: true});
      } else {
        await RNCalendarEvents.removeEvent(eventData.id, {futureEvents: false});
      }
      refreshAllViews();

      // Set up undo action
      setUndoAction({
        message: t('eventDeleted', {title: eventData.title}),
        onUndo: async () => {
          try {
            // Re-create the event
            const calendars = await RNCalendarEvents.findCalendars();
            const writableCalendars = calendars.filter(cal => cal.allowsModifications);
            const defaultCalendar = writableCalendars.find(cal => cal.isPrimary) || writableCalendars[0];
            if (!defaultCalendar) return;

            const eventConfig: any = {
              calendarId: eventData.calendar?.id || defaultCalendar.id,
              startDate: eventData.startDate!,
              endDate: eventData.endDate!,
              allDay: eventData.allDay || false,
              location: eventData.location,
              notes: eventData.notes,
              url: eventData.url,
              alarms: eventData.alarms,
            };
            // Restore recurrence if it was a recurring event
            if (eventData.recurrence) {
              eventConfig.recurrenceRule = {
                frequency: eventData.recurrence,
                occurrence: 52,
              };
            }
            await RNCalendarEvents.saveEvent(eventData.title || '', eventConfig);
            refreshAllViews();
          } catch {
            Alert.alert(t('error'), t('restoreFailed'));
          }
        },
      });
    } catch {
      Alert.alert(t('error'), t('deleteFailed'));
    }
  }, [refreshAllViews]);

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'month' ? 'week' : 'month');
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    if (viewMode === 'month') {
      calendarRef.current?.goToToday();
    }
    // week and day view will respond to currentDate change
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
              accessibilityLabel={t('goToToday')}
              accessibilityRole="button">
              <Text style={styles.todayBtnText}>{t('today')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSearchModal(true)}
              accessibilityLabel={t('searchEventsLabel')}
              accessibilityRole="button">
              <SearchIcon size={18} color="#007AFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSettingsModal(true)}
              accessibilityLabel={t('settingsLabel')}
              accessibilityRole="button">
              <Ionicons name="settings-outline" size={22} color="#007AFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.viewToggle}
              onPress={toggleViewMode}
              accessibilityLabel={t('toggleView')}
              accessibilityRole="button">
              <Text style={styles.viewToggleText}>
                {viewMode === 'month' ? t('monthView') : t('weekView')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddEvent}
              onLongPress={() => {
                loadTemplates();
                setShowTemplateModal(true);
              }}
              accessibilityLabel={t('addEventLabel')}
              accessibilityHint={t('addEventHint')}
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
          <WeekView
            ref={weekViewRef}
            currentDate={currentDate}
            onTimeRangeSelect={handleTimeRangeSelect}
            onEventPress={handleEventPress}
            onDayChange={handleDayChange}
            hasPermission={hasPermission}
            sleepSettings={sleepSettings}
            onOpenSleepSettings={openSleepSettings}
          />
        )}

        <AddEventModal
          visible={showAddModal}
          onClose={handleCloseModal}
          onEventAdded={handleEventAdded}
          onDeleted={handleEventDeleted}
          initialDate={initialStartDate}
          initialEndDate={initialEndDate}
          editingEvent={editingEvent}
          initialColor={initialColor}
        />

        <EventDetailModal
          visible={showDetailModal}
          event={selectedEvent}
          onClose={handleCloseDetailModal}
          onEdit={handleEditEvent}
          onDeleted={handleEventDeleted}
          onCopied={handleEventCopied}
          onUndoableDelete={handleUndoableDelete}
        />

        {/* Template Modal */}
        <Modal
          visible={showTemplateModal}
          animationType="fade"
          transparent
          onRequestClose={() => setShowTemplateModal(false)}>
          <View style={styles.templateOverlay}>
            <View style={styles.templateContainer}>
              <View style={styles.templateHeader}>
                <Text style={styles.templateTitle}>{t('template')}</Text>
                <TouchableOpacity onPress={() => setShowTemplateModal(false)}>
                  <Text style={styles.templateCloseBtn}>{t('close')}</Text>
                </TouchableOpacity>
              </View>
              {templates.length === 0 ? (
                <View style={styles.templateEmpty}>
                  <Text style={styles.templateEmptyText}>{t('noTemplates')}</Text>
                  <Text style={styles.templateEmptyHint}>{t('templateHint')}</Text>
                </View>
              ) : (
                <FlatList
                  data={templates}
                  keyExtractor={(item) => item.id}
                  style={styles.templateList}
                  renderItem={({item}) => {
                    const hours = Math.floor(item.durationMinutes / 60);
                    const mins = item.durationMinutes % 60;
                    const durationStr = hours > 0 && mins > 0 ? t('hoursMinutesFmt', {h: hours, m: mins}) : hours > 0 ? t('hoursFmt', {h: hours}) : t('minutesFmt', {m: mins});
                    return (
                      <TouchableOpacity
                        style={styles.templateItem}
                        onPress={() => handleUseTemplate(item)}
                        onLongPress={() => {
                          Alert.alert(t('deleteTemplate'), t('deleteTemplateConfirm', {title: item.title}), [
                            {text: t('cancel'), style: 'cancel'},
                            {text: t('delete'), style: 'destructive', onPress: () => handleDeleteTemplate(item.id)},
                          ]);
                        }}>
                        <View style={[styles.templateItemColor, {backgroundColor: item.color}]} />
                        <View style={styles.templateItemContent}>
                          <Text style={styles.templateItemTitle}>{item.title}</Text>
                          <Text style={styles.templateItemDuration}>{durationStr}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
              <TouchableOpacity
                style={styles.templateNewBtn}
                onPress={() => {
                  setShowTemplateModal(false);
                  handleAddEvent();
                }}>
                <Text style={styles.templateNewBtnText}>{t('newTemplate')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

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
                <Text style={styles.searchCancelBtn}>{t('cancel')}</Text>
              </TouchableOpacity>
              <Text style={styles.searchTitle}>{t('searchEvents')}</Text>
              <View style={{width: 80}} />
            </View>
            <View style={styles.searchInputContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder={t('searchPlaceholder')}
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
                <Text style={styles.searchLoadingText}>{t('searching')}</Text>
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
                <Text style={styles.searchNoResultsText}>{t('noResults')}</Text>
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
                  <Text style={styles.settingsTitle}>{t('settings')}</Text>
                  <TouchableOpacity onPress={() => { setShowWidgetGuide(false); setShowSettingsModal(false); }}>
                    <Text style={styles.settingsDoneBtn}>{t('done')}</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  style={styles.settingsContent}
                  data={[{key: 'settings'}]}
                  renderItem={() => (
                    <>
                      {/* Theme Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('appearance')}</Text>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>{t('theme')}</Text>
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
                              ]}>{t('themeAuto')}</Text>
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
                              ]}>{t('themeLight')}</Text>
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
                              ]}>{t('themeDark')}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {/* Sleep Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('sleepRhythm')}</Text>
                        <TouchableOpacity
                          style={styles.sleepSettingsItem}
                          onPress={() => {
                            setShowSettingsModal(false);
                            setTimeout(() => openSleepSettings(), 300);
                          }}>
                          <View style={styles.sleepSettingsRow}>
                            <Text style={styles.settingsItemLabel}>{t('wakeUpAndBedTime')}</Text>
                            <Text style={styles.settingsItemLink}>{t('changeLink')}</Text>
                          </View>
                          {sleepSettings && (
                            <View style={styles.sleepSettingsValues}>
                              <Text style={styles.sleepSettingsText}>
                                {t('weekday')} {formatTimeDisplay(sleepSettings.weekday.wakeUpHour, sleepSettings.weekday.wakeUpMinute)}〜{formatTimeDisplay(sleepSettings.weekday.sleepHour, sleepSettings.weekday.sleepMinute)}
                              </Text>
                              <Text style={styles.sleepSettingsText}>
                                {t('weekend')} {formatTimeDisplay(sleepSettings.weekend.wakeUpHour, sleepSettings.weekend.wakeUpMinute)}〜{formatTimeDisplay(sleepSettings.weekend.sleepHour, sleepSettings.weekend.sleepMinute)}
                              </Text>
                            </View>
                          )}
                          {!sleepSettings && (
                            <Text style={styles.sleepSettingsText}>{t('notSet')}</Text>
                          )}
                        </TouchableOpacity>
                      </View>

                      {/* Calendar Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('calendarSection')}</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => Linking.openSettings()}>
                          <Text style={styles.settingsItemLabel}>{t('calendarPermission')}</Text>
                          <Text style={styles.settingsItemLink}>{t('openSettingsLink')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => {
                            calendarRef.current?.refreshEvents();
                            weekViewRef.current?.refreshEvents();
                            Alert.alert(t('done'), t('refreshDone'));
                          }}>
                          <Text style={styles.settingsItemLabel}>{t('refreshCalendar')}</Text>
                          <Text style={styles.settingsItemLink}>{t('refreshNow')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Premium */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('premium')}</Text>
                        <TouchableOpacity
                          style={[styles.settingsItem, {backgroundColor: '#007AFF10'}]}
                          onPress={() => { setShowSettingsModal(false); setShowPaywall(true); }}>
                          <Text style={[styles.settingsItemLabel, {color: '#007AFF', fontWeight: '700'}]}>{t('upgradeToPremium')}</Text>
                          <Text style={styles.settingsItemLink}>{t('detailsLink')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Notification Settings */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('notification')}</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => Linking.openSettings()}>
                          <Text style={styles.settingsItemLabel}>{t('notificationSettings')}</Text>
                          <Text style={styles.settingsItemLink}>{t('openSettingsLink')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Widget Guide */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('widget')}</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => setShowWidgetGuide(true)}>
                          <Text style={styles.settingsItemLabel}>{t('widgetUsage')}</Text>
                          <Text style={styles.settingsItemLink}>{t('showMore')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* About */}
                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('language')}</Text>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => setShowLanguageModal(true)}>
                          <Text style={styles.settingsItemLabel}>{t('language')}</Text>
                          <Text style={styles.settingsItemLink}>
                            {selectedLanguage === 'auto' ? t('languageAuto') : LANGUAGES.find(l => l.code === selectedLanguage)?.label || selectedLanguage} →
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.settingsSection}>
                        <Text style={styles.settingsSectionTitle}>{t('aboutApp')}</Text>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>{t('version')}</Text>
                          <Text style={styles.settingsItemValue}>1.8.0</Text>
                        </View>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>{t('build')}</Text>
                          <Text style={styles.settingsItemValue}>React Native 0.83</Text>
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
                    <Text style={[styles.settingsItemLink, {width: 80}]}>{t('backToSettings')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.settingsTitle}>{t('widgetTitle')}</Text>
                  <TouchableOpacity onPress={() => { setShowWidgetGuide(false); setShowSettingsModal(false); }}>
                    <Text style={styles.settingsDoneBtn}>{t('done')}</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.settingsContent}>
                  {/* Setup Guide */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetHowToAdd')}</Text>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>1</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetStep1')}
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>2</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetStep2')}
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>3</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetStep3')}
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>4</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetStep4')}
                      </Text>
                    </View>
                  </View>

                  {/* Widget 1: Today's Events */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetTodaySmallMedium')}</Text>
                    <View style={styles.widgetPreviewArea}>
                      <SmallWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        {t('widgetTodaySmallDesc')}
                      </Text>
                    </View>
                    <View style={styles.widgetPreviewArea}>
                      <MediumWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        {t('widgetTodayMediumDesc')}
                      </Text>
                    </View>
                  </View>

                  {/* Widget 2: Month Calendar */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetMonthLarge')}</Text>
                    <View style={styles.widgetPreviewArea}>
                      <MonthCalendarPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        {t('widgetMonthDesc')}
                      </Text>
                    </View>
                  </View>

                  {/* Widget 3: Upcoming Events */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetUpcomingMediumLarge')}</Text>
                    <View style={styles.widgetPreviewArea}>
                      <UpcomingEventsPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        {t('widgetUpcomingDesc')}
                      </Text>
                    </View>
                  </View>

                  {/* Widget 4: Lock Screen */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetLockScreen')}</Text>
                    <View style={styles.widgetPreviewAreaDark}>
                      <View style={{alignItems: 'center', gap: 14}}>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenCircularPreview />
                          <Text style={{fontSize: 10, color: '#aaa', marginTop: 6}}>{t('widgetLockCircle')}</Text>
                        </View>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenRectangularPreview />
                          <Text style={{fontSize: 10, color: '#aaa', marginTop: 6}}>{t('widgetLockRect')}</Text>
                        </View>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenInlinePreview />
                          <Text style={{fontSize: 10, color: '#aaa', marginTop: 6}}>{t('widgetLockInline')}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        {t('widgetLockDesc')}
                      </Text>
                    </View>
                  </View>

                  {/* Lock Screen Setup */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetLockHowToAdd')}</Text>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>1</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetLockStep1')}
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>2</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetLockStep2')}
                      </Text>
                    </View>
                    <View style={styles.widgetGuideStep}>
                      <View style={styles.widgetGuideStepNumber}>
                        <Text style={styles.widgetGuideStepNumberText}>3</Text>
                      </View>
                      <Text style={styles.widgetGuideStepText}>
                        {t('widgetLockStep3')}
                      </Text>
                    </View>
                  </View>

                  {/* Notes */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>{t('widgetNote')}</Text>
                    <View style={styles.settingsTipItem}>
                      <Text style={styles.settingsTipText}>
                        {t('widgetNote1')}
                      </Text>
                    </View>
                    <View style={styles.settingsTipItem}>
                      <Text style={styles.settingsTipText}>
                        {t('widgetNote2')}
                      </Text>
                    </View>
                    <View style={styles.settingsTipItem}>
                      <Text style={styles.settingsTipText}>
                        {t('widgetNote3')}
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
      {/* Language Selection Modal */}
      <Modal
        visible={showLanguageModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLanguageModal(false)}>
        <View style={styles.settingsContainer}>
          <View style={styles.settingsHeader}>
            <View style={{width: 80}} />
            <Text style={styles.settingsTitle}>{t('language')}</Text>
            <TouchableOpacity onPress={() => setShowLanguageModal(false)}>
              <Text style={styles.settingsDoneBtn}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.settingsContent}>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.settingsItem, {paddingVertical: 14}]}
                onPress={async () => {
                  setSelectedLanguage(lang.code);
                  await setAppLanguage(lang.code);
                  setShowLanguageModal(false);
                }}>
                <Text style={styles.settingsItemLabel}>
                  {lang.code === 'auto' ? t('languageAuto') : lang.label}
                </Text>
                {selectedLanguage === lang.code && (
                  <Text style={{fontSize: 18, color: '#007AFF'}}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
      <UndoToast action={undoAction} onDismiss={() => setUndoAction(null)} />
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
  sleepSettingsItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  sleepSettingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sleepSettingsValues: {
    marginTop: 6,
    gap: 2,
  },
  sleepSettingsText: {
    fontSize: 14,
    color: '#007AFF',
  },
  templateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  templateContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxHeight: '70%',
    overflow: 'hidden',
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  templateTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  templateCloseBtn: {
    fontSize: 16,
    color: '#007AFF',
  },
  templateList: {
    maxHeight: 300,
  },
  templateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  templateItemColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  templateItemContent: {
    flex: 1,
  },
  templateItemTitle: {
    fontSize: 16,
    color: '#333',
    marginBottom: 2,
  },
  templateItemDuration: {
    fontSize: 13,
    color: '#999',
  },
  templateEmpty: {
    padding: 32,
    alignItems: 'center',
  },
  templateEmptyText: {
    fontSize: 15,
    color: '#999',
    marginBottom: 8,
  },
  templateEmptyHint: {
    fontSize: 13,
    color: '#ccc',
    textAlign: 'center',
  },
  templateNewBtn: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  templateNewBtnText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
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
