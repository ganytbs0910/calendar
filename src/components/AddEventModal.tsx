import React, {useState, useCallback, useEffect, memo, useMemo} from 'react';
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
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';

const SCREEN_WIDTH = Dimensions.get('window').width;
const COPY_CALENDAR_DAY_WIDTH = Math.floor((SCREEN_WIDTH - 80) / 7);
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
      } else if (isCopying && initialDate && initialEndDate) {
        // Copy mode - use title from event but dates from initialDate/initialEndDate
        setTitle(editingEvent.title || '');
        setStartDate(new Date(initialDate));
        setEndDate(new Date(initialEndDate));
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

        await RNCalendarEvents.saveEvent(title.trim() || '(タイトルなし)', {
          calendarId: defaultCalendar.id,
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          allDay: false,
        });
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

          <TouchableOpacity
            style={styles.copyToOtherDaysButton}
            onPress={handleShowCopyCalendar}>
            <Text style={styles.copyToOtherDaysButtonText}>別の日にもコピー</Text>
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
  copyToOtherDaysButton: {
    backgroundColor: '#E8F4FD',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  copyToOtherDaysButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
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
});

export default memo(AddEventModal);
