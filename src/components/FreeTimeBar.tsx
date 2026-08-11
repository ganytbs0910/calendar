// ── FreeTimeBar — today's remaining free time, above the calendar ───────────
//
// The one number the app is organised around, kept to a single line directly
// under the header so it reads as part of the calendar rather than a widget
// bolted on top.
//
// Without a sleep schedule there is no "awake" to subtract from, so the bar
// turns into the invitation to set one — which is also where a user who
// dismissed the first-run prompt with "later" gets a second chance.

import React, {useCallback, useEffect, useState} from 'react';
import {AppState, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';

import {useTheme} from '../theme/ThemeContext';
import {SleepSettings} from '../services/sleepSettingsService';
import {getTodayFreeTime} from '../services/freeTimeService';

interface Props {
  sleepSettings: SleepSettings | null;
  /** Opens the sleep schedule setup, for when there is nothing to show yet. */
  onSetup: () => void;
  /** Bumped by the host whenever events change, to force a recount. */
  refreshKey?: number;
}

const RECOUNT_INTERVAL_MS = 60000;

const FreeTimeBar: React.FC<Props> = ({sleepSettings, onSetup, refreshKey}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const [freeMin, setFreeMin] = useState<number | null>(null);

  const recount = useCallback(async () => {
    if (!sleepSettings) {
      setFreeMin(null);
      return;
    }
    const {freeMin: min} = await getTodayFreeTime(sleepSettings);
    setFreeMin(min);
  }, [sleepSettings]);

  // The figure decays in real time, so it is recounted on a timer as well as
  // whenever the events behind it change or the app comes back to the front.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      recount().catch(() => {
        if (!cancelled) setFreeMin(null);
      });
    };
    run();
    const timer = setInterval(run, RECOUNT_INTERVAL_MS);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') run();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [recount, refreshKey]);

  const styles = makeStyles();

  if (!sleepSettings) {
    return (
      <TouchableOpacity
        style={[styles.bar, {backgroundColor: colors.surface, borderColor: colors.border}]}
        onPress={onSetup}
        accessibilityRole="button"
        accessibilityLabel={t('freeTimeSetupCta')}>
        <Ionicons name="moon-outline" size={15} color={colors.textSecondary} />
        <Text style={[styles.setupText, {color: colors.textSecondary}]} numberOfLines={1}>
          {t('freeTimeSetupCta')}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  }

  // Hold the previous line until the first count lands, so the bar doesn't
  // flash empty on every mount.
  if (freeMin === null) return null;

  const h = Math.floor(freeMin / 60);
  const m = freeMin % 60;
  const value =
    h > 0 && m > 0
      ? t('hoursMinutesFmt', {h, m})
      : h > 0
      ? t('hoursFmt', {h})
      : t('minutesFmt', {m});

  return (
    <View style={[styles.bar, {backgroundColor: colors.surface, borderColor: colors.border}]}>
      <Ionicons name="cafe-outline" size={15} color={colors.primary} />
      <Text style={[styles.label, {color: colors.textSecondary}]} numberOfLines={1}>
        {t('freeTimeLabel')}
      </Text>
      <Text style={[styles.value, {color: colors.primary}]}>{value}</Text>
    </View>
  );
};

const makeStyles = () =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: 10,
      marginBottom: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
    },
    label: {flex: 1, fontSize: 13},
    setupText: {flex: 1, fontSize: 13},
    value: {fontSize: 15, fontWeight: '700'},
  });

export default React.memo(FreeTimeBar);
