/**
 * Dev-only sample data seeder.
 *
 * When running in __DEV__ mode, populate April 2026 with a variety of events
 * so the UI can be inspected without manually creating data.
 *
 * Re-running is safe — the function checks an AsyncStorage flag and bails
 * out early if seeding was already performed. Delete the flag (or the events
 * themselves) to re-seed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNCalendarEvents from 'react-native-calendar-events';
import {setEventColor} from '../components/AddEventModal';

const SEED_FLAG_KEY = '@dev_seeded_2026_04';

const COLORS = {
  work: '#007AFF',     // blue — 仕事
  important: '#FF3B30', // red — 大事
  play: '#34C759',      // green — 遊び
  other: '#FFCC00',     // yellow — その他
  schedule: '#FF2D95',  // pink — 予定
  purple: '#AF52DE',
};

type Seed = {
  title: string;
  y: number;
  m: number; // 1-based
  d: number;
  startH: number;
  startMin: number;
  durationMin: number;
  color?: string;
  allDay?: boolean;
};

// All dates are in 2026 April. Keep the set broad so it covers several weeks
// and includes a mix of durations, categories, and all-day entries.
const SEEDS: Seed[] = [
  // Week of Apr 6 (Mon–Sun)
  {title: '朝会', y: 2026, m: 4, d: 6, startH: 9, startMin: 0, durationMin: 30, color: COLORS.work},
  {title: '設計レビュー', y: 2026, m: 4, d: 6, startH: 14, startMin: 0, durationMin: 90, color: COLORS.important},
  {title: '1on1 (田中さん)', y: 2026, m: 4, d: 7, startH: 10, startMin: 0, durationMin: 60, color: COLORS.work},
  {title: 'ハッカソン', y: 2026, m: 4, d: 7, startH: 13, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: '締切: プロジェクトA', y: 2026, m: 4, d: 8, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: 'ランチミーティング', y: 2026, m: 4, d: 8, startH: 12, startMin: 0, durationMin: 60, color: COLORS.other},
  {title: 'スタンドアップ', y: 2026, m: 4, d: 9, startH: 9, startMin: 30, durationMin: 15, color: COLORS.work},
  {title: '技術勉強会', y: 2026, m: 4, d: 9, startH: 16, startMin: 0, durationMin: 120, color: COLORS.play},
  {title: '定例会議', y: 2026, m: 4, d: 10, startH: 10, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '送別会', y: 2026, m: 4, d: 10, startH: 18, startMin: 30, durationMin: 120, color: COLORS.schedule},
  {title: 'ジム', y: 2026, m: 4, d: 11, startH: 10, startMin: 0, durationMin: 90, color: COLORS.play},
  {title: '家族と外出', y: 2026, m: 4, d: 12, startH: 0, startMin: 0, durationMin: 0, color: COLORS.other, allDay: true},

  // Week of Apr 13
  {title: '週次MTG', y: 2026, m: 4, d: 13, startH: 10, startMin: 0, durationMin: 60, color: COLORS.work},
  {title: 'デザインレビュー', y: 2026, m: 4, d: 13, startH: 15, startMin: 0, durationMin: 60, color: COLORS.work},
  {title: 'クライアント訪問', y: 2026, m: 4, d: 14, startH: 14, startMin: 0, durationMin: 120, color: COLORS.important},
  {title: '朝会', y: 2026, m: 4, d: 15, startH: 9, startMin: 0, durationMin: 30, color: COLORS.work},
  {title: 'ペアプロ', y: 2026, m: 4, d: 15, startH: 13, startMin: 0, durationMin: 180, color: COLORS.work},
  {title: 'ランチ (友人)', y: 2026, m: 4, d: 16, startH: 12, startMin: 30, durationMin: 60, color: COLORS.play},
  {title: '会社イベント', y: 2026, m: 4, d: 17, startH: 0, startMin: 0, durationMin: 0, color: COLORS.purple, allDay: true},

  // Week of Apr 20
  {title: 'キックオフ', y: 2026, m: 4, d: 20, startH: 10, startMin: 0, durationMin: 60, color: COLORS.important},
  {title: '仕様策定', y: 2026, m: 4, d: 21, startH: 14, startMin: 0, durationMin: 120, color: COLORS.work},
  {title: '面談', y: 2026, m: 4, d: 22, startH: 14, startMin: 0, durationMin: 60, color: COLORS.work},
  {title: 'ワークショップ', y: 2026, m: 4, d: 24, startH: 9, startMin: 0, durationMin: 480, color: COLORS.purple},
  {title: '映画', y: 2026, m: 4, d: 25, startH: 19, startMin: 0, durationMin: 150, color: COLORS.play},

  // Week of Apr 27
  {title: '部会', y: 2026, m: 4, d: 27, startH: 11, startMin: 0, durationMin: 60, color: COLORS.work},
  {title: '休暇', y: 2026, m: 4, d: 29, startH: 0, startMin: 0, durationMin: 0, color: COLORS.other, allDay: true},
  {title: '月末レビュー', y: 2026, m: 4, d: 30, startH: 16, startMin: 0, durationMin: 90, color: COLORS.important},
];

const makeIso = (y: number, mo: number, d: number, h: number, mi: number) => {
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  return dt.toISOString();
};

export const seedDevEventsIfNeeded = async (): Promise<void> => {
  if (!__DEV__) return;
  try {
    const already = await AsyncStorage.getItem(SEED_FLAG_KEY);
    if (already === '1') return;

    for (const s of SEEDS) {
      const startDate = makeIso(s.y, s.m, s.d, s.startH, s.startMin);
      const endDate = s.allDay
        ? makeIso(s.y, s.m, s.d, 23, 59)
        : (() => {
            const end = new Date(s.y, s.m - 1, s.d, s.startH, s.startMin + s.durationMin, 0, 0);
            return end.toISOString();
          })();

      const id = await RNCalendarEvents.saveEvent(s.title, {
        startDate,
        endDate,
        allDay: !!s.allDay,
      });
      if (id && s.color) {
        await setEventColor(id, s.color);
      }
    }

    await AsyncStorage.setItem(SEED_FLAG_KEY, '1');
  } catch (e) {
    console.warn('[devSeedData] seeding failed:', e);
  }
};

/** Reset the seed flag so the next app start will re-seed. */
export const resetDevSeedFlag = async (): Promise<void> => {
  await AsyncStorage.removeItem(SEED_FLAG_KEY);
};
