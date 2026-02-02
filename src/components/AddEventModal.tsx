import React, {useState, useCallback, useEffect, memo} from 'react';
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
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Preset storage key
const PRESETS_STORAGE_KEY = '@calendar_presets';

interface EventPreset {
  id: string;
  title: string;
  durationMinutes: number;
  // Optional: for recurring presets
  dayOfWeek?: number; // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
  startHour?: number;
  startMinute?: number;
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// Duration options - unified list for adding time
const DURATION_OPTIONS = [
  {label: '+5分', minutes: 5},
  {label: '+10分', minutes: 10},
  {label: '+30分', minutes: 30},
  {label: '+1時間', minutes: 60},
  {label: '+3時間', minutes: 180},
  {label: '+6時間', minutes: 6 * 60},
  {label: '+12時間', minutes: 12 * 60},
  {label: '+1日', minutes: 24 * 60},
  {label: '+3日', minutes: 3 * 24 * 60},
  {label: '+1週間', minutes: 7 * 24 * 60},
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
  const isEditing = !!editingEvent;
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [presets, setPresets] = useState<EventPreset[]>([]);
  const [includeSchedule, setIncludeSchedule] = useState(false);

  // Load presets from storage
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const stored = await AsyncStorage.getItem(PRESETS_STORAGE_KEY);
        if (stored) {
          setPresets(JSON.parse(stored));
        }
      } catch (error) {
        console.error('Error loading presets:', error);
      }
    };
    loadPresets();
  }, []);

  // Save presets to storage
  const savePresetsToStorage = useCallback(async (newPresets: EventPreset[]) => {
    try {
      await AsyncStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(newPresets));
    } catch (error) {
      console.error('Error saving presets:', error);
    }
  }, []);

  // Apply a preset
  const applyPreset = useCallback((preset: EventPreset) => {
    setTitle(preset.title);

    let newStart = new Date(startDate);

    // If preset has day of week, find the next occurrence
    if (preset.dayOfWeek !== undefined) {
      const today = new Date();
      const currentDay = today.getDay();
      let daysUntil = preset.dayOfWeek - currentDay;
      if (daysUntil < 0) {
        daysUntil += 7;
      }
      // If it's today but the time has passed, go to next week
      if (daysUntil === 0 && preset.startHour !== undefined) {
        const now = new Date();
        if (now.getHours() > preset.startHour ||
            (now.getHours() === preset.startHour && now.getMinutes() >= (preset.startMinute || 0))) {
          daysUntil = 7;
        }
      }
      newStart = new Date(today);
      newStart.setDate(today.getDate() + daysUntil);
    }

    // If preset has start time, set it
    if (preset.startHour !== undefined) {
      newStart.setHours(preset.startHour, preset.startMinute || 0, 0, 0);
    }

    setStartDate(newStart);

    // Ensure minimum 5 minutes duration
    const durationMinutes = Math.max(5, preset.durationMinutes);
    const newEnd = new Date(newStart);
    newEnd.setMinutes(newEnd.getMinutes() + durationMinutes);
    setEndDate(newEnd);
  }, [startDate]);

  // Save current settings as a new preset
  const saveAsPreset = useCallback(() => {
    const durationMs = Math.max(0, endDate.getTime() - startDate.getTime());
    // Minimum 5 minutes for presets
    const durationMinutes = Math.max(5, Math.round(durationMs / (1000 * 60)));
    const presetTitle = title.trim() || '(タイトルなし)';
    const newPreset: EventPreset = {
      id: Date.now().toString(),
      title: presetTitle,
      durationMinutes,
    };

    // Include schedule if toggle is on
    if (includeSchedule) {
      newPreset.dayOfWeek = startDate.getDay();
      newPreset.startHour = startDate.getHours();
      newPreset.startMinute = startDate.getMinutes();
    }

    const newPresets = [...presets, newPreset];
    setPresets(newPresets);
    savePresetsToStorage(newPresets);

    const scheduleInfo = includeSchedule
      ? `（毎週${WEEKDAY_NAMES[startDate.getDay()]} ${startDate.getHours()}:${startDate.getMinutes().toString().padStart(2, '0')}）`
      : '';
    Alert.alert('保存完了', `「${presetTitle}」${scheduleInfo}をプリセットに追加しました`);
    setIncludeSchedule(false);
  }, [title, startDate, endDate, presets, savePresetsToStorage, includeSchedule]);

  // Delete a preset
  const deletePreset = useCallback((presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    Alert.alert(
      'プリセットを削除',
      `「${preset?.title}」を削除しますか？`,
      [
        {text: 'キャンセル', style: 'cancel'},
        {
          text: '削除',
          style: 'destructive',
          onPress: () => {
            const newPresets = presets.filter(p => p.id !== presetId);
            setPresets(newPresets);
            savePresetsToStorage(newPresets);
          },
        },
      ]
    );
  }, [presets, savePresetsToStorage]);

  // Format duration for preset display
  const formatPresetDuration = (minutes: number) => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
    }
    return `${minutes}分`;
  };

  // Format preset info (including schedule if set)
  const formatPresetInfo = (preset: EventPreset) => {
    let info = formatPresetDuration(preset.durationMinutes);
    if (preset.dayOfWeek !== undefined && preset.startHour !== undefined) {
      const time = `${preset.startHour}:${(preset.startMinute || 0).toString().padStart(2, '0')}`;
      info = `${WEEKDAY_NAMES[preset.dayOfWeek]} ${time}〜 ${info}`;
    }
    return info;
  };

  // Initialize dates when modal opens or initialDate/initialEndDate changes
  useEffect(() => {
    if (visible) {
      if (editingEvent) {
        // Editing mode - load existing event data
        setTitle(editingEvent.title || '');
        if (editingEvent.startDate) {
          setStartDate(new Date(editingEvent.startDate));
        }
        if (editingEvent.endDate) {
          setEndDate(new Date(editingEvent.endDate));
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
      } else {
        const now = new Date();
        now.setMinutes(0);
        now.setSeconds(0);
        setStartDate(now);
        const end = new Date(now);
        end.setHours(end.getHours() + 1);
        setEndDate(end);
        setTitle('');
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
        });
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

        await RNCalendarEvents.saveEvent(title.trim() || '(タイトルなし)', {
          calendarId: defaultCalendar.id,
          startDate: startDate.toISOString(),
          endDate: finalEndDate.toISOString(),
          allDay: false,
        });
        console.log('Event saved successfully');
      }

      handleClose();
      onEventAdded();
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert('エラー', isEditing ? '予定の更新に失敗しました' : '予定の保存に失敗しました');
    }
  }, [title, startDate, endDate, handleClose, onEventAdded, isEditing, editingEvent]);

  const formatDate = (date: Date) => {
    return `${date.getMonth() + 1}/${date.getDate()}`;
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
            {isEditing ? '予定を編集' : '予定を追加'}
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
            <TextInput
              style={styles.titleInput}
              placeholder="タイトル"
              value={title}
              onChangeText={setTitle}
              placeholderTextColor="#999"
              accessibilityLabel="予定のタイトル"
              accessibilityHint="予定のタイトルを入力してください"
            />
          </View>

          <View style={styles.dateTimeSection}>
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

          <View style={styles.presetSection}>
            <View style={styles.presetHeader}>
              <Text style={styles.sectionLabel}>プリセット</Text>
              <TouchableOpacity onPress={saveAsPreset}>
                <Text style={styles.savePresetButton}>+ 保存</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.scheduleToggle}
              onPress={() => setIncludeSchedule(!includeSchedule)}>
              <View style={[styles.checkbox, includeSchedule && styles.checkboxChecked]}>
                {includeSchedule && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.scheduleToggleText}>曜日・時間も保存（定期予定用）</Text>
            </TouchableOpacity>
            {presets.length > 0 ? (
              <View style={styles.presetButtons}>
                {presets.map((preset) => (
                  <TouchableOpacity
                    key={preset.id}
                    style={[
                      styles.presetButton,
                      preset.dayOfWeek !== undefined && styles.presetButtonScheduled,
                    ]}
                    onPress={() => applyPreset(preset)}
                    onLongPress={() => deletePreset(preset.id)}>
                    <Text style={styles.presetButtonTitle}>{preset.title}</Text>
                    <Text style={styles.presetButtonDuration}>{formatPresetInfo(preset)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.noPresetsText}>
                タイトルと所要時間を設定して「+ 保存」をタップ
              </Text>
            )}
          </View>

        </ScrollView>

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
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={onTempDateChange}
              locale="ja-JP"
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
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={onTempDateChange}
              locale="ja-JP"
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
    padding: 16,
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
    marginBottom: 16,
  },
  titleInput: {
    fontSize: 17,
    padding: 16,
    color: '#333',
  },
  dateTimeSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 15,
    color: '#666',
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  compactDateText: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '500',
  },
  compactTimeButton: {
    backgroundColor: '#E8F4FD',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  compactTimeText: {
    fontSize: 17,
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
    padding: 16,
    marginBottom: 16,
  },
  durationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  durationDisplay: {
    fontSize: 20,
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
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  durationButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  resetDurationButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  resetDurationText: {
    fontSize: 14,
    color: '#999',
  },
  presetSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  presetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  savePresetButton: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  presetButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetButton: {
    backgroundColor: '#E8F4FD',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  presetButtonScheduled: {
    backgroundColor: '#FFF3E8',
    borderColor: '#FF9500',
  },
  presetButtonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  presetButtonDuration: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  noPresetsText: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  scheduleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ccc',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scheduleToggleText: {
    fontSize: 14,
    color: '#333',
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
});

export default memo(AddEventModal);
