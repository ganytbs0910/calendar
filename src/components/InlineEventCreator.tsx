import React, {useState, useCallback, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  Alert,
} from 'react-native';
import RNCalendarEvents from 'react-native-calendar-events';
import {setEventColor, getColorSettings} from './AddEventModal';
import {useTheme} from '../theme/ThemeContext';

interface InlineEventCreatorProps {
  startDate: Date;
  endDate: Date;
  onCreated: () => void;
  onCancel: () => void;
  onMoreOptions: (title: string, color: string) => void;
}

const DEFAULT_COLORS = [
  '#007AFF', '#FF3B30', '#34C759', '#FFCC00', '#FF9500', '#AF52DE', '#FF2D92',
];

export const InlineEventCreator: React.FC<InlineEventCreatorProps> = ({
  startDate,
  endDate,
  onCreated,
  onCancel,
  onMoreOptions,
}) => {
  const {colors} = useTheme();
  const [title, setTitle] = useState('');
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLORS[0]);
  const [colorOptions, setColorOptions] = useState(DEFAULT_COLORS);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    getColorSettings().then(settings => {
      if (settings.length > 0) {
        setColorOptions(settings.map(s => s.color));
        setSelectedColor(settings[0].color);
      }
    });
    // Auto-focus
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const formatTime = (date: Date) =>
    `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

  const handleSave = useCallback(async () => {
    Keyboard.dismiss();
    try {
      const calendars = await RNCalendarEvents.findCalendars();
      const writable = calendars.filter(c => c.allowsModifications);
      if (writable.length === 0) {
        Alert.alert('エラー', '書き込み可能なカレンダーがありません');
        return;
      }
      const cal = writable.find(c => c.isPrimary) || writable[0];

      const eventId = await RNCalendarEvents.saveEvent(title.trim() || '(タイトルなし)', {
        calendarId: cal.id,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        allDay: false,
      });

      if (eventId) {
        await setEventColor(eventId, selectedColor);
      }
      onCreated();
    } catch {
      Alert.alert('エラー', '予定の保存に失敗しました');
    }
  }, [title, selectedColor, startDate, endDate, onCreated]);

  return (
    <View style={[styles.container, {backgroundColor: colors.surface}]}>
      {/* Time display */}
      <Text style={[styles.timeText, {color: colors.textSecondary}]}>
        {formatTime(startDate)} - {formatTime(endDate)}
      </Text>

      {/* Title input */}
      <TextInput
        ref={inputRef}
        style={[styles.titleInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
        placeholder="タイトル"
        placeholderTextColor={colors.textTertiary}
        value={title}
        onChangeText={setTitle}
        returnKeyType="done"
        onSubmitEditing={handleSave}
      />

      {/* Color dots */}
      <View style={styles.colorRow}>
        {colorOptions.slice(0, 6).map(color => (
          <TouchableOpacity
            key={color}
            style={[
              styles.colorDot,
              {backgroundColor: color},
              selectedColor === color && styles.colorDotSelected,
            ]}
            onPress={() => setSelectedColor(color)}
          />
        ))}
      </View>

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={[styles.cancelBtnText, {color: colors.textTertiary}]}>キャンセル</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => {
            Keyboard.dismiss();
            onMoreOptions(title, selectedColor);
          }}>
          <Text style={[styles.moreBtnText, {color: colors.primary}]}>詳細</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, {backgroundColor: colors.primary}]}
          onPress={handleSave}>
          <Text style={styles.saveBtnText}>保存</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  titleInput: {
    fontSize: 16,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  colorDotSelected: {
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  moreBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  moreBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default InlineEventCreator;
