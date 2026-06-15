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
  Platform,
  AppState,
  Switch,
  Share,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import Calendar, {CalendarRef} from './src/components/Calendar';
import WeekView, {WeekViewRef} from './src/components/WeekView';
import AddEventModal, {removeEventColor} from './src/components/AddEventModal';
import {removeAllEventPhotos} from './src/services/eventPhotoService';
import EventDetailModal from './src/components/EventDetailModal';
import {UndoToast, UndoAction} from './src/components/UndoToast';
import UpdateAvailableModal from './src/components/UpdateAvailableModal';
import DeviceInfo from 'react-native-device-info';
import {
  checkForUpdate,
  dismissUpdatePrompt,
  openStore,
  UpdateCheckResult,
} from './src/services/versionCheckService';
import {ThemeProvider, useTheme} from './src/theme/ThemeContext';
import {PremiumProvider, usePremium} from './src/context/PremiumContext';
import {PaywallScreen} from './src/components/PaywallScreen';
import StatsScreen from './src/components/StatsScreen';
import AgentScreen from './src/components/AgentScreen';
import ShareAvailabilityModal from './src/components/ShareAvailabilityModal';
import PollModal from './src/components/PollModal';
import SettingsLauncherScreen from './src/components/SettingsLauncherScreen';
import JobsManagerModal from './src/components/JobsManagerModal';
import OnboardingModal from './src/components/OnboardingModal';
import AsyncStorageRoot from '@react-native-async-storage/async-storage';
import {
  SmallWidgetPreview,
  MediumWidgetPreview,
  MonthCalendarPreview,
  UpcomingEventsPreview,
  CountdownWidgetPreview,
  FreeTimeWidgetPreview,
  WeekWidgetPreview,
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
import {EventHistoryEntry} from './src/services/eventHistoryService';
import EventHistoryList from './src/components/EventHistoryList';
import {
  cancelEventNotification,
  isNotificationsEnabled,
  setNotificationsEnabled,
  isSoundEnabled,
  setSoundEnabled,
  requestNotificationPermission,
  sendTestNotification,
  cleanupExpiredEventNotifications,
} from './src/services/notificationService';
import {clearDevSeedEvents, seedDevJuneEventsIfNeeded} from './src/services/devSeedData';
import LockScreen, {PinSetupModal} from './src/components/LockScreen';
import NLEventInput from './src/components/NLEventInput';
import {ParsedEvent} from './src/utils/eventParser';
import {
  UserCalendar,
  ensureDefaultsSeeded,
  getUserCalendars,
  addUserCalendar,
  updateUserCalendar,
  deleteUserCalendar,
  resolveCalendarName,
} from './src/services/userCalendarService';
import {
  isPinSet,
  setupPin,
  clearLock,
  isBiometricEnabled,
  setBiometricEnabled,
  getBiometricCapability,
  authenticateBiometric,
  getLockExpiry,
  setLockExpiry,
} from './src/services/lockService';
import {useTranslation} from 'react-i18next';
import './src/i18n/i18n';
import {loadSavedLanguage, setAppLanguage, getSavedLanguageCode, LANGUAGES} from './src/i18n/i18n';

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

type ViewMode = 'month' | 'week';

// Bottom navigation tabs. Only "home" is implemented; the other three navigate
// to a placeholder "coming soon" screen for now.
type TabKey = 'home' | 'tasks' | 'stats' | 'settings';
const TABS: {key: TabKey; labelKey: string; icon: string; iconOutline: string}[] = [
  {key: 'home', labelKey: 'tabHome', icon: 'home', iconOutline: 'home-outline'},
  {key: 'tasks', labelKey: 'tabTasks', icon: 'checkbox', iconOutline: 'checkbox-outline'},
  {key: 'stats', labelKey: 'tabStats', icon: 'stats-chart', iconOutline: 'stats-chart-outline'},
  {key: 'settings', labelKey: 'tabSettings', icon: 'settings', iconOutline: 'settings-outline'},
];

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
  const {isPremium} = usePremium();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showJobsManager, setShowJobsManager] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventReadable | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventReadable | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [initialStartDate, setInitialStartDate] = useState<Date | undefined>();
  const [initialEndDate, setInitialEndDate] = useState<Date | undefined>();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const insets = useSafeAreaInsets();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [hasPermission, setHasPermission] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showWidgetGuide, setShowWidgetGuide] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEventReadable[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSleepSetup, setShowSleepSetup] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showIncomeWall, setShowIncomeWall] = useState(false);
  const [sleepSettings, setSleepSettings] = useState<SleepSettings | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [templateTab, setTemplateTab] = useState<'template' | 'history'>('template');
  const [showHistoryScreen, setShowHistoryScreen] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [notificationSound, setNotificationSound] = useState(true);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [initialColor, setInitialColor] = useState<string | undefined>(undefined);
  // Lock-screen state. `lockReady` becomes true once we've checked AsyncStorage
  // for an existing PIN; until then we keep the lock visible to avoid a flash
  // of the calendar.
  const [lockReady, setLockReady] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState<string>('');
  const [pinSetupVisible, setPinSetupVisible] = useState(false);
  const [pinSetupChange, setPinSetupChange] = useState(false);
  const [lockExpiryAt, setLockExpiryAt] = useState<number | null>(null);
  const [fullscreenMonth, setFullscreenMonth] = useState(false);
  const [showNLInput, setShowNLInput] = useState(false);
  const [showShareAvail, setShowShareAvail] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialTitle, setInitialTitle] = useState<string | undefined>(undefined);
  // User-defined calendars (categories) and the active tab.
  const [userCalendars, setUserCalendars] = useState<UserCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);
  const [showCalendarCreate, setShowCalendarCreate] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarColor, setNewCalendarColor] = useState('#007AFF');
  // When editing, holds the id of the calendar being edited; null = create mode.
  const [editingCalendarId, setEditingCalendarId] = useState<string | null>(null);
  const calendarRef = useRef<CalendarRef>(null);
  const weekViewRef = useRef<WeekViewRef>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved language on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSavedLanguage();
      const code = await getSavedLanguageCode();
      if (!cancelled) setSelectedLanguage(code);
    })();
    return () => { cancelled = true; };
  }, []);

  // Show first-run onboarding once (drives trial value / retention).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorageRoot.getItem('@onboarded');
        if (!cancelled && seen !== '1') setShowOnboarding(true);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    AsyncStorageRoot.setItem('@onboarded', '1').catch(() => {});
  }, []);

  // Request notification permission once on first launch (no-op if granted).
  useEffect(() => {
    (async () => {
      const [enabled, sound] = await Promise.all([
        isNotificationsEnabled(),
        isSoundEnabled(),
      ]);
      setNotificationsOn(enabled);
      setNotificationSound(sound);
      if (enabled) {
        requestNotificationPermission().catch(() => {});
      }
      // Sweep out any one-shot notifications whose fire time already passed —
      // e.g. left over after the system clock jumped forward or a delivery
      // failed silently. Repeating reminders are preserved.
      cleanupExpiredEventNotifications().catch(() => {});
    })();
  }, []);

  const handleToggleNotifications = useCallback(async (next: boolean) => {
    setNotificationsOn(next);
    await setNotificationsEnabled(next);
    if (next) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(t('notification'), t('notificationsPermissionDenied'), [
          {text: t('cancel'), style: 'cancel'},
          {text: t('openSettings'), onPress: () => Linking.openSettings()},
        ]);
      }
    }
  }, [t]);

  const handleToggleNotificationSound = useCallback(async (next: boolean) => {
    setNotificationSound(next);
    await setSoundEnabled(next);
  }, []);

  const handleSendTestNotification = useCallback(async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(t('notification'), t('notificationsPermissionDenied'), [
        {text: t('cancel'), style: 'cancel'},
        {text: t('openSettings'), onPress: () => Linking.openSettings()},
      ]);
      return;
    }
    await sendTestNotification(t('testNotificationTitle'), t('testNotificationBody'));
  }, [t]);

  // Share the next 60 days of events as a standard .ics file (no backend —
  // recipients import into any calendar app). Not real-time, but interoperable.
  const handleShareCalendarIcs = useCallback(async () => {
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      const events = await RNCalendarEvents.fetchAllEvents(now.toISOString(), end.toISOString());
      const pad = (n: number) => String(n).padStart(2, '0');
      const fmt = (iso: string, allDay?: boolean) => {
        const d = new Date(iso);
        const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        return allDay ? date : `${date}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
      };
      const esc = (s?: string) => (s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CalendarApp//JP', 'CALSCALE:GREGORIAN'];
      events.forEach((e, i) => {
        if (!e.startDate) return;
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${e.id || `evt-${i}`}@calendarapp`);
        if (e.allDay) {
          lines.push(`DTSTART;VALUE=DATE:${fmt(e.startDate, true)}`);
          if (e.endDate) lines.push(`DTEND;VALUE=DATE:${fmt(e.endDate, true)}`);
        } else {
          lines.push(`DTSTART:${fmt(e.startDate)}`);
          if (e.endDate) lines.push(`DTEND:${fmt(e.endDate)}`);
        }
        lines.push(`SUMMARY:${esc(e.title) || esc(t('noTitle'))}`);
        if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
        if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
        lines.push('END:VEVENT');
      });
      lines.push('END:VCALENDAR');
      await Share.share({message: lines.join('\r\n')});
    } catch (err) {
      console.warn('[ics share] failed', err);
    }
  }, [t]);

  // App-store version check (optional update prompt).
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Skip in dev — the binary version doesn't match the published one.
    if (__DEV__) return;
    const timer = setTimeout(() => {
      checkForUpdate().then(result => {
        if (!cancelled && result.updateAvailable) {
          setUpdateInfo(result);
        }
      });
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Initial lock check on mount
  const refreshLockStatus = useCallback(async () => {
    const [pinSet, bioOn, cap, expiry] = await Promise.all([
      isPinSet(),
      isBiometricEnabled(),
      getBiometricCapability(),
      getLockExpiry(),
    ]);
    setLockEnabled(pinSet);
    setBiometricOn(bioOn);
    setBiometricAvailable(cap.available);
    setBiometricLabel(
      cap.type === 'FaceID' ? 'Face ID' : cap.type === 'TouchID' ? 'Touch ID' : cap.type ? 'Biometrics' : ''
    );
    setLockExpiryAt(expiry);
  }, []);

  useEffect(() => {
    isPinSet().then(set => {
      setLockEnabled(set);
      setIsLocked(set);
      setLockReady(true);
    });
    refreshLockStatus();
  }, [refreshLockStatus]);

  // Load user calendars (seed defaults on first run)
  useEffect(() => {
    ensureDefaultsSeeded().then(setUserCalendars);
  }, []);

  // Re-lock the app when it goes to background (only if a PIN is set)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background' || state === 'inactive') {
        if (lockEnabled) setIsLocked(true);
      }
    });
    return () => sub.remove();
  }, [lockEnabled]);

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

  const handleUseHistoryEntry = useCallback((entry: EventHistoryEntry) => {
    setShowTemplateModal(false);
    setShowHistoryScreen(false);
    const start = new Date(selectedDate || new Date());
    start.setHours(new Date().getHours() + 1, 0, 0, 0);
    const end = new Date(start.getTime() + entry.durationMinutes * 60 * 1000);
    setInitialStartDate(start);
    setInitialEndDate(end);
    const historyEvent = {
      title: entry.title,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      alarms: entry.reminder !== null ? [{date: entry.reminder}] : [],
    } as any;
    setEditingEvent(historyEvent);
    setInitialColor(entry.color);
    setInitialTitle(entry.title);
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

  // Dev-only: clean up the old April 2026 sample events, then seed June 2026
  // with a college-student schedule (classes / part-time / circles).
  useEffect(() => {
    if (!__DEV__) return;
    if (!hasPermission) return;
    (async () => {
      await clearDevSeedEvents();
      await seedDevJuneEventsIfNeeded();
      calendarRef.current?.refreshEvents();
      weekViewRef.current?.refreshEvents();
    })();
  }, [hasPermission]);


  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    setCurrentDate(date);
  }, []);

  const handleAddEvent = useCallback(() => {
    setInitialStartDate(selectedDate || undefined);
    setInitialEndDate(undefined);
    // When viewing a specific user-calendar tab, pre-select its color so the
    // new event lands in that category by default.
    const active = userCalendars.find(c => c.id === selectedCalendarId);
    setInitialColor(active?.color);
    setShowAddModal(true);
  }, [selectedDate, userCalendars, selectedCalendarId]);

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
    setInitialTitle(undefined);
  }, []);

  // ── Lock handlers ───────────────────────────────────────────────────────
  // iOS can only present one modal per view controller, so the Settings modal
  // must be dismissed before the PIN setup modal is presented — otherwise the
  // second modal silently fails to appear. This mirrors how the Sleep settings
  // row opens its modal from Settings (close, wait for dismiss, then open).
  const handleEnableLock = useCallback(() => {
    setPinSetupChange(false);
    setShowSettingsModal(false);
    setTimeout(() => setPinSetupVisible(true), 300);
  }, []);

  const handleChangePin = useCallback(() => {
    setPinSetupChange(true);
    setShowSettingsModal(false);
    setTimeout(() => setPinSetupVisible(true), 300);
  }, []);

  const askLockDuration = useCallback(() => {
    const DAY = 24 * 60 * 60 * 1000;
    Alert.alert(
      t('lockDurationTitle'),
      t('lockDurationMessage'),
      [
        {
          text: t('lockDuration3Days'),
          onPress: async () => {
            await setLockExpiry(Date.now() + 3 * DAY);
            refreshLockStatus();
          },
        },
        {
          text: t('lockDuration1Week'),
          onPress: async () => {
            await setLockExpiry(Date.now() + 7 * DAY);
            refreshLockStatus();
          },
        },
        {
          text: t('lockDurationForever'),
          onPress: async () => {
            await setLockExpiry(null);
            refreshLockStatus();
          },
        },
      ],
      {cancelable: false}
    );
  }, [t, refreshLockStatus]);

  const handlePinSetupComplete = useCallback(async (pin: string) => {
    const wasNew = !pinSetupChange;
    await setupPin(pin);
    setPinSetupVisible(false);
    setLockEnabled(true);
    refreshLockStatus();
    // Reopen Settings once the PIN sheet has dismissed, then (for first-time
    // setup) ask how long the lock should stay active. Changing an existing
    // PIN keeps the previous expiry intact.
    setTimeout(() => {
      setShowSettingsModal(true);
      if (wasNew) {
        askLockDuration();
      }
    }, 300);
  }, [pinSetupChange, refreshLockStatus, askLockDuration]);

  const handleDisableLock = useCallback(() => {
    Alert.alert(
      t('lockDisableTitle'),
      t('lockDisableMessage'),
      [
        {text: t('cancel'), style: 'cancel'},
        {
          text: t('lockDisableConfirm'),
          style: 'destructive',
          onPress: async () => {
            await clearLock();
            setLockEnabled(false);
            setBiometricOn(false);
            setIsLocked(false);
          },
        },
      ]
    );
  }, [t]);

  const handleToggleBiometric = useCallback(async () => {
    if (biometricOn) {
      await setBiometricEnabled(false);
      setBiometricOn(false);
      return;
    }
    // Verify the device biometric works before flipping the flag on.
    const ok = await authenticateBiometric(t('lockBiometricEnablePrompt'));
    if (!ok) return;
    await setBiometricEnabled(true);
    setBiometricOn(true);
  }, [biometricOn, t]);

  const handleUnlocked = useCallback(() => {
    setIsLocked(false);
  }, []);

  const handleNLParsed = useCallback((parsed: ParsedEvent) => {
    setShowNLInput(false);
    setInitialStartDate(parsed.startDate);
    setInitialEndDate(parsed.endDate);
    setInitialTitle(parsed.title || undefined);
    const active = userCalendars.find(c => c.id === selectedCalendarId);
    setInitialColor(active?.color);
    setShowAddModal(true);
  }, [userCalendars, selectedCalendarId]);

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
      // Clean up orphaned color setting (only for full deletes - single instance keeps its color for the series)
      if (deleteType === 'all') {
        removeEventColor(eventData.id).catch(() => {});
        removeAllEventPhotos(eventData.id).catch(() => {});
      }
      cancelEventNotification(eventData.id).catch(() => {});
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
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <SafeAreaView edges={['top', 'left', 'right']} style={[dynamicStyles.container, {paddingBottom: 0}]}>
        {activeTab === 'home' && (
        <>
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
              <SearchIcon size={18} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowStats(true)}
              accessibilityLabel={t('statsLabel')}
              accessibilityRole="button">
              <Ionicons name="stats-chart-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            {viewMode === 'month' && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => setFullscreenMonth(prev => !prev)}
                accessibilityLabel={t('fullscreenToggle')}
                accessibilityRole="button">
                <Ionicons name={fullscreenMonth ? 'contract-outline' : 'expand-outline'} size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
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

        {!hasPermission && (
          <TouchableOpacity
            style={[styles.permissionBanner, {backgroundColor: colors.error}]}
            onPress={() => Linking.openSettings()}
            accessibilityRole="button">
            <Ionicons name="warning-outline" size={16} color="#fff" />
            <Text style={styles.permissionBannerText}>{t('calendarAccessMessage')}</Text>
            <Text style={styles.permissionBannerLink}>{t('openSettings')}</Text>
          </TouchableOpacity>
        )}

        {viewMode === 'month' ? (
            <Calendar
              ref={calendarRef}
              onDateSelect={handleDateSelect}
              onDateDoubleSelect={handleDateDoubleSelect}
              onEventPress={handleEventPress}
              onDateRangeSelect={handleTimeRangeSelect}
              onMonthChange={setCurrentDate}
              hasPermission={hasPermission}
              fullscreenMode={fullscreenMonth}
              filterColor={userCalendars.find(c => c.id === selectedCalendarId)?.color ?? null}
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
            onJumpToToday={goToToday}
            filterColor={userCalendars.find(c => c.id === selectedCalendarId)?.color ?? null}
          />
        )}
        </>
        )}

        {activeTab === 'tasks' && (
          <View style={{flex: 1}}>
            <AgentScreen />
          </View>
        )}

        {activeTab === 'stats' && (
          <View style={{flex: 1}}>
            {/* 統計タブ: 活動サマリー・月の給料集計を表示。年収の壁は設定からのみ。 */}
            <StatsScreen embedded hideIncomeWall visible onClose={() => {}} initialDate={currentDate} />
          </View>
        )}

        {activeTab === 'settings' && (
          <View style={{flex: 1}}>
            <SettingsLauncherScreen
              onOpenShareAvail={() => setShowShareAvail(true)}
              onOpenPoll={() => setShowPoll(true)}
              onOpenSettings={() => setShowSettingsModal(true)}
              onOpenStats={() => setShowStats(true)}
              onOpenIncomeWall={() => setShowIncomeWall(true)}
              onOpenJobs={() => setShowJobsManager(true)}
            />
          </View>
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
          initialTitle={initialTitle}
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
                <Text style={styles.templateTitle}>{templateTab === 'template' ? t('template') : t('eventHistory')}</Text>
                <TouchableOpacity onPress={() => setShowTemplateModal(false)}>
                  <Text style={styles.templateCloseBtn}>{t('close')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.templateTabRow}>
                <TouchableOpacity
                  style={[styles.templateTab, templateTab === 'template' && styles.templateTabActive]}
                  onPress={() => setTemplateTab('template')}>
                  <Text style={[styles.templateTabText, templateTab === 'template' && styles.templateTabTextActive]}>{t('template')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.templateTab, templateTab === 'history' && styles.templateTabActive]}
                  onPress={() => setTemplateTab('history')}>
                  <Text style={[styles.templateTabText, templateTab === 'history' && styles.templateTabTextActive]}>{t('eventHistory')}</Text>
                </TouchableOpacity>
              </View>
              {templateTab === 'template' ? (
                <>
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
                </>
              ) : (
                <View style={styles.templateList}>
                  <EventHistoryList onPick={handleUseHistoryEntry} refreshKey={showTemplateModal ? 1 : 0} />
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* Event History Modal (from settings) */}
        <Modal
          visible={showHistoryScreen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowHistoryScreen(false)}>
          <SafeAreaView style={[styles.searchModalContainer, {backgroundColor: colors.background}]}>
            <View style={[styles.searchHeader, {borderBottomColor: colors.border}]}>
              <TouchableOpacity onPress={() => setShowHistoryScreen(false)}>
                <Text style={[styles.searchCancelBtn, {color: colors.primary}]}>{t('close')}</Text>
              </TouchableOpacity>
              <Text style={[styles.searchTitle, {color: colors.text}]}>{t('eventHistory')}</Text>
              <View style={{width: 80}} />
            </View>
            <EventHistoryList onPick={handleUseHistoryEntry} refreshKey={showHistoryScreen ? 1 : 0} />
          </SafeAreaView>
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
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="color-palette-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('appearance')}</Text></View>
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

                      {/* App Lock */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="lock-closed-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('lockSection')}</Text></View>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={lockEnabled ? handleDisableLock : handleEnableLock}>
                          <Text style={styles.settingsItemLabel}>{t('lockEnable')}</Text>
                          <Text style={[styles.settingsItemLink, {color: lockEnabled ? colors.error : colors.primary}]}>
                            {lockEnabled ? t('lockEnabledStatus') : t('lockDisabledStatus')}
                          </Text>
                        </TouchableOpacity>
                        {lockEnabled && (
                          <TouchableOpacity
                            style={styles.settingsItem}
                            onPress={handleChangePin}>
                            <Text style={styles.settingsItemLabel}>{t('lockChangePin')}</Text>
                            <Text style={styles.settingsItemLink}>{t('changeLink')}</Text>
                          </TouchableOpacity>
                        )}
                        {lockEnabled && (
                          <TouchableOpacity
                            style={styles.settingsItem}
                            onPress={askLockDuration}>
                            <Text style={styles.settingsItemLabel}>{t('lockDuration')}</Text>
                            <Text style={styles.settingsItemLink}>
                              {lockExpiryAt === null
                                ? t('lockDurationForever')
                                : t('lockDurationRemaining', {days: Math.max(0, Math.ceil((lockExpiryAt - Date.now()) / (24 * 60 * 60 * 1000)))})}
                            </Text>
                          </TouchableOpacity>
                        )}
                        {lockEnabled && biometricAvailable && (
                          <TouchableOpacity
                            style={styles.settingsItem}
                            onPress={handleToggleBiometric}>
                            <Text style={styles.settingsItemLabel}>
                              {biometricLabel || t('lockBiometric')}
                            </Text>
                            <Text style={[styles.settingsItemLink, {color: biometricOn ? colors.error : colors.primary}]}>
                              {biometricOn ? t('lockEnabledStatus') : t('lockDisabledStatus')}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Sleep Settings */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="moon-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('sleepRhythm')}</Text></View>
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
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="calendar-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('calendarSection')}</Text></View>
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
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => { setShowSettingsModal(false); setShowHistoryScreen(true); }}>
                          <Text style={styles.settingsItemLabel}>{t('eventHistory')}</Text>
                          <Text style={styles.settingsItemLink}>{t('showMore')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Jobs & payroll */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="briefcase-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('jobsTitle')}</Text></View>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => { setShowSettingsModal(false); setShowJobsManager(true); }}>
                          <Text style={styles.settingsItemLabel}>{t('openJobs')}</Text>
                          <Text style={styles.settingsItemLink}>{t('showMore')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={handleShareCalendarIcs}>
                          <View>
                            <Text style={styles.settingsItemLabel}>{t('shareCalendarIcs')}</Text>
                            <Text style={[styles.settingsItemLink, {textAlign: 'left'}]}>{t('shareCalendarRange')}</Text>
                          </View>
                          <Ionicons name="share-outline" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      </View>

                      {/* Premium */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="star-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('premium')}</Text></View>
                        {isPremium ? (
                          <View style={[styles.settingsItem, {backgroundColor: '#34C75910'}]}>
                            <Text style={[styles.settingsItemLabel, {color: '#34C759', fontWeight: '700'}]}>{t('premiumActive')}</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.settingsItem, {backgroundColor: '#007AFF10'}]}
                            onPress={() => { setShowSettingsModal(false); setShowPaywall(true); }}>
                            <Text style={[styles.settingsItemLabel, {color: '#007AFF', fontWeight: '700'}]}>{t('upgradeToPremium')}</Text>
                            <Text style={styles.settingsItemLink}>{t('detailsLink')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Notification Settings */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="notifications-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('notification')}</Text></View>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>{t('notificationsInApp')}</Text>
                          <Switch value={notificationsOn} onValueChange={handleToggleNotifications} />
                        </View>
                        {notificationsOn && (
                          <View style={styles.settingsItem}>
                            <Text style={styles.settingsItemLabel}>{t('notificationsSound')}</Text>
                            <Switch value={notificationSound} onValueChange={handleToggleNotificationSound} />
                          </View>
                        )}
                        {notificationsOn && (
                          <TouchableOpacity
                            style={styles.settingsItem}
                            onPress={handleSendTestNotification}>
                            <Text style={styles.settingsItemLabel}>{t('notificationsTest')}</Text>
                            <Text style={styles.settingsItemLink}>{t('notificationsTestAction')}</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => Linking.openSettings()}>
                          <Text style={styles.settingsItemLabel}>{t('notificationSettings')}</Text>
                          <Text style={styles.settingsItemLink}>{t('openSettingsLink')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Widget Guide */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="grid-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('widget')}</Text></View>
                        <TouchableOpacity
                          style={styles.settingsItem}
                          onPress={() => setShowWidgetGuide(true)}>
                          <Text style={styles.settingsItemLabel}>{t('widgetUsage')}</Text>
                          <Text style={styles.settingsItemLink}>{t('showMore')}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* About */}
                      <View style={styles.settingsSection}>
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="globe-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('language')}</Text></View>
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
                        <View style={styles.sectionTitleRow}><View style={[styles.sectionTitleIcon, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="information-circle-outline" size={12} color={colors.textSecondary} /></View><Text style={styles.settingsSectionTitle}>{t('aboutApp')}</Text></View>
                        <View style={styles.settingsItem}>
                          <Text style={styles.settingsItemLabel}>{t('version')}</Text>
                          <Text style={styles.settingsItemValue}>{DeviceInfo.getVersion()}</Text>
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

                  {/* Widget: Next-event countdown */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>次の予定まで（小・中）</Text>
                    <View style={styles.widgetPreviewArea}>
                      <CountdownWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        次の予定までの残り時間をカウントダウン表示。あと何分かが一目で分かります。
                      </Text>
                    </View>
                  </View>

                  {/* Widget: Today's free time */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>今日の空き時間（小）</Text>
                    <View style={styles.widgetPreviewArea}>
                      <FreeTimeWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        今日これからの空き時間をゲージ付きで表示。スキマ時間がすぐ分かります。
                      </Text>
                    </View>
                  </View>

                  {/* Widget: This week */}
                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>今週の予定（中・大）</Text>
                    <View style={styles.widgetPreviewArea}>
                      <WeekWidgetPreview />
                    </View>
                    <View style={styles.widgetGuideCard}>
                      <Text style={styles.widgetGuideCardDesc}>
                        今週7日間を横並びで表示。曜日ごとの予定の多さが一目で分かります。
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
                          <Text style={{fontSize: 10, color: colors.textTertiary, marginTop: 6}}>{t('widgetLockCircle')}</Text>
                        </View>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenRectangularPreview />
                          <Text style={{fontSize: 10, color: colors.textTertiary, marginTop: 6}}>{t('widgetLockRect')}</Text>
                        </View>
                        <View style={{alignItems: 'center'}}>
                          <LockScreenInlinePreview />
                          <Text style={{fontSize: 10, color: colors.textTertiary, marginTop: 6}}>{t('widgetLockInline')}</Text>
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

        {/* Stats Screen */}
        <StatsScreen visible={showStats} onClose={() => setShowStats(false)} initialDate={currentDate} hideIncomeWall />
        <StatsScreen visible={showIncomeWall} onClose={() => setShowIncomeWall(false)} initialDate={currentDate} onlyIncomeWall />

        {/* ① 空き日シェアカード */}
        <ShareAvailabilityModal
          visible={showShareAvail}
          onClose={() => setShowShareAvail(false)}
          initialDate={currentDate}
        />

        {/* ③ グループ日程調整 */}
        <PollModal
          visible={showPoll}
          onClose={() => setShowPoll(false)}
          initialDate={currentDate}
        />


        <JobsManagerModal visible={showJobsManager} onClose={() => setShowJobsManager(false)} />

        <OnboardingModal visible={showOnboarding} onClose={dismissOnboarding} />

        {/* New User-Calendar modal */}
        <Modal
          visible={showCalendarCreate}
          animationType="fade"
          transparent
          onRequestClose={() => setShowCalendarCreate(false)}>
          <TouchableOpacity
            style={[styles.calCreateOverlay, {backgroundColor: 'rgba(0,0,0,0.5)'}]}
            activeOpacity={1}
            onPress={() => setShowCalendarCreate(false)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[styles.calCreateCard, {backgroundColor: colors.surface}]}>
                <Text style={[styles.calCreateTitle, {color: colors.text}]}>
                  {editingCalendarId ? t('calEditTitle') : t('calCreateTitle')}
                </Text>
                <TextInput
                  style={[styles.calCreateInput, {color: colors.text, backgroundColor: colors.inputBackground}]}
                  value={newCalendarName}
                  onChangeText={setNewCalendarName}
                  placeholder={t('calCreatePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                  maxLength={20}
                />
                <Text style={[styles.calCreateLabel, {color: colors.textSecondary}]}>{t('calCreateColor')}</Text>
                <View style={styles.calCreateColorRow}>
                  {['#007AFF', '#FF3B30', '#34C759', '#FFCC00', '#FF9500', '#AF52DE', '#FF2D92', '#5AC8FA', '#5856D6', '#8E8E93'].map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.calCreateColorDot,
                        {backgroundColor: c},
                        newCalendarColor === c && styles.calCreateColorDotActive,
                      ]}
                      onPress={() => setNewCalendarColor(c)}
                    />
                  ))}
                </View>
                <View style={styles.calCreateActions}>
                  <TouchableOpacity
                    style={[styles.calCreateBtn, {backgroundColor: colors.inputBackground}]}
                    onPress={() => setShowCalendarCreate(false)}>
                    <Text style={[styles.calCreateBtnText, {color: colors.textSecondary}]}>{t('cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.calCreateBtn, {backgroundColor: colors.primary, opacity: newCalendarName.trim() ? 1 : 0.4}]}
                    disabled={!newCalendarName.trim()}
                    onPress={async () => {
                      if (editingCalendarId) {
                        await updateUserCalendar(editingCalendarId, {
                          name: newCalendarName,
                          color: newCalendarColor,
                        });
                      } else {
                        const created = await addUserCalendar(newCalendarName, newCalendarColor);
                        setSelectedCalendarId(created.id);
                      }
                      const list = await getUserCalendars();
                      setUserCalendars(list);
                      setShowCalendarCreate(false);
                    }}>
                    <Text style={[styles.calCreateBtnText, {color: colors.onPrimary}]}>
                      {editingCalendarId ? t('save') : t('add')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Natural language event input */}
        <NLEventInput
          visible={showNLInput}
          onClose={() => setShowNLInput(false)}
          onParsed={handleNLParsed}
        />

        {/* App Lock — render last so it sits on top of everything */}
        <LockScreen visible={lockReady && lockEnabled && isLocked} onUnlocked={handleUnlocked} />
        <PinSetupModal
          visible={pinSetupVisible}
          onClose={() => {
            setPinSetupVisible(false);
            setTimeout(() => setShowSettingsModal(true), 300);
          }}
          onComplete={handlePinSetupComplete}
          requireCurrent={pinSetupChange}
        />

        {/* Sleep Setup Modal */}
        <SleepSetupModal
          visible={showSleepSetup}
          currentSettings={sleepSettings}
          onSave={handleSaveSleepSettings}
          onCancel={sleepSettings ? () => setShowSleepSetup(false) : undefined}
          formatTimeDisplay={formatTimeDisplay}
        />

        {/* Bottom tab bar */}
        <View
          style={[
            styles.bottomTabBar,
            {backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 4)},
          ]}>
          {TABS.map(tb => {
            const active = activeTab === tb.key;
            const tint = active ? colors.primary : colors.textTertiary;
            return (
              <TouchableOpacity
                key={tb.key}
                style={styles.bottomTabItem}
                onPress={() => setActiveTab(tb.key)}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                accessibilityLabel={t(tb.labelKey)}>
                <Ionicons name={(active ? tb.icon : tb.iconOutline) as any} size={22} color={tint} />
                <Text style={[styles.bottomTabLabel, {color: tint}]}>{t(tb.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
                  <Text style={{fontSize: 18, color: colors.primary}}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
      <UndoToast action={undoAction} onDismiss={() => setUndoAction(null)} />
      {/* バナー広告の表示を一旦停止中。再開する場合は下のブロックのコメントを外す。
      {!__DEV__ && !isPremium && (
        <View style={styles.bannerContainer}>
          <BannerAd
            unitId={adUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          />
        </View>
      )}
      */}
      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} />
      <UpdateAvailableModal
        visible={!!updateInfo}
        currentVersion={updateInfo?.currentVersion}
        latestVersion={updateInfo?.latestVersion}
        onUpdate={() => {
          openStore(updateInfo?.storeUrl);
          setUpdateInfo(null);
        }}
        onDismiss={() => {
          dismissUpdatePrompt(updateInfo?.latestVersion);
          setUpdateInfo(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  bottomTabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  bottomTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bottomTabLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  tabPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tabPlaceholderTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  tabPlaceholderSub: {
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  permissionBannerText: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  permissionBannerLink: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
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
  moreMenuOverlay: {
    flex: 1,
    paddingTop: 96,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
  },
  moreMenuCard: {
    minWidth: 200,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 6,
  },
  moreMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  moreMenuText: {
    fontSize: 15,
    fontWeight: '500',
  },
  calTabsContainer: {
    borderBottomWidth: 0.5,
  },
  calTabsContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  calTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  calTabDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calTabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  calTabAdd: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calCreateOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  calCreateCard: {
    width: 320,
    borderRadius: 16,
    padding: 20,
  },
  calCreateTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  calCreateInput: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  calCreateLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  calCreateHint: {
    fontSize: 11,
    marginBottom: 16,
  },
  calCreateColorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  calCreateColorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  calCreateColorDotActive: {
    borderWidth: 3,
    borderColor: '#000',
  },
  calCreateActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  calCreateBtn: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  calCreateBtnText: {
    fontSize: 14,
    fontWeight: '600',
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
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  sectionTitleIcon: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsSectionTitle: {
    fontSize: 13,
    color: '#666',
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
  templateTabRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 6,
  },
  templateTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  templateTabActive: {
    backgroundColor: '#007AFF',
  },
  templateTabText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  templateTabTextActive: {
    color: '#fff',
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
    <SafeAreaProvider>
      <PremiumProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </PremiumProvider>
    </SafeAreaProvider>
  );
}

export default App;
