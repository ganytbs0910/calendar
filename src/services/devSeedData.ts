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
const CLEANUP_FLAG_KEY = '@dev_cleaned_2026_04';
const JUNE_SEED_FLAG_KEY = '@dev_seeded_2026_06';
const JUNE_CLEANUP_FLAG_KEY = '@dev_cleaned_2026_06';

const COLORS = {
  work: '#007AFF',     // blue — 仕事
  important: '#FF3B30', // red — 大事
  play: '#34C759',      // green — 遊び
  other: '#FFCC00',     // yellow — その他
  schedule: '#FF2D92',  // pink — 予定
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

// June 2026 — 大学生らしい予定表。授業・バイト・サークル中心の週次パターンに、
// レポート締切・飲み会・帰省・期末テストなどの単発予定を混ぜている。
// June 1 is a Monday. Colors: 授業=work(青) / バイト=purple(紫) / 締切・テスト=important(赤)
// / サークル=schedule(ピンク) / 遊び=play(緑) / その他=other(黄).
const JUNE_SEEDS: Seed[] = [
  // Week of Jun 1 (Mon–Sun)
  {title: 'マクロ経済学', y: 2026, m: 6, d: 1, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '英語コミュニケーション', y: 2026, m: 6, d: 1, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '統計学', y: 2026, m: 6, d: 2, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 2, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'プログラミング演習', y: 2026, m: 6, d: 3, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '心理学', y: 2026, m: 6, d: 3, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'テニスサークル', y: 2026, m: 6, d: 3, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'マーケティング論', y: 2026, m: 6, d: 4, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 4, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'ゼミ', y: 2026, m: 6, d: 5, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 6, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'サークルの飲み会', y: 2026, m: 6, d: 6, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'TOEIC勉強', y: 2026, m: 6, d: 7, startH: 15, startMin: 0, durationMin: 120, color: COLORS.other},

  // Week of Jun 8
  {title: 'マクロ経済学', y: 2026, m: 6, d: 8, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '英語コミュニケーション', y: 2026, m: 6, d: 8, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '締切: 心理学レポート', y: 2026, m: 6, d: 8, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: '統計学', y: 2026, m: 6, d: 9, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 9, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'プログラミング演習', y: 2026, m: 6, d: 10, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '心理学', y: 2026, m: 6, d: 10, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'テニスサークル', y: 2026, m: 6, d: 10, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'マーケティング論', y: 2026, m: 6, d: 11, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 11, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'ゼミ', y: 2026, m: 6, d: 12, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: '友達とランチ', y: 2026, m: 6, d: 12, startH: 12, startMin: 0, durationMin: 90, color: COLORS.play},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 13, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'カラオケ', y: 2026, m: 6, d: 13, startH: 18, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: '映画', y: 2026, m: 6, d: 14, startH: 14, startMin: 0, durationMin: 150, color: COLORS.play},

  // Week of Jun 15
  {title: 'マクロ経済学', y: 2026, m: 6, d: 15, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '英語コミュニケーション', y: 2026, m: 6, d: 15, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '統計学', y: 2026, m: 6, d: 16, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 16, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: '健康診断', y: 2026, m: 6, d: 17, startH: 9, startMin: 0, durationMin: 60, color: COLORS.other},
  {title: '心理学', y: 2026, m: 6, d: 17, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'テニスサークル', y: 2026, m: 6, d: 17, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'マーケティング論', y: 2026, m: 6, d: 18, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 18, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'ゼミ', y: 2026, m: 6, d: 19, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'ゼミ飲み', y: 2026, m: 6, d: 19, startH: 19, startMin: 0, durationMin: 150, color: COLORS.play},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 20, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: '帰省', y: 2026, m: 6, d: 21, startH: 0, startMin: 0, durationMin: 0, color: COLORS.other, allDay: true},

  // Week of Jun 22
  {title: 'マクロ経済学', y: 2026, m: 6, d: 22, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '英語コミュニケーション', y: 2026, m: 6, d: 22, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '統計学', y: 2026, m: 6, d: 23, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 23, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'プログラミング演習', y: 2026, m: 6, d: 24, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '心理学', y: 2026, m: 6, d: 24, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'テニスサークル', y: 2026, m: 6, d: 24, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'マーケティング論', y: 2026, m: 6, d: 25, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 25, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'ゼミ', y: 2026, m: 6, d: 26, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: '締切: ゼミ期末レポート', y: 2026, m: 6, d: 26, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 27, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: '友達の誕生日会', y: 2026, m: 6, d: 27, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'テスト勉強', y: 2026, m: 6, d: 28, startH: 13, startMin: 0, durationMin: 180, color: COLORS.important},

  // Week of Jun 29 (期末テスト)
  {title: '期末テスト: マクロ経済学', y: 2026, m: 6, d: 29, startH: 9, startMin: 0, durationMin: 90, color: COLORS.important},
  {title: '英語コミュニケーション', y: 2026, m: 6, d: 29, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: '期末テスト: 統計学', y: 2026, m: 6, d: 30, startH: 10, startMin: 40, durationMin: 90, color: COLORS.important},
  {title: 'バイト (カフェ)', y: 2026, m: 6, d: 30, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
];

const makeIso = (y: number, mo: number, d: number, h: number, mi: number) => {
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  return dt.toISOString();
};

/** Persist a list of seeds to the device calendar, applying per-event colors. */
const persistSeeds = async (seeds: Seed[]): Promise<void> => {
  for (const s of seeds) {
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
};

export const seedDevEventsIfNeeded = async (): Promise<void> => {
  if (!__DEV__) return;
  try {
    const already = await AsyncStorage.getItem(SEED_FLAG_KEY);
    if (already === '1') return;
    await persistSeeds(SEEDS);
    await AsyncStorage.setItem(SEED_FLAG_KEY, '1');
  } catch (e) {
    console.warn('[devSeedData] seeding failed:', e);
  }
};

/** Seed June 2026 with a college-student schedule (classes, part-time, circles). */
export const seedDevJuneEventsIfNeeded = async (): Promise<void> => {
  if (!__DEV__) return;
  try {
    const already = await AsyncStorage.getItem(JUNE_SEED_FLAG_KEY);
    if (already === '1') return;
    await persistSeeds(JUNE_SEEDS);
    await AsyncStorage.setItem(JUNE_SEED_FLAG_KEY, '1');
  } catch (e) {
    console.warn('[devSeedData] June seeding failed:', e);
  }
};

/** Reset the seed flag so the next app start will re-seed. */
export const resetDevSeedFlag = async (): Promise<void> => {
  await AsyncStorage.removeItem(SEED_FLAG_KEY);
};

/**
 * Remove previously-seeded April 2026 events from the device calendar.
 *
 * Matches events by (title + start timestamp) against the SEEDS list, so
 * unrelated user events with similar titles are left untouched. Runs once
 * (guarded by CLEANUP_FLAG_KEY); call resetDevCleanupFlag to re-run.
 */
export const clearDevSeedEvents = async (): Promise<number> => {
  if (!__DEV__) return 0;
  try {
    const already = await AsyncStorage.getItem(CLEANUP_FLAG_KEY);
    if (already === '1') return 0;

    const seedKeys = new Set(
      SEEDS.map(s => {
        const ts = new Date(s.y, s.m - 1, s.d, s.startH, s.startMin, 0, 0).getTime();
        return `${s.title}__${ts}`;
      })
    );

    const rangeStart = new Date(2026, 3, 1, 0, 0, 0, 0).toISOString();
    const rangeEnd = new Date(2026, 4, 0, 23, 59, 59, 999).toISOString();
    const events = await RNCalendarEvents.fetchAllEvents(rangeStart, rangeEnd);

    let deleted = 0;
    for (const ev of events) {
      if (!ev.id || !ev.title || !ev.startDate) continue;
      const ts = new Date(ev.startDate).getTime();
      const key = `${ev.title}__${ts}`;
      if (seedKeys.has(key)) {
        try {
          await RNCalendarEvents.removeEvent(ev.id);
          deleted += 1;
        } catch (e) {
          console.warn('[devSeedData] failed to remove event', ev.id, e);
        }
      }
    }

    await AsyncStorage.setItem(CLEANUP_FLAG_KEY, '1');
    // Also clear the seed flag so the SEED_FLAG_KEY no longer reflects a populated calendar.
    await AsyncStorage.removeItem(SEED_FLAG_KEY);
    if (deleted > 0) {
      console.log(`[devSeedData] removed ${deleted} seeded events from April 2026`);
    }
    return deleted;
  } catch (e) {
    console.warn('[devSeedData] cleanup failed:', e);
    return 0;
  }
};

/** Reset the cleanup flag so the next app start will re-clean. */
export const resetDevCleanupFlag = async (): Promise<void> => {
  await AsyncStorage.removeItem(CLEANUP_FLAG_KEY);
};

/** Reset the June seed flag so the next app start will re-seed June 2026. */
export const resetDevJuneSeedFlag = async (): Promise<void> => {
  await AsyncStorage.removeItem(JUNE_SEED_FLAG_KEY);
};

/**
 * Remove previously-seeded June 2026 college events from the device calendar.
 * Matches by (title + start timestamp) against JUNE_SEEDS, so unrelated user
 * events are left untouched. Runs once (guarded by JUNE_CLEANUP_FLAG_KEY).
 */
export const clearDevJuneSeedEvents = async (): Promise<number> => {
  if (!__DEV__) return 0;
  try {
    const already = await AsyncStorage.getItem(JUNE_CLEANUP_FLAG_KEY);
    if (already === '1') return 0;

    const seedKeys = new Set(
      JUNE_SEEDS.map(s => {
        const ts = new Date(s.y, s.m - 1, s.d, s.startH, s.startMin, 0, 0).getTime();
        return `${s.title}__${ts}`;
      })
    );

    const rangeStart = new Date(2026, 5, 1, 0, 0, 0, 0).toISOString();
    const rangeEnd = new Date(2026, 6, 0, 23, 59, 59, 999).toISOString();
    const events = await RNCalendarEvents.fetchAllEvents(rangeStart, rangeEnd);

    let deleted = 0;
    for (const ev of events) {
      if (!ev.id || !ev.title || !ev.startDate) continue;
      const ts = new Date(ev.startDate).getTime();
      const key = `${ev.title}__${ts}`;
      if (seedKeys.has(key)) {
        try {
          await RNCalendarEvents.removeEvent(ev.id);
          deleted += 1;
        } catch (e) {
          console.warn('[devSeedData] failed to remove June event', ev.id, e);
        }
      }
    }

    await AsyncStorage.setItem(JUNE_CLEANUP_FLAG_KEY, '1');
    await AsyncStorage.removeItem(JUNE_SEED_FLAG_KEY);
    if (deleted > 0) {
      console.log(`[devSeedData] removed ${deleted} seeded events from June 2026`);
    }
    return deleted;
  } catch (e) {
    console.warn('[devSeedData] June cleanup failed:', e);
    return 0;
  }
};
