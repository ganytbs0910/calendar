// タイトルをタップして開く、他のカレンダーへの切り替えシート。
//
// カレンダー一覧まで戻らなくても、開いたまま別のカレンダーに移れるように。
// 一覧画面(LocalCalendarsScreen)が既に持っている calendars state を再利用する
// (呼び出し側から渡してもらう) — この画面自身では取得し直さない。

import React, {useMemo} from 'react';
import {View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {LocalCalendar} from '../../services/localCalendarService';

interface Props {
  visible: boolean;
  calendars: LocalCalendar[];
  currentCalendarId: string;
  onClose: () => void;
  onSelect: (calendarId: string) => void;
}

const CalendarSwitcherModal: React.FC<Props> = ({visible, calendars, currentCalendarId, onClose, onSelect}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[styles.card, {backgroundColor: colors.background}]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Text style={styles.close}>{t('close')}</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{t('localCalSwitchTitle', {defaultValue: 'カレンダーを切り替え'})}</Text>
            <View style={styles.headerBtn} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {calendars.map(cal => {
              const isCurrent = cal.id === currentCalendarId;
              return (
                <TouchableOpacity
                  key={cal.id}
                  style={[styles.row, {backgroundColor: colors.surface}]}
                  disabled={isCurrent}
                  onPress={() => {
                    onSelect(cal.id);
                    onClose();
                  }}>
                  <View style={[styles.avatar, {backgroundColor: cal.color + '22'}]}>
                    <Text style={styles.avatarEmoji}>{cal.emoji}</Text>
                  </View>
                  <Text style={[styles.rowText, {color: colors.text}, isCurrent && {color: colors.primary, fontWeight: '700'}]} numberOfLines={1}>
                    {cal.name}
                  </Text>
                  {isCurrent && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Shadow alone doesn't read as "this is a popup" against a background
    // that can be the same near-white/near-black as the card itself — a dim
    // scrim behind it is what actually separates the two, not the corner
    // radius or elevation. Kept moderate (not the old full-bleed 0.35 the
    // bottom-sheet version used) since the card itself is small and centered.
    overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24},
    card: {
      width: '100%',
      maxWidth: 360,
      maxHeight: '70%',
      borderRadius: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 16,
      shadowOffset: {width: 0, height: 8},
      elevation: 10,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerBtn: {width: 60, justifyContent: 'center'},
    close: {fontSize: 16, color: colors.primary},
    title: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.text},
    body: {padding: 16, gap: 8},
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    avatar: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
    avatarEmoji: {fontSize: 17},
    rowText: {flex: 1, fontSize: 16},
  });

export default CalendarSwitcherModal;
