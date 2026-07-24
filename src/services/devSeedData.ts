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
const JUNE_SEED_FLAG_KEY = '@dev_seeded_2026_06_en';
const JUNE_CLEANUP_FLAG_KEY = '@dev_cleaned_2026_06_en';
// Bumped to _en when the May titles were translated, so a device that already
// seeded the JP set re-runs cleanup + seeding once and ends up with English.
const MAY_SEED_FLAG_KEY = '@dev_seeded_2026_05_en';
const MAY_CLEANUP_FLAG_KEY = '@dev_cleaned_2026_05_en';
const SUMMER_SEED_FLAG_KEY = '@dev_seeded_2026_summer';
const SUMMER_CLEANUP_FLAG_KEY = '@dev_cleaned_2026_summer';

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
  {title: 'Movie', y: 2026, m: 4, d: 25, startH: 19, startMin: 0, durationMin: 150, color: COLORS.play},

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
  {title: 'Macroeconomics', y: 2026, m: 6, d: 1, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'English class', y: 2026, m: 6, d: 1, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Statistics', y: 2026, m: 6, d: 2, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 2, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Programming lab', y: 2026, m: 6, d: 3, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Psychology', y: 2026, m: 6, d: 3, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 6, d: 3, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Marketing', y: 2026, m: 6, d: 4, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 4, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Seminar', y: 2026, m: 6, d: 5, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 6, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Club night out', y: 2026, m: 6, d: 6, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'TOEIC prep', y: 2026, m: 6, d: 7, startH: 15, startMin: 0, durationMin: 120, color: COLORS.other},

  // Week of Jun 8
  {title: 'Macroeconomics', y: 2026, m: 6, d: 8, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'English class', y: 2026, m: 6, d: 8, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Due: Psychology report', y: 2026, m: 6, d: 8, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: 'Statistics', y: 2026, m: 6, d: 9, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 9, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Programming lab', y: 2026, m: 6, d: 10, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Psychology', y: 2026, m: 6, d: 10, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 6, d: 10, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Marketing', y: 2026, m: 6, d: 11, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 11, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Seminar', y: 2026, m: 6, d: 12, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Lunch with friends', y: 2026, m: 6, d: 12, startH: 12, startMin: 0, durationMin: 90, color: COLORS.play},
  {title: 'Café shift', y: 2026, m: 6, d: 13, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Karaoke', y: 2026, m: 6, d: 13, startH: 18, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'Movie', y: 2026, m: 6, d: 14, startH: 14, startMin: 0, durationMin: 150, color: COLORS.play},

  // Week of Jun 15
  {title: 'Macroeconomics', y: 2026, m: 6, d: 15, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'English class', y: 2026, m: 6, d: 15, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Statistics', y: 2026, m: 6, d: 16, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 16, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Health checkup', y: 2026, m: 6, d: 17, startH: 9, startMin: 0, durationMin: 60, color: COLORS.other},
  {title: 'Psychology', y: 2026, m: 6, d: 17, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 6, d: 17, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Marketing', y: 2026, m: 6, d: 18, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 18, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Seminar', y: 2026, m: 6, d: 19, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Seminar drinks', y: 2026, m: 6, d: 19, startH: 19, startMin: 0, durationMin: 150, color: COLORS.play},
  {title: 'Café shift', y: 2026, m: 6, d: 20, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Trip home', y: 2026, m: 6, d: 21, startH: 0, startMin: 0, durationMin: 0, color: COLORS.other, allDay: true},

  // Week of Jun 22
  {title: 'Macroeconomics', y: 2026, m: 6, d: 22, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'English class', y: 2026, m: 6, d: 22, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Statistics', y: 2026, m: 6, d: 23, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 23, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Programming lab', y: 2026, m: 6, d: 24, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Psychology', y: 2026, m: 6, d: 24, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 6, d: 24, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Marketing', y: 2026, m: 6, d: 25, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 6, d: 25, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Seminar', y: 2026, m: 6, d: 26, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Due: Seminar final report', y: 2026, m: 6, d: 26, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: 'Café shift', y: 2026, m: 6, d: 27, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Birthday party', y: 2026, m: 6, d: 27, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'Exam study', y: 2026, m: 6, d: 28, startH: 13, startMin: 0, durationMin: 180, color: COLORS.important},

  // Week of Jun 29 (期末テスト)
  {title: 'Final exam: Macroeconomics', y: 2026, m: 6, d: 29, startH: 9, startMin: 0, durationMin: 90, color: COLORS.important},
  {title: 'English class', y: 2026, m: 6, d: 29, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Final exam: Statistics', y: 2026, m: 6, d: 30, startH: 10, startMin: 40, durationMin: 90, color: COLORS.important},
  {title: 'Café shift', y: 2026, m: 6, d: 30, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
];

// May 2026 — 大学生の予定表（学期中〜GW）。ゆとりのある月にしてある:
// 平日は授業・バイトがありつつ「たまに空いてる日」を混ぜ、土日はやや開けて
// たまにバイト/遊びが入る程度に。5/1(金)始まり、5/4みどりの日・5/5こどもの日・
// 5/6振替休日のGW、5/31(日)終わり。色: 授業=work(青) / バイト=purple(紫)
// / 締切=important(赤) / サークル=schedule(ピンク) / 遊び=play(緑) / 帰省=other(黄).
// English titles (App Store English screenshots). Same dates/times/colors as the
// original JP set; only the titles are translated. 授業=work / バイト=purple /
// 締切=important / サークル=schedule / 遊び=play / 帰省=other.
const MAY_SEEDS: Seed[] = [
  // Week of May 1 (Fri–Sun)
  {title: 'Seminar', y: 2026, m: 5, d: 1, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  // May 2–3 free

  // Golden Week (May 4–6)
  {title: 'Trip home', y: 2026, m: 5, d: 4, startH: 0, startMin: 0, durationMin: 0, color: COLORS.other, allDay: true},
  // May 5–6 free
  {title: 'Marketing', y: 2026, m: 5, d: 7, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Seminar', y: 2026, m: 5, d: 8, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 5, d: 9, startH: 11, startMin: 0, durationMin: 300, color: COLORS.purple},
  // May 10 free

  // Week of May 11
  {title: 'Macroeconomics', y: 2026, m: 5, d: 11, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Statistics', y: 2026, m: 5, d: 12, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 5, d: 12, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  // May 13 free
  {title: 'Marketing', y: 2026, m: 5, d: 14, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 5, d: 14, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Seminar', y: 2026, m: 5, d: 15, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  // May 16 free
  {title: 'Lunch with friends', y: 2026, m: 5, d: 17, startH: 12, startMin: 0, durationMin: 90, color: COLORS.play},

  // Week of May 18
  {title: 'Macroeconomics', y: 2026, m: 5, d: 18, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'English class', y: 2026, m: 5, d: 18, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Statistics', y: 2026, m: 5, d: 19, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 5, d: 19, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  {title: 'Programming lab', y: 2026, m: 5, d: 20, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Psychology', y: 2026, m: 5, d: 20, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  // May 21 free
  {title: 'Seminar', y: 2026, m: 5, d: 22, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Due: Marketing report', y: 2026, m: 5, d: 22, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: 'Café shift', y: 2026, m: 5, d: 23, startH: 11, startMin: 0, durationMin: 300, color: COLORS.purple},
  // May 24 free

  // Week of May 25
  {title: 'Macroeconomics', y: 2026, m: 5, d: 25, startH: 9, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'English class', y: 2026, m: 5, d: 25, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Statistics', y: 2026, m: 5, d: 26, startH: 10, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Café shift', y: 2026, m: 5, d: 26, startH: 18, startMin: 0, durationMin: 240, color: COLORS.purple},
  // May 27 free
  {title: 'Marketing', y: 2026, m: 5, d: 28, startH: 13, startMin: 0, durationMin: 90, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 5, d: 28, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Seminar', y: 2026, m: 5, d: 29, startH: 14, startMin: 40, durationMin: 90, color: COLORS.work},
  {title: 'Club night out', y: 2026, m: 5, d: 29, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  // May 30–31 free
];

// Titles the May slots used *before* the English rewrite. Cleanup matches by
// timestamp (below), so this is just documentation of what gets replaced.


// From-today summer college schedule (English). Seeded once so the current
// month has realistic student data (classes/part-time/circle/social).
const SUMMER_SEEDS: Seed[] = [
  {title: 'Café shift', y: 2026, m: 7, d: 24, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 7, d: 25, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Movie', y: 2026, m: 7, d: 25, startH: 19, startMin: 0, durationMin: 150, color: COLORS.play},
  {title: 'Gym', y: 2026, m: 7, d: 26, startH: 10, startMin: 0, durationMin: 90, color: COLORS.play},
  {title: 'Summer course', y: 2026, m: 7, d: 27, startH: 10, startMin: 0, durationMin: 120, color: COLORS.work},
  {title: 'TOEIC prep', y: 2026, m: 7, d: 27, startH: 15, startMin: 0, durationMin: 120, color: COLORS.other},
  {title: 'Café shift', y: 2026, m: 7, d: 28, startH: 17, startMin: 0, durationMin: 300, color: COLORS.purple},
  {title: 'Summer course', y: 2026, m: 7, d: 29, startH: 10, startMin: 0, durationMin: 120, color: COLORS.work},
  {title: 'Lunch with friends', y: 2026, m: 7, d: 29, startH: 12, startMin: 0, durationMin: 90, color: COLORS.play},
  {title: 'Tennis club', y: 2026, m: 7, d: 29, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Café shift', y: 2026, m: 7, d: 30, startH: 17, startMin: 0, durationMin: 300, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 7, d: 31, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Beach day', y: 2026, m: 8, d: 1, startH: 10, startMin: 0, durationMin: 480, color: COLORS.play},
  {title: 'Café shift', y: 2026, m: 8, d: 1, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Gym', y: 2026, m: 8, d: 2, startH: 10, startMin: 0, durationMin: 90, color: COLORS.play},
  {title: 'Summer course', y: 2026, m: 8, d: 3, startH: 10, startMin: 0, durationMin: 120, color: COLORS.work},
  {title: 'TOEIC prep', y: 2026, m: 8, d: 3, startH: 15, startMin: 0, durationMin: 120, color: COLORS.other},
  {title: 'Café shift', y: 2026, m: 8, d: 4, startH: 17, startMin: 0, durationMin: 300, color: COLORS.purple},
  {title: 'Due: Course report', y: 2026, m: 8, d: 5, startH: 0, startMin: 0, durationMin: 0, color: COLORS.important, allDay: true},
  {title: 'Summer course', y: 2026, m: 8, d: 5, startH: 10, startMin: 0, durationMin: 120, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 8, d: 5, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Café shift', y: 2026, m: 8, d: 6, startH: 17, startMin: 0, durationMin: 300, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 8, d: 7, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 8, d: 8, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Club night out', y: 2026, m: 8, d: 8, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'Karaoke', y: 2026, m: 8, d: 9, startH: 18, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'Trip home', y: 2026, m: 8, d: 10, startH: 0, startMin: 0, durationMin: 0, color: COLORS.other, allDay: true},
  {title: 'Café shift', y: 2026, m: 8, d: 14, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 8, d: 15, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Summer festival', y: 2026, m: 8, d: 15, startH: 18, startMin: 0, durationMin: 240, color: COLORS.play},
  {title: 'Birthday party', y: 2026, m: 8, d: 16, startH: 19, startMin: 0, durationMin: 180, color: COLORS.play},
  {title: 'TOEIC prep', y: 2026, m: 8, d: 17, startH: 15, startMin: 0, durationMin: 120, color: COLORS.other},
  {title: 'Café shift', y: 2026, m: 8, d: 18, startH: 17, startMin: 0, durationMin: 300, color: COLORS.purple},
  {title: 'Internship info session', y: 2026, m: 8, d: 19, startH: 13, startMin: 0, durationMin: 120, color: COLORS.work},
  {title: 'Tennis club', y: 2026, m: 8, d: 19, startH: 18, startMin: 0, durationMin: 120, color: COLORS.schedule},
  {title: 'Café shift', y: 2026, m: 8, d: 20, startH: 17, startMin: 0, durationMin: 300, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 8, d: 21, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Café shift', y: 2026, m: 8, d: 22, startH: 11, startMin: 0, durationMin: 360, color: COLORS.purple},
  {title: 'Study group', y: 2026, m: 8, d: 22, startH: 14, startMin: 0, durationMin: 180, color: COLORS.other},
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

/** Seed May 2026 with a lighter college schedule (open weekends, some free weekdays). */
export const seedDevMayEventsIfNeeded = async (): Promise<void> => {
  if (!__DEV__) return;
  try {
    const already = await AsyncStorage.getItem(MAY_SEED_FLAG_KEY);
    if (already === '1') return;
    await persistSeeds(MAY_SEEDS);
    await AsyncStorage.setItem(MAY_SEED_FLAG_KEY, '1');
  } catch (e) {
    console.warn('[devSeedData] May seeding failed:', e);
  }
};

/** Reset the May seed flag so the next app start will re-seed May 2026. */
export const resetDevMaySeedFlag = async (): Promise<void> => {
  await AsyncStorage.removeItem(MAY_SEED_FLAG_KEY);
};

/**
 * Remove previously-seeded May 2026 college events from the device calendar.
 * Matches by (title + start timestamp) against MAY_SEEDS, so unrelated user
 * events are left untouched. Runs once (guarded by MAY_CLEANUP_FLAG_KEY).
 */
export const clearDevMaySeedEvents = async (): Promise<number> => {
  if (!__DEV__) return 0;
  try {
    const already = await AsyncStorage.getItem(MAY_CLEANUP_FLAG_KEY);
    if (already === '1') return 0;

    // Match by start-timestamp only (not title): the previous seed populated
    // these exact slots with JP titles, so this removes the old JP events even
    // though MAY_SEEDS now holds English titles. Unrelated events at other
    // times are left untouched.
    const seedTimes = new Set(
      MAY_SEEDS.map(s => new Date(s.y, s.m - 1, s.d, s.startH, s.startMin, 0, 0).getTime())
    );

    const rangeStart = new Date(2026, 4, 1, 0, 0, 0, 0).toISOString();
    const rangeEnd = new Date(2026, 5, 0, 23, 59, 59, 999).toISOString();
    const events = await RNCalendarEvents.fetchAllEvents(rangeStart, rangeEnd);

    let deleted = 0;
    for (const ev of events) {
      if (!ev.id || !ev.startDate) continue;
      const ts = new Date(ev.startDate).getTime();
      if (seedTimes.has(ts)) {
        try {
          await RNCalendarEvents.removeEvent(ev.id);
          deleted += 1;
        } catch (e) {
          console.warn('[devSeedData] failed to remove May event', ev.id, e);
        }
      }
    }

    await AsyncStorage.setItem(MAY_CLEANUP_FLAG_KEY, '1');
    await AsyncStorage.removeItem(MAY_SEED_FLAG_KEY);
    if (deleted > 0) {
      console.log(`[devSeedData] removed ${deleted} seeded events from May 2026`);
    }
    return deleted;
  } catch (e) {
    console.warn('[devSeedData] May cleanup failed:', e);
    return 0;
  }
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

    // Match by start-timestamp only, so the previously-seeded JP June events are
    // removed even though JUNE_SEEDS now holds English titles.
    const seedTimes = new Set(
      JUNE_SEEDS.map(s => new Date(s.y, s.m - 1, s.d, s.startH, s.startMin, 0, 0).getTime())
    );

    const rangeStart = new Date(2026, 5, 1, 0, 0, 0, 0).toISOString();
    const rangeEnd = new Date(2026, 6, 0, 23, 59, 59, 999).toISOString();
    const events = await RNCalendarEvents.fetchAllEvents(rangeStart, rangeEnd);

    let deleted = 0;
    for (const ev of events) {
      if (!ev.id || !ev.startDate) continue;
      const ts = new Date(ev.startDate).getTime();
      if (seedTimes.has(ts)) {
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

/** Seed the ~1-month summer college schedule starting today (English). */
export const seedDevSummerEventsIfNeeded = async (): Promise<void> => {
  if (!__DEV__) return;
  try {
    const already = await AsyncStorage.getItem(SUMMER_SEED_FLAG_KEY);
    if (already === '1') return;
    await persistSeeds(SUMMER_SEEDS);
    await AsyncStorage.setItem(SUMMER_SEED_FLAG_KEY, '1');
  } catch (e) {
    console.warn('[devSeedData] summer seeding failed:', e);
  }
};

/** Remove the seeded summer events (timestamp match), once. */
export const clearDevSummerSeedEvents = async (): Promise<number> => {
  if (!__DEV__) return 0;
  try {
    const already = await AsyncStorage.getItem(SUMMER_CLEANUP_FLAG_KEY);
    if (already === '1') return 0;
    const seedTimes = new Set(
      SUMMER_SEEDS.map(s => new Date(s.y, s.m - 1, s.d, s.startH, s.startMin, 0, 0).getTime())
    );
    const rangeStart = new Date(2026, 6, 24, 0, 0, 0, 0).toISOString();
    const rangeEnd = new Date(2026, 7, 24, 23, 59, 59, 999).toISOString();
    const events = await RNCalendarEvents.fetchAllEvents(rangeStart, rangeEnd);
    let deleted = 0;
    for (const ev of events) {
      if (!ev.id || !ev.startDate) continue;
      if (seedTimes.has(new Date(ev.startDate).getTime())) {
        try { await RNCalendarEvents.removeEvent(ev.id); deleted += 1; } catch {}
      }
    }
    await AsyncStorage.setItem(SUMMER_CLEANUP_FLAG_KEY, '1');
    await AsyncStorage.removeItem(SUMMER_SEED_FLAG_KEY);
    return deleted;
  } catch (e) {
    console.warn('[devSeedData] summer cleanup failed:', e);
    return 0;
  }
};
