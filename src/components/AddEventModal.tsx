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
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Default color options for events with labels
const DEFAULT_EVENT_COLORS = [
  {name: 'blue', color: '#007AFF', label: '仕事'},
  {name: 'red', color: '#FF3B30', label: '大事'},
  {name: 'green', color: '#34C759', label: '遊び'},
  {name: 'yellow', color: '#FFCC00', label: 'その他'},
];

// Additional colors that can be added
const ADDITIONAL_COLORS = [
  {name: 'orange', color: '#FF9500', label: '約束'},
  {name: 'purple', color: '#AF52DE', label: '趣味'},
  {name: 'pink', color: '#FF2D92', label: '予定'},
];

const COLOR_SETTINGS_KEY = '@color_settings';

// Reminder options (negative minutes before event)
const REMINDER_OPTIONS = [
  {label: 'なし', value: null},
  {label: '5分', value: -5},
  {label: '10分', value: -10},
  {label: '30分', value: -30},
  {label: '1時間', value: -60},
  {label: '1日', value: -1440},
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
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// Custom Month-Day Picker Constants
const PICKER_ITEM_HEIGHT = 40;
const PICKER_VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = PICKER_ITEM_HEIGHT * PICKER_VISIBLE_ITEMS;

// Custom Month-Day Picker Component
interface MonthDayPickerProps {
  value: Date;
  onChange: (date: Date) => void;
}

const MonthDayPicker: React.FC<MonthDayPickerProps> = memo(({value, onChange}) => {
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
          {renderPickerItems(months, (m) => `${m + 1}月`, selectedMonth)}
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
          {renderPickerItems(days, (d) => `${d}日`, selectedDay - 1)}
        </ScrollView>
      </View>
      <View style={styles.monthDayPickerHighlight} pointerEvents="none" />
    </View>
  );
});

// Duration options
const DURATION_OPTIONS = [
  {label: '-1時間', minutes: -60},
  {label: '-30分', minutes: -30},
  {label: '-5分', minutes: -5},
  {label: '+5分', minutes: 5},
  {label: '+30分', minutes: 30},
  {label: '+1時間', minutes: 60},
  {label: '+3時間', minutes: 180},
  {label: '+1日', minutes: 24 * 60},
];


interface AddEventModalProps {
  visible: boolean;
  onClose: () => void;
  onEventAdded: () => void;
  initialDate?: Date;
  initialEndDate?: Date;
  editingEvent?: CalendarEventReadable | null;
}

export const AddEventModal: React.FC<AddEventModalProps> = ({
  visible,
  onClose,
  onEventAdded,
  initialDate,
  initialEndDate,
  editingEvent,
}) => {
  const isEditing = !!(editingEvent?.id);
  const isCopying = !!(editingEvent && !editingEvent.id);
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
  const [selectedColor, setSelectedColor] = useState<string>(DEFAULT_EVENT_COLORS[0].color);
  const [colorOptions, setColorOptions] = useState<ColorOption[]>(DEFAULT_EVENT_COLORS);
  const [editingLabelColor, setEditingLabelColor] = useState<string | null>(null);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [showAddColor, setShowAddColor] = useState(false);
  const [reminder, setReminder] = useState<number | null>(null);

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
        const start = new Date(initialDate);
        if (!initialEndDate) {
          start.setMinutes(0);
          start.setSeconds(0);
        }
        setStartDate(start);

        if (initialEndDate) {
          setEndDate(new Date(initialEndDate));
        } else {
          const end = new Date(start);
          end.setHours(end.getHours() + 1);
          setEndDate(end);
        }
        setTitle('');
        setReminder(null);
        setSelectedColor(DEFAULT_EVENT_COLORS[0].color);
      } else {
        const now = new Date();
        now.setMinutes(0);
        now.setSeconds(0);
        setStartDate(now);
        const end = new Date(now);
        end.setHours(end.getHours() + 1);
        setEndDate(end);
        setTitle('');
        setReminder(null);
        setSelectedColor(DEFAULT_EVENT_COLORS[0].color);
      }
    }
  }, [visible, initialDate, initialEndDate, editingEvent]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    console.log('handleSave called', {startDate, endDate, title});

    // Check and request permission before saving
    const permissionStatus = await RNCalendarEvents.checkPermissions();
    console.log('Current permission status:', permissionStatus);

    if (permissionStatus !== 'authorized' && permissionStatus !== 'fullAccess') {
      const requestedStatus = await RNCalendarEvents.requestPermissions();
      console.log('Requested permission status:', requestedStatus);

      if (requestedStatus !== 'authorized' && requestedStatus !== 'fullAccess') {
        Alert.alert(
          'カレンダーへのアクセス',
          'カレンダーに予定を保存するには、設定でフルアクセスを許可してください。',
          [
            {text: 'キャンセル', style: 'cancel'},
            {text: '設定を開く', onPress: () => Linking.openSettings()},
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
        await RNCalendarEvents.saveEvent(title.trim() || '(タイトルなし)', {
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
        console.log('Found calendars:', calendars.map(c => ({
          title: c.title,
          allowsModifications: c.allowsModifications,
          isPrimary: c.isPrimary,
          type: c.type,
        })));

        // Only select calendars that allow modifications
        const writableCalendars = calendars.filter(cal => cal.allowsModifications);
        if (writableCalendars.length === 0) {
          Alert.alert('エラー', '書き込み可能なカレンダーが見つかりません');
          return;
        }

        // Prefer primary calendar if writable, otherwise use first writable calendar
        const defaultCalendar = writableCalendars.find(cal => cal.isPrimary) || writableCalendars[0];
        console.log('Using calendar:', defaultCalendar.title, 'allowsModifications:', defaultCalendar.allowsModifications);

        const eventId = await RNCalendarEvents.saveEvent(title.trim() || '(タイトルなし)', {
          calendarId: defaultCalendar.id,
          startDate: startDate.toISOString(),
          endDate: finalEndDate.toISOString(),
          allDay: false,
          alarms: reminder !== null ? [{date: reminder}] : [],
        });
        console.log('Event saved successfully with id:', eventId);
        // Save custom color for new event
        if (eventId) {
          await setEventColor(eventId, selectedColor);
        }
      }

      handleClose();
      onEventAdded();
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert('エラー', isEditing ? '予定の更新に失敗しました' : '予定の保存に失敗しました');
    }
  }, [title, startDate, endDate, handleClose, onEventAdded, isEditing, editingEvent, selectedColor, reminder]);

  const formatDate = (date: Date) => {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getMonth() + 1}/${date.getDate()}(${weekdays[date.getDay()]})`;
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
      return `${days / 7}週間`;
    } else if (days > 0 && hours === 0 && minutes === 0) {
      return `${days}日`;
    } else if (days > 0) {
      if (hours === 0 && minutes === 0) {
        return `${days}日`;
      } else if (minutes === 0) {
        return `${days}日${hours}時間`;
      } else {
        return `${days}日${hours}時間${minutes}分`;
      }
    } else if (hours === 0) {
      return `${minutes}分`;
    } else if (minutes === 0) {
      return `${hours}時間`;
    } else {
      return `${hours}時間${minutes}分`;
    }
  };

  const handleAddDuration = useCallback((minutes: number) => {
    const newEnd = new Date(endDate);
    newEnd.setMinutes(newEnd.getMinutes() + minutes);
    setEndDate(newEnd);
  }, [endDate]);

  // Copy to other dates functionality
  const handleShowCopyCalendar = useCallback(() => {
    setCopyCalendarDate(new Date());
    setSelectedCopyDates([]);
    setShowCopyCalendar(true);
  }, []);

  const toggleCopyDateSelection = useCallback((targetDate: Date) => {
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
    if (selectedCopyDates.length === 0) return;

    const durationMs = endDate.getTime() - startDate.getTime();

    try {
      const calendars = await RNCalendarEvents.findCalendars();
      const writableCalendars = calendars.filter(cal => cal.allowsModifications);
      if (writableCalendars.length === 0) {
        Alert.alert('エラー', '書き込み可能なカレンダーが見つかりません');
        return;
      }
      const defaultCalendar = writableCalendars.find(cal => cal.isPrimary) || writableCalendars[0];

      for (const targetDate of selectedCopyDates) {
        const newStart = new Date(targetDate);
        newStart.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
        const newEnd = new Date(newStart.getTime() + durationMs);

        const eventId = await RNCalendarEvents.saveEvent(title.trim() || '(タイトルなし)', {
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
      Alert.alert('完了', `${selectedCopyDates.length}件の予定をコピーしました`);
      onEventAdded();
    } catch (error) {
      console.error('Error copying event:', error);
      Alert.alert('エラー', '予定のコピーに失敗しました');
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
    setCopyCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const goToCopyNextMonth = useCallback(() => {
    setCopyCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

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
    const newDate = new Date(startDate);
    newDate.setHours(tempDate.getHours());
    newDate.setMinutes(tempDate.getMinutes());
    setStartDate(newDate);

    if (endDate <= newDate) {
      const newEndDate = new Date(newDate);
      newEndDate.setHours(newEndDate.getHours() + 1);
      setEndDate(newEndDate);
    }
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
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityLabel="キャンセル"
            accessibilityRole="button">
            <Text style={styles.cancelButton}>キャンセル</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {isEditing ? '予定を編集' : isCopying ? '予定をコピー' : '予定を追加'}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            accessibilityLabel="保存"
            accessibilityRole="button">
            <Text style={styles.saveButton}>保存</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.form}>
          <View style={styles.inputGroup}>
            <View style={styles.titleInputContainer}>
              <TextInput
                style={styles.titleInput}
                placeholder="タイトル"
                value={title}
                onChangeText={setTitle}
                placeholderTextColor="#999"
                accessibilityLabel="予定のタイトル"
                accessibilityHint="予定のタイトルを入力してください"
              />
              {title.length > 0 && (
                <TouchableOpacity
                  style={styles.titleClearButton}
                  onPress={() => setTitle('')}
                  accessibilityLabel="タイトルをクリア">
                  <Text style={styles.titleClearButtonText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.dateTimeSection}>
            <Text style={styles.selectedDateDisplay}>
              {startDate.getMonth() + 1}月{startDate.getDate()}日（{WEEKDAYS[startDate.getDay()]}）
            </Text>
            <View style={styles.dateTimeCompactRow}>
              <TouchableOpacity
                style={styles.compactDateButton}
                onPress={() => {
                  setShowStartTimePicker(false);
                  setShowEndDatePicker(false);
                  setShowEndTimePicker(false);
                  setTempDate(new Date(startDate));
                  setShowStartDatePicker(true);
                }}>
                <Text style={styles.compactDateText}>{formatDate(startDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.compactTimeButton}
                onPress={() => {
                  setShowStartDatePicker(false);
                  setShowEndDatePicker(false);
                  setShowEndTimePicker(false);
                  setTempDate(new Date(startDate));
                  setShowStartTimePicker(true);
                }}>
                <Text style={styles.compactTimeText}>{formatTime(startDate)}</Text>
              </TouchableOpacity>
              <Text style={styles.dateTimeSeparator}>→</Text>
              <TouchableOpacity
                style={styles.compactDateButton}
                onPress={() => {
                  setShowStartDatePicker(false);
                  setShowStartTimePicker(false);
                  setShowEndTimePicker(false);
                  setTempDate(new Date(endDate));
                  setShowEndDatePicker(true);
                }}>
                <Text style={styles.compactDateText}>{formatDate(endDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.compactTimeButton}
                onPress={() => {
                  setShowStartDatePicker(false);
                  setShowStartTimePicker(false);
                  setShowEndDatePicker(false);
                  setTempDate(new Date(endDate));
                  setShowEndTimePicker(true);
                }}>
                <Text style={styles.compactTimeText}>{formatTime(endDate)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.durationSection}>
            <View style={styles.durationHeader}>
              <Text style={styles.sectionLabel}>所要時間</Text>
              <Text style={styles.durationDisplay}>{formatDuration(endDate.getTime() - startDate.getTime())}</Text>
            </View>
            <View style={styles.durationButtons}>
              {DURATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.minutes}
                  style={styles.durationButton}
                  onPress={() => handleAddDuration(option.minutes)}>
                  <Text style={styles.durationButtonText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.resetDurationButton}
              onPress={() => {
                setEndDate(new Date(startDate));
              }}>
              <Text style={styles.resetDurationText}>リセット（0分）</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.colorSection}>
            <Text style={styles.sectionLabel}>色</Text>
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
                        selectedColor === colorOption.color && styles.colorButtonLabelSelected,
                      ]}
                      numberOfLines={1}>
                      {colorOption.label}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
              {availableColorsToAdd.length > 0 && (
                <View style={styles.colorButtonWrapper}>
                  <TouchableOpacity
                    style={styles.addColorButton}
                    onPress={() => setShowAddColor(true)}>
                    <Text style={styles.addColorButtonText}>+</Text>
                  </TouchableOpacity>
                  <Text style={styles.colorButtonLabel}> </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.reminderSection}>
            <Text style={styles.sectionLabel}>リマインダー</Text>
            <View style={styles.reminderButtons}>
              {REMINDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.reminderButton,
                    reminder === option.value && styles.reminderButtonSelected,
                  ]}
                  onPress={() => setReminder(option.value)}>
                  <Text style={[
                    styles.reminderButtonText,
                    reminder === option.value && styles.reminderButtonTextSelected,
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.copyToOtherDaysButton}
            onPress={handleShowCopyCalendar}>
            <Text style={styles.copyToOtherDaysButtonText}>別の日にもコピー</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.saveButtonBottom}
            onPress={handleSave}>
            <Text style={styles.saveButtonBottomText}>保存</Text>
          </TouchableOpacity>

        </ScrollView>

        {/* Copy Calendar Modal */}
        <Modal
          visible={showCopyCalendar}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCopyCalendar(false)}>
          <View style={styles.copyModalOverlay}>
            <View style={styles.copyModalContent}>
              <View style={styles.copyModalHeader}>
                <TouchableOpacity onPress={() => setShowCopyCalendar(false)}>
                  <Text style={styles.copyModalCancel}>キャンセル</Text>
                </TouchableOpacity>
                <Text style={styles.copyModalTitle}>コピー先を選択</Text>
                <TouchableOpacity
                  onPress={handleCopyToSelectedDates}
                  disabled={selectedCopyDates.length === 0}>
                  <Text style={[
                    styles.copyModalDone,
                    selectedCopyDates.length === 0 && styles.copyModalDoneDisabled,
                  ]}>
                    コピー{selectedCopyDates.length > 0 ? `(${selectedCopyDates.length})` : ''}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.copyCalendarNav}>
                <TouchableOpacity onPress={goToCopyPrevMonth} style={styles.copyCalendarNavBtn}>
                  <Text style={styles.copyCalendarNavText}>{'<'}</Text>
                </TouchableOpacity>
                <Text style={styles.copyCalendarMonth}>
                  {copyCalendarDate.getFullYear()}年{copyCalendarDate.getMonth() + 1}月
                </Text>
                <TouchableOpacity onPress={goToCopyNextMonth} style={styles.copyCalendarNavBtn}>
                  <Text style={styles.copyCalendarNavText}>{'>'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.copyCalendarWeekdays}>
                {WEEKDAYS.map((day, index) => (
                  <Text
                    key={day}
                    style={[
                      styles.copyCalendarWeekday,
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
                  return (
                    <TouchableOpacity
                      key={`${item.date.toISOString()}-${index}`}
                      style={[
                        styles.copyCalendarDay,
                        isToday && styles.copyCalendarToday,
                        isSelected && styles.copyCalendarSelected,
                      ]}
                      onPress={() => toggleCopyDateSelection(item.date)}>
                      <Text
                        style={[
                          styles.copyCalendarDayText,
                          !item.isCurrentMonth && styles.copyCalendarOtherMonth,
                          isToday && !isSelected && styles.copyCalendarTodayText,
                          isSelected && styles.copyCalendarSelectedText,
                          index % 7 === 0 && item.isCurrentMonth && !isSelected && styles.copySundayText,
                          index % 7 === 6 && item.isCurrentMonth && !isSelected && styles.copySaturdayText,
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
          <View style={styles.labelModalOverlay}>
            <View style={styles.labelModalContent}>
              <Text style={styles.labelModalTitle}>ラベルを編集</Text>
              <View style={[styles.labelColorPreview, {backgroundColor: editingLabelColor || '#007AFF'}]} />
              <TextInput
                style={styles.labelInput}
                value={editingLabelText}
                onChangeText={setEditingLabelText}
                placeholder="ラベル名"
                autoFocus
                maxLength={10}
              />
              <View style={styles.labelModalButtons}>
                <TouchableOpacity
                  style={styles.labelModalCancel}
                  onPress={() => setEditingLabelColor(null)}>
                  <Text style={styles.labelModalCancelText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.labelModalSave}
                  onPress={handleLabelSave}>
                  <Text style={styles.labelModalSaveText}>保存</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Add Color Modal */}
        <Modal
          visible={showAddColor}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAddColor(false)}>
          <View style={styles.labelModalOverlay}>
            <View style={styles.labelModalContent}>
              <Text style={styles.labelModalTitle}>色を追加</Text>
              <View style={styles.addColorList}>
                {availableColorsToAdd.map(colorOption => (
                  <TouchableOpacity
                    key={colorOption.name}
                    style={styles.addColorItem}
                    onPress={() => handleAddColor(colorOption)}>
                    <View style={[styles.addColorPreview, {backgroundColor: colorOption.color}]} />
                    <Text style={styles.addColorLabel}>{colorOption.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.labelModalCancel}
                onPress={() => setShowAddColor(false)}>
                <Text style={styles.labelModalCancelText}>キャンセル</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {showStartDatePicker && (
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowStartDatePicker(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>開始日</Text>
              <TouchableOpacity onPress={confirmStartDate}>
                <Text style={styles.pickerOkText}>OK</Text>
              </TouchableOpacity>
            </View>
            <MonthDayPicker
              value={tempDate}
              onChange={(date) => setTempDate(date)}
            />
          </View>
        )}
        {showStartTimePicker && (
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowStartTimePicker(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>開始時間</Text>
              <TouchableOpacity onPress={confirmStartTime}>
                <Text style={styles.pickerOkText}>OK</Text>
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
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowEndDatePicker(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>終了日</Text>
              <TouchableOpacity onPress={confirmEndDate}>
                <Text style={styles.pickerOkText}>OK</Text>
              </TouchableOpacity>
            </View>
            <MonthDayPicker
              value={tempDate}
              onChange={(date) => setTempDate(date)}
            />
          </View>
        )}
        {showEndTimePicker && (
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowEndTimePicker(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>終了時間</Text>
              <TouchableOpacity onPress={confirmEndTime}>
                <Text style={styles.pickerOkText}>OK</Text>
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
      </View>
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
    padding: 16,
  },
  inputGroup: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 12,
  },
  titleInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleInput: {
    flex: 1,
    fontSize: 17,
    padding: 14,
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
  dateTimeSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  selectedDateDisplay: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 12,
  },
  dateTimeCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  compactDateButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  compactDateText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  compactTimeButton: {
    backgroundColor: '#E8F4FD',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  compactTimeText: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '600',
  },
  dateTimeSeparator: {
    fontSize: 18,
    color: '#999',
    marginHorizontal: 4,
  },
  durationSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  colorSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
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
    marginTop: 8,
  },
  colorButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    width: 40,
    height: 40,
    borderRadius: 20,
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
    padding: 14,
    marginBottom: 12,
  },
  reminderButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  reminderButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
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
  durationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  durationDisplay: {
    fontSize: 18,
    fontWeight: '700',
    color: '#007AFF',
  },
  durationButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  durationButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  resetDurationButton: {
    marginTop: 10,
    alignItems: 'center',
  },
  resetDurationText: {
    fontSize: 12,
    color: '#999',
  },
  copyToOtherDaysButton: {
    backgroundColor: '#E8F4FD',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  copyToOtherDaysButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
  },
  saveButtonBottom: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  saveButtonBottomText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
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
