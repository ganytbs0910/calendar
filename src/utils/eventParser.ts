/**
 * Lightweight Japanese natural-language event parser.
 *
 * Extracts start date, end date and title from free text such as
 *   「明日 14時 会議」
 *   「12/25 19時 クリスマス会 2時間」
 *   「来週月曜 10:00〜11:30 田中さんと打ち合わせ」
 *
 * The parser is intentionally regex-based and 100 % on-device — no API calls.
 * It handles the common patterns; ambiguous text falls back to the title slot.
 */

export interface ParsedEvent {
  startDate: Date;
  endDate: Date;
  title: string;
}

const WEEKDAY: Record<string, number> = {
  日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6,
};

const stripDateTime = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export function parseEventText(text: string, base: Date = new Date()): ParsedEvent | null {
  let working = (text || '').trim();
  if (!working) return null;

  const today = stripDateTime(base);
  let date = new Date(today);
  let dateMatched = false;

  const consume = (re: RegExp): RegExpMatchArray | null => {
    const m = working.match(re);
    if (m) working = working.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
    return m;
  };

  // ── Relative day keywords ──
  if (/(明後日|あさって)/.test(working)) {
    date = new Date(today); date.setDate(date.getDate() + 2);
    dateMatched = true;
    consume(/(明後日|あさって)/);
  } else if (/(明日|あした|あす)/.test(working)) {
    date = new Date(today); date.setDate(date.getDate() + 1);
    dateMatched = true;
    consume(/(明日|あした|あす)/);
  } else if (/(今日|きょう)/.test(working)) {
    date = new Date(today);
    dateMatched = true;
    consume(/(今日|きょう)/);
  }

  // ── Absolute date: YYYY年M月D日 / M月D日 ──
  if (!dateMatched) {
    const m = consume(/(?:(\d{4})年)?\s*(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const y = m[1] ? parseInt(m[1], 10) : today.getFullYear();
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      date = new Date(y, mo, d);
      // If unspecified year and the date is already past, assume next year.
      if (!m[1] && date.getTime() < today.getTime()) date.setFullYear(y + 1);
      dateMatched = true;
    }
  }

  // ── Absolute date: YYYY/M/D or M/D ──
  if (!dateMatched) {
    const m = consume(/(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?!\d)/);
    if (m) {
      const y = m[1] ? parseInt(m[1], 10) : today.getFullYear();
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      date = new Date(y, mo, d);
      if (!m[1] && date.getTime() < today.getTime()) date.setFullYear(y + 1);
      dateMatched = true;
    }
  }

  // ── Weekday: (来週|今週)?[日月火水木金土]曜?日? ──
  if (!dateMatched) {
    const m = consume(/(来週|再来週|今週)?\s*([日月火水木金土])曜日?/);
    if (m) {
      const target = WEEKDAY[m[2]];
      const baseDay = today.getDay();
      // Day offset within the current week (0..6); 0 means same weekday.
      const sameWeekDiff = (target - baseDay + 7) % 7;
      let diff: number;
      if (m[1] === '来週') {
        diff = sameWeekDiff + 7;          // exactly one week ahead from same-week match
      } else if (m[1] === '再来週') {
        diff = sameWeekDiff + 14;         // two weeks ahead
      } else {
        diff = sameWeekDiff === 0 ? 7 : sameWeekDiff; // never the same day
      }
      date = new Date(today);
      date.setDate(date.getDate() + diff);
      dateMatched = true;
    }
  }

  // ── Time range: HH(:|時)MM?(分)? [〜~ーから] HH(:|時)MM?(分)?(まで)? ──
  let startH: number | null = null;
  let startM = 0;
  let endH: number | null = null;
  let endM = 0;

  // Capture "半" explicitly on either side so we don't depend on string splitting.
  const rangeRe = /(\d{1,2})(?::|時)(?:(\d{1,2})分?|(半))?\s*(?:〜|~|ー|から|-)\s*(\d{1,2})(?::|時)(?:(\d{1,2})分?|(半))?(?:まで)?/;
  const rangeMatch = consume(rangeRe);
  if (rangeMatch) {
    startH = parseInt(rangeMatch[1], 10);
    if (rangeMatch[2]) startM = parseInt(rangeMatch[2], 10);
    else if (rangeMatch[3]) startM = 30;
    endH = parseInt(rangeMatch[4], 10);
    if (rangeMatch[5]) endM = parseInt(rangeMatch[5], 10);
    else if (rangeMatch[6]) endM = 30;
  } else {
    // Single time: HH:MM / HH時MM分 / HH時半 / HH時
    const single = consume(/(\d{1,2})(?::|時)(?:(\d{1,2})分?|半)?(?:から|より)?/);
    if (single) {
      startH = parseInt(single[1], 10);
      if (single[2]) startM = parseInt(single[2], 10);
      else if (/半/.test(single[0])) startM = 30;
    }
  }

  // ── Duration: N時間半 / N時間 / N分 ──
  let durationMin: number | null = null;
  const durH = consume(/(\d+)時間(半)?/);
  if (durH) {
    durationMin = parseInt(durH[1], 10) * 60 + (durH[2] ? 30 : 0);
  } else {
    const durM = consume(/(\d+)分(?:間)?/);
    if (durM) durationMin = parseInt(durM[1], 10);
  }

  // Without a parsed time we cannot anchor an event to an hour, so bail out.
  if (startH === null) return null;

  const startDate = new Date(date);
  startDate.setHours(startH, startM, 0, 0);

  let endDate: Date;
  if (endH !== null) {
    endDate = new Date(date);
    endDate.setHours(endH, endM, 0, 0);
    // If the end time is before the start, assume it crosses midnight.
    if (endDate.getTime() <= startDate.getTime()) {
      endDate.setDate(endDate.getDate() + 1);
    }
  } else if (durationMin !== null) {
    endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);
  } else {
    // Default to a 1-hour event when only a start time is provided.
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  }

  // Honour the app-wide 30-minute minimum duration rule.
  if (endDate.getTime() - startDate.getTime() < 30 * 60 * 1000) {
    endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
  }

  // Trim leftover punctuation/connectives that aren't part of the title.
  const title = working
    .replace(/^[\s、,。\-—ー〜~・]+|[\s、,。\-—ー〜~・]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    startDate,
    endDate,
    title,
  };
}
