// A single local calendar opened into a month view: header + month navigation +
// the month grid + an add button, plus the add/edit event modal. Reads & writes
// only the on-device localCalendarService.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {LocalCalendar, LocalEvent, getLocalEvents} from '../../services/localCalendarService';
import LocalCalendarMonth from './LocalCalendarMonth';
import LocalEventModal from './LocalEventModal';

interface Props {
  calendar: LocalCalendar;
  onBack: () => void;
}

const LocalCalendarDetail: React.FC<Props> = ({calendar, onBack}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [month, setMonth] = useState(() => new Date());
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<LocalEvent | null>(null);
  const [initialDate, setInitialDate] = useState(() => new Date());

  const reload = useCallback(async () => {
    setEvents(await getLocalEvents(calendar.id));
  }, [calendar.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const monthLabel = t('localCalMonthLabel', {
    year: month.getFullYear(),
    month: month.getMonth() + 1,
  });
  const shiftMonth = (delta: number) =>
    setMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const openNew = (date: Date) => {
    setEditing(null);
    setInitialDate(date);
    setModalVisible(true);
  };
  const openEdit = (e: LocalEvent) => {
    setEditing(e);
    setModalVisible(true);
  };
  const handleSaved = async () => {
    setModalVisible(false);
    await reload();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.emoji}>{calendar.emoji}</Text>
          <Text style={styles.title} numberOfLines={1}>{calendar.name}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.monthBar}>
        <TouchableOpacity style={styles.arrowBtn} onPress={() => shiftMonth(-1)}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMonth(new Date())}>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.arrowBtn} onPress={() => shiftMonth(1)}>
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <LocalCalendarMonth
        month={month}
        events={events}
        color={calendar.color}
        onDayPress={openNew}
        onEventPress={openEdit}
      />

      <TouchableOpacity
        style={[styles.fab, {backgroundColor: calendar.color}]}
        activeOpacity={0.85}
        onPress={() => openNew(new Date())}>
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      <LocalEventModal
        visible={modalVisible}
        calendarId={calendar.id}
        color={calendar.color}
        editing={editing}
        initialDate={initialDate}
        onClose={() => setModalVisible(false)}
        onSaved={handleSaved}
      />
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: colors.background},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: {width: 44, height: 32, justifyContent: 'center'},
    titleWrap: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
    emoji: {fontSize: 18},
    title: {fontSize: 17, fontWeight: '600', color: colors.text, maxWidth: '70%'},
    monthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    arrowBtn: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
    monthLabel: {fontSize: 17, fontWeight: '600', color: colors.text, minWidth: 130, textAlign: 'center'},
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 28,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 4,
    },
  });

export default LocalCalendarDetail;
