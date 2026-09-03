// Lightweight month grid for a single local calendar. Purely presentational:
// it receives the month + that calendar's events and reports day/event taps.
// Deliberately separate from the EventKit-bound main Calendar so the on-device
// store stays simple (single/multi-day chips, no drag-drop or recurrence).

import React, {useMemo} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {LocalEvent} from '../../services/localCalendarService';
import {ShareMember} from '../../services/sharedCalendarService';

interface Props {
  month: Date; // any date within the month to display
  events: LocalEvent[];
  color: string; // the calendar's color, used for event chips
  members: ShareMember[];
  onDayPress: (date: Date) => void;
  onEventPress: (event: LocalEvent) => void;
}

export const ymd = (d: Date): string => {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`;
};

const MAX_CHIPS = 2;

const LocalCalendarMonth: React.FC<Props> = ({month, events, color, members, onDayPress, onEventPress}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Match the home calendar: only this month's dates are shown, with blank
  // leading/trailing cells and only the number of week rows actually needed.
  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cellCount = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
    const out: Array<Array<Date | null>> = [];
    let dayNumber = 1 - first.getDay();
    for (let w = 0; w < cellCount / 7; w++) {
      const row: Array<Date | null> = [];
      for (let d = 0; d < 7; d++) {
        row.push(dayNumber >= 1 && dayNumber <= daysInMonth
          ? new Date(month.getFullYear(), month.getMonth(), dayNumber)
          : null);
        dayNumber++;
      }
      out.push(row);
    }
    return out;
  }, [month]);

  // date string -> events on that day (an event shows on every day in its range)
  const byDay = useMemo(() => {
    const map: Record<string, LocalEvent[]> = {};
    for (const e of events) {
      const s = new Date(e.startDate + 'T00:00:00');
      const end = new Date((e.endDate || e.startDate) + 'T00:00:00');
      const cur = new Date(s);
      // guard against inverted/huge ranges
      let guard = 0;
      while (cur <= end && guard < 400) {
        const key = ymd(cur);
        (map[key] = map[key] ?? []).push(e);
        cur.setDate(cur.getDate() + 1);
        guard++;
      }
    }
    // sort each day: all-day first, then by start time
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
    }
    return map;
  }, [events]);

  const todayStr = ymd(new Date());
  const weekdays = t('weekdaysSingle', {returnObjects: true}) as string[];
  const memberColors = useMemo(
    () => new Map(members.map(member => [member.id, member.color])),
    [members],
  );

  return (
    <View style={styles.container}>
      <View style={styles.weekHeader}>
        {weekdays.map((label, i) => (
          <Text
            key={i}
            style={[
              styles.weekHeaderText,
              i === 0 && {color: colors.sunday},
              i === 6 && {color: colors.saturday},
            ]}>
            {label}
          </Text>
        ))}
      </View>
      <ScrollView contentContainerStyle={{paddingBottom: 12}}>
        {weeks.map((row, wi) => (
          <View key={wi} style={styles.weekRow}>
            {row.map((day, di) => {
              if (!day) {
                return <View key={`empty-${wi}-${di}`} style={styles.dayCell} />;
              }
              const key = ymd(day);
              const isToday = key === todayStr;
              const dayEvents = byDay[key] ?? [];
              const dow = day.getDay();
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.dayCell}
                  activeOpacity={0.6}
                  onPress={() => onDayPress(day)}>
                  <View style={[styles.dayNumWrap, isToday && {backgroundColor: colors.primary}]}>
                    <Text
                      style={[
                        styles.dayNum,
                        dow === 0 && {color: colors.sunday},
                        dow === 6 && {color: colors.saturday},
                        isToday && {color: colors.onPrimary, fontWeight: '700'},
                      ]}>
                      {day.getDate()}
                    </Text>
                  </View>
                  <View style={styles.chips}>
                    {dayEvents.slice(0, MAX_CHIPS).map(e => (
                      <TouchableOpacity
                        key={e.id}
                        activeOpacity={0.7}
                        onPress={() => onEventPress(e)}
                        style={[styles.chip, {backgroundColor: (e.creatorId && memberColors.get(e.creatorId)) || color}]}>
                        {!e.allDay && e.startTime && (
                          <Text style={styles.chipTime} numberOfLines={1}>{e.startTime}</Text>
                        )}
                        {!e.allDay && e.endTime && (
                          <Text style={styles.chipTime} numberOfLines={1}>{e.endTime}</Text>
                        )}
                        <Text style={styles.chipText} numberOfLines={1}>{e.title}</Text>
                      </TouchableOpacity>
                    ))}
                    {dayEvents.length > MAX_CHIPS && (
                      <Text style={styles.moreText}>+{dayEvents.length - MAX_CHIPS}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1},
    weekHeader: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingVertical: 6,
    },
    weekHeaderText: {flex: 1, textAlign: 'center', fontSize: 12, color: colors.textSecondary},
    weekRow: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
      minHeight: 128,
    },
    dayCell: {
      flex: 1,
      paddingTop: 4,
      paddingHorizontal: 2,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.borderLight,
    },
    dayNumWrap: {
      alignSelf: 'center',
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    dayNum: {fontSize: 13, color: colors.text},
    chips: {marginTop: 3, gap: 3},
    chip: {borderRadius: 5, paddingHorizontal: 4, paddingVertical: 3, minHeight: 42},
    chipTime: {color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 12},
    chipText: {color: '#fff', fontSize: 10, fontWeight: '600', lineHeight: 12},
    moreText: {fontSize: 9, color: colors.textSecondary, paddingHorizontal: 4},
  });

export default LocalCalendarMonth;
