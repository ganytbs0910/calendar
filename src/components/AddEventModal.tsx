import React, {useState, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ScrollView,
  Switch,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import RNCalendarEvents from 'react-native-calendar-events';

// Duration options for adding time
const DURATION_OPTIONS = [
  {label: '+5分', minutes: 5},
  {label: '+10分', minutes: 10},
  {label: '+30分', minutes: 30},
  {label: '+1時間', minutes: 60},
  {label: '+3時間', minutes: 180},
];

interface AddEventModalProps {
  visible: boolean;
  onClose: () => void;
  onEventAdded: () => void;
  initialDate?: Date;
  initialEndDate?: Date;
}

export const AddEventModal: React.FC<AddEventModalProps> = ({
  visible,
  onClose,
  onEventAdded,
  initialDate,
  initialEndDate,
}) => {
  const [title, setTitle] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // Initialize dates when modal opens or initialDate/initialEndDate changes
  useEffect(() => {
    if (visible) {
      if (initialDate) {
        const start = new Date(initialDate);
        if (!initialEndDate) {
          start.setMinutes(0);
          start.setSeconds(0);
        }
        setStartDate(start);

        if (initialEndDate) {
          setEndDate(new Date(initialEndDate));
          setIsAllDay(false);
        } else {
          const end = new Date(start);
          end.setHours(end.getHours() + 1);
          setEndDate(end);
        }
      } else {
        const now = new Date();
        now.setMinutes(0);
        now.setSeconds(0);
        setStartDate(now);
        const end = new Date(now);
        end.setHours(end.getHours() + 1);
        setEndDate(end);
      }
      setTitle('');
      setIsAllDay(false);
    }
  }, [visible, initialDate, initialEndDate]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('エラー', 'タイトルを入力してください');
      return;
    }

    if (!isAllDay && endDate <= startDate) {
      Alert.alert('エラー', '終了時刻は開始時刻より後に設定してください');
      return;
    }

    if (isAllDay) {
      const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      if (endDay < startDay) {
        Alert.alert('エラー', '終了日は開始日以降に設定してください');
        return;
      }
    }

    try {
      const calendars = await RNCalendarEvents.findCalendars();
      const defaultCalendar = calendars.find(
        cal => cal.isPrimary || cal.allowsModifications,
      );

      if (!defaultCalendar) {
        Alert.alert('エラー', '書き込み可能なカレンダーが見つかりません');
        return;
      }

      const eventStartDate = isAllDay
        ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0)
        : startDate;
      const eventEndDate = isAllDay
        ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59)
        : endDate;

      await RNCalendarEvents.saveEvent(title.trim(), {
        calendarId: defaultCalendar.id,
        startDate: eventStartDate.toISOString(),
        endDate: eventEndDate.toISOString(),
        allDay: isAllDay,
      });

      handleClose();
      onEventAdded();
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert('エラー', '予定の保存に失敗しました');
    }
  }, [title, isAllDay, startDate, endDate, handleClose, onEventAdded]);

  const formatDate = (date: Date) => {
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
  };

  const formatTime = (date: Date) => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatDuration = (ms: number) => {
    const totalMinutes = Math.round(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) {
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
        if (!isAllDay) {
          newEndDate.setHours(newEndDate.getHours() + 1);
        }
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
          <TouchableOpacity onPress={handleClose}>
            <Text style={styles.cancelButton}>キャンセル</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>予定を追加</Text>
          <TouchableOpacity onPress={handleSave}>
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
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>終日</Text>
            <Switch
              value={isAllDay}
              onValueChange={(value) => {
                setIsAllDay(value);
                if (value) {
                  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                  const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
                  if (endDay < startDay) {
                    setEndDate(new Date(startDate));
                  }
                }
              }}
            />
          </View>

          <View style={styles.dateTimeSection}>
            <Text style={styles.sectionLabel}>開始</Text>
            <View style={styles.dateTimeRow}>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowStartDatePicker(true)}>
                <Text style={styles.dateButtonText}>{formatDate(startDate)}</Text>
              </TouchableOpacity>
              {!isAllDay && (
                <TouchableOpacity
                  style={styles.timeButton}
                  onPress={() => setShowStartTimePicker(true)}>
                  <Text style={styles.timeButtonText}>{formatTime(startDate)}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!isAllDay && (
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
                  const newEnd = new Date(startDate);
                  newEnd.setMinutes(newEnd.getMinutes() + 60);
                  setEndDate(newEnd);
                }}>
                <Text style={styles.resetDurationText}>リセット（1時間）</Text>
              </TouchableOpacity>
            </View>
          )}

          {isAllDay && (
            <View style={styles.dateTimeSection}>
              <Text style={styles.sectionLabel}>終了日</Text>
              <View style={styles.dateTimeRow}>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setShowEndDatePicker(true)}>
                  <Text style={styles.dateButtonText}>{formatDate(endDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  label: {
    fontSize: 17,
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
  dateTimeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateButton: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dateButtonText: {
    fontSize: 17,
    color: '#007AFF',
  },
  timeButton: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  timeButtonText: {
    fontSize: 17,
    color: '#007AFF',
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
});

export default AddEventModal;
