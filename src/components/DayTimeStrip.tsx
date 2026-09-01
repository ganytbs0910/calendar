// ── DayTimeStrip — a 24h mini timeline, one colored segment ─────────────────
//
// Pure presentational preview of "when in the day" an event sits — used by
// AgentScreen's post-apply UndoToast so a glance confirms the event landed
// where expected before the undo window closes. No state, no logic.

import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';

const MINUTES_PER_DAY = 24 * 60;
const TICK_HOURS = [0, 6, 12, 18, 24];

export interface DayTimeStripProps {
  /** Minutes since midnight, 0–1439. */
  startMin: number;
  endMin: number;
  color: string;
  allDay?: boolean;
}

export const DayTimeStrip: React.FC<DayTimeStripProps> = ({startMin, endMin, color, allDay}) => {
  const {t} = useTranslation();

  if (allDay) {
    return (
      <View style={styles.container}>
        <View style={[styles.track, styles.allDayTrack, {backgroundColor: color}]}>
          <Text style={styles.allDayText}>{t('allDay')}</Text>
        </View>
      </View>
    );
  }

  const clampedStart = Math.max(0, Math.min(startMin, MINUTES_PER_DAY));
  const clampedEnd = Math.max(clampedStart, Math.min(endMin, MINUTES_PER_DAY));
  const leftPct = (clampedStart / MINUTES_PER_DAY) * 100;
  // A near-zero-duration event would render an invisible sliver — floor it
  // to a hairline so the segment always reads as "somewhere in the day".
  const widthPct = Math.max(1, ((clampedEnd - clampedStart) / MINUTES_PER_DAY) * 100);

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View
          style={[
            styles.segment,
            {left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: color},
          ]}
        />
      </View>
      <View style={styles.ticks}>
        {TICK_HOURS.map(h => (
          <Text key={h} style={styles.tickText}>{h}</Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {width: '100%'},
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
  allDayTrack: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
  },
  allDayText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  ticks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  tickText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.5)',
  },
});

export default DayTimeStrip;
