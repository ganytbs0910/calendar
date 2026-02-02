import React, {useCallback, memo} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import {CalendarEventReadable} from 'react-native-calendar-events';
import RNCalendarEvents from 'react-native-calendar-events';

interface EventDetailModalProps {
  visible: boolean;
  event: CalendarEventReadable | null;
  onClose: () => void;
  onEdit: (event: CalendarEventReadable) => void;
  onDeleted: () => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  visible,
  event,
  onClose,
  onEdit,
  onDeleted,
}) => {
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
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="閉じる"
            accessibilityRole="button">
            <Text style={styles.closeButton}>閉じる</Text>
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
          <TouchableOpacity
            onPress={handleEdit}
            accessibilityLabel="編集"
            accessibilityRole="button">
            <Text style={styles.editButton}>編集</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.titleSection}>
            <View
              style={[
                styles.colorDot,
                {backgroundColor: event.calendar?.color || '#007AFF'},
              ]}
            />
            <Text style={styles.title}>{event.title}</Text>
          </View>

          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>開始</Text>
              <View style={styles.infoValue}>
                <Text style={styles.infoDate}>
                  {event.startDate && formatDate(event.startDate)}
                </Text>
                {!event.allDay && event.startDate && (
                  <Text style={styles.infoTime}>
                    {formatTime(event.startDate)}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>終了</Text>
              <View style={styles.infoValue}>
                {!isSameDay && event.endDate && (
                  <Text style={styles.infoDate}>
                    {formatDate(event.endDate)}
                  </Text>
                )}
                {!event.allDay && event.endDate && (
                  <Text style={styles.infoTime}>
                    {formatTime(event.endDate)}
                  </Text>
                )}
                {isSameDay && event.allDay && (
                  <Text style={styles.infoDate}>終日</Text>
                )}
              </View>
            </View>

            {!event.allDay && event.startDate && event.endDate && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>所要時間</Text>
                <Text style={styles.infoDuration}>
                  {formatDuration(event.startDate, event.endDate)}
                </Text>
              </View>
            )}

            {event.calendar && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>カレンダー</Text>
                <Text style={styles.infoCalendar}>{event.calendar.title}</Text>
              </View>
            )}

            {event.location && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>場所</Text>
                <Text style={styles.infoLocation}>{event.location}</Text>
              </View>
            )}

            {event.notes && (
              <View style={styles.notesSection}>
                <Text style={styles.infoLabel}>メモ</Text>
                <Text style={styles.notes}>{event.notes}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            accessibilityLabel="予定を削除"
            accessibilityRole="button"
            accessibilityHint="この予定を削除します">
            <Text style={styles.deleteButtonText}>予定を削除</Text>
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
});

export default memo(EventDetailModal);
