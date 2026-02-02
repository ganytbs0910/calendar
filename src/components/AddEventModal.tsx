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
}

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
  const [presets, setPresets] = useState<EventPreset[]>([]);

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
    const newEnd = new Date(startDate);
    newEnd.setMinutes(newEnd.getMinutes() + preset.durationMinutes);
    setEndDate(newEnd);
  }, [startDate]);

  // Save current settings as a new preset
  const saveAsPreset = useCallback(() => {
    if (!title.trim()) {
      Alert.alert('エラー', 'プリセットを保存するにはタイトルを入力してください');
      return;
    }
    const durationMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    const newPreset: EventPreset = {
      id: Date.now().toString(),
      title: title.trim(),
      durationMinutes,
    };
    const newPresets = [...presets, newPreset];
    setPresets(newPresets);
    savePresetsToStorage(newPresets);
    Alert.alert('保存完了', `「${title.trim()}」をプリセットに追加しました`);
  }, [title, startDate, endDate, presets, savePresetsToStorage]);

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
    if (!title.trim()) {
      Alert.alert('エラー', 'タイトルを入力してください');
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      Alert.alert('エラー', '終了時刻は開始時刻より後に設定してください');
      return;
    }

    // Minimum event duration: 5 minutes
    const minDuration = 5 * 60 * 1000; // 5 minutes in ms
    if (endDate.getTime() - startDate.getTime() < minDuration) {
      Alert.alert('エラー', '予定は最低5分以上の長さが必要です');
      return;
    }

    try {
      if (isEditing && editingEvent?.id) {
        // Update existing event
        await RNCalendarEvents.saveEvent(title.trim(), {
          id: editingEvent.id,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          allDay: false,
        });
      } else {
        // Create new event
        const calendars = await RNCalendarEvents.findCalendars();
        const defaultCalendar = calendars.find(
          cal => cal.isPrimary || cal.allowsModifications,
        );

        if (!defaultCalendar) {
          Alert.alert('エラー', '書き込み可能なカレンダーが見つかりません');
          return;
        }

        await RNCalendarEvents.saveEvent(title.trim(), {
          calendarId: defaultCalendar.id,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          allDay: false,
        });
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


  const onStartDateChange = (_: any, selectedDate?: Date) => {
    setShowStartDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(startDate);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      setStartDate(newDate);

      const startDay = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
      const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

      if (endDay < startDay) {
        const newEndDate = new Date(newDate);
        newEndDate.setHours(newEndDate.getHours() + 1);
        setEndDate(newEndDate);
      }
    }
  };

  const onStartTimeChange = (_: any, selectedDate?: Date) => {
    setShowStartTimePicker(false);
    if (selectedDate) {
      const newDate = new Date(startDate);
      newDate.setHours(selectedDate.getHours());
      newDate.setMinutes(selectedDate.getMinutes());
      setStartDate(newDate);

      if (endDate <= newDate) {
        const newEndDate = new Date(newDate);
        newEndDate.setHours(newEndDate.getHours() + 1);
        setEndDate(newEndDate);
      }
    }
  };

  const onEndDateChange = (_: any, selectedDate?: Date) => {
    setShowEndDatePicker(false);
    if (selectedDate) {
      const newDate = new Date(endDate);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      setEndDate(newDate);
    }
  };

  const onEndTimeChange = (_: any, selectedDate?: Date) => {
    setShowEndTimePicker(false);
    if (selectedDate) {
      const newDate = new Date(endDate);
      newDate.setHours(selectedDate.getHours());
      newDate.setMinutes(selectedDate.getMinutes());
      setEndDate(newDate);
    }
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
                <Text style={styles.savePresetButton}>+ 現在の設定を保存</Text>
              </TouchableOpacity>
            </View>
            {presets.length > 0 ? (
              <View style={styles.presetButtons}>
                {presets.map((preset) => (
                  <TouchableOpacity
                    key={preset.id}
                    style={styles.presetButton}
                    onPress={() => applyPreset(preset)}
                    onLongPress={() => deletePreset(preset.id)}>
                    <Text style={styles.presetButtonTitle}>{preset.title}</Text>
                    <Text style={styles.presetButtonDuration}>{formatPresetDuration(preset.durationMinutes)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.noPresetsText}>
                プリセットがありません{'\n'}
                タイトルと所要時間を設定して「現在の設定を保存」をタップ
              </Text>
            )}
          </View>

        </ScrollView>

        {showStartDatePicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onStartDateChange}
            locale="ja-JP"
          />
        )}
        {showStartTimePicker && (
          <DateTimePicker
            value={startDate}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onStartTimeChange}
            minuteInterval={5}
          />
        )}
        {showEndDatePicker && (
          <DateTimePicker
            value={endDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onEndDateChange}
            locale="ja-JP"
          />
        )}
        {showEndTimePicker && (
          <DateTimePicker
            value={endDate}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onEndTimeChange}
            minuteInterval={5}
          />
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
});

export default memo(AddEventModal);
