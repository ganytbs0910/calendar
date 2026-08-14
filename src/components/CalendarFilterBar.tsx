// ── CalendarFilterBar — filter the grid down to one colour category ─────────
//
// This row used to exist and was removed at some point, but only the row: the
// user-calendar store, the create/edit sheet and the `filterColor` plumbing in
// Calendar and WeekView all stayed. Nothing called setShowCalendarCreate, so
// the whole feature had no entry point — and had one ever been reached, the
// filter could be switched on but never off, because turning it off was this
// row's job too.
//
// Chips, not a menu: the point is to see at a glance which categories exist
// and which one is active, and to get back to "everything" in one tap.
//
// Verified on device 2026-08-14: tapping 仕事 leaves only the blue events on the
// grid and marks the chip active; tapping it again returns the month to exactly
// its unfiltered state.

import React from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';

import {useTheme} from '../theme/ThemeContext';
import {UserCalendar, resolveCalendarName} from '../services/userCalendarService';

interface Props {
  calendars: UserCalendar[];
  /** null = no filter, show every event. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (calendar: UserCalendar) => void;
}

const CalendarFilterBar: React.FC<Props> = ({
  calendars,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView is still a flex child: without this it grows to
      // fill the column and shoves the calendar down the screen.
      style={styles.bar}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled">
      <TouchableOpacity
        style={[
          styles.chip,
          {borderColor: colors.border, backgroundColor: colors.surface},
          selectedId === null && {backgroundColor: colors.primary, borderColor: colors.primary},
        ]}
        onPress={() => onSelect(null)}
        accessibilityRole="button"
        accessibilityState={{selected: selectedId === null}}>
        <Text
          style={[
            styles.chipText,
            {color: colors.textSecondary},
            selectedId === null && {color: colors.onPrimary},
          ]}>
          {t('calAll')}
        </Text>
      </TouchableOpacity>

      {calendars.map(cal => {
        const active = cal.id === selectedId;
        return (
          <TouchableOpacity
            key={cal.id}
            style={[
              styles.chip,
              {borderColor: colors.border, backgroundColor: colors.surface},
              active && {backgroundColor: cal.color, borderColor: cal.color},
            ]}
            onPress={() => onSelect(active ? null : cal.id)}
            onLongPress={() => onEdit(cal)}
            accessibilityRole="button"
            accessibilityState={{selected: active}}>
            {/* The dot carries the colour when the chip is inactive; when it is
                active the chip itself is that colour, so the dot would just be
                a hole in it. Either way the name is present, so the category is
                never conveyed by colour alone. */}
            {!active && <View style={[styles.dot, {backgroundColor: cal.color}]} />}
            <Text
              style={[
                styles.chipText,
                {color: colors.text},
                active && {color: colors.onPrimary},
              ]}
              numberOfLines={1}>
              {/* Seeded categories carry only a translation key, so reading
                  cal.name directly would render an empty chip for every one
                  of the defaults. */}
              {resolveCalendarName(cal, t)}
            </Text>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        style={[styles.addChip, {borderColor: colors.border}]}
        onPress={onCreate}
        accessibilityRole="button"
        accessibilityLabel={t('calCreateTitle')}>
        <Ionicons name="add" size={16} color={colors.textSecondary} />
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  bar: {flexGrow: 0, flexShrink: 0},
  row: {paddingHorizontal: 10, paddingBottom: 6, gap: 6, alignItems: 'center'},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    // 30pt tall inside a row that is itself part of a 44pt band; the chips sit
    // far from any other target, so the row height is the limit, not the chip.
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 160,
  },
  chipText: {fontSize: 13, fontWeight: '600'},
  dot: {width: 8, height: 8, borderRadius: 4},
  addChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(CalendarFilterBar);
