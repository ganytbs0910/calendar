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
import {useTranslation} from 'react-i18next';

// Default color options for events with labels (keys for i18n)
const DEFAULT_EVENT_COLORS = [
  {name: 'blue', color: '#007AFF', label: 'colorWork'},
  {name: 'red', color: '#FF3B30', label: 'colorImportant'},
  {name: 'green', color: '#34C759', label: 'colorFun'},
  {name: 'yellow', color: '#FFCC00', label: 'colorOther'},
];

// Additional colors that can be added (keys for i18n)
const ADDITIONAL_COLORS = [
  {name: 'orange', color: '#FF9500', label: 'colorPromise'},
  {name: 'purple', color: '#AF52DE', label: 'colorHobby'},
  {name: 'pink', color: '#FF2D92', label: 'colorSchedule'},
];

const COLOR_SETTINGS_KEY = '@color_settings';

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

export const setEventColor = async (eventId: string, color: string): Promise<void> => {
  try {
    const colorsJson = await AsyncStorage.getItem(EVENT_COLOR_STORAGE_KEY);
    const colors = colorsJson ? JSON.parse(colorsJson) : {};
    colors[eventId] = color;
    await AsyncStorage.setItem(EVENT_COLOR_STORAGE_KEY, JSON.stringify(colors));
  } catch (error) {
    console.error('Error saving event color:', error);
  }
};

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
  {label: 'duration15min', minutes: 15},
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
  const [colorOptions, setColorOptions] = useState<ColorOption[]>(DEFAULT_EVENT_COLORS);
  const [editingLabelColor, setEditingLabelColor] = useState<string | null>(null);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [showAddColor, setShowAddColor] = useState(false);
  const [reminder, setReminder] = useState<number | null>(null);
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
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
        } else {
          setSelectedColor(DEFAULT_EVENT_COLORS[0].color);
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
        setTitle('');
        setReminder(null);
        setSelectedColor(initialColor || DEFAULT_EVENT_COLORS[0].color);
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
        setTitle('');
        setReminder(null);
        setSelectedColor(initialColor || DEFAULT_EVENT_COLORS[0].color);
      }
    }
  }, [visible, initialDate, initialEndDate, editingEvent, initialColor]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    // Check and request permission before saving
    const permissionStatus = await RNCalendarEvents.checkPermissions();

    if (permissionStatus !== 'authorized' && permissionStatus !== 'fullAccess') {
      const requestedStatus = await RNCalendarEvents.requestPermissions();
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

    // Auto-fix: ensure minimum 5 minutes duration
    const minDuration = 5 * 60 * 1000;
    if (finalEndDate.getTime() - startDate.getTime() < minDuration) {
      finalEndDate = new Date(startDate.getTime() + minDuration);
    }

    try {
      if (isEditing && editingEvent?.id) {
        // Update existing event
        await RNCalendarEvents.saveEvent(title.trim() || t('noTitle'), {
          id: editingEvent.id,
          startDate: startDate.toISOString(),
          endDate: finalEndDate.toISOString(),
          allDay: false,
          alarms: reminder !== null ? [{date: reminder}] : [],
        });
        // Save custom color
        await setEventColor(editingEvent.id, selectedColor);
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
          alarms: reminder !== null ? [{date: reminder}] : [],
        };
        if (recurrence !== 'none') {
          eventConfig.recurrenceRule = {
            frequency: recurrence,
            occurrence: recurrence === 'monthly' ? 60 : 260, // ~5 years
          };
        }
        const eventId = await RNCalendarEvents.saveEvent(title.trim() || t('noTitle'), eventConfig);
        if (eventId) {
          await setEventColor(eventId, selectedColor);
        }
      }

      handleClose();
      onEventAdded();
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert(t('error'), isEditing ? t('updateFailed') : t('saveFailed'));
    }
  }, [title, startDate, endDate, handleClose, onEventAdded, isEditing, editingEvent, selectedColor, reminder]);

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

      for (const targetDate of copyTargets) {
        const newStart = new Date(targetDate);
        newStart.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
        const newEnd = new Date(newStart.getTime() + durationMs);

        const eventId = await RNCalendarEvents.saveEvent(title.trim() || t('noTitle'), {
          calendarId: defaultCalendar.id,
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          allDay: false,
          alarms: reminder !== null ? [{date: reminder}] : [],
        });
        // Save custom color for copied event
        if (eventId) {
          await setEventColor(eventId, selectedColor);
        }
      }

      setShowCopyCalendar(false);
      setSelectedCopyDates([]);
      Alert.alert(t('done'), t('copyCompleted', {count: copyTargets.length}));
      onEventAdded();
    } catch (error) {
      console.error('Error copying event:', error);
      Alert.alert(t('error'), t('copyFailed'));
    }
  }, [title, startDate, endDate, selectedCopyDates, onEventAdded]);

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
          <View style={[styles.inputGroup, {backgroundColor: colors.surface}]}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8}}>
              <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
              <Text style={{fontSize: 12, color: colors.textSecondary, fontWeight: '500'}}>{t('eventTitle')}</Text>
            </View>
            <View style={styles.titleInputContainer}>
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
          </View>

          <View style={[styles.dateTimeSection, {backgroundColor: colors.surface}]}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8}}>
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={{fontSize: 12, color: colors.textSecondary, fontWeight: '500'}}>{t('dateTime')}</Text>
            </View>
            <View style={styles.dtRow}>
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
              <Text style={[styles.dtArrow, {color: colors.textTertiary}]}>→</Text>
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
            </View>
            <View style={styles.dtRow}>
              <TouchableOpacity
                style={[styles.dtCell, {backgroundColor: colors.today}]}
                onPress={() => {
                  setShowStartDatePicker(false);
                  setShowEndDatePicker(false);
                  setShowEndTimePicker(false);
                  setTempDate(new Date(startDate));
                  setShowStartTimePicker(true);
                }}>
                <Text style={[styles.dtCellTime, {color: colors.primary}]}>{formatTime(startDate)}</Text>
              </TouchableOpacity>
              <Text style={[styles.dtArrow, {color: colors.textTertiary}]}>→</Text>
              <TouchableOpacity
                style={[styles.dtCell, {backgroundColor: colors.inputBackground}]}
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
            <View style={styles.durationInline}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
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

          <View style={[styles.colorSection, {backgroundColor: colors.surface}]}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8}}>
              <Ionicons name="color-fill-outline" size={14} color={colors.textSecondary} />
              <Text style={{fontSize: 12, color: colors.textSecondary, fontWeight: '500'}}>{t('eventColor')}</Text>
            </View>
            <View style={styles.colorButtons}>
              {colorOptions.map((colorOption) => (
                <View key={colorOption.name} style={styles.colorButtonWrapper}>
                  <TouchableOpacity
                    style={[
                      styles.colorButton,
                      {backgroundColor: colorOption.color},
                      selectedColor === colorOption.color && styles.colorButtonSelected,
                    ]}
                    onPress={() => setSelectedColor(colorOption.color)}
                    onLongPress={() => handleRemoveColor(colorOption.color)}>
                    {selectedColor === colorOption.color && (
                      <Text style={styles.colorButtonCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleLabelPress(colorOption.color)}>
                    <Text
                      style={[
                        styles.colorButtonLabel,
                        {color: colors.textSecondary},
                        selectedColor === colorOption.color && [styles.colorButtonLabelSelected, {color: colors.primary}],
                      ]}
                      numberOfLines={1}>
                      {t(colorOption.label, {defaultValue: colorOption.label})}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
              {availableColorsToAdd.length > 0 && isPremium && (
                <View style={styles.colorButtonWrapper}>
                  <TouchableOpacity
                    style={[styles.addColorButton, {backgroundColor: colors.inputBackground, borderColor: colors.border}]}
                    onPress={() => setShowAddColor(true)}>
                    <Text style={[styles.addColorButtonText, {color: colors.textTertiary}]}>+</Text>
                  </TouchableOpacity>
                  <Text style={[styles.colorButtonLabel, {color: colors.textSecondary}]}> </Text>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.reminderSection, {backgroundColor: colors.surface}]}>
            <View style={styles.optionRow}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <Ionicons name="notifications-outline" size={14} color={colors.textSecondary} />
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
            <View style={[styles.optionRow, {marginTop: 8}]}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                <Ionicons name="repeat-outline" size={14} color={colors.textSecondary} />
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
                  durationMinutes: Math.max(durationMinutes, 5),
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
    padding: 14,
  },
  inputGroup: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  titleInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 8,
    paddingHorizontal: 0,
    color: '#333',
  },
  titleClearButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
  dateTimeSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
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
  dtCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  dtCellText: {
    fontSize: 15,
    fontWeight: '700',
  },
  dtCellTime: {
    fontSize: 22,
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
    marginTop: 10,
    marginBottom: 8,
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
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
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
  colorButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorButtonSelected: {
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  colorButtonCheck: {
    color: '#fff',
    fontSize: 18,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  addColorButtonText: {
    fontSize: 22,
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
  reminderSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
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
    marginBottom: 12,
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
