// Add / edit / delete an event inside a local calendar. Saves straight to the
// on-device localCalendarService — never touches EventKit. Date & time use the
// native @react-native-community/datetimepicker already in the project.

import React, {useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Switch,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {LocalEvent, saveLocalEvent, deleteLocalEvent} from '../../services/localCalendarService';
import {ymd} from './LocalCalendarMonth';

interface Props {
  visible: boolean;
  calendarId: string;
  color: string;
  creatorId?: string;
  editing: LocalEvent | null;
  initialDate: Date;
  onClose: () => void;
  onSaved: () => void;
}

const parseDate = (s: string): Date => {
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? new Date() : d;
};
const parseTime = (base: Date, hhmm?: string): Date => {
  const d = new Date(base);
  if (hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
  }
  return d;
};
const fmtTime = (d: Date): string => {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h < 10 ? '0' + h : h}:${m < 10 ? '0' + m : m}`;
};

type PickerField = 'start' | 'end' | 'startTime' | 'endTime' | null;

const LocalEventModal: React.FC<Props> = ({
  visible,
  calendarId,
  color,
  creatorId,
  editing,
  initialDate,
  onClose,
  onSaved,
}) => {
  const {colors, isDark} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState<Date>(initialDate);
  const [endDate, setEndDate] = useState<Date>(initialDate);
  const [startTime, setStartTime] = useState<Date>(() => parseTime(initialDate, '09:00'));
  const [endTime, setEndTime] = useState<Date>(() => parseTime(initialDate, '10:00'));
  const [memo, setMemo] = useState('');
  const [picker, setPicker] = useState<PickerField>(null);

  // Reset the form whenever the modal opens (for create or for a given event).
  useEffect(() => {
    if (!visible) return;
    setPicker(null);
    if (editing) {
      setTitle(editing.title);
      setAllDay(editing.allDay);
      setStartDate(parseDate(editing.startDate));
      setEndDate(parseDate(editing.endDate || editing.startDate));
      setStartTime(parseTime(parseDate(editing.startDate), editing.startTime || '09:00'));
      setEndTime(parseTime(parseDate(editing.endDate || editing.startDate), editing.endTime || '10:00'));
      setMemo(editing.memo ?? '');
    } else {
      setTitle('');
      setAllDay(true);
      setStartDate(initialDate);
      setEndDate(initialDate);
      setStartTime(parseTime(initialDate, '09:00'));
      setEndTime(parseTime(initialDate, '10:00'));
      setMemo('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert(t('localEventNeedTitle'));
      return;
    }
    let sDate = startDate;
    let eDate = endDate;
    if (eDate < sDate) eDate = sDate; // keep range sane
    await saveLocalEvent({
      id: editing?.id,
      createdAt: editing?.createdAt,
      calendarId,
      title: trimmed,
      startDate: ymd(sDate),
      endDate: ymd(eDate),
      allDay,
      startTime: allDay ? undefined : fmtTime(startTime),
      endTime: allDay ? undefined : fmtTime(endTime),
      memo: memo.trim() || undefined,
      creatorId: editing?.creatorId ?? creatorId,
    });
    onSaved();
  };

  const handleDelete = () => {
    if (!editing) return;
    Alert.alert(t('localEventDeleteTitle'), undefined, [
      {text: t('cancel'), style: 'cancel'},
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteLocalEvent(calendarId, editing.id);
          onSaved();
        },
      },
    ]);
  };

  const onPickerChange = (field: PickerField, _e: any, d?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (!d) return;
    if (field === 'start') {
      setStartDate(d);
      if (endDate < d) setEndDate(d);
    } else if (field === 'end') {
      setEndDate(d);
    } else if (field === 'startTime') {
      setStartTime(d);
    } else if (field === 'endTime') {
      setEndTime(d);
    }
  };

  const dateLabel = (d: Date) =>
    t('localEventDateFormat', {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });

  // Plain function (not a nested component) so it doesn't remount on each render.
  const renderRow = (label: string, value: string, field: Exclude<PickerField, null>) => (
    <React.Fragment key={field}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => setPicker(picker === field ? null : field)}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={[styles.rowValue, picker === field && {color: colors.primary}]}>{value}</Text>
      </TouchableOpacity>
      {picker === field && (
        <DateTimePicker
          value={
            field === 'start' ? startDate : field === 'end' ? endDate : field === 'startTime' ? startTime : endTime
          }
          mode={field === 'start' || field === 'end' ? 'date' : 'time'}
          display="spinner"
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(e, d) => onPickerChange(field, e, d)}
        />
      )}
    </React.Fragment>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={{width: 64}}>
            <Text style={styles.cancel}>{t('cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {editing ? t('localEventEdit') : t('localEventNew')}
          </Text>
          <TouchableOpacity onPress={handleSave} style={{width: 64}}>
            <Text style={styles.save}>{t('save')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{paddingBottom: 40}} keyboardShouldPersistTaps="handled">
          <View style={styles.titleWrap}>
            <View style={[styles.colorDot, {backgroundColor: color}]} />
            <TextInput
              style={styles.titleInput}
              placeholder={t('localEventTitlePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              autoFocus={!editing}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('localEventAllDay')}</Text>
              <Switch
                value={allDay}
                onValueChange={setAllDay}
                trackColor={{true: color}}
              />
            </View>
            {renderRow(t('localEventStart'), dateLabel(startDate), 'start')}
            {!allDay && renderRow(t('localEventStartTime'), fmtTime(startTime), 'startTime')}
            {renderRow(t('localEventEnd'), dateLabel(endDate), 'end')}
            {!allDay && renderRow(t('localEventEndTime'), fmtTime(endTime), 'endTime')}
          </View>

          <View style={styles.card}>
            <TextInput
              style={styles.memoInput}
              placeholder={t('localEventMemoPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={memo}
              onChangeText={setMemo}
              multiline
            />
          </View>

          {editing && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <Text style={styles.deleteText}>{t('delete')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: colors.background},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: {fontSize: 17, fontWeight: '600', color: colors.text},
    cancel: {fontSize: 16, color: colors.textSecondary},
    save: {fontSize: 16, color: colors.primary, fontWeight: '700', textAlign: 'right'},
    titleWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      marginTop: 16,
      marginHorizontal: 16,
      borderRadius: 12,
      paddingHorizontal: 14,
    },
    colorDot: {width: 12, height: 12, borderRadius: 6},
    titleInput: {flex: 1, fontSize: 17, color: colors.text, paddingVertical: 14},
    card: {
      backgroundColor: colors.surface,
      marginTop: 16,
      marginHorizontal: 16,
      borderRadius: 12,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    rowLabel: {fontSize: 15, color: colors.text},
    rowValue: {fontSize: 15, color: colors.textSecondary},
    memoInput: {fontSize: 15, color: colors.text, padding: 14, minHeight: 90, textAlignVertical: 'top'},
    deleteBtn: {
      marginTop: 24,
      marginHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.errorBackground,
      alignItems: 'center',
    },
    deleteText: {fontSize: 16, color: colors.delete, fontWeight: '600'},
  });

export default LocalEventModal;
