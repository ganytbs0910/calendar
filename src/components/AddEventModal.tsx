import React, {useState, useCallback, useEffect, memo, useMemo, useRef} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
  Linking,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useTheme} from '../theme/ThemeContext';
import {usePremium} from '../context/PremiumContext';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {addTemplate} from '../services/templateService';
import {recordEventCreation, getEventHistory, deleteEventHistoryEntry, EventHistoryEntry} from '../services/eventHistoryService';
import {getEventWage, setEventWage, removeEventWage, getRecentWages, addRecentWage, removeRecentWage, getEventJob, setEventJob, removeEventJob} from '../services/eventWageService';
import {getJobs, Job} from '../services/jobService';
import {computeShiftPay, getIncomeThresholds} from '../services/statisticsService';
import {getYearWorkTotal, wallCrossedBy, wallLabel} from '../services/incomeWallService';
import JobsManagerModal from './JobsManagerModal';
import {
  cancelEventNotification,
  isNotificationsEnabled,
  scheduleEventNotification,
} from '../services/notificationService';
import {useTranslation} from 'react-i18next';

// Canonical color category palette (keys for i18n). MUST stay in sync with the
// calendar seed defaults in userCalendarService.ts — same 7 colors and labels —
// so the event color picker shows the same categories as the calendar filter tabs.
const DEFAULT_EVENT_COLORS = [
  {name: 'blue', color: '#007AFF', label: 'colorWork'},
  {name: 'red', color: '#FF3B30', label: 'colorImportant'},
  {name: 'green', color: '#34C759', label: 'colorFun'},
  {name: 'yellow', color: '#FFCC00', label: 'colorOther'},
  {name: 'orange', color: '#FF9500', label: 'colorPromise'},
  {name: 'purple', color: '#AF52DE', label: 'colorHobby'},
  {name: 'pink', color: '#FF2D92', label: 'colorSchedule'},
];

// Preset colors offered by the "+" picker: the full canonical set, so any color
// the user removed (long-press) can be re-added. availableColorsToAdd filters
// out the ones already shown.
const ADDITIONAL_COLORS = DEFAULT_EVENT_COLORS;

const COLOR_SETTINGS_KEY = '@color_settings';

// The "work" color. Selecting it unlocks the per-event hourly wage input,
// which feeds the monthly revenue total in the statistics screen.
const WORK_COLOR = '#007AFF';
const isWorkColor = (c: string): boolean => (c || '').trim().toUpperCase() === WORK_COLOR;

// Reminder options (negative minutes before event)
const REMINDER_OPTIONS = [
  {label: 'reminderNone', value: null},
  {label: 'reminder5min', value: -5},
  {label: 'reminder15min', value: -15},
  {label: 'reminder30min', value: -30},
  {label: 'reminder1hour', value: -60},
  {label: 'reminder1day', value: -1440},
];

const EVENT_COLOR_STORAGE_KEY = '@event_colors';

// Serialize read-modify-write on the colors map so two concurrent setEventColor
// calls don't clobber each other (e.g. when saving several events at once).
let eventColorWriteChain: Promise<unknown> = Promise.resolve();
const withEventColorLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = eventColorWriteChain.then(fn, fn);
  eventColorWriteChain = next.catch(() => {});
  return next;
};

// Helper functions for event colors
export const getEventColor = async (eventId: string): Promise<string | null> => {
  try {
    const colorsJson = await AsyncStorage.getItem(EVENT_COLOR_STORAGE_KEY);
    if (colorsJson) {
      const colors = JSON.parse(colorsJson);
      return colors[eventId] || null;
    }
    return null;
  } catch {
    return null;
  }
};

export const setEventColor = async (eventId: string, color: string): Promise<void> =>
  withEventColorLock(async () => {
    try {
      const colorsJson = await AsyncStorage.getItem(EVENT_COLOR_STORAGE_KEY);
      const colors = colorsJson ? JSON.parse(colorsJson) : {};
      colors[eventId] = color;
      await AsyncStorage.setItem(EVENT_COLOR_STORAGE_KEY, JSON.stringify(colors));
    } catch (error) {
      console.error('Error saving event color:', error);
    }
  });

export const removeEventColor = async (eventId: string): Promise<void> =>
  withEventColorLock(async () => {
    try {
      const colorsJson = await AsyncStorage.getItem(EVENT_COLOR_STORAGE_KEY);
      if (!colorsJson) return;
      const colors = JSON.parse(colorsJson);
      if (eventId in colors) {
        delete colors[eventId];
        await AsyncStorage.setItem(EVENT_COLOR_STORAGE_KEY, JSON.stringify(colors));
      }
    } catch (error) {
      console.error('Error removing event color:', error);
    }
  });

export const getAllEventColors = async (): Promise<Record<string, string>> => {
  try {
    const colorsJson = await AsyncStorage.getItem(EVENT_COLOR_STORAGE_KEY);
    return colorsJson ? JSON.parse(colorsJson) : {};
  } catch {
    return {};
  }
};

// Color settings (labels and active colors)
interface ColorOption {
  name: string;
  color: string;
  label: string;
}

export const getColorSettings = async (): Promise<ColorOption[]> => {
  try {
    const settingsJson = await AsyncStorage.getItem(COLOR_SETTINGS_KEY);
    if (settingsJson) {
      return JSON.parse(settingsJson);
    }
    return DEFAULT_EVENT_COLORS;
  } catch {
    return DEFAULT_EVENT_COLORS;
  }
};

export const saveColorSettings = async (colors: ColorOption[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(COLOR_SETTINGS_KEY, JSON.stringify(colors));
  } catch (error) {
    console.error('Error saving color settings:', error);
  }
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const COPY_CALENDAR_DAY_WIDTH = Math.floor((SCREEN_WIDTH - 80) / 7);
// WEEKDAYS will be resolved via i18n inside the component

// Custom Month-Day Picker Constants
const PICKER_ITEM_HEIGHT = 40;
const PICKER_VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = PICKER_ITEM_HEIGHT * PICKER_VISIBLE_ITEMS;

// Custom Month-Day Picker Component
interface MonthDayPickerProps {
  value: Date;
  onChange: (date: Date) => void;
}

const MonthDayPicker: React.FC<MonthDayPickerProps & {t: (key: string, opts?: any) => string}> = memo(({value, onChange, t}) => {
  const monthScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const [selectedMonth, setSelectedMonth] = useState(value.getMonth());
  const [selectedDay, setSelectedDay] = useState(value.getDate());
  const currentYear = value.getFullYear();

  // Get days in the selected month
  const daysInMonth = useMemo(() => {
    return new Date(currentYear, selectedMonth + 1, 0).getDate();
  }, [currentYear, selectedMonth]);

  // Generate month and day arrays
  const months = useMemo(() => Array.from({length: 12}, (_, i) => i), []);
  const days = useMemo(() => Array.from({length: daysInMonth}, (_, i) => i + 1), [daysInMonth]);

  // Scroll to initial values on mount
  useEffect(() => {
    setTimeout(() => {
      monthScrollRef.current?.scrollTo({
        y: selectedMonth * PICKER_ITEM_HEIGHT,
        animated: false,
      });
      dayScrollRef.current?.scrollTo({
        y: (selectedDay - 1) * PICKER_ITEM_HEIGHT,
        animated: false,
      });
    }, 50);
  }, []);

  // Handle month scroll end
  const handleMonthScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const index = Math.round(y / PICKER_ITEM_HEIGHT);
    const newMonth = Math.max(0, Math.min(11, index));
    setSelectedMonth(newMonth);

    // Adjust day if it exceeds the new month's days
    const newDaysInMonth = new Date(currentYear, newMonth + 1, 0).getDate();
    const newDay = Math.min(selectedDay, newDaysInMonth);
    if (newDay !== selectedDay) {
      setSelectedDay(newDay);
      dayScrollRef.current?.scrollTo({
        y: (newDay - 1) * PICKER_ITEM_HEIGHT,
        animated: true,
      });
    }

    const newDate = new Date(currentYear, newMonth, newDay);
    onChange(newDate);
  }, [currentYear, selectedDay, onChange]);

  // Handle day scroll end
  const handleDayScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const index = Math.round(y / PICKER_ITEM_HEIGHT);
    const newDay = Math.max(1, Math.min(daysInMonth, index + 1));
    setSelectedDay(newDay);

    const newDate = new Date(currentYear, selectedMonth, newDay);
    onChange(newDate);
  }, [currentYear, selectedMonth, daysInMonth, onChange]);

  const renderPickerItems = (items: number[], formatter: (item: number) => string, selectedIndex: number) => {
    const paddingItems = Math.floor(PICKER_VISIBLE_ITEMS / 2);
    return (
      <>
        {Array.from({length: paddingItems}).map((_, i) => (
          <View key={`pad-start-${i}`} style={styles.monthDayPickerItem} />
        ))}
        {items.map((item, index) => (
          <View key={item} style={styles.monthDayPickerItem}>
            <Text style={[
              styles.monthDayPickerItemText,
              index === selectedIndex && styles.monthDayPickerItemTextSelected,
            ]}>
              {formatter(item)}
            </Text>
          </View>
        ))}
        {Array.from({length: paddingItems}).map((_, i) => (
          <View key={`pad-end-${i}`} style={styles.monthDayPickerItem} />
        ))}
      </>
    );
  };

  return (
    <View style={styles.monthDayPickerContainer}>
      <View style={styles.monthDayPickerColumn}>
        <ScrollView
          ref={monthScrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={PICKER_ITEM_HEIGHT}
          decelerationRate="fast"
          onMomentumScrollEnd={handleMonthScrollEnd}
          contentContainerStyle={styles.monthDayPickerScrollContent}
        >
          {renderPickerItems(months, (m) => t('monthFormat', {month: m + 1}), selectedMonth)}
        </ScrollView>
      </View>
      <View style={styles.monthDayPickerColumn}>
        <ScrollView
          ref={dayScrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={PICKER_ITEM_HEIGHT}
          decelerationRate="fast"
          onMomentumScrollEnd={handleDayScrollEnd}
          contentContainerStyle={styles.monthDayPickerScrollContent}
        >
          {renderPickerItems(days, (d) => t('dayFormat', {day: d}), selectedDay - 1)}
        </ScrollView>
      </View>
      <View style={styles.monthDayPickerHighlight} pointerEvents="none" />
    </View>
  );
});

// Duration options (labels are i18n keys)
const DURATION_OPTIONS = [
  {label: 'duration30min', minutes: 30},
  {label: 'duration45min', minutes: 45},
  {label: 'duration1h', minutes: 60},
  {label: 'duration1_5h', minutes: 90},
  {label: 'duration2h', minutes: 120},
  {label: 'duration3h', minutes: 180},
  {label: 'duration6h', minutes: 360},
  {label: 'custom', minutes: -1},
];


interface AddEventModalProps {
  visible: boolean;
  onClose: () => void;
  onEventAdded: () => void;
  initialDate?: Date;
  initialEndDate?: Date;
  editingEvent?: CalendarEventReadable | null;
  initialColor?: string;
  initialTitle?: string;
  onDeleted?: () => void;
}

export const AddEventModal: React.FC<AddEventModalProps> = ({
  visible,
  onClose,
  onEventAdded,
  initialDate,
  initialEndDate,
  editingEvent,
  initialColor,
  initialTitle,
  onDeleted,
}) => {
  const {t} = useTranslation();
  const WEEKDAYS = t('weekdaysSingle', {returnObjects: true}) as string[];
  const isEditing = !!(editingEvent?.id);
  const isCopying = !!(editingEvent && !editingEvent.id);
  const {colors} = useTheme();
  const {isPremium} = usePremium();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [showCopyCalendar, setShowCopyCalendar] = useState(false);
  const [copyCalendarDate, setCopyCalendarDate] = useState(new Date());
  const [selectedCopyDates, setSelectedCopyDates] = useState<Date[]>([]);
  const [busyCopyDates, setBusyCopyDates] = useState<Set<string>>(new Set());
  const [selectedColor, setSelectedColor] = useState<string>(DEFAULT_EVENT_COLORS[0].color);
  const [hourlyWage, setHourlyWage] = useState<string>('');
  const [recentWages, setRecentWages] = useState<number[]>([]);
  const [wageSuggestions, setWageSuggestions] = useState<number[]>([]);
  const [showWageSuggestions, setShowWageSuggestions] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null); // null = manual wage
  const [showJobsManager, setShowJobsManager] = useState(false);
  const selectedJob = useMemo(() => jobs.find(j => j.id === selectedJobId) || null, [jobs, selectedJobId]);
  const payPreview = useMemo(
    () => (selectedJob ? computeShiftPay(startDate, endDate, selectedJob) : null),
    [selectedJob, startDate, endDate],
  );
  const [colorOptions, setColorOptions] = useState<ColorOption[]>(DEFAULT_EVENT_COLORS);
  const [editingLabelColor, setEditingLabelColor] = useState<string | null>(null);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [showAddColor, setShowAddColor] = useState(false);
  const [reminder, setReminder] = useState<number | null>(null);
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  // Presets = auto-saved recent events (eventHistory). One tap re-enters the
  // same event (incl. job/wage for バイト).
  const [presets, setPresets] = useState<EventHistoryEntry[]>([]);
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentTitles, setRecentTitles] = useState<string[]>([]);

  // Load recent event titles for suggestions
  useEffect(() => {
    if (visible && !isEditing) {
      const fetchTitles = async () => {
        try {
          const now = new Date();
          const past = new Date();
          past.setMonth(past.getMonth() - 2);
          const events = await RNCalendarEvents.fetchAllEvents(past.toISOString(), now.toISOString());
          // Count frequency
          const freq = new Map<string, number>();
          events.forEach(e => {
            if (e.title && e.title.trim()) {
              const t = e.title.trim();
              freq.set(t, (freq.get(t) || 0) + 1);
            }
          });
          // Sort by frequency, take top 20 unique
          const sorted = [...freq.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([t]) => t)
            .slice(0, 20);
          setRecentTitles(sorted);
        } catch {
          // ignore
        }
      };
      fetchTitles();
    }
  }, [visible, isEditing]);

  // Load color settings on mount
  useEffect(() => {
    getColorSettings().then(colors => {
      setColorOptions(colors);
      if (colors.length > 0 && !colors.find(c => c.color === selectedColor)) {
        setSelectedColor(colors[0].color);
      }
    });
  }, []);

  // Initialize dates when modal opens or initialDate/initialEndDate changes
  useEffect(() => {
    if (visible) {
      getRecentWages().then(setRecentWages);
      getJobs().then(setJobs);
      const isCopying = editingEvent && !editingEvent.id;

      if (editingEvent && !isCopying) {
        // Editing mode - load existing event data
        setTitle(editingEvent.title || '');
        if (editingEvent.startDate) {
          setStartDate(new Date(editingEvent.startDate));
        }
        if (editingEvent.endDate) {
          setEndDate(new Date(editingEvent.endDate));
        }
        // Load reminder from alarms
        if (editingEvent.alarms && editingEvent.alarms.length > 0) {
          const alarm = editingEvent.alarms[0];
          if (typeof alarm.date === 'number') {
            setReminder(alarm.date);
          } else {
            setReminder(null);
          }
        } else {
          setReminder(null);
        }
        // Load saved color for this event
        if (editingEvent.id) {
          getEventColor(editingEvent.id).then(color => {
            setSelectedColor(color || editingEvent.calendar?.color || DEFAULT_EVENT_COLORS[0].color);
          });
          getEventWage(editingEvent.id).then(wage => {
            setHourlyWage(wage ? String(wage) : '');
          });
          getEventJob(editingEvent.id).then(jobId => setSelectedJobId(jobId));
        } else {
          setHourlyWage('');
          setSelectedJobId(null);
        }
      } else if (isCopying && initialDate && initialEndDate) {
        // Copy mode - use title from event but dates from initialDate/initialEndDate
        setTitle(editingEvent.title || '');
        setStartDate(new Date(initialDate));
        setEndDate(new Date(initialEndDate));
        // Copy reminder
        if (editingEvent.alarms && editingEvent.alarms.length > 0) {
          const alarm = editingEvent.alarms[0];
          if (typeof alarm.date === 'number') {
            setReminder(alarm.date);
          } else {
            setReminder(null);
          }
        } else {
          setReminder(null);
        }
        // Copy color from original event if available
        if (editingEvent.id) {
          getEventColor(editingEvent.id).then(color => {
            setSelectedColor(color || editingEvent.calendar?.color || DEFAULT_EVENT_COLORS[0].color);
          });
          getEventWage(editingEvent.id).then(wage => {
            setHourlyWage(wage ? String(wage) : '');
          });
          getEventJob(editingEvent.id).then(jobId => setSelectedJobId(jobId));
        } else {
          setSelectedColor(DEFAULT_EVENT_COLORS[0].color);
          setHourlyWage('');
          setSelectedJobId(null);
        }
      } else if (initialDate) {
        if (initialEndDate) {
          setStartDate(new Date(initialDate));
          setEndDate(new Date(initialEndDate));
        } else {
          // Fetch events for the day to calculate smart start time
          const dayStart = new Date(initialDate);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(initialDate);
          dayEnd.setHours(23, 59, 59, 999);
          RNCalendarEvents.fetchAllEvents(dayStart.toISOString(), dayEnd.toISOString()).then(events => {
            const nonAllDayEvents = events.filter(e => !e.allDay && e.endDate);
            const start = new Date(initialDate);
            if (nonAllDayEvents.length > 0) {
              const latestEnd = nonAllDayEvents.reduce((latest, e) => {
                const end = new Date(e.endDate!);
                return end > latest ? end : latest;
              }, new Date(0));
              start.setHours(latestEnd.getHours() + 1);
              start.setMinutes(0);
            } else {
              start.setHours(14);
              start.setMinutes(0);
            }
            start.setSeconds(0);
            setStartDate(start);
            const end = new Date(start);
            end.setHours(end.getHours() + 1);
            setEndDate(end);
          }).catch(() => {
            const start = new Date(initialDate);
            start.setHours(14, 0, 0, 0);
            setStartDate(start);
            const end = new Date(start);
            end.setHours(end.getHours() + 1);
            setEndDate(end);
          });
        }
        setTitle(initialTitle || '');
        setReminder(null);
        setSelectedColor(initialColor || DEFAULT_EVENT_COLORS[0].color);
        setHourlyWage('');
        setSelectedJobId(null);
      } else {
        // No initialDate - use today with smart start time
        const today = new Date();
        const dayStart = new Date(today);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(today);
        dayEnd.setHours(23, 59, 59, 999);
        RNCalendarEvents.fetchAllEvents(dayStart.toISOString(), dayEnd.toISOString()).then(events => {
          const nonAllDayEvents = events.filter(e => !e.allDay && e.endDate);
          const start = new Date(today);
          if (nonAllDayEvents.length > 0) {
            const latestEnd = nonAllDayEvents.reduce((latest, e) => {
              const end = new Date(e.endDate!);
              return end > latest ? end : latest;
            }, new Date(0));
            start.setHours(latestEnd.getHours() + 1);
            start.setMinutes(0);
          } else {
            start.setHours(14);
            start.setMinutes(0);
          }
          start.setSeconds(0);
          setStartDate(start);
          const end = new Date(start);
          end.setHours(end.getHours() + 1);
          setEndDate(end);
        }).catch(() => {
          const start = new Date(today);
          start.setHours(14, 0, 0, 0);
          setStartDate(start);
          const end = new Date(start);
          end.setHours(end.getHours() + 1);
          setEndDate(end);
        });
        setTitle(initialTitle || '');
        setReminder(null);
        setSelectedColor(initialColor || DEFAULT_EVENT_COLORS[0].color);
        setHourlyWage('');
        setSelectedJobId(null);
      }
    }
  }, [visible, initialDate, initialEndDate, editingEvent, initialColor, initialTitle]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Load presets (recent saved events) when the modal opens.
  useEffect(() => {
    if (visible) getEventHistory().then(p => setPresets(p.slice(0, 12))).catch(() => {});
  }, [visible]);

  // One-tap re-enter a saved event. Duration is applied relative to the current
  // start; job/wage are restored only for work-colored presets.
  const applyPreset = useCallback((p: EventHistoryEntry) => {
    setTitle(p.title);
    setSelectedColor(p.color);
    setEndDate(new Date(startDate.getTime() + p.durationMinutes * 60000));
    setReminder(p.reminder);
    setRecurrence(p.recurrence);
    if (isWorkColor(p.color)) {
      setSelectedJobId(p.jobId ?? null);
      setHourlyWage(p.hourlyWage != null ? String(p.hourlyWage) : '');
    } else {
      setSelectedJobId(null);
      setHourlyWage('');
    }
    setShowSuggestions(false);
  }, [startDate]);

  const removePreset = useCallback((p: EventHistoryEntry) => {
    Alert.alert('プリセットを削除', `「${p.title}」を削除しますか？`, [
      {text: t('cancel'), style: 'cancel'},
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteEventHistoryEntry(p.id);
          setPresets(prev => prev.filter(e => e.id !== p.id));
        },
      },
    ]);
  }, [t]);

  const handleSave = useCallback(async () => {
    // Check and request permission before saving. iOS 17+ returns "fullAccess"
    // alongside the older "authorized", but the library's TS types haven't
    // caught up — widen to string for the comparison.
    const permissionStatus: string = await RNCalendarEvents.checkPermissions();

    if (permissionStatus !== 'authorized' && permissionStatus !== 'fullAccess') {
      const requestedStatus: string = await RNCalendarEvents.requestPermissions();
      if (requestedStatus !== 'authorized' && requestedStatus !== 'fullAccess') {
        Alert.alert(
          t('calendarAccess'),
          t('calendarFullAccessMessage'),
          [
            {text: t('cancel'), style: 'cancel'},
            {text: t('openSettings'), onPress: () => Linking.openSettings()},
          ]
        );
        return;
      }
    }

    // Auto-fix: if endDate is not after startDate, set to startDate + 1 hour
    let finalEndDate = endDate;
    if (endDate.getTime() <= startDate.getTime()) {
      finalEndDate = new Date(startDate);
      finalEndDate.setHours(finalEndDate.getHours() + 1);
    }

    // Auto-fix: ensure minimum 30 minutes duration (15-min events are not allowed)
    const minDuration = 30 * 60 * 1000;
    if (finalEndDate.getTime() - startDate.getTime() < minDuration) {
      finalEndDate = new Date(startDate.getTime() + minDuration);
    }

    // Per-event wage / job link only apply to work-colored events. A job link
    // takes precedence over a manual wage (they are mutually exclusive).
    const jobToSave = isWorkColor(selectedColor) ? selectedJobId : null;
    const parsedWage = parseFloat(hourlyWage);
    const wageToSave =
      isWorkColor(selectedColor) && !jobToSave && !isNaN(parsedWage) && parsedWage > 0 ? parsedWage : null;
    const persistPayroll = async (eventId: string) => {
      if (jobToSave) {
        await setEventJob(eventId, jobToSave);
        await removeEventWage(eventId);
      } else {
        await removeEventJob(eventId);
        if (wageToSave !== null) {
          await setEventWage(eventId, wageToSave);
        } else {
          await removeEventWage(eventId);
        }
      }
    };

    // 年収の壁ナビ: before a NEW work shift is saved, warn if it pushes this
    // year's income over the next 103/106/130/150万 wall. Best-effort — a failed
    // check must never block saving.
    if (!isEditing && isWorkColor(selectedColor)) {
      let addPay = 0;
      if (jobToSave) {
        const job = jobs.find(j => j.id === jobToSave);
        if (job) addPay = computeShiftPay(startDate, finalEndDate, job).total;
      } else if (wageToSave) {
        addPay = ((finalEndDate.getTime() - startDate.getTime()) / 3600000) * wageToSave;
      }
      if (addPay > 0) {
        try {
          const [currentTotal, thresholds] = await Promise.all([
            getYearWorkTotal(startDate.getFullYear()),
            getIncomeThresholds(),
          ]);
          const crossed = wallCrossedBy(currentTotal, addPay, thresholds);
          if (crossed) {
            const ok = await new Promise<boolean>(resolve => {
              Alert.alert(
                `${wallLabel(crossed)}円の壁を超えます`,
                `このシフトで今年の収入が ${wallLabel(crossed)}円の壁（¥${crossed.toLocaleString()}）を超えます。\n` +
                  `¥${Math.round(currentTotal).toLocaleString()} → ¥${Math.round(currentTotal + addPay).toLocaleString()}`,
                [
                  {text: 'やめておく', style: 'cancel', onPress: () => resolve(false)},
                  {text: '承知で保存', onPress: () => resolve(true)},
                ],
              );
            });
            if (!ok) return;
          }
        } catch {
          // ignore — never block saving on a wall-check failure
        }
      }
    }

    // Local conflict detection (no AI/API): warn on overlapping events.
    try {
      const dayStart = new Date(startDate); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startDate); dayEnd.setHours(23, 59, 59, 999);
      const dayEvents = await RNCalendarEvents.fetchAllEvents(dayStart.toISOString(), dayEnd.toISOString());
      const s = startDate.getTime();
      const e = finalEndDate.getTime();
      const clash = dayEvents.find(ev => {
        if (ev.allDay || !ev.startDate || !ev.endDate) return false;
        if (isEditing && editingEvent?.id && ev.id === editingEvent.id) return false;
        const es = new Date(ev.startDate).getTime();
        const ee = new Date(ev.endDate).getTime();
        return s < ee && es < e;
      });
      if (clash) {
        const proceed = await new Promise<boolean>(resolve => {
          Alert.alert(
            t('conflictTitle'),
            t('conflictMessage', {title: clash.title || t('noTitle')}),
            [
              {text: t('cancel'), style: 'cancel', onPress: () => resolve(false)},
              {text: t('saveAnyway'), onPress: () => resolve(true)},
            ],
          );
        });
        if (!proceed) return;
      }
    } catch {
      /* conflict check is best-effort */
    }

    try {
      // When in-app notifications are on we own the delivery, so don't ask the
      // OS calendar to alarm too (would cause duplicates).
      const inAppOn = await isNotificationsEnabled();
      const osAlarms = !inAppOn && reminder !== null ? [{date: reminder}] : [];
      const eventTitle = title.trim() || t('noTitle');

      if (isEditing && editingEvent?.id) {
        // Update existing event
        await RNCalendarEvents.saveEvent(eventTitle, {
          id: editingEvent.id,
          startDate: startDate.toISOString(),
          endDate: finalEndDate.toISOString(),
          allDay: false,
          alarms: osAlarms,
        });
        // Save custom color
        await setEventColor(editingEvent.id, selectedColor);
        // Save (or clear) per-event wage / job link
        await persistPayroll(editingEvent.id);

        await cancelEventNotification(editingEvent.id);
        if (inAppOn && reminder !== null) {
          const fireDate = new Date(startDate.getTime() + reminder * 60_000);
          await scheduleEventNotification({
            eventId: editingEvent.id,
            title: eventTitle,
            fireDate,
          });
        }
      } else {
        // Create new event
        const calendars = await RNCalendarEvents.findCalendars();
        const writableCalendars = calendars.filter(cal => cal.allowsModifications);
        if (writableCalendars.length === 0) {
          Alert.alert(t('error'), t('noWritableCalendar'));
          return;
        }

        const defaultCalendar = writableCalendars.find(cal => cal.isPrimary) || writableCalendars[0];

        const eventConfig: any = {
          calendarId: defaultCalendar.id,
          startDate: startDate.toISOString(),
          endDate: finalEndDate.toISOString(),
          allDay: false,
          alarms: osAlarms,
        };
        if (recurrence !== 'none') {
          eventConfig.recurrenceRule = {
            frequency: recurrence,
            occurrence: recurrence === 'monthly' ? 60 : 260, // ~5 years
          };
        }
        const eventId = await RNCalendarEvents.saveEvent(eventTitle, eventConfig);
        if (eventId) {
          await setEventColor(eventId, selectedColor);
          await persistPayroll(eventId);
          if (inAppOn && reminder !== null) {
            const fireDate = new Date(startDate.getTime() + reminder * 60_000);
            await scheduleEventNotification({
              eventId,
              title: eventTitle,
              fireDate,
              recurrence,
            });
          }
        }
        const durationMinutes = Math.max(
          1,
          Math.round((finalEndDate.getTime() - startDate.getTime()) / 60000),
        );
        recordEventCreation({
          title: eventTitle,
          durationMinutes,
          color: selectedColor,
          reminder,
          recurrence,
          jobId: jobToSave,
          hourlyWage: wageToSave,
        }).catch(() => {});
      }

      if (wageToSave !== null) {
        await addRecentWage(wageToSave);
      }

      handleClose();
      onEventAdded();
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert(t('error'), isEditing ? t('updateFailed') : t('saveFailed'));
    }
  }, [title, startDate, endDate, handleClose, onEventAdded, isEditing, editingEvent, selectedColor, hourlyWage, selectedJobId, reminder, recurrence, t]);

  const formatDate = (date: Date) => {
    return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
  };

  const formatTime = (date: Date) => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatDuration = (ms: number) => {
    const totalMinutes = Math.round(ms / (1000 * 60));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (days >= 7 && days % 7 === 0 && hours === 0 && minutes === 0) {
      return t('weeksFmt', {w: days / 7});
    } else if (days > 0 && hours === 0 && minutes === 0) {
      return t('daysFmt', {d: days});
    } else if (days > 0) {
      if (hours === 0 && minutes === 0) {
        return t('daysFmt', {d: days});
      } else if (minutes === 0) {
        return t('daysHoursFmt', {d: days, h: hours});
      } else {
        return t('daysHoursMinutesFmt', {d: days, h: hours, m: minutes});
      }
    } else if (hours === 0) {
      return t('minutesFmt', {m: minutes});
    } else if (minutes === 0) {
      return t('hoursFmt', {h: hours});
    } else {
      return t('hoursMinutesFmt', {h: hours, m: minutes});
    }
  };

  const handleSetDuration = useCallback((minutes: number) => {
    const newEnd = new Date(startDate);
    newEnd.setMinutes(newEnd.getMinutes() + minutes);
    setEndDate(newEnd);
  }, [startDate]);

  // Check which dates have conflicting events for the copy time range
  const fetchBusyDates = useCallback(async (monthDate: Date) => {
    try {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const fetchStart = new Date(year, month - 1, 1);
      const fetchEnd = new Date(year, month + 2, 0, 23, 59, 59);
      const events = await RNCalendarEvents.fetchAllEvents(fetchStart.toISOString(), fetchEnd.toISOString());

      const eventStartTime = startDate.getHours() * 60 + startDate.getMinutes();
      const eventEndTime = endDate.getHours() * 60 + endDate.getMinutes();

      const busy = new Set<string>();
      for (const ev of events) {
        if (ev.allDay || !ev.startDate || !ev.endDate) continue;
        const evStart = new Date(ev.startDate);
        const evEnd = new Date(ev.endDate);
        const evStartMin = evStart.getHours() * 60 + evStart.getMinutes();
        const evEndMin = evEnd.getHours() * 60 + evEnd.getMinutes();
        // Check time overlap
        if (evStartMin < eventEndTime && evEndMin > eventStartTime) {
          busy.add(evStart.toDateString());
        }
      }
      setBusyCopyDates(busy);
    } catch {
      setBusyCopyDates(new Set());
    }
  }, [startDate, endDate]);

  // Copy to other dates functionality
  const handleShowCopyCalendar = useCallback(() => {
    const monthDate = new Date(startDate);
    setCopyCalendarDate(monthDate);
    setSelectedCopyDates([new Date(startDate)]);
    setShowCopyCalendar(true);
    fetchBusyDates(monthDate);
  }, [startDate, fetchBusyDates]);

  const toggleCopyDateSelection = useCallback((targetDate: Date) => {
    // Don't allow deselecting the origin date
    if (targetDate.toDateString() === startDate.toDateString()) return;
    setSelectedCopyDates(prev => {
      const dateStr = targetDate.toDateString();
      const exists = prev.some(d => d.toDateString() === dateStr);
      if (exists) {
        return prev.filter(d => d.toDateString() !== dateStr);
      } else {
        return [...prev, targetDate];
      }
    });
  }, []);

  const handleCopyToSelectedDates = useCallback(async () => {
    // Exclude the origin date (startDate) from copy targets
    const copyTargets = selectedCopyDates.filter(d => d.toDateString() !== startDate.toDateString());
    if (copyTargets.length === 0) return;

    const durationMs = endDate.getTime() - startDate.getTime();

    try {
      const calendars = await RNCalendarEvents.findCalendars();
      const writableCalendars = calendars.filter(cal => cal.allowsModifications);
      if (writableCalendars.length === 0) {
        Alert.alert(t('error'), t('noWritableCalendar'));
        return;
      }
      const defaultCalendar = writableCalendars.find(cal => cal.isPrimary) || writableCalendars[0];
      const inAppOn = await isNotificationsEnabled();
      const osAlarms = !inAppOn && reminder !== null ? [{date: reminder}] : [];
      const copyTitle = title.trim() || t('noTitle');
      const parsedCopyWage = parseFloat(hourlyWage);
      const copyWage =
        isWorkColor(selectedColor) && !isNaN(parsedCopyWage) && parsedCopyWage > 0
          ? parsedCopyWage
          : null;

      for (const targetDate of copyTargets) {
        const newStart = new Date(targetDate);
        newStart.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
        const newEnd = new Date(newStart.getTime() + durationMs);

        const eventId = await RNCalendarEvents.saveEvent(copyTitle, {
          calendarId: defaultCalendar.id,
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          allDay: false,
          alarms: osAlarms,
        });
        // Save custom color (and per-event wage / job link) for copied event
        if (eventId) {
          await setEventColor(eventId, selectedColor);
          if (isWorkColor(selectedColor) && selectedJobId) {
            await setEventJob(eventId, selectedJobId);
          } else if (copyWage !== null) {
            await setEventWage(eventId, copyWage);
          }
          if (inAppOn && reminder !== null) {
            const fireDate = new Date(newStart.getTime() + reminder * 60_000);
            await scheduleEventNotification({
              eventId,
              title: copyTitle,
              fireDate,
            });
          }
        }
      }

      if (copyWage !== null) {
        await addRecentWage(copyWage);
      }

      setShowCopyCalendar(false);
      setSelectedCopyDates([]);
      Alert.alert(t('done'), t('copyCompleted', {count: copyTargets.length}));
      onEventAdded();
    } catch (error) {
      console.error('Error copying event:', error);
      Alert.alert(t('error'), t('copyFailed'));
    }
  }, [title, startDate, endDate, selectedCopyDates, onEventAdded, reminder, selectedColor, hourlyWage, selectedJobId, t]);

  // Label editing functions
  const handleLabelPress = useCallback((color: string) => {
    const colorOption = colorOptions.find(c => c.color === color);
    if (colorOption) {
      setEditingLabelColor(color);
      setEditingLabelText(colorOption.label);
    }
  }, [colorOptions]);

  const handleLabelSave = useCallback(async () => {
    if (editingLabelColor) {
      const updatedColors = colorOptions.map(c =>
        c.color === editingLabelColor ? {...c, label: editingLabelText} : c
      );
      setColorOptions(updatedColors);
      await saveColorSettings(updatedColors);
      setEditingLabelColor(null);
      setEditingLabelText('');
    }
  }, [editingLabelColor, editingLabelText, colorOptions]);

  // Add color function
  const handleAddColor = useCallback(async (colorToAdd: ColorOption) => {
    const updatedColors = [...colorOptions, colorToAdd];
    setColorOptions(updatedColors);
    await saveColorSettings(updatedColors);
    setShowAddColor(false);
  }, [colorOptions]);

  // Remove color function
  const handleRemoveColor = useCallback(async (colorToRemove: string) => {
    if (colorOptions.length <= 1) return; // Keep at least one color
    const updatedColors = colorOptions.filter(c => c.color !== colorToRemove);
    setColorOptions(updatedColors);
    await saveColorSettings(updatedColors);
    if (selectedColor === colorToRemove && updatedColors.length > 0) {
      setSelectedColor(updatedColors[0].color);
    }
  }, [colorOptions, selectedColor]);

  // Get available colors to add
  const availableColorsToAdd = useMemo(() => {
    const currentColorValues = colorOptions.map(c => c.color);
    return ADDITIONAL_COLORS.filter(c => !currentColorValues.includes(c.color));
  }, [colorOptions]);

  const goToCopyPrevMonth = useCallback(() => {
    setCopyCalendarDate(prev => {
      const newDate = new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
      fetchBusyDates(newDate);
      return newDate;
    });
  }, [fetchBusyDates]);

  const goToCopyNextMonth = useCallback(() => {
    setCopyCalendarDate(prev => {
      const newDate = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      fetchBusyDates(newDate);
      return newDate;
    });
  }, [fetchBusyDates]);

  const copyCalendarDays = useMemo(() => {
    const year = copyCalendarDate.getFullYear();
    const month = copyCalendarDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: Array<{day: number; isCurrentMonth: boolean; date: Date}> = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      days.push({day, isCurrentMonth: false, date: new Date(year, month - 1, day)});
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push({day: i, isCurrentMonth: true, date: new Date(year, month, i)});
    }

    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({day: i, isCurrentMonth: false, date: new Date(year, month + 1, i)});
    }

    return days;
  }, [copyCalendarDate]);

  const onTempDateChange = (_: any, selectedDate?: Date) => {
    if (selectedDate) {
      setTempDate(selectedDate);
    }
  };

  const confirmStartDate = () => {
    const newDate = new Date(startDate);
    newDate.setFullYear(tempDate.getFullYear());
    newDate.setMonth(tempDate.getMonth());
    newDate.setDate(tempDate.getDate());
    setStartDate(newDate);

    const startDay = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
    const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    if (endDay < startDay) {
      const newEndDate = new Date(newDate);
      newEndDate.setHours(newEndDate.getHours() + 1);
      setEndDate(newEndDate);
    }
    setShowStartDatePicker(false);
  };

  const confirmStartTime = () => {
    const durationMs = endDate.getTime() - startDate.getTime();
    const newDate = new Date(startDate);
    newDate.setHours(tempDate.getHours());
    newDate.setMinutes(tempDate.getMinutes());
    setStartDate(newDate);

    const newEndDate = new Date(newDate.getTime() + durationMs);
    setEndDate(newEndDate);
    setShowStartTimePicker(false);
  };

  const confirmEndDate = () => {
    const newDate = new Date(endDate);
    newDate.setFullYear(tempDate.getFullYear());
    newDate.setMonth(tempDate.getMonth());
    newDate.setDate(tempDate.getDate());
    setEndDate(newDate);
    setShowEndDatePicker(false);
  };

  const confirmEndTime = () => {
    const newDate = new Date(endDate);
    newDate.setHours(tempDate.getHours());
    newDate.setMinutes(tempDate.getMinutes());
    setEndDate(newDate);
    setShowEndTimePicker(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}>
      <KeyboardAvoidingView style={[styles.container, {backgroundColor: colors.background}]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityLabel={t('cancel')}
            accessibilityRole="button">
            <Text style={[styles.cancelButton, {color: colors.primary}]}>{t('cancel')}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, {color: colors.text}]} accessibilityRole="header">
            {isEditing ? t('editEvent') : isCopying ? t('copyEvent') : t('addEvent')}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            accessibilityLabel={t('save')}
            accessibilityRole="button">
            <Text style={[styles.saveButton, {color: colors.primary}]}>{t('save')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={[styles.inputGroup, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
            {!isEditing && presets.length > 0 && (
              <View style={styles.presetWrap}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6}}>
                  <Ionicons name="flash-outline" size={12} color={colors.textSecondary} />
                  <Text style={{fontSize: 12, color: colors.textSecondary, fontWeight: '500'}}>プリセット（前回の予定をワンタップ）</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap: 8, paddingRight: 8}}>
                  {presets.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.presetChip, {backgroundColor: colors.inputBackground, borderColor: colors.border}]}
                      onPress={() => applyPreset(p)}
                      onLongPress={() => removePreset(p)}
                      delayLongPress={300}>
                      <View style={[styles.presetDot, {backgroundColor: p.color}]} />
                      <Text style={[styles.presetChipText, {color: colors.text}]} numberOfLines={1}>{p.title}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={[styles.titleColorDivider, {backgroundColor: colors.borderLight, marginTop: 12}]} />
              </View>
            )}
            <View style={styles.titleInputContainer}>
              <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="create-outline" size={12} color={colors.textSecondary} /></View>
              <TextInput
                style={[styles.titleInput, {color: colors.text}]}
                placeholder={t('titlePlaceholder')}
                value={title}
                onChangeText={(text) => {
                  setTitle(text);
                  if (text.length > 0 && recentTitles.length > 0) {
                    const filtered = recentTitles.filter(t =>
                      t.toLowerCase().includes(text.toLowerCase()) && t !== text
                    );
                    setTitleSuggestions(filtered.slice(0, 5));
                    setShowSuggestions(filtered.length > 0);
                  } else if (text.length === 0) {
                    setTitleSuggestions(recentTitles.slice(0, 5));
                    setShowSuggestions(true);
                  } else {
                    setShowSuggestions(false);
                  }
                }}
                onFocus={() => {
                  if (title.length === 0 && recentTitles.length > 0) {
                    setTitleSuggestions(recentTitles.slice(0, 5));
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  // Delay to allow tap on suggestion
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('title')}
                accessibilityHint={t('eventTitleHint')}
              />
              {title.length > 0 && (
                <TouchableOpacity
                  style={styles.titleClearButton}
                  onPress={() => { setTitle(''); setShowSuggestions(false); }}
                  accessibilityLabel={t('titleClear')}>
                  <Text style={[styles.titleClearButtonText, {color: colors.textTertiary}]}>×</Text>
                </TouchableOpacity>
              )}
            </View>
            {showSuggestions && titleSuggestions.length > 0 && (
              <View style={[styles.suggestionsContainer, {backgroundColor: colors.inputBackground}]}>
                {titleSuggestions.map((suggestion, i) => (
                  <TouchableOpacity
                    key={`${suggestion}-${i}`}
                    style={[styles.suggestionItem, i > 0 && {borderTopWidth: 1, borderTopColor: colors.borderLight}]}
                    onPress={() => {
                      setTitle(suggestion);
                      setShowSuggestions(false);
                    }}>
                    <Text style={[styles.suggestionText, {color: colors.text}]} numberOfLines={1}>
                      {suggestion}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.colorChipScroll}
              contentContainerStyle={styles.colorChipScrollContent}>
              {colorOptions.map((colorOption) => {
                const isSel = selectedColor === colorOption.color;
                return (
                  <View
                    key={colorOption.name}
                    style={[
                      styles.colorNameChip,
                      {backgroundColor: colors.inputBackground, borderColor: colors.border},
                      isSel && {borderColor: colorOption.color, backgroundColor: colorOption.color + '22'},
                    ]}>
                    <TouchableOpacity
                      style={styles.colorNameChipMain}
                      onPress={() => setSelectedColor(colorOption.color)}
                      onLongPress={() => handleRemoveColor(colorOption.color)}>
                      <View style={[styles.colorNameChipDot, {backgroundColor: colorOption.color}]} />
                      <Text
                        style={[
                          styles.colorNameChipText,
                          {color: colors.textSecondary},
                          isSel && {color: colors.text, fontWeight: '700'},
                        ]}
                        numberOfLines={1}>
                        {t(colorOption.label, {defaultValue: colorOption.label})}
                      </Text>
                    </TouchableOpacity>
                    {isSel && (
                      <TouchableOpacity
                        onPress={() => handleLabelPress(colorOption.color)}
                        hitSlop={{top: 8, bottom: 8, left: 4, right: 8}}>
                        <Ionicons name="pencil-outline" size={12} color={colors.textTertiary} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {availableColorsToAdd.length > 0 && isPremium && (
                <TouchableOpacity
                  style={[styles.colorNameChip, styles.addColorChip, {backgroundColor: colors.inputBackground, borderColor: colors.border}]}
                  onPress={() => setShowAddColor(true)}>
                  <Text style={[styles.addColorButtonText, {color: colors.textTertiary}]}>+</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          <View style={[styles.dateTimeSection, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
            <View style={styles.dtLabeledRow}>
              <View style={styles.dtRowLabel}>
                <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="calendar-outline" size={12} color={colors.textSecondary} /></View>
                <Text style={[styles.dtRowLabelText, {color: colors.textSecondary}]}>{t('startLabel')}</Text>
              </View>
              <View style={styles.dtRowValue}>
                <TouchableOpacity
                  style={[styles.dtCell, {backgroundColor: colors.today}]}
                  onPress={() => {
                    setShowStartTimePicker(false);
                    setShowEndDatePicker(false);
                    setShowEndTimePicker(false);
                    setTempDate(new Date(startDate));
                    setShowStartDatePicker(true);
                  }}>
                  <Text style={[styles.dtCellText, {color: colors.primary}]}>
                    {t('dateDayOfWeek', {month: startDate.getMonth() + 1, day: startDate.getDate(), weekday: WEEKDAYS[startDate.getDay()]})}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dtTimeCell, {backgroundColor: colors.today}]}
                  onPress={() => {
                    setShowStartDatePicker(false);
                    setShowEndDatePicker(false);
                    setShowEndTimePicker(false);
                    setTempDate(new Date(startDate));
                    setShowStartTimePicker(true);
                  }}>
                  <Text style={[styles.dtCellTime, {color: colors.primary}]}>{formatTime(startDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.dtLabeledRow}>
              <View style={styles.dtRowLabel}>
                <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="flag-outline" size={12} color={colors.textSecondary} /></View>
                <Text style={[styles.dtRowLabelText, {color: colors.textSecondary}]}>{t('endLabel')}</Text>
              </View>
              <View style={styles.dtRowValue}>
                <TouchableOpacity
                  style={[styles.dtCell, {backgroundColor: colors.inputBackground}]}
                  onPress={() => {
                    setShowStartDatePicker(false);
                    setShowStartTimePicker(false);
                    setShowEndTimePicker(false);
                    setTempDate(new Date(endDate));
                    setShowEndDatePicker(true);
                  }}>
                  <Text style={[styles.dtCellText, {color: colors.text}]}>
                    {t('dateDayOfWeek', {month: endDate.getMonth() + 1, day: endDate.getDate(), weekday: WEEKDAYS[endDate.getDay()]})}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dtTimeCell, {backgroundColor: colors.inputBackground}]}
                  onPress={() => {
                    setShowStartDatePicker(false);
                    setShowStartTimePicker(false);
                    setShowEndDatePicker(false);
                    setTempDate(new Date(endDate));
                    setShowEndTimePicker(true);
                  }}>
                  <Text style={[styles.dtCellTime, {color: colors.text}]}>{formatTime(endDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.durationInline}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="time-outline" size={12} color={colors.textSecondary} /></View>
                <Text style={[styles.durationInlineLabel, {color: colors.textSecondary}]}>{t('duration')}</Text>
              </View>
              <Text style={[styles.durationInlineValue, {color: colors.primary}]}>
                {formatDuration(endDate.getTime() - startDate.getTime())}
              </Text>
            </View>
            <View style={styles.durationChipRow}>
              {DURATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.minutes}
                  style={[
                    styles.durationChipSmall,
                    option.minutes === -1
                      ? {backgroundColor: colors.inputBackground}
                      : {backgroundColor: colors.primary},
                  ]}
                  onPress={() => {
                    if (option.minutes === -1) {
                      const durationMs = endDate.getTime() - startDate.getTime();
                      const durationEnd = new Date(startDate.getTime() + Math.max(durationMs, 5 * 60 * 1000));
                      setTempDate(durationEnd);
                      setShowEndTimePicker(true);
                    } else {
                      handleSetDuration(option.minutes);
                    }
                  }}>
                  <Text style={[
                    styles.durationChipSmallText,
                    {color: option.minutes === -1 ? colors.textSecondary : '#fff'},
                  ]}>{t(option.label)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {isWorkColor(selectedColor) && (
            <View style={[styles.colorSection, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6}}>
                <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="cash-outline" size={12} color={colors.textSecondary} /></View>
                <Text style={{fontSize: 12, color: colors.textSecondary, fontWeight: '500'}}>{t('payrollLabel')}</Text>
              </View>

              {/* Job picker: manual wage, each job, or add a job */}
              <View style={styles.durationChipRow}>
                <TouchableOpacity
                  style={[styles.durationChipSmall, {backgroundColor: selectedJobId === null ? colors.primary : colors.inputBackground}]}
                  onPress={() => setSelectedJobId(null)}>
                  <Text style={[styles.durationChipSmallText, {color: selectedJobId === null ? '#fff' : colors.textSecondary}]}>{t('manualWage')}</Text>
                </TouchableOpacity>
                {jobs.map(j => (
                  <TouchableOpacity
                    key={j.id}
                    style={[styles.durationChipSmall, {backgroundColor: selectedJobId === j.id ? j.color : colors.inputBackground}]}
                    onPress={() => setSelectedJobId(j.id)}>
                    <Text style={[styles.durationChipSmallText, {color: selectedJobId === j.id ? '#fff' : colors.textSecondary}]} numberOfLines={1}>{j.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.durationChipSmall, {flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.inputBackground}]}
                  onPress={() => setShowJobsManager(true)}>
                  <Ionicons name="add" size={13} color={colors.textSecondary} />
                  <Text style={[styles.durationChipSmallText, {color: colors.textSecondary}]}>{t('addJob')}</Text>
                </TouchableOpacity>
              </View>

              {selectedJobId === null ? (
                <>
                  <View style={[styles.wageInputRow, {marginTop: 10}]}>
                    <Text style={[styles.wageCurrency, {color: colors.textSecondary}]}>{t('currencySymbol')}</Text>
                    <TextInput
                      style={[styles.wageInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                      value={hourlyWage}
                      onChangeText={(text) => {
                        const cleaned = text.replace(/[^0-9.]/g, '');
                        setHourlyWage(cleaned);
                        if (recentWages.length > 0) {
                          const filtered = cleaned.length > 0
                            ? recentWages.filter(w => String(w).includes(cleaned) && String(w) !== cleaned)
                            : recentWages;
                          setWageSuggestions(filtered.slice(0, 5));
                          setShowWageSuggestions(filtered.length > 0);
                        } else {
                          setShowWageSuggestions(false);
                        }
                      }}
                      onFocus={() => {
                        if (recentWages.length > 0) {
                          const filtered = hourlyWage.length > 0
                            ? recentWages.filter(w => String(w).includes(hourlyWage) && String(w) !== hourlyWage)
                            : recentWages;
                          setWageSuggestions(filtered.slice(0, 5));
                          setShowWageSuggestions(filtered.length > 0);
                        }
                      }}
                      onBlur={() => {
                        setTimeout(() => setShowWageSuggestions(false), 200);
                      }}
                      keyboardType="numeric"
                      placeholder={t('hourlyWagePlaceholder')}
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="done"
                    />
                  </View>
                  {showWageSuggestions && wageSuggestions.length > 0 && (
                    <View style={[styles.suggestionsContainer, {backgroundColor: colors.inputBackground, marginTop: 8}]}>
                      {wageSuggestions.map((w, i) => (
                        <TouchableOpacity
                          key={`wage-${w}`}
                          style={[styles.suggestionItem, i > 0 && {borderTopWidth: 1, borderTopColor: colors.borderLight}]}
                          onPress={() => {
                            setHourlyWage(String(w));
                            setShowWageSuggestions(false);
                          }}
                          onLongPress={() => {
                            removeRecentWage(w);
                            setRecentWages(prev => prev.filter(x => x !== w));
                            setWageSuggestions(prev => prev.filter(x => x !== w));
                          }}>
                          <Text style={[styles.suggestionText, {color: colors.text}]} numberOfLines={1}>
                            {t('currencySymbol')}{w.toLocaleString()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              ) : payPreview ? (
                <View style={[styles.payPreview, {borderTopColor: colors.borderLight}]}>
                  <View style={styles.payPreviewRow}>
                    <Text style={[styles.payPreviewLabel, {color: colors.textSecondary}]}>{t('estimatedPay')}</Text>
                    <Text style={[styles.payPreviewTotal, {color: colors.primary}]}>{t('currencySymbol')}{Math.round(payPreview.total).toLocaleString()}</Text>
                  </View>
                  <Text style={[styles.payPreviewSub, {color: colors.textTertiary}]} numberOfLines={2}>
                    {t('base')} {t('currencySymbol')}{Math.round(payPreview.base).toLocaleString()}
                    {payPreview.nightPremium > 0 ? `  ・${t('nightPremiumShort')} +${t('currencySymbol')}${Math.round(payPreview.nightPremium).toLocaleString()}` : ''}
                    {payPreview.overtimePremium > 0 ? `  ・${t('overtimeShort')} +${t('currencySymbol')}${Math.round(payPreview.overtimePremium).toLocaleString()}` : ''}
                    {payPreview.holidayPremium > 0 ? `  ・${t('holidayShort')} +${t('currencySymbol')}${Math.round(payPreview.holidayPremium).toLocaleString()}` : ''}
                    {payPreview.transport > 0 ? `  ・${t('transportShort')} +${t('currencySymbol')}${Math.round(payPreview.transport).toLocaleString()}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          <View style={[styles.reminderSection, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
            {/* Reminder is always visible — it's the trigger for notifications. */}
            <View style={styles.optionRow}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="notifications-outline" size={12} color={colors.textSecondary} /></View>
                <Text style={[styles.optionRowLabel, {color: colors.textSecondary}]}>{t('reminder')}</Text>
              </View>
              <View style={styles.optionRowChips}>
                {REMINDER_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.reminderButton,
                      {backgroundColor: colors.inputBackground},
                      reminder === option.value && [styles.reminderButtonSelected, {backgroundColor: colors.primary}],
                    ]}
                    onPress={() => setReminder(option.value)}>
                    <Text style={[
                      styles.reminderButtonText,
                      {color: colors.text},
                      reminder === option.value && styles.reminderButtonTextSelected,
                    ]}>
                      {t(option.label)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Repeat is always shown. */}
            <View style={[styles.optionRow, {marginTop: 12}]}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <View style={[styles.titleIconBox, {borderColor: colors.border, backgroundColor: colors.surfaceSecondary}]}><Ionicons name="repeat-outline" size={12} color={colors.textSecondary} /></View>
                <Text style={[styles.optionRowLabel, {color: colors.textSecondary}]}>{t('repeat')}</Text>
              </View>
              <View style={styles.optionRowChips}>
                {([{label: 'repeatNone', value: 'none'}, {label: 'repeatDaily', value: 'daily'}, {label: 'repeatWeekly', value: 'weekly'}, {label: 'repeatMonthly', value: 'monthly'}] as const).map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.reminderButton,
                      {backgroundColor: colors.inputBackground},
                      recurrence === option.value && [styles.reminderButtonSelected, {backgroundColor: colors.primary}],
                    ]}
                    onPress={() => setRecurrence(option.value)}>
                    <Text style={[
                      styles.reminderButtonText,
                      {color: colors.text},
                      recurrence === option.value && styles.reminderButtonTextSelected,
                    ]}>
                      {t(option.label)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {!isEditing && !isCopying && (
            <TouchableOpacity
              style={styles.templateSaveLink}
              onPress={async () => {
                const durationMs = endDate.getTime() - startDate.getTime();
                const durationMinutes = Math.round(durationMs / (1000 * 60));
                await addTemplate({
                  title: title.trim() || t('noTitle'),
                  durationMinutes: Math.max(durationMinutes, 30),
                  color: selectedColor,
                  reminder,
                });
                Alert.alert(t('saved'), t('templateSaved'));
              }}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <Ionicons name="bookmark-outline" size={14} color={colors.primary} />
                <Text style={[styles.templateSaveLinkText, {color: colors.primary}]}>{t('saveAsTemplate')}</Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.bottomButtonsRow}>
            <TouchableOpacity
              style={[styles.copyButtonBottom, {borderColor: colors.primary}]}
              onPress={handleShowCopyCalendar}>
              <Text style={[styles.copyButtonBottomText, {color: colors.primary}]}>{t('copy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButtonBottom, {backgroundColor: colors.primary}]}
              onPress={handleSave}>
              <Text style={styles.saveButtonBottomText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>

          {isEditing && editingEvent?.id && (
            <TouchableOpacity
              style={[styles.deleteButtonBottom, {backgroundColor: colors.surface}]}
              onPress={() => {
                Alert.alert(
                  t('deleteEvent'),
                  t('deleteEventConfirm', {title: title || editingEvent.title}),
                  [
                    {text: t('cancel'), style: 'cancel'},
                    {
                      text: t('delete'),
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await RNCalendarEvents.removeEvent(editingEvent.id!);
                          handleClose();
                          onDeleted?.();
                        } catch {
                          Alert.alert(t('error'), t('deleteFailed'));
                        }
                      },
                    },
                  ],
                );
              }}>
              <Text style={[styles.deleteButtonBottomText, {color: colors.delete}]}>{t('deleteThisEvent')}</Text>
            </TouchableOpacity>
          )}

        </ScrollView>

        {/* Copy Calendar Modal */}
        <Modal
          visible={showCopyCalendar}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCopyCalendar(false)}>
          <View style={[styles.copyModalOverlay, {backgroundColor: colors.overlay}]}>
            <View style={[styles.copyModalContent, {backgroundColor: colors.surface}]}>
              <View style={styles.copyModalHeader}>
                <TouchableOpacity onPress={() => setShowCopyCalendar(false)}>
                  <Text style={[styles.copyModalCancel, {color: colors.textTertiary}]}>{t('cancel')}</Text>
                </TouchableOpacity>
                <Text style={[styles.copyModalTitle, {color: colors.text}]}>{t('selectCopyTarget')}</Text>
                <TouchableOpacity
                  onPress={handleCopyToSelectedDates}
                  disabled={selectedCopyDates.length === 0}>
                  <Text style={[
                    styles.copyModalDone,
                    {color: colors.primary},
                    selectedCopyDates.length === 0 && styles.copyModalDoneDisabled,
                  ]}>
                    {selectedCopyDates.length > 0 ? t('copyCount', {count: selectedCopyDates.length}) : t('copy')}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.copyCalendarNav}>
                <TouchableOpacity onPress={goToCopyPrevMonth} style={styles.copyCalendarNavBtn}>
                  <Text style={[styles.copyCalendarNavText, {color: colors.primary}]}>{'<'}</Text>
                </TouchableOpacity>
                <Text style={[styles.copyCalendarMonth, {color: colors.text}]}>
                  {t('yearMonthFormat', {year: copyCalendarDate.getFullYear(), month: (t('monthNames', {returnObjects: true}) as string[])[copyCalendarDate.getMonth()]})}
                </Text>
                <TouchableOpacity onPress={goToCopyNextMonth} style={styles.copyCalendarNavBtn}>
                  <Text style={[styles.copyCalendarNavText, {color: colors.primary}]}>{'>'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.copyCalendarWeekdays}>
                {WEEKDAYS.map((day: string, index: number) => (
                  <Text
                    key={day}
                    style={[
                      styles.copyCalendarWeekday,
                      {color: colors.textSecondary},
                      index === 0 && styles.copySundayText,
                      index === 6 && styles.copySaturdayText,
                    ]}>
                    {day}
                  </Text>
                ))}
              </View>

              <View style={styles.copyCalendarGrid}>
                {copyCalendarDays.map((item, index) => {
                  const isToday = item.date.toDateString() === new Date().toDateString();
                  const isSelected = selectedCopyDates.some(d => d.toDateString() === item.date.toDateString());
                  const isOrigin = item.date.toDateString() === startDate.toDateString();
                  const isBusy = busyCopyDates.has(item.date.toDateString()) && !isOrigin;
                  return (
                    <TouchableOpacity
                      key={`${item.date.toISOString()}-${index}`}
                      style={[
                        styles.copyCalendarDay,
                        isBusy && !isSelected && {backgroundColor: colors.border, opacity: 0.5},
                        isToday && !isBusy && [styles.copyCalendarToday, {backgroundColor: colors.today}],
                        isOrigin && [styles.copyCalendarSelected, {backgroundColor: colors.primary, opacity: 0.6}],
                        isSelected && !isOrigin && [styles.copyCalendarSelected, {backgroundColor: colors.primary}],
                      ]}
                      onPress={() => toggleCopyDateSelection(item.date)}>
                      <Text
                        style={[
                          styles.copyCalendarDayText,
                          {color: colors.text},
                          !item.isCurrentMonth && [styles.copyCalendarOtherMonth, {color: colors.textTertiary}],
                          isToday && !isSelected && !isOrigin && [styles.copyCalendarTodayText, {color: colors.primary}],
                          (isSelected || isOrigin) && styles.copyCalendarSelectedText,
                          index % 7 === 0 && item.isCurrentMonth && !isSelected && !isOrigin && styles.copySundayText,
                          index % 7 === 6 && item.isCurrentMonth && !isSelected && !isOrigin && styles.copySaturdayText,
                        ]}>
                        {item.day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </Modal>

        {/* Label Edit Modal */}
        <Modal
          visible={editingLabelColor !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingLabelColor(null)}>
          <KeyboardAvoidingView
            style={[styles.labelModalOverlay, {backgroundColor: colors.overlay}]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={[styles.labelModalContent, {backgroundColor: colors.surface}]}>
              <Text style={[styles.labelModalTitle, {color: colors.text}]}>{t('editLabel')}</Text>
              <View style={[styles.labelColorPreview, {backgroundColor: editingLabelColor || '#007AFF'}]} />
              <TextInput
                style={[styles.labelInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                value={editingLabelText}
                onChangeText={setEditingLabelText}
                placeholder={t('labelName')}
                placeholderTextColor={colors.textTertiary}
                autoFocus
                maxLength={10}
              />
              <View style={styles.labelModalButtons}>
                <TouchableOpacity
                  style={styles.labelModalCancel}
                  onPress={() => setEditingLabelColor(null)}>
                  <Text style={[styles.labelModalCancelText, {color: colors.textTertiary}]}>{t('cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.labelModalSave, {backgroundColor: colors.primary}]}
                  onPress={handleLabelSave}>
                  <Text style={styles.labelModalSaveText}>{t('save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Add Color Modal */}
        <Modal
          visible={showAddColor}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAddColor(false)}>
          <View style={[styles.labelModalOverlay, {backgroundColor: colors.overlay}]}>
            <View style={[styles.labelModalContent, {backgroundColor: colors.surface}]}>
              <Text style={[styles.labelModalTitle, {color: colors.text}]}>{t('addColor')}</Text>
              <View style={styles.addColorList}>
                {availableColorsToAdd.map(colorOption => (
                  <TouchableOpacity
                    key={colorOption.name}
                    style={[styles.addColorItem, {borderBottomColor: colors.border}]}
                    onPress={() => handleAddColor(colorOption)}>
                    <View style={[styles.addColorPreview, {backgroundColor: colorOption.color}]} />
                    <Text style={[styles.addColorLabel, {color: colors.text}]}>{t(colorOption.label, {defaultValue: colorOption.label})}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.labelModalCancel}
                onPress={() => setShowAddColor(false)}>
                <Text style={[styles.labelModalCancelText, {color: colors.textTertiary}]}>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {showStartDatePicker && (
          <View style={[styles.pickerContainer, {backgroundColor: colors.surface, borderTopColor: colors.border}]}>
            <View style={[styles.pickerHeader, {borderBottomColor: colors.border}]}>
              <TouchableOpacity onPress={() => setShowStartDatePicker(false)}>
                <Text style={[styles.pickerCancelText, {color: colors.textTertiary}]}>{t('cancel')}</Text>
              </TouchableOpacity>
              <Text style={[styles.pickerTitle, {color: colors.text}]}>{t('startDate')}</Text>
              <TouchableOpacity onPress={confirmStartDate}>
                <Text style={[styles.pickerOkText, {color: colors.primary}]}>OK</Text>
              </TouchableOpacity>
            </View>
            <MonthDayPicker
              value={tempDate}
              onChange={(date) => setTempDate(date)}
              t={t}
            />
          </View>
        )}
        {showStartTimePicker && (
          <View style={[styles.pickerContainer, {backgroundColor: colors.surface, borderTopColor: colors.border}]}>
            <View style={[styles.pickerHeader, {borderBottomColor: colors.border}]}>
              <TouchableOpacity onPress={() => setShowStartTimePicker(false)}>
                <Text style={[styles.pickerCancelText, {color: colors.textTertiary}]}>{t('cancel')}</Text>
              </TouchableOpacity>
              <Text style={[styles.pickerTitle, {color: colors.text}]}>{t('startTime')}</Text>
              <TouchableOpacity onPress={confirmStartTime}>
                <Text style={[styles.pickerOkText, {color: colors.primary}]}>OK</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="time"
              display="spinner"
              onChange={onTempDateChange}
              minuteInterval={5}
            />
          </View>
        )}
        {showEndDatePicker && (
          <View style={[styles.pickerContainer, {backgroundColor: colors.surface, borderTopColor: colors.border}]}>
            <View style={[styles.pickerHeader, {borderBottomColor: colors.border}]}>
              <TouchableOpacity onPress={() => setShowEndDatePicker(false)}>
                <Text style={[styles.pickerCancelText, {color: colors.textTertiary}]}>{t('cancel')}</Text>
              </TouchableOpacity>
              <Text style={[styles.pickerTitle, {color: colors.text}]}>{t('endDate')}</Text>
              <TouchableOpacity onPress={confirmEndDate}>
                <Text style={[styles.pickerOkText, {color: colors.primary}]}>OK</Text>
              </TouchableOpacity>
            </View>
            <MonthDayPicker
              value={tempDate}
              onChange={(date) => setTempDate(date)}
              t={t}
            />
          </View>
        )}
        {showEndTimePicker && (
          <View style={[styles.pickerContainer, {backgroundColor: colors.surface, borderTopColor: colors.border}]}>
            <View style={[styles.pickerHeader, {borderBottomColor: colors.border}]}>
              <TouchableOpacity onPress={() => setShowEndTimePicker(false)}>
                <Text style={[styles.pickerCancelText, {color: colors.textTertiary}]}>{t('cancel')}</Text>
              </TouchableOpacity>
              <Text style={[styles.pickerTitle, {color: colors.text}]}>{t('endTime')}</Text>
              <TouchableOpacity onPress={confirmEndTime}>
                <Text style={[styles.pickerOkText, {color: colors.primary}]}>OK</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="time"
              display="spinner"
              onChange={onTempDateChange}
              minuteInterval={5}
            />
          </View>
        )}
      </KeyboardAvoidingView>
      <JobsManagerModal
        visible={showJobsManager}
        onClose={() => { setShowJobsManager(false); getJobs().then(setJobs); }}
        onChange={() => getJobs().then(setJobs)}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  cancelButton: {
    fontSize: 17,
    color: '#007AFF',
  },
  saveButton: {
    fontSize: 17,
    color: '#007AFF',
    fontWeight: '600',
  },
  form: {
    flex: 1,
  },
  inputGroup: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  presetWrap: {
    marginBottom: 4,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 12,
    maxWidth: 180,
  },
  presetDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  titleIconBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 8,
    paddingHorizontal: 0,
    color: '#333',
  },
  titleClearButton: {
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Named color chips below the title — tap to pick the category (仕事/重要…),
  // long-press to remove, and a pencil on the selected chip renames it.
  colorChipScroll: {
    flexGrow: 0,
    marginTop: 8,
  },
  colorChipScrollContent: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  colorNameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  colorNameChipMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  colorNameChipDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
  colorNameChipText: {
    fontSize: 13,
  },
  addColorChip: {
    borderStyle: 'dashed',
    paddingHorizontal: 12,
  },
  titleClearButtonText: {
    fontSize: 20,
    color: '#999',
    fontWeight: '300',
  },
  suggestionsContainer: {
    borderRadius: 8,
    marginTop: 4,
    marginHorizontal: 4,
    marginBottom: 4,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestionText: {
    fontSize: 15,
  },
  titleColorDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  dateTimeSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  dtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dtLabeledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dtRowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 64,
  },
  dtRowLabelText: {
    fontSize: 12,
    fontWeight: '500',
  },
  dtRowValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dtCell: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  dtTimeCell: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 9,
    alignItems: 'center',
  },
  dtCellText: {
    fontSize: 15,
    fontWeight: '700',
  },
  dtCellTime: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  dtArrow: {
    fontSize: 18,
    fontWeight: '700',
  },
  durationInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 6,
  },
  durationInlineLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  durationInlineValue: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  durationChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  durationChipSmall: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 7,
  },
  durationChipSmallText: {
    fontSize: 13,
    fontWeight: '600',
  },
  colorSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wageInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wageCurrency: {
    fontSize: 16,
    fontWeight: '700',
  },
  wageInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  payPreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  payPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  payPreviewLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  payPreviewTotal: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  payPreviewSub: {
    fontSize: 11,
    marginTop: 4,
  },
  colorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  colorLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#007AFF',
  },
  colorButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 0,
  },
  colorButtonsInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 8,
    columnGap: 14,
  },
  colorChipInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  colorChipLabel: {
    fontSize: 13,
  },
  colorButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorButtonSelected: {
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  colorButtonCheck: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  colorButtonWrapper: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  colorButtonLabel: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
  colorButtonLabelSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  addColorButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  addColorButtonText: {
    fontSize: 18,
    color: '#999',
    fontWeight: '300',
  },
  labelModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: 280,
    alignItems: 'center',
  },
  labelModalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  labelColorPreview: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginBottom: 16,
  },
  labelInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  labelModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  labelModalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  labelModalCancelText: {
    fontSize: 16,
    color: '#999',
  },
  labelModalSave: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  labelModalSaveText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  addColorList: {
    width: '100%',
    marginBottom: 16,
  },
  addColorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  addColorPreview: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  addColorLabel: {
    fontSize: 16,
    color: '#333',
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reminderSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionRow: {
    gap: 8,
  },
  optionRowLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  optionRowChips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reminderButtons: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    marginTop: 10,
  },
  reminderButton: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 7,
    backgroundColor: '#f0f0f0',
  },
  reminderButtonSelected: {
    backgroundColor: '#007AFF',
  },
  reminderButtonText: {
    fontSize: 13,
    color: '#333',
  },
  reminderButtonTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  templateSaveLink: {
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 8,
  },
  templateSaveLinkText: {
    fontSize: 13,
    fontWeight: '500',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  copyButtonBottom: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  copyButtonBottomText: {
    fontSize: 15,
    fontWeight: '600',
  },
  saveButtonBottom: {
    flex: 2,
    backgroundColor: '#007AFF',
    borderRadius: 9,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveButtonBottomText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  deleteButtonBottom: {
    borderRadius: 9,
    paddingVertical: 11,
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 24,
  },
  deleteButtonBottomText: {
    fontSize: 17,
  },
  copyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  copyModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: SCREEN_WIDTH - 40,
    padding: 16,
  },
  copyModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  copyModalCancel: {
    fontSize: 16,
    color: '#999',
  },
  copyModalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  copyModalDone: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  copyModalDoneDisabled: {
    color: '#ccc',
  },
  copyCalendarNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  copyCalendarNavBtn: {
    padding: 8,
  },
  copyCalendarNavText: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: '600',
  },
  copyCalendarMonth: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  copyCalendarWeekdays: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  copyCalendarWeekday: {
    width: COPY_CALENDAR_DAY_WIDTH,
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  copyCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  copyCalendarDay: {
    width: COPY_CALENDAR_DAY_WIDTH,
    height: COPY_CALENDAR_DAY_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: COPY_CALENDAR_DAY_WIDTH / 2,
  },
  copyCalendarDayText: {
    fontSize: 16,
    color: '#333',
  },
  copyCalendarOtherMonth: {
    color: '#ccc',
  },
  copyCalendarToday: {
    backgroundColor: '#E8F4FD',
  },
  copyCalendarTodayText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  copyCalendarSelected: {
    backgroundColor: '#007AFF',
  },
  copyCalendarSelectedText: {
    color: '#fff',
    fontWeight: '600',
  },
  copySundayText: {
    color: '#FF3B30',
  },
  copySaturdayText: {
    color: '#007AFF',
  },
  pickerContainer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  pickerCancelText: {
    fontSize: 16,
    color: '#999',
  },
  pickerOkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  // Custom Month-Day Picker styles
  monthDayPickerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    height: PICKER_HEIGHT,
    backgroundColor: '#fff',
  },
  monthDayPickerColumn: {
    width: 100,
    height: PICKER_HEIGHT,
    overflow: 'hidden',
  },
  monthDayPickerScrollContent: {
    alignItems: 'center',
  },
  monthDayPickerItem: {
    height: PICKER_ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthDayPickerItemText: {
    fontSize: 22,
    color: '#999',
  },
  monthDayPickerItemTextSelected: {
    fontSize: 24,
    color: '#000',
    fontWeight: '600',
  },
  monthDayPickerHighlight: {
    position: 'absolute',
    top: PICKER_ITEM_HEIGHT * 2,
    left: 20,
    right: 20,
    height: PICKER_ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#ddd',
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
  },
});

export default memo(AddEventModal);
