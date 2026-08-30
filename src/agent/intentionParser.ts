// ── Rule-based intention parser (Japanese-first, light English) ─────────────
//
// On-device, zero-cost. Turns a free-text declaration like
//   「平日午前は深い作業を死守。週3で筋トレ。金曜夜は彼女と夕飯。
//     今月末までにアプリをリリース。移動は極力まとめたい」
// into structured Intention[] the solver can act on. It is deliberately
// transparent and editable — every parsed intention is shown back to the user
// for confirmation, so heuristic misses are cheap to fix.

import {DayOfWeek, Intention, IntentionKind, TimeWindow} from './types';
import i18n from '../i18n/i18n';

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

// All the hour/minute/count regexes below match ASCII \d only. Without this,
// a fullwidth-digit time like "１０時から１２時" (common from JP IME defaults)
// is invisible to every one of them at once — the whole range, duration, and
// even the day tokens around it silently fail to parse.
const normalizeDigits = (s: string): string =>
  s.replace(/[０-９]/g, d => String('０１２３４５６７８９'.indexOf(d)));

// Kanji numerals directly in front of 時 ("十時", "十二時半") — scoped tightly
// to "immediately followed by 時" so ordinary uses of 一/二/三 etc. elsewhere
// in the sentence ("一人で", "三日坊主") are never touched.
const KANJI_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const kanjiHourToNum = (s: string): number | undefined => {
  if (s in KANJI_DIGIT) return KANJI_DIGIT[s];
  if (s === '十') return 10;
  let m = s.match(/^十([一二三四五六七八九])$/);
  if (m) return 10 + KANJI_DIGIT[m[1]];
  if (s === '二十') return 20;
  m = s.match(/^二十([一二三四五六七八九])$/);
  if (m) return 20 + KANJI_DIGIT[m[1]];
  return undefined;
};
const normalizeKanjiHours = (s: string): string =>
  s.replace(/([零一二三四五六七八九]|二?十[一二三四五六七八九]?)時/g, (whole, num) => {
    const n = kanjiHourToNum(num);
    return n === undefined ? whole : `${n}時`;
  });

const DOW_TOKENS: {re: RegExp; day: DayOfWeek}[] = [
  {re: /日曜|日曜日|sun/i, day: 0},
  {re: /月曜|月曜日|mon/i, day: 1},
  {re: /火曜|火曜日|tue/i, day: 2},
  {re: /水曜|水曜日|wed/i, day: 3},
  {re: /木曜|木曜日|thu/i, day: 4},
  {re: /金曜|金曜日|fri/i, day: 5},
  {re: /土曜|土曜日|sat/i, day: 6},
];

// "月・水・金" / "月水金" — the shorthand list form (bare kanji, no 曜/曜日) is
// common for class/gym schedules. Only fires on a *run* of 2+ of these
// characters (with only ・/、 allowed between them) so an unrelated word that
// happens to contain one of them (水 "water", 木 "wood", 金 "money") isn't
// misread as a weekday.
const BARE_DOW_DAY: Record<string, DayOfWeek> = {日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6};
const BARE_DOW_RUN_RE = /[月火水木金土日](?:[・、,，]?[月火水木金土日]){1,6}/g;

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
  // "1時間半" (1.5h) — checked before the plain "N時間" match below so the
  // trailing 半 isn't left as unparsed, silently dropping the extra 30min.
  const hh = frag.match(/(\d+|[０-９]+)\s*時間半/);
  if (hh) {
    const n = toNum(hh[1]);
    if (!isNaN(n)) return n * 60 + 30;
  }
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
  // English — "for 2 hours" / "90 minutes". Only tried when the JP patterns
  // above found nothing, so a mixed fragment like "TOEIC対策90分" still uses
  // the JP number (checked first).
  const enH = frag.match(/(\d+(?:\.\d+)?)\s*hours?/i);
  if (enH) return Math.round(parseFloat(enH[1]) * 60);
  const enM = frag.match(/(\d+)\s*min(?:ute)?s?/i);
  if (enM) return parseInt(enM[1], 10);
  return fallback;
};

// One time-of-day mention: an optional AM/PM-style marker (午前/午後/AM/PM),
// an hour, and optional half/minutes — e.g. 「午後4時」「PM4時」「10時半」.
// Without consuming the marker here, "午前10時から午後4時" fails the combined
// range match entirely (the from...to pattern requires digits right after the
// connector, and 午後 sits in the way) and falls back to whichever vague
// keyword (午前/午後/朝/...) happens to appear first in the whole fragment —
// silently discarding both explicit hours.
const ONE_TIME = String.raw`(?:(午前|午後|AM|PM|am|pm)\s*)?(\d{1,2})時(半|(?:(\d{1,2})分))?`;
const applyAmPm = (marker: string | undefined, hour: number): number => {
  if (!marker) return hour;
  if (/午後|pm/i.test(marker)) return hour < 12 ? hour + 12 : hour;
  if (/午前|am/i.test(marker) && hour === 12) return 0;
  return hour;
};

// Explicit start–end time range, e.g. 「10時から16時」「18時〜22時」「10:00-16:00」
// 「19時半から21時」「22時から翌1時」(半 = :30, 翌 = the end time rolls into the
// next day — see the caller for how the latter is handled; TimeWindow itself
// has no notion of a day boundary, so this only recovers the start time and a
// correct duration instead of silently falling back to unrelated defaults).
interface TimeRange {startHour: number; startMin: number; endHour: number; endMin: number; nextDay?: boolean}
const timeRange = (frag: string): TimeRange | undefined => {
  const re = new RegExp(
    `${ONE_TIME}\\s*(?:から|〜|~|-|ー|–|−|→|まで|to)?\\s*(翌)?\\s*${ONE_TIME}`,
    'i',
  );
  let m = frag.match(re);
  if (m) {
    return {
      startHour: applyAmPm(m[1], +m[2]),
      startMin: m[3] === '半' ? 30 : m[4] ? +m[4] : 0,
      endHour: applyAmPm(m[6], +m[7]),
      endMin: m[8] === '半' ? 30 : m[9] ? +m[9] : 0,
      nextDay: !!m[5],
    };
  }
  m = frag.match(/(\d{1,2}):(\d{2})\s*(?:から|〜|~|-|ー|–|−|→|まで)\s*(\d{1,2}):(\d{2})/);
  if (m) {
    return {startHour: +m[1], startMin: +m[2], endHour: +m[3], endMin: +m[4]};
  }
  return englishTimeRange(frag);
};

// English — "from 10 to 12", "10am to 4pm", "10-12". Only attempted when the
// fragment has Latin letters at all (a pure-JP fragment never reaches this),
// and a bare hyphen only counts as a range when at least one side carries
// am/pm — otherwise "3-5" in an ordinary JP sentence ("3-5部用意して") would
// misread as a time range on the strength of an unrelated stray English word.
const EN_TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
const enAdjustAmPm = (h: number, ampm?: string): number => {
  if (!ampm) return h;
  if (/pm/i.test(ampm) && h < 12) return h + 12;
  if (/am/i.test(ampm) && h === 12) return 0;
  return h;
};
const englishTimeRange = (frag: string): TimeRange | undefined => {
  if (!/[a-zA-Z]/.test(frag)) return undefined;
  let m = frag.match(new RegExp(`(?:from\\s+)?${EN_TIME}\\s*(?:to|until)\\s*${EN_TIME}`, 'i'));
  if (!m) {
    const hyphenMatch = frag.match(new RegExp(`${EN_TIME}\\s*[-–—]\\s*${EN_TIME}`, 'i'));
    if (hyphenMatch && (hyphenMatch[3] || hyphenMatch[6])) m = hyphenMatch;
  }
  if (!m) return undefined;
  return {
    startHour: enAdjustAmPm(+m[1], m[3]),
    startMin: m[2] ? +m[2] : 0,
    endHour: enAdjustAmPm(+m[4], m[6]),
    endMin: m[5] ? +m[5] : 0,
  };
};

// A single time mention with no "…から…まで" ("13時に打ち合わせ", "毎晩23時に
// 日記") — this used to be invisible to both timeRange() (which requires two
// time mentions) and be shadowed by a vague keyword match in timeWindow()
// (「毎晩」contains 晩, so "23時" was silently discarded in favor of a generic
// 18–23時 window). An explicit hour always beats a vague keyword.
const singleTimeOf = (frag: string): {hour: number; min: number} | undefined => {
  const m = frag.match(new RegExp(ONE_TIME, 'i'));
  if (m) return {hour: applyAmPm(m[1], +m[2]), min: m[3] === '半' ? 30 : m[4] ? +m[4] : 0};
  // English single mention — requires an explicit am/pm so a bare number
  // elsewhere in the sentence ("3 things to do") is never misread as a time.
  if (!/[a-zA-Z]/.test(frag)) return undefined;
  const en = frag.match(new RegExp(EN_TIME, 'i'));
  if (!en || !en[3]) return undefined;
  return {hour: enAdjustAmPm(+en[1], en[3]), min: en[2] ? +en[2] : 0};
};

const priorityOf = (frag: string, base: number): number => {
  if (/死守|絶対|必ず|マスト|must|死んでも/i.test(frag)) return 5;
  if (/できれば|なるべく|極力|余裕があれば|nice/i.test(frag)) return 2;
  if (/重要|大事|優先/.test(frag)) return 4;
  return base;
};

// A small lexicon to pull a clean short title out of a fragment. `titleKey` is
// resolved through i18n at parse time so titles follow the app's language
// (English input like "part-time job" no longer produces a Japanese title).
const TITLE_LEXICON: {re: RegExp; titleKey: string; tag: string}[] = [
  {re: /大学|授業|講義|ゼミ|クラス|university|college|lecture|class/i, titleKey: 'lexSchool', tag: 'study'},
  {re: /バイト|アルバイト|勤務|シフト|part.?time|part.?time job/i, titleKey: 'lexPartTime', tag: 'work'},
  {re: /レポート|課題|宿題|提出|assignment|homework|report/i, titleKey: 'lexReport', tag: 'work'},
  {re: /深い作業|ディープワーク|集中|deep work/i, titleKey: 'lexDeepWork', tag: 'focus'},
  {re: /筋トレ|ジム|トレーニング|運動|ワークアウト|workout|gym|exercise/i, titleKey: 'lexWorkout', tag: 'exercise'},
  {re: /ランニング|ジョギング|走|running|jog|run/i, titleKey: 'lexRunning', tag: 'exercise'},
  {re: /勉強|学習|study|studying/i, titleKey: 'lexStudy', tag: 'study'},
  {re: /読書|本を読|reading|read/i, titleKey: 'lexReading', tag: 'study'},
  {re: /夕飯|夕食|晩ご?飯|ディナー|dinner/i, titleKey: 'lexDinner', tag: 'meal'},
  {re: /昼ご?飯|ランチ|lunch/i, titleKey: 'lexLunch', tag: 'meal'},
  {re: /リリース|release|公開|ローンチ|launch/i, titleKey: 'lexRelease', tag: 'work'},
  {re: /開発|実装|コーディング|coding|build|develop/i, titleKey: 'lexDev', tag: 'work'},
  {re: /執筆|ブログ|記事|writing|write/i, titleKey: 'lexWriting', tag: 'work'},
  {re: /掃除|片付け|cleaning|clean/i, titleKey: 'lexCleaning', tag: 'chore'},
  {re: /買い物|買物|shopping|groceries/i, titleKey: 'lexShopping', tag: 'errand'},
  {re: /移動|通勤|外出|commute|travel/i, titleKey: 'lexCommute', tag: 'errand'},
  {re: /散歩|walk/i, titleKey: 'lexWalk', tag: 'exercise'},
  {re: /家族|family/i, titleKey: 'lexFamily', tag: 'social'},
  {re: /彼女|彼氏|恋人|デート|date|partner/i, titleKey: 'lexPartner', tag: 'social'},
];

// "英語基礎を追加して" declares an event named 英語基礎, not one named
// 英語基礎追加して — but "追加して" isn't a particle the generic strip below
// catches, so a trailing request-to-the-agent survives into the title unless
// peeled off first. Looped because polite requests chain ("を登録してください").
const TRAILING_REQUEST_RE =
  /(を?(追加|登録|入力|作成|セット|予定)して(ください)?|を?入れて(ください)?|を?(追加|登録|作成)する|お願いします|してください|して欲しい|してほしい)$/;
const stripTrailingRequest = (s: string): string => {
  let t = s;
  let prevLen: number;
  do {
    prevLen = t.length;
    t = t.replace(TRAILING_REQUEST_RE, '').trim();
  } while (t.length !== prevLen && t.length > 0);
  return t;
};

const cleanTitle = (frag: string): string => {
  let t = frag
    // Day-number patterns ("毎月1日", "隔月1日") must be stripped as whole
    // units BEFORE the bare 毎月/隔月 strip below, or the bare strip eats the
    // qualifier first and leaves the day number ("1日") stranded with nothing
    // left to remove it.
    .replace(/毎月\s*\d{1,2}\s*日|隔月\s*[のに]?\s*\d{1,2}\s*日/g, '')
    .replace(/(\d+)\s*(?:ヶ|か|カ)月に\s*1\s*回/g, '')
    .replace(/最終営業日/g, '')
    .replace(/第\s*[1-5一二三四五]\s*[月火水木金土日]曜日?/g, '')
    // 毎月末/月末 (last-day-of-month) is handled as its own whole phrase later
    // (alongside 今月末/来月末) — the negative lookahead here keeps "毎月" from
    // eating the "月" that phrase needs, leaving a stranded "末".
    .replace(/平日|週末|毎日|毎週|毎朝|毎晩|毎月(?!末)|隔週|隔日|隔月|一日おき|以外/g, '')
    .replace(/週\s*[0-9０-９一二三四五六七]+/g, '')
    .replace(/[0-9０-９一二三四五六七]+\s*回/g, '')
    .replace(/午前|午後|早朝|朝|昼|夕方|夕方|夜|晩|正午/g, '')
    .replace(/[月火水木金土日]曜日?\s*(から|〜|~|-)\s*[月火水木金土日]曜日?\s*まで/g, '')
    .replace(/(日|月|火|水|木|金|土)曜日?/g, '')
    .replace(BARE_DOW_RUN_RE, '')
    .replace(/(AM|PM)?\s*\d{1,2}時(半|\d{1,2}分)?\s*(から|〜|~|-|ー|–|−|→|まで)?\s*翌?\s*(AM|PM)?\s*\d{1,2}時(半|\d{1,2}分)?/gi, '')
    .replace(/\d{1,2}:\d{2}\s*(から|〜|~|-|ー|–|−|→|まで)?\s*\d{1,2}:\d{2}/g, '')
    // A single time mention with no matching range end ("18時から給料日会")
    // leaves "から" dangling with nowhere to attach — the full range pattern
    // above only fires when a second 時 is actually present.
    .replace(/(AM|PM)?\s*\d{1,2}時(半|\d{1,2}分)?\s*(から|〜|~|-|ー|–|−|→)?/gi, '')
    .replace(/(\d+|[０-９]+)\s*時間半/g, '')
    .replace(/(\d+|[０-９]+)\s*(分|時間)/g, '')
    .replace(/(\d+)\s*日以内に|(\d+)\s*週間以内に/g, '')
    // "3日後" (relative event date, e.g. "3日後に美容院") must be stripped as its
    // own whole unit before the bare "日" isn't left stranded by nothing else
    // removing it.
    .replace(/(\d+|[０-９]+)\s*日後/g, '')
    .replace(/今日中に|明日中に|今年中に|今年末|年内に|今月中|月内|今月末|今週末|今週|来週|今度|今月|来月|明々後日|明明後日|明後日|今日|明日|までに|まで/g, '')
    // Bare/毎-prefixed "月末" only reaches here once 今月末/来月末 (handled
    // above) are already gone, so this can't accidentally eat their 今/来.
    .replace(/毎月末|月末/g, '')
    .replace(/(\d+)月(\d+)日/g, '')
    // English connectors/units — \b-anchored so a legitimate title word that
    // merely contains one of these (e.g. "Weekly" contains "week") is untouched;
    // only the exact function-word forms extracted above are removed.
    .replace(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b/gi, '')
    .replace(/\bevery\s+other\s+day\b|\bevery\s*day\b|\bdaily\b/gi, '')
    .replace(/\bfrom\b|\bto\b|\buntil\b|\bevery\b/gi, '')
    .replace(/\b\d+\s*times?\s*(?:a|per)\s*week\b|\btwice\s*(?:a|per)\s*week\b|\bonce\s*(?:a|per)\s*week\b/gi, '')
    .replace(/\bby\s+(?:the\s+end\s+of\s+(?:the\s+)?(?:day|month|year)|today|tomorrow)\b/gi, '')
    .replace(/\bwithin\s+\d+\s*(?:days?|weeks?)\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
    .replace(/\b\d+(?:\.\d+)?\s*hours?\b|\b\d+\s*min(?:ute)?s?\b/gi, '')
    // Every removal above can leave a run of spaces where a JP fragment would
    // have left nothing — collapse before trimming so "meeting at  on Friday"
    // (two spaces where "3pm" was removed) reads cleanly.
    .replace(/\s+/g, ' ');
  t = stripTrailingRequest(t.trim());
  // "俺の誕生日" -> "誕生日": a first-person possessive reads fine in speech but
  // is an odd default title for a calendar entry.
  t = t.replace(/俺の|私の|自分の|僕の/g, '');
  // Leftover fillers/particles are stripped from the EDGES only, repeatedly —
  // not globally. A global strip of bare は/が/に/で/と/の/を also matches
  // those characters *inside* an ordinary word ("ごはん" → "ごん", "かがみ" →
  // "かみ"), since regex has no notion of "this は is a grammatical particle."
  // Particle residue from earlier steps is always at a boundary, so anchoring
  // to ^/$ gets the same cleanup without that risk.
  const EDGE_FILLER = '死守|絶対|必ず|極力|なるべく|できれば|したい|する|やる|だけ|って|を|は|が|に|で|と|の|、|。';
  const LEADING_RE = new RegExp(`^(${EDGE_FILLER})`);
  const TRAILING_RE = new RegExp(`(${EDGE_FILLER})$`);
  let prevLen: number;
  do {
    prevLen = t.length;
    t = t.replace(LEADING_RE, '').replace(TRAILING_RE, '').trim();
  } while (t.length !== prevLen && t.length > 0);
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

// Roll a past month/day forward to next year — including a day earlier this
// same month (e.g. today 6/12, "6月5日までに" means next year, not 5 days ago).
const resolveMonthDayKey = (mo1: number, dom: number, now: Date): string => {
  let y = now.getFullYear();
  const mo = mo1 - 1;
  if (mo < now.getMonth() || (mo === now.getMonth() && dom < now.getDate())) y += 1;
  const d = new Date(y, mo, dom);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const deadlineOf = (frag: string, now: Date): string | undefined => {
  if (/今月末|今月中|月内/.test(frag)) return monthEndDateKey(now);
  if (/来月末/.test(frag)) return monthEndDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  // A bare "月末" (no 今/来 qualifier) only counts as a one-off deadline when
  // task language says so ("月末までに提出") — otherwise it's monthlyPatternOf's
  // "every month-end" recurring interpretation (see there), mirroring how a
  // bare weekday elsewhere defaults to a standing weekly commitment.
  if (/月末/.test(frag) && /までに|〆切|締切|提出/.test(frag)) return monthEndDateKey(now);
  if (/今年中に|今年末|年内に/.test(frag)) return `${now.getFullYear()}-12-31`;
  if (/今週末|週末まで|今週中/.test(frag)) {
    const toSat = (6 - now.getDay() + 7) % 7;
    return addDaysKey(now, toSat);
  }
  if (/明日まで|明日中に/.test(frag)) return addDaysKey(now, 1);
  if (/今日中に/.test(frag)) return addDaysKey(now, 0);
  // Unlike 明日/今日 above, a bare "明後日" (no まで/中に) used to be read as a
  // deadline unconditionally — turning a one-off "明後日に友達とランチ" into a
  // task due two days out instead of a lunch plan on that day. Require the
  // same task language the other two branches do.
  if (/明後日(?:まで|中に)/.test(frag)) return addDaysKey(now, 2);
  // "3日以内に" / "1週間以内に" — a relative offset from today, distinct from
  // "3日後" (see the note on deadlineOf vs. a plain due-date reminder) in that
  // 以内に explicitly means task language ("finish within N days").
  const withinDays = frag.match(/(\d+)\s*日以内に/);
  if (withinDays) return addDaysKey(now, parseInt(withinDays[1], 10));
  const withinWeeks = frag.match(/(\d+)\s*週間以内に/);
  if (withinWeeks) return addDaysKey(now, parseInt(withinWeeks[1], 10) * 7);
  // An explicit date only counts as a deadline when task language says so —
  // "9月10日は誕生日" is a one-off event, not a project due that day. Bare
  // "まで" is excluded too (e.g. "16時まで" is a time range end, not a due
  // date); only "までに" or an explicit 締切ワード count.
  const md = frag.match(/(\d+)月(\d+)日/);
  if (md && /までに|〆切|締切|提出/.test(frag)) {
    return resolveMonthDayKey(parseInt(md[1], 10), parseInt(md[2], 10), now);
  }
  // "までに" is a deadline marker; bare "まで" is NOT (e.g. "16時まで" is a time
  // range end, not a due date) — only treat 〆切/締切/提出 + までに as vague deadlines.
  if (/までに|〆切|締切|提出期限/.test(frag)) return monthEndDateKey(now);
  // English — "by tomorrow" / "within 3 days" / "by the end of the month".
  // "by" is inherently deadline language (unlike a bare JP date), so no
  // additional task-word gate is needed the way the JP date branch above has.
  if (/by\s+(?:the\s+end\s+of\s+(?:the\s+)?day|today|end\s+of\s+day)/i.test(frag)) return addDaysKey(now, 0);
  if (/by\s+tomorrow/i.test(frag)) return addDaysKey(now, 1);
  const enWithinDays = frag.match(/within\s+(\d+)\s*days?/i);
  if (enWithinDays) return addDaysKey(now, parseInt(enWithinDays[1], 10));
  const enWithinWeeks = frag.match(/within\s+(\d+)\s*weeks?/i);
  if (enWithinWeeks) return addDaysKey(now, parseInt(enWithinWeeks[1], 10) * 7);
  if (/by\s+(?:the\s+)?end\s+of\s+(?:the\s+)?month/i.test(frag)) return monthEndDateKey(now);
  if (/by\s+(?:the\s+)?end\s+of\s+(?:the\s+)?year/i.test(frag)) return `${now.getFullYear()}-12-31`;
  return undefined;
};

// A bare explicit date with no deadline language ("9月10日は誕生日") is a
// one-off calendar marker, not a project to distribute work toward.
const singleDateOf = (frag: string, now: Date): string | undefined => {
  const md = frag.match(/(\d+)月(\d+)日/);
  if (!md) return undefined;
  return resolveMonthDayKey(parseInt(md[1], 10), parseInt(md[2], 10), now);
};

// "来週の月曜日に歯医者" / "今度の金曜日に飲み会" — a weekday qualified by 来週/
// 今度/今週 names ONE specific occurrence, not a standing weekly commitment.
// Without this, daysOf() still finds the weekday and the fragment falls
// through to 'fixed', silently creating a recurring ~3-month series out of a
// single dentist visit.
const qualifiedWeekdayEventDate = (frag: string, now: Date): string | undefined => {
  if (/毎週/.test(frag)) return undefined; // an explicit recurrence wins
  const q = frag.match(/来週|今度|今週/);
  if (!q) return undefined;
  const dow = DOW_TOKENS.find(({re}) => re.test(frag))?.day;
  if (dow === undefined) return undefined;
  let delta = (dow - now.getDay() + 7) % 7; // days until the nearest occurrence
  if (q[0] === '来週') delta += 7; // explicitly skip this week's occurrence
  return addDaysKey(now, delta);
};

// "今日"/"明日"/"明後日" name one specific day with no weekday reference at all
// ("明日10時に歯医者") — without this, such a fragment had no eventDate and no
// `days`, so it fell through to the generic `win || days` branch and became a
// standing 'fixed' commitment defaulting to every weekday, silently turning a
// single tomorrow appointment into a recurring one. Checked only when no
// deadline/monthly/frequency signal already claimed the fragment (see the
// priority order in parseFragment), so "明日から毎日ジム" still reads as
// recurring, not a one-off event.
const relativeEventDateOf = (frag: string, now: Date): string | undefined => {
  if (/明々後日|明明後日/.test(frag)) return addDaysKey(now, 3);
  if (/明後日/.test(frag)) return addDaysKey(now, 2);
  if (/明日/.test(frag)) return addDaysKey(now, 1);
  if (/今日/.test(frag)) return addDaysKey(now, 0);
  const m = frag.match(/(\d+|[０-９]+)\s*日後/);
  if (m) {
    const n = toNum(m[1]);
    if (!isNaN(n)) return addDaysKey(now, n);
  }
  return undefined;
};

// "隔月" (every other month) / "3ヶ月に1回" (every 3 months) — a multiplier on
// whichever monthly pattern below it's combined with. Standalone (no day
// spec at all) is left unhandled: there's no single date to pin without one.
const monthIntervalOf = (frag: string): number | undefined => {
  if (/隔月/.test(frag)) return 2;
  const m = frag.match(/(\d+)\s*(?:ヶ|か|カ)月に\s*1\s*回/);
  if (m) return parseInt(m[1], 10);
  return undefined;
};

// "毎月1日に家賃支払い" (day-of-month) / "第2土曜日にサークル活動" (Nth weekday
// of the month) / "毎月末に" (last calendar day) / "毎月最終営業日に" (last
// weekday) — a monthly cadence, distinct from both a weekly 'fixed'
// commitment and a one-off 'event'. None of these fit the weekly day-of-week
// model at all, so they used to silently fall through to 'recurring' with a
// meaningless default (~3x/week) and leftover garbage in the title.
interface MonthlyPattern {
  monthDay?: number;
  monthWeek?: number;
  dow?: DayOfWeek;
  lastDayOfMonth?: boolean;
  lastBusinessDayOfMonth?: boolean;
  monthInterval?: number;
}
const monthlyPatternOf = (frag: string): MonthlyPattern | undefined => {
  const interval = monthIntervalOf(frag);
  // 最終営業日 (last business day) is checked before bare 月末 (last calendar
  // day) since "毎月末の最終営業日" would otherwise match the calendar-day
  // branch first and lose the "business day" refinement.
  if (/最終営業日/.test(frag)) return {lastBusinessDayOfMonth: true, monthInterval: interval};
  // A bare "月末"/"毎月末" reaches here only when deadlineOf() didn't already
  // claim it as a one-off (see the note there) — i.e. no task language, so
  // this is the recurring "every month-end" reading.
  if (/月末/.test(frag)) return {lastDayOfMonth: true, monthInterval: interval};
  const nth = frag.match(/第\s*([1-5一二三四五])\s*([月火水木金土日])曜日?/);
  if (nth) {
    const week = toNum(nth[1]);
    const dow = BARE_DOW_DAY[nth[2]];
    if (!isNaN(week) && dow !== undefined) return {monthWeek: week, dow, monthInterval: interval};
  }
  const md = frag.match(/毎月\s*(\d{1,2})\s*日/) ?? (interval ? frag.match(/隔月\s*[のに]?\s*(\d{1,2})\s*日/) : null);
  if (md) {
    const day = parseInt(md[1], 10);
    if (day >= 1 && day <= 31) return {monthDay: day, monthInterval: interval};
  }
  return undefined;
};

const frequencyOf = (frag: string): number | undefined => {
  const m = frag.match(/週\s*([0-9０-９]+|[一二三四五六七])\s*回?/);
  if (m) {
    const n = toNum(m[1]);
    if (!isNaN(n)) return n;
  }
  // 毎朝/毎晩 name a daily cadence just as much as 毎日 does ("毎朝ランニング" means
  // every single morning, weekends included) — without this they fell through
  // to 'fixed' with a silent weekdays-only default, quietly dropping Sat/Sun.
  if (/毎日|毎朝|毎晩/.test(frag)) return 7;
  if (/隔日|一日おき/.test(frag)) return 4;
  // "隔週" (every other week) doesn't fit a per-week count at all — the
  // 'recurring' kind only models a weekly cadence — so this is a rough
  // approximation (roughly-weekly-or-less) rather than a real once-per-2-weeks.
  if (/隔週/.test(frag)) return 1;
  if (/平日毎日|平日は毎日/.test(frag)) return 5;
  // English — "every day"/"daily", "every other day", "3 times a week".
  if (/every\s*day|daily/i.test(frag)) return 7;
  if (/every\s+other\s+day/i.test(frag)) return 4;
  const enTimes = frag.match(/(\d+)\s*times?\s*(?:a|per)\s*week/i);
  if (enTimes) return parseInt(enTimes[1], 10);
  if (/twice\s*(?:a|per)\s*week/i.test(frag)) return 2;
  if (/once\s*(?:a|per)\s*week/i.test(frag)) return 1;
  return undefined;
};

// "月曜から金曜まで" — a weekday RANGE, not just its two endpoints. Without
// this, daysOf() only ever sees 月曜/金曜 as two independent DOW_TOKENS matches
// and silently drops Tue/Wed/Thu, e.g. turning "weekdays" into "Mon and Fri".
// Wraps forward through the week (e.g. 土曜から月曜まで → Sat, Sun, Mon).
const weekdayRangeOf = (frag: string): DayOfWeek[] | undefined => {
  const m = frag.match(/([月火水木金土日])曜日?\s*(?:から|〜|~|-)\s*([月火水木金土日])曜日?\s*まで/);
  if (!m) return undefined;
  const start = BARE_DOW_DAY[m[1]];
  const end = BARE_DOW_DAY[m[2]];
  const result: DayOfWeek[] = [];
  let i = start;
  for (let n = 0; n < 7; n++) {
    result.push(i);
    if (i === end) break;
    i = ((i + 1) % 7) as DayOfWeek;
  }
  return result;
};

const daysOf = (frag: string): DayOfWeek[] | undefined => {
  // "以外" (except) inverts the named days — must be checked before the plain
  // 土日/平日 matches below, which would otherwise return the literal (and
  // opposite of intended) set.
  if (/土日以外|週末以外/.test(frag)) return [...WEEKDAYS];
  if (/平日以外/.test(frag)) return [...WEEKENDS];
  const range = weekdayRangeOf(frag);
  if (range) return range;
  const found: DayOfWeek[] = [];
  for (const {re, day} of DOW_TOKENS) if (re.test(frag)) found.push(day);
  if (found.length) return Array.from(new Set(found)) as DayOfWeek[];
  const run = frag.match(BARE_DOW_RUN_RE);
  if (run) {
    const bare = run[0]
      .replace(/[・、,，]/g, '')
      .split('')
      .map(c => BARE_DOW_DAY[c]);
    if (bare.length) return Array.from(new Set(bare));
  }
  if (/平日/.test(frag)) return [...WEEKDAYS];
  if (/週末|土日/.test(frag)) return [...WEEKENDS];
  return undefined;
};

/** Classify and build one Intention from a single fragment. */
const parseFragment = (raw: string, idx: number, now: Date): Intention | null => {
  const rawTrimmed = raw.trim();
  const frag = normalizeKanjiHours(normalizeDigits(rawTrimmed));
  if (frag.length < 2) return null;

  const lex = TITLE_LEXICON.find(l => l.re.test(frag));
  const days = daysOf(frag);
  const freq = frequencyOf(frag);
  const deadline = deadlineOf(frag, now);
  const qualifiedEventDate = qualifiedWeekdayEventDate(frag, now);
  const relativeEventDate = relativeEventDateOf(frag, now);
  const eventDate = singleDateOf(frag, now) ?? qualifiedEventDate ?? relativeEventDate;
  const monthlyPattern = monthlyPatternOf(frag);
  // An explicit "10時から16時" range wins over vague time-of-day words, and also
  // gives us an exact duration. The window's endHour must round UP when the
  // range ends mid-hour (e.g. 7:00–7:30) — using the raw hour would collapse
  // it to a zero-width {7, 7} window, which findSlot then can't fit anything
  // into and silently ignores, placing the block at a random time of day
  // instead of the declared one.
  const range = timeRange(frag);
  // "22時から翌1時" rolls past midnight, which TimeWindow (a single day's
  // {startHour, endHour}) can't represent as a search window. `window` is
  // still capped at 24:00 here for display/fallback purposes, but the real,
  // uncapped duration is kept separately (crossesMidnight below) so the
  // scheduler can pin the block at its exact declared time instead of
  // searching a window it doesn't actually fit in.
  const crossesMidnight = !!range?.nextDay;
  // A single "13時に" mention (no range) still beats a vague keyword — without
  // this, "毎晩23時に日記" matched 晩 in timeWindow() and silently discarded
  // the explicit 23時. +2h of window headroom (not +1h) so a kind's default
  // duration (up to 90min) comfortably starts exactly at the declared hour;
  // findSlot always prefers the earliest fit, so it lands there whenever free.
  const singleTime = !range ? singleTimeOf(frag) : undefined;
  const win = range
    ? {
        startHour: range.startHour,
        endHour: crossesMidnight ? 24 : Math.ceil((range.endHour * 60 + range.endMin) / 60),
      }
    : singleTime
    ? {startHour: singleTime.hour, endHour: Math.min(24, singleTime.hour + 2)}
    : timeWindow(frag);
  const explicitDur = range
    ? Math.max(
        30,
        (crossesMidnight ? range.endHour * 60 + range.endMin + 24 * 60 : range.endHour * 60 + range.endMin) -
          (range.startHour * 60 + range.startMin),
      )
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
  // "毎月1日" / "第2土曜日" outranks 'fixed' below — daysOf() still finds a
  // literal 土曜 substring inside "第2土曜日", which would otherwise turn a
  // once-a-month meetup into a standing weekly commitment.
  else if (monthlyPattern) kind = 'monthly';
  // "来週の月曜日" etc. names one specific occurrence — this must outrank the
  // 'fixed' branch below, which would otherwise treat the same weekday token
  // (`days`) as a standing weekly commitment.
  else if (qualifiedEventDate) kind = 'event';
  else if (isFocusWork || (isProtect && win)) kind = 'focus';
  else if (batchPref && !freq) kind = 'preference';
  else if (explicitDay && win && !freq) kind = 'fixed';
  else if (freq) kind = 'recurring';
  else if (/好み|prefer/i.test(frag) && !lex) kind = 'preference';
  // A bare date with no weekday/frequency/focus signal is a one-off marker,
  // not a recurring pattern — but a weekday token (`days`) is the stronger,
  // more specific signal when both somehow appear in the same fragment.
  else if (eventDate && !days) kind = 'event';
  else if (win || days) kind = 'fixed';
  else kind = 'recurring';

  const title = lex ? i18n.t(lex.titleKey) : cleanTitle(frag) || i18n.t('agentUntitled', {n: idx + 1});
  const tag = lex?.tag;
  // Work/baito gets the canonical work-blue so the 年収の壁 / pay features apply.
  const color = tag === 'work' ? '#007AFF' : PALETTE[idx % PALETTE.length];

  const base: Intention = {
    id: genId(),
    raw: rawTrimmed,
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
    if (crossesMidnight) base.crossesMidnight = true;
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
    if (crossesMidnight) base.crossesMidnight = true;
  } else if (kind === 'deadline') {
    base.deadline = deadline;
    base.window = win;
    base.durationMin = 90;
    base.totalEstimateMin = durationMin(frag, 90) > 90 ? durationMin(frag, 90) : 600; // default ~10h
    base.priority = priorityOf(frag, 4);
  } else if (kind === 'event') {
    base.eventDate = eventDate;
    if (range) {
      base.window = win!;
      base.durationMin = explicitDur ?? 60;
      if (crossesMidnight) base.crossesMidnight = true;
    } else if (win) {
      base.window = win;
      base.durationMin = durationMin(frag, 60);
    } else {
      base.allDay = true;
      base.durationMin = 0;
    }
    base.priority = priorityOf(frag, 3);
  } else if (kind === 'monthly') {
    if (monthlyPattern!.lastBusinessDayOfMonth) {
      base.lastBusinessDayOfMonth = true;
    } else if (monthlyPattern!.lastDayOfMonth) {
      base.lastDayOfMonth = true;
    } else if (monthlyPattern!.monthDay !== undefined) {
      base.monthDay = monthlyPattern!.monthDay;
    } else {
      base.monthWeek = monthlyPattern!.monthWeek;
      base.days = [monthlyPattern!.dow!];
    }
    if (monthlyPattern!.monthInterval) base.monthInterval = monthlyPattern!.monthInterval;
    base.window = win ?? {startHour: 18, endHour: 20};
    base.durationMin = explicitDur ?? durationMin(frag, 90);
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
    // sentence-ish boundaries; also split on an ASCII period + space so English
    // "…16:00. Part-time…" becomes two fragments (times like 10:00 are untouched).
    // The negative lookbehind guards against splitting mid-clause: "週2回、
    // 19時から20時半に" is one declaration (frequency, then its time), not two
    // — a 、 right after a count word or a topic/case particle almost always
    // means the writer paused before finishing the same thought, not that a
    // new, independent item started. Same for "月曜、水曜、金曜の18時から" — a
    // weekday list, not three separate declarations.
    .split(/[。\n．;；]+|\.\s+|(?<!回|は|が|も|に|で|と|の|を|から|まで|曜|曜日)、(?=[^、]{6,})/)
    .map(s => s.trim())
    .filter(Boolean);
  const out: Intention[] = [];
  fragments.forEach((f, i) => {
    const intn = parseFragment(f, i, now);
    if (intn) out.push(intn);
  });
  return out;
};
