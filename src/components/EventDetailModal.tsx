import React, {useCallback, memo, useState, useMemo} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Dimensions,
} from 'react-native';
import {CalendarEventReadable} from 'react-native-calendar-events';
import RNCalendarEvents from 'react-native-calendar-events';
import {useTheme} from '../theme/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CALENDAR_DAY_WIDTH = Math.floor((SCREEN_WIDTH - 80) / 7);
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface EventDetailModalProps {
  visible: boolean;
  event: CalendarEventReadable | null;
  onClose: () => void;
  onEdit: (event: CalendarEventReadable) => void;
  onDeleted: () => void;
  onCopied: () => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  visible,
  event,
  onClose,
  onEdit,
  onDeleted,
  onCopied,
}) => {
  const [showCopyCalendar, setShowCopyCalendar] = useState(false);
  const [copyCalendarDate, setCopyCalendarDate] = useState(new Date());
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const {colors} = useTheme();
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[date.getDay()];
    return `${year}/${month}/${day} (${weekday})`;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const formatDuration = (startStr: string, endStr: string) => {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end.getTime() - start.getTime();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    const days = Math.floor(diffMinutes / (24 * 60));
    const hours = Math.floor((diffMinutes % (24 * 60)) / 60);
    const minutes = diffMinutes % 60;

    if (days > 0 && hours === 0 && minutes === 0) {
      return `${days}日`;
    } else if (days > 0) {
      return `${days}日${hours}時間`;
    } else if (hours === 0) {
      return `${minutes}分`;
    } else if (minutes === 0) {
      return `${hours}時間`;
    } else {
      return `${hours}時間${minutes}分`;
    }
  };

  const handleDelete = useCallback(async () => {
    if (!event?.id) return;

    Alert.alert(
      '予定を削除',
      `「${event.title}」を削除しますか？`,
      [
        {text: 'キャンセル', style: 'cancel'},
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await RNCalendarEvents.removeEvent(event.id!);
              onClose();
              onDeleted();
            } catch (error) {
              console.error('Error deleting event:', error);
              Alert.alert('エラー', '予定の削除に失敗しました');
            }
          },
        },
      ],
    );
  }, [event, onClose, onDeleted]);

  const handleEdit = useCallback(() => {
    if (event) {
      onClose();
      onEdit(event);
    }
  }, [event, onClose, onEdit]);

  const handleShowCopyCalendar = useCallback(() => {
    setCopyCalendarDate(new Date());
    setSelectedDates([]);
    setShowCopyCalendar(true);
  }, []);

  const toggleDateSelection = useCallback((targetDate: Date) => {
    setSelectedDates(prev => {
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
    if (!event?.startDate || !event?.endDate || selectedDates.length === 0) return;

    const originalStart = new Date(event.startDate);
    const originalEnd = new Date(event.endDate);
    const durationMs = originalEnd.getTime() - originalStart.getTime();

    try {
      const calendars = await RNCalendarEvents.findCalendars();
      const writableCalendars = calendars.filter(cal => cal.allowsModifications);
      if (writableCalendars.length === 0) {
        Alert.alert('エラー', '書き込み可能なカレンダーが見つかりません');
        return;
      }
      const defaultCalendar = writableCalendars.find(cal => cal.isPrimary) || writableCalendars[0];

      for (const targetDate of selectedDates) {
        const newStart = new Date(targetDate);
        newStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
        const newEnd = new Date(newStart.getTime() + durationMs);

        await RNCalendarEvents.saveEvent(event.title || '(タイトルなし)', {
          calendarId: defaultCalendar.id,
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          allDay: event.allDay || false,
        });
      }

      setShowCopyCalendar(false);
      setSelectedDates([]);
      onClose();
      onCopied();
    } catch (error) {
      console.error('Error copying event:', error);
      Alert.alert('エラー', '予定のコピーに失敗しました');
    }
  }, [event, selectedDates, onClose, onCopied]);

  // Calendar navigation for copy
  const goToPrevMonth = useCallback(() => {
    setCopyCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const goToNextMonth = useCallback(() => {
    setCopyCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  // Generate calendar days for copy modal
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

  if (!event) return null;

  // Efficient date comparison without string formatting
  const isSameDay = event.startDate && event.endDate && (() => {
    const start = new Date(event.startDate!);
    const end = new Date(event.endDate!);
    return start.getFullYear() === end.getFullYear() &&
           start.getMonth() === end.getMonth() &&
           start.getDate() === end.getDate();
  })();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={[styles.container, {backgroundColor: colors.background}]}>
        <View style={[styles.header, {backgroundColor: colors.surface, borderBottomColor: colors.border}]}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="閉じる"
            accessibilityRole="button">
            <Text style={[styles.closeButton, {color: colors.primary}]}>閉じる</Text>
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
          <TouchableOpacity
            onPress={handleEdit}
            accessibilityLabel="編集"
            accessibilityRole="button">
            <Text style={[styles.editButton, {color: colors.primary}]}>編集</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <View style={[styles.titleSection, {backgroundColor: colors.surface}]}>
            <View
              style={[
                styles.colorDot,
                {backgroundColor: event.calendar?.color || colors.primary},
              ]}
            />
            <Text style={[styles.title, {color: colors.text}]}>{event.title}</Text>
          </View>

          <View style={[styles.infoSection, {backgroundColor: colors.surface}]}>
            <View style={[styles.infoRow, {borderBottomColor: colors.borderLight}]}>
              <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>開始</Text>
              <View style={styles.infoValue}>
                <Text style={[styles.infoDate, {color: colors.text}]}>
                  {event.startDate && formatDate(event.startDate)}
                </Text>
                {!event.allDay && event.startDate && (
                  <Text style={[styles.infoTime, {color: colors.primary}]}>
                    {formatTime(event.startDate)}
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.infoRow, {borderBottomColor: colors.borderLight}]}>
              <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>終了</Text>
              <View style={styles.infoValue}>
                {!isSameDay && event.endDate && (
                  <Text style={[styles.infoDate, {color: colors.text}]}>
                    {formatDate(event.endDate)}
                  </Text>
                )}
                {!event.allDay && event.endDate && (
                  <Text style={[styles.infoTime, {color: colors.primary}]}>
                    {formatTime(event.endDate)}
                  </Text>
                )}
                {isSameDay && event.allDay && (
                  <Text style={[styles.infoDate, {color: colors.text}]}>終日</Text>
                )}
              </View>
            </View>

            {!event.allDay && event.startDate && event.endDate && (
              <View style={[styles.infoRow, {borderBottomColor: colors.borderLight}]}>
                <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>所要時間</Text>
                <Text style={[styles.infoDuration, {color: colors.text}]}>
                  {formatDuration(event.startDate, event.endDate)}
                </Text>
              </View>
            )}

            {event.calendar && (
              <View style={[styles.infoRow, {borderBottomColor: colors.borderLight}]}>
                <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>カレンダー</Text>
                <Text style={[styles.infoCalendar, {color: colors.text}]}>{event.calendar.title}</Text>
              </View>
            )}

            {event.location && (
              <View style={[styles.infoRow, {borderBottomColor: colors.borderLight}]}>
                <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>場所</Text>
                <Text style={[styles.infoLocation, {color: colors.text}]}>{event.location}</Text>
              </View>
            )}

            {event.notes && (
              <View style={styles.notesSection}>
                <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>メモ</Text>
                <Text style={[styles.notes, {color: colors.text}]}>{event.notes}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.copyButton, {backgroundColor: colors.primary}]}
            onPress={handleShowCopyCalendar}
            accessibilityLabel="別の日にコピー"
            accessibilityRole="button">
            <Text style={styles.copyButtonText}>別の日にコピー</Text>
          </TouchableOpacity>

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
                    <Text style={[styles.copyModalCancel, {color: colors.textTertiary}]}>キャンセル</Text>
                  </TouchableOpacity>
                  <Text style={[styles.copyModalTitle, {color: colors.text}]}>コピー先を選択</Text>
                  <TouchableOpacity
                    onPress={handleCopyToSelectedDates}
                    disabled={selectedDates.length === 0}>
                    <Text style={[
                      styles.copyModalDone,
                      {color: colors.primary},
                      selectedDates.length === 0 && styles.copyModalDoneDisabled,
                    ]}>
                      コピー{selectedDates.length > 0 ? `(${selectedDates.length})` : ''}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.copyCalendarNav}>
                  <TouchableOpacity onPress={goToPrevMonth} style={styles.copyCalendarNavBtn}>
                    <Text style={[styles.copyCalendarNavText, {color: colors.primary}]}>{'<'}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.copyCalendarMonth, {color: colors.text}]}>
                    {copyCalendarDate.getFullYear()}年{copyCalendarDate.getMonth() + 1}月
                  </Text>
                  <TouchableOpacity onPress={goToNextMonth} style={styles.copyCalendarNavBtn}>
                    <Text style={[styles.copyCalendarNavText, {color: colors.primary}]}>{'>'}</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.copyCalendarWeekdays}>
                  {WEEKDAYS.map((day, index) => (
                    <Text
                      key={day}
                      style={[
                        styles.copyCalendarWeekday,
                        {color: colors.textSecondary},
                        index === 0 && {color: colors.sunday},
                        index === 6 && {color: colors.saturday},
                      ]}>
                      {day}
                    </Text>
                  ))}
                </View>

                <View style={styles.copyCalendarGrid}>
                  {copyCalendarDays.map((item, index) => {
                    const isToday = item.date.toDateString() === new Date().toDateString();
                    const isSelected = selectedDates.some(d => d.toDateString() === item.date.toDateString());
                    return (
                      <TouchableOpacity
                        key={`${item.date.toISOString()}-${index}`}
                        style={[
                          styles.copyCalendarDay,
                          isToday && {backgroundColor: colors.today},
                          isSelected && {backgroundColor: colors.primary},
                        ]}
                        onPress={() => toggleDateSelection(item.date)}>
                        <Text
                          style={[
                            styles.copyCalendarDayText,
                            {color: colors.text},
                            !item.isCurrentMonth && {color: colors.textTertiary},
                            isToday && !isSelected && {color: colors.primary, fontWeight: '600'},
                            isSelected && styles.copyCalendarSelectedText,
                            index % 7 === 0 && item.isCurrentMonth && !isSelected && {color: colors.sunday},
                            index % 7 === 6 && item.isCurrentMonth && !isSelected && {color: colors.saturday},
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

          <TouchableOpacity
            style={[styles.deleteButton, {backgroundColor: colors.surface}]}
            onPress={handleDelete}
            accessibilityLabel="予定を削除"
            accessibilityRole="button"
            accessibilityHint="この予定を削除します">
            <Text style={[styles.deleteButtonText, {color: colors.delete}]}>予定を削除</Text>
          </TouchableOpacity>
        </ScrollView>
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
  headerSpacer: {
    flex: 1,
  },
  closeButton: {
    fontSize: 17,
    color: '#007AFF',
  },
  editButton: {
    fontSize: 17,
    color: '#007AFF',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  infoSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 15,
    color: '#666',
  },
  infoValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoDate: {
    fontSize: 15,
    color: '#333',
  },
  infoTime: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '500',
  },
  infoDuration: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  infoCalendar: {
    fontSize: 15,
    color: '#333',
  },
  infoLocation: {
    fontSize: 15,
    color: '#333',
    flex: 1,
    textAlign: 'right',
  },
  notesSection: {
    paddingTop: 12,
  },
  notes: {
    fontSize: 15,
    color: '#333',
    marginTop: 8,
    lineHeight: 22,
  },
  copyButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  copyButtonText: {
    fontSize: 17,
    color: '#fff',
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 32,
  },
  deleteButtonText: {
    fontSize: 17,
    color: '#FF3B30',
  },
  sundayText: {
    color: '#FF3B30',
  },
  saturdayText: {
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
    width: CALENDAR_DAY_WIDTH,
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
    width: CALENDAR_DAY_WIDTH,
    height: CALENDAR_DAY_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: CALENDAR_DAY_WIDTH / 2,
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
});

export default memo(EventDetailModal);
