// ── Rule-based intention parser (Japanese-first, light English) ─────────────
//
// On-device, zero-cost. Turns a free-text declaration like
//   「平日午前は深い作業を死守。週3で筋トレ。金曜夜は彼女と夕飯。
//     今月末までにアプリをリリース。移動は極力まとめたい」
// into structured Intention[] the solver can act on. It is deliberately
// transparent and editable — every parsed intention is shown back to the user
// for confirmation, so heuristic misses are cheap to fix.

import {DayOfWeek, Intention, IntentionKind, TimeWindow} from './types';

const PALETTE = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D92', '#5AC8FA', '#FFCC00'];

const genId = (): string =>
  'int-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

// Full-width / kanji digit normalisation for counts like 週３ / 週三.
const KANJI_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 毎: 7,
};
const toNum = (s: string): number => {
  const z = s.replace(/[０-９]/g, d => String('０１２３４５６７８９'.indexOf(d)));
  if (/^\d+$/.test(z)) return parseInt(z, 10);
  if (z in KANJI_NUM) return KANJI_NUM[z];
  return NaN;
};

const DOW_TOKENS: {re: RegExp; day: DayOfWeek}[] = [
  {re: /日曜|日曜日|sun/i, day: 0},
  {re: /月曜|月曜日|mon/i, day: 1},
  {re: /火曜|火曜日|tue/i, day: 2},
  {re: /水曜|水曜日|wed/i, day: 3},
  {re: /木曜|木曜日|thu/i, day: 4},
  {re: /金曜|金曜日|fri/i, day: 5},
  {re: /土曜|土曜日|sat/i, day: 6},
];

const WEEKDAYS: DayOfWeek[] = [1, 2, 3, 4, 5];
const WEEKENDS: DayOfWeek[] = [0, 6];

// Time-of-day windows (whole hours).
const timeWindow = (frag: string): TimeWindow | undefined => {
  if (/早朝/.test(frag)) return {startHour: 5, endHour: 8};
  if (/午前|朝|morning/i.test(frag)) return {startHour: 8, endHour: 12};
  if (/昼|正午|lunch|noon/i.test(frag)) return {startHour: 11, endHour: 14};
  if (/午後|afternoon/i.test(frag)) return {startHour: 13, endHour: 18};
  if (/夕方|夕飯|夕食|evening/i.test(frag)) return {startHour: 17, endHour: 20};
  if (/夜|晩|night/i.test(frag)) return {startHour: 18, endHour: 23};
  return undefined;
};

const durationMin = (frag: string, fallback: number): number => {
  const h = frag.match(/(\d+(?:\.\d+)?|[０-９]+)\s*時間/);
  if (h) {
    const n = parseFloat(h[1].replace(/[０-９]/g, d => String('０１２３４５６７８９'.indexOf(d))));
    if (!isNaN(n)) return Math.round(n * 60);
  }
  const m = frag.match(/(\d+|[０-９]+)\s*分/);
  if (m) {
    const n = toNum(m[1]);
    if (!isNaN(n)) return n;
  }
  return fallback;
};

// Explicit start–end time range, e.g. 「10時から16時」「18時〜22時」「10:00-16:00」.
interface TimeRange {startHour: number; startMin: number; endHour: number; endMin: number}
const timeRange = (frag: string): TimeRange | undefined => {
  let m = frag.match(/(\d{1,2})時(?:(\d{1,2})分)?\s*(?:から|〜|~|-|ー|–|−|→|まで)?\s*(\d{1,2})時(?:(\d{1,2})分)?/);
  if (m) {
    return {startHour: +m[1], startMin: m[2] ? +m[2] : 0, endHour: +m[3], endMin: m[4] ? +m[4] : 0};
  }
  m = frag.match(/(\d{1,2}):(\d{2})\s*(?:から|〜|~|-|ー|–|−|→|まで)\s*(\d{1,2}):(\d{2})/);
  if (m) {
    return {startHour: +m[1], startMin: +m[2], endHour: +m[3], endMin: +m[4]};
  }
  return undefined;
};

const priorityOf = (frag: string, base: number): number => {
  if (/死守|絶対|必ず|マスト|must|死んでも/i.test(frag)) return 5;
  if (/できれば|なるべく|極力|余裕があれば|nice/i.test(frag)) return 2;
  if (/重要|大事|優先/.test(frag)) return 4;
  return base;
};

// A small lexicon to pull a clean short title out of a fragment.
const TITLE_LEXICON: {re: RegExp; title: string; tag: string}[] = [
  {re: /大学|授業|講義|ゼミ|クラス|lecture|class/i, title: '大学', tag: 'study'},
  {re: /バイト|アルバイト|勤務|シフト|part.?time/i, title: 'バイト', tag: 'work'},
  {re: /レポート|課題|宿題|提出|assignment|report/i, title: 'レポート', tag: 'work'},
  {re: /深い作業|ディープワーク|集中|deep work/i, title: '深い作業', tag: 'focus'},
  {re: /筋トレ|ジム|トレーニング|運動|ワークアウト|workout|gym|exercise/i, title: '筋トレ', tag: 'exercise'},
  {re: /ランニング|ジョギング|走|run/i, title: 'ランニング', tag: 'exercise'},
  {re: /勉強|学習|study/i, title: '勉強', tag: 'study'},
  {re: /読書|本を読|read/i, title: '読書', tag: 'study'},
  {re: /夕飯|夕食|晩ご?飯|ディナー|dinner/i, title: '夕飯', tag: 'meal'},
  {re: /昼ご?飯|ランチ|lunch/i, title: 'ランチ', tag: 'meal'},
  {re: /リリース|release|公開|ローンチ|launch/i, title: 'リリース', tag: 'work'},
  {re: /開発|実装|コーディング|build|develop/i, title: '開発', tag: 'work'},
  {re: /執筆|ブログ|記事|write/i, title: '執筆', tag: 'work'},
  {re: /掃除|片付け|clean/i, title: '掃除', tag: 'chore'},
  {re: /買い物|買物|shopping/i, title: '買い物', tag: 'errand'},
  {re: /移動|通勤|外出|commute|travel/i, title: '移動', tag: 'errand'},
  {re: /散歩|walk/i, title: '散歩', tag: 'exercise'},
  {re: /家族|family/i, title: '家族の時間', tag: 'social'},
  {re: /彼女|彼氏|恋人|デート|date|partner/i, title: '大切な人との時間', tag: 'social'},
];

const cleanTitle = (frag: string): string => {
  let t = frag
    .replace(/平日|週末|毎日|毎週|毎朝|毎晩/g, '')
    .replace(/週\s*[0-9０-９一二三四五六七]+/g, '')
    .replace(/[0-9０-９一二三四五六七]+\s*回/g, '')
    .replace(/午前|午後|早朝|朝|昼|夕方|夕方|夜|晩|正午/g, '')
    .replace(/(日|月|火|水|木|金|土)曜日?/g, '')
    .replace(/\d{1,2}時(\d{1,2}分)?\s*(から|〜|~|-|ー|–|−|→|まで)?\s*\d{1,2}時(\d{1,2}分)?/g, '')
    .replace(/\d{1,2}:\d{2}\s*(から|〜|~|-|ー|–|−|→|まで)?\s*\d{1,2}:\d{2}/g, '')
    .replace(/\d{1,2}時(\d{1,2}分)?/g, '')
    .replace(/(\d+|[０-９]+)\s*(分|時間)/g, '')
    .replace(/今月中|月内|今月末|今週末|今週|来週|今月|来月|今日|明日|明後日|までに|まで/g, '')
    .replace(/(\d+)月(\d+)日/g, '')
    .replace(/死守|絶対|必ず|極力|なるべく|できれば|したい|する|やる|を|は|が|に|で|と|の|、|。/g, '')
    .trim();
  if (t.length > 16) t = t.slice(0, 16) + '…';
  return t;
};

const monthEndDateKey = (base: Date): string => {
  const d = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDaysKey = (base: Date, n: number): string => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const deadlineOf = (frag: string, now: Date): string | undefined => {
  if (/今月末|月末|今月中|月内/.test(frag)) return monthEndDateKey(now);
  if (/来月末/.test(frag)) return monthEndDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  if (/今週末|週末まで|今週中/.test(frag)) {
    const toSat = (6 - now.getDay() + 7) % 7;
    return addDaysKey(now, toSat);
  }
  if (/明日まで/.test(frag)) return addDaysKey(now, 1);
  if (/明後日/.test(frag)) return addDaysKey(now, 2);
  const md = frag.match(/(\d+)月(\d+)日/);
  if (md) {
    let y = now.getFullYear();
    const mo = parseInt(md[1], 10) - 1;
    const dom = parseInt(md[2], 10);
    // Roll a past month/day forward to next year — including a day earlier this
    // same month (e.g. today 6/12, "6月5日までに" means next year, not 5 days ago).
    if (mo < now.getMonth() || (mo === now.getMonth() && dom < now.getDate())) y += 1;
    const d = new Date(y, mo, dom);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // "までに" is a deadline marker; bare "まで" is NOT (e.g. "16時まで" is a time
  // range end, not a due date) — only treat 〆切/締切/提出 + までに as vague deadlines.
  if (/までに|〆切|締切|提出期限/.test(frag)) return monthEndDateKey(now);
  return undefined;
};

const frequencyOf = (frag: string): number | undefined => {
  const m = frag.match(/週\s*([0-9０-９]+|[一二三四五六七])\s*回?/);
  if (m) {
    const n = toNum(m[1]);
    if (!isNaN(n)) return n;
  }
  if (/毎日/.test(frag)) return 7;
  if (/隔日|一日おき/.test(frag)) return 4;
  if (/平日毎日|平日は毎日/.test(frag)) return 5;
  return undefined;
};

const daysOf = (frag: string): DayOfWeek[] | undefined => {
  const found: DayOfWeek[] = [];
  for (const {re, day} of DOW_TOKENS) if (re.test(frag)) found.push(day);
  if (found.length) return Array.from(new Set(found)) as DayOfWeek[];
  if (/平日/.test(frag)) return [...WEEKDAYS];
  if (/週末|土日/.test(frag)) return [...WEEKENDS];
  return undefined;
};

/** Classify and build one Intention from a single fragment. */
const parseFragment = (raw: string, idx: number, now: Date): Intention | null => {
  const frag = raw.trim();
  if (frag.length < 2) return null;

  const lex = TITLE_LEXICON.find(l => l.re.test(frag));
  const days = daysOf(frag);
  const freq = frequencyOf(frag);
  const deadline = deadlineOf(frag, now);
  // An explicit "10時から16時" range wins over vague time-of-day words, and also
  // gives us an exact duration.
  const range = timeRange(frag);
  const win = range ? {startHour: range.startHour, endHour: range.endHour} : timeWindow(frag);
  const explicitDur = range
    ? Math.max(30, (range.endHour * 60 + range.endMin) - (range.startHour * 60 + range.startMin))
    : undefined;
  const isProtect = /死守|守る|防衛|邪魔されない|集中|ディープ|deep/i.test(frag);
  const isFocusWork = /深い作業|ディープワーク|集中|deep work/i.test(frag);
  const explicitDay = !!days && days.length > 0 && days.length <= 2 && !/平日|週末/.test(frag);

  // A batching/spreading preference ("まとめたい / 分散したい") describes *how* to
  // arrange things, not a quantity to schedule — it must win over the lexicon so
  // e.g. 「移動は極力まとめたい」 doesn't become a 3×/week task.
  const batchPref = /まとめ|固め|分散|詰め|連続させ|まとめたい/.test(frag);

  let kind: IntentionKind;
  if (deadline) kind = 'deadline';
  else if (isFocusWork || (isProtect && win)) kind = 'focus';
  else if (batchPref && !freq) kind = 'preference';
  else if (explicitDay && win && !freq) kind = 'fixed';
  else if (freq) kind = 'recurring';
  else if (/好み|prefer/i.test(frag) && !lex) kind = 'preference';
  else if (win || days) kind = 'fixed';
  else kind = 'recurring';

  const title = lex ? lex.title : cleanTitle(frag) || `予定${idx + 1}`;
  const tag = lex?.tag;
  // Work/baito gets the canonical work-blue so the 年収の壁 / pay features apply.
  const color = tag === 'work' ? '#007AFF' : PALETTE[idx % PALETTE.length];

  const base: Intention = {
    id: genId(),
    raw: frag,
    title,
    kind,
    priority: priorityOf(frag, kind === 'fixed' || kind === 'focus' ? 4 : 3),
    durationMin: 60,
    color,
    tag,
    createdAt: new Date().toISOString(),
    active: true,
  };

  if (kind === 'focus') {
    base.window = win ?? {startHour: 9, endHour: 12};
    base.days = days ?? [...WEEKDAYS];
    base.protect = true;
    base.durationMin = explicitDur ?? durationMin(frag, (base.window.endHour - base.window.startHour) * 60);
    base.priority = priorityOf(frag, 5);
  } else if (kind === 'recurring') {
    base.timesPerWeek = freq ?? 3;
    base.days = days;
    base.window = win;
    base.durationMin = explicitDur ?? durationMin(frag, 60);
  } else if (kind === 'fixed') {
    base.days = days ?? [...WEEKDAYS];
    base.window = win ?? {startHour: 18, endHour: 20};
    base.durationMin = explicitDur ?? durationMin(frag, 90);
    base.priority = priorityOf(frag, 4);
  } else if (kind === 'deadline') {
    base.deadline = deadline;
    base.window = win;
    base.durationMin = 90;
    base.totalEstimateMin = durationMin(frag, 90) > 90 ? durationMin(frag, 90) : 600; // default ~10h
    base.priority = priorityOf(frag, 4);
  } else {
    // preference
    base.durationMin = 0;
    base.priority = priorityOf(frag, 2);
  }
  return base;
};

/** Split a declaration into fragments and parse each. */
export const parseIntentions = (text: string, now: Date = new Date()): Intention[] => {
  const fragments = text
    .split(/[。\n．;；]+|、(?=[^、]{6,})/) // sentence-ish boundaries; keep short commas joined
    .map(s => s.trim())
    .filter(Boolean);
  const out: Intention[] = [];
  fragments.forEach((f, i) => {
    const intn = parseFragment(f, i, now);
    if (intn) out.push(intn);
  });
  return out;
};
