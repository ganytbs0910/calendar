import {parseIntentions} from '../src/agent/intentionParser';

const now = new Date(2026, 7, 26); // Wed 2026-08-26

test('a weekly fixed commitment parses with a clean title, not the trailing request verb', () => {
  const [intn] = parseIntentions('毎週月曜日の10時から12時に英語基礎を追加して', now);

  expect(intn.title).toBe('英語基礎');
  expect(intn.kind).toBe('fixed');
  expect(intn.days).toEqual([1]);
  expect(intn.window).toEqual({startHour: 10, endHour: 12});
  expect(intn.durationMin).toBe(120);
});

test.each([
  ['毎週火曜日の19時から20時にヨガを登録してください', 'ヨガ'],
  ['毎週水曜日の7時から8時に瞑想を入れて', '瞑想'],
  ['毎週木曜日の21時から22時に日記をセットして', '日記'],
])('strips other common trailing request phrasings: %s', (text, expectedTitle) => {
  const [intn] = parseIntentions(text, now);
  expect(intn.title).toBe(expectedTitle);
});

test('does not touch a title with no trailing request phrase', () => {
  const [intn] = parseIntentions('毎週金曜日の18時から20時に写真整理', now);
  expect(intn.title).toBe('写真整理');
});

// A bare date with no deadline language is a one-off marker (誕生日/記念日),
// not a project with work to distribute — this used to become a 'deadline'
// with a fake ~10h estimate just because a date appeared in the text.
test('a bare date with no deadline language becomes a one-off event, not a deadline', () => {
  const [intn] = parseIntentions('9月10日は俺の誕生日って入れて', now);

  expect(intn.kind).toBe('event');
  expect(intn.title).toBe('誕生日');
  expect(intn.eventDate).toBe('2026-09-10');
  expect(intn.allDay).toBe(true);
});

test('an explicit date WITH deadline language still classifies as a deadline', () => {
  const [intn] = parseIntentions('9月10日までにレポート提出', now);

  expect(intn.kind).toBe('deadline');
  expect(intn.deadline).toBe('2026-09-10');
});

// A sub-hour range (e.g. 7:00–7:30) used to collapse its window to {7, 7} —
// zero width — because the window only stored whole hours. findSlot then
// couldn't fit anything into a zero-width window and silently placed the
// block at any free time of day, ignoring the declared time entirely.
test('a sub-hour time range keeps its window instead of collapsing to zero width', () => {
  const [intn] = parseIntentions('毎日7時から7時30分に瞑想', now);

  expect(intn.window).toEqual({startHour: 7, endHour: 8});
  expect(intn.durationMin).toBe(30);
});

test('"時半" (half past) is understood on either side of a time range', () => {
  const [intn] = parseIntentions('毎週月曜日の19時半から21時にヨガ', now);

  expect(intn.window).toEqual({startHour: 19, endHour: 21});
  expect(intn.durationMin).toBe(90);
  expect(intn.title).toBe('ヨガ');
});

test('"N時間半" duration keeps the extra 30 minutes', () => {
  const [intn] = parseIntentions('毎週月曜日の夜に1時間半のジム', now);

  expect(intn.durationMin).toBe(90);
});

// TimeWindow can't represent a range crossing midnight (the day model caps at
// 24:00), so the window is capped there for display — but the real duration
// is kept, and crossesMidnight tells the scheduler to pin the block directly
// at 22:00 rather than search a same-day window it doesn't fit in.
test('an overnight range keeps its real duration and is flagged to pin directly', () => {
  const [intn] = parseIntentions('毎週月曜日の22時から翌1時にバイト', now);

  expect(intn.window).toEqual({startHour: 22, endHour: 24});
  expect(intn.durationMin).toBe(180); // the real 22:00–01:00 length
  expect(intn.crossesMidnight).toBe(true);
});

// "月・水・金" / "月水木" — the bare-kanji shorthand list (no 曜/曜日) is common
// for class/gym schedules and used to be invisible to daysOf(), silently
// falling back to all-weekdays and leaving the kanji stuck in the title.
test('a bare-kanji weekday list ("月・水・金") is recognized without 曜', () => {
  const [intn] = parseIntentions('毎週月・水・金の18時から20時にジム', now);

  expect(intn.days).toEqual([1, 3, 5]);
  expect(intn.title).toBe('筋トレ'); // ジム matches the workout lexicon
});

test('a bare-kanji weekday list with no separators ("月水金") is recognized', () => {
  const [intn] = parseIntentions('毎週月水金の18時から20時にジム', now);

  expect(intn.days).toEqual([1, 3, 5]);
});

// A single incidental kanji that happens to overlap a weekday character (水,
// 木, 金) must not be misread as a day — only a run of 2+ counts.
test('a lone weekday-lookalike kanji is not treated as a day', () => {
  const [intn] = parseIntentions('毎週金曜日の朝に水を飲む', now);

  expect(intn.days).toEqual([5]);
});

// "週2回、19時から20時半に" is one declaration continued after a pause, not
// two — a 、 right after a count word ("回") must not split it in half.
test('a comma after a frequency count does not split the declaration in two', () => {
  const intns = parseIntentions('週2回、19時から20時半にランニング', now);

  expect(intns).toHaveLength(1);
  expect(intns[0].title).toBe('ランニング');
  expect(intns[0].timesPerWeek).toBe(2);
  expect(intns[0].window).toEqual({startHour: 19, endHour: 21});
  expect(intns[0].durationMin).toBe(90);
});

// "月曜、水曜、金曜の18時から" is one weekday list, not three declarations —
// a 、 right after 曜/曜日 must not split it either.
test('commas in a weekday list do not split it into separate declarations', () => {
  const intns = parseIntentions('毎週月曜、水曜、金曜の18時から20時にジム', now);

  expect(intns).toHaveLength(1);
  expect(intns[0].days).toEqual([1, 3, 5]);
});

test('a mix of と and 、 in a weekday list still parses as one declaration', () => {
  const intns = parseIntentions('毎週月曜日と水曜日、金曜日の18時から20時にジム', now);

  expect(intns).toHaveLength(1);
  expect(intns[0].days).toEqual([1, 3, 5]);
});

// "来週の月曜日に歯医者" names one specific Monday, not a standing weekly
// commitment — this used to fall through to 'fixed' and silently create a
// recurring ~3-month series out of a single dentist visit.
test('"来週の" + a weekday names one occurrence, not a weekly commitment', () => {
  const [intn] = parseIntentions('来週の月曜日に歯医者', now);

  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-09-07'); // the Monday after next
  expect(intn.allDay).toBe(true);
  expect(intn.title).toBe('歯医者');
});

test('"今度の" + a weekday means the nearest upcoming one, not next week\'s', () => {
  const [intn] = parseIntentions('今度の金曜日に飲み会', now);

  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-08-28'); // this week's Friday
  expect(intn.title).toBe('飲み会');
});

// 午前/午後 (and AM/PM) prefixed onto explicit hours used to be invisible to
// the from–to range matcher (which requires digits right after the
// connector) and fell back to whichever vague keyword appeared first in the
// fragment, discarding both explicit hours.
test('午前/午後 prefixes on explicit hours are resolved to 24-hour time', () => {
  const [intn] = parseIntentions('毎週月曜日午前10時から午後4時まで大学', now);

  expect(intn.window).toEqual({startHour: 10, endHour: 16});
  expect(intn.durationMin).toBe(360);
  expect(intn.title).toBe('大学');
});

test('AM/PM prefixes on explicit hours are resolved to 24-hour time', () => {
  const [intn] = parseIntentions('毎週月曜日AM10時からPM4時まで大学', now);

  expect(intn.window).toEqual({startHour: 10, endHour: 16});
  expect(intn.title).toBe('大学');
});

// Fullwidth digits (common from JP IME defaults) used to be invisible to
// every \d-based regex at once, losing the time range entirely.
test('fullwidth digits in a time range are recognized', () => {
  const [intn] = parseIntentions('毎週月曜日１０時から１２時に英語', now);

  expect(intn.window).toEqual({startHour: 10, endHour: 12});
  expect(intn.title).toBe('英語');
});

test('a dated event with a time range keeps that exact time, not all-day', () => {
  const [intn] = parseIntentions('9月10日の19時から21時に誕生日会', now);

  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-09-10');
  expect(intn.allDay).toBeUndefined();
  expect(intn.window).toEqual({startHour: 19, endHour: 21});
  expect(intn.durationMin).toBe(120);
});

// A single "13時に" mention (no から...まで) used to be invisible to the range
// matcher and then get shadowed by a vague keyword ("毎晩" contains 晩, so
// "23時" lost to a generic 18–23時 window) — an explicit hour must always win.
test('a single time mention (no range) anchors the window there, not a vague keyword', () => {
  const [intn] = parseIntentions('毎週月曜日13時に打ち合わせ', now);

  expect(intn.window).toEqual({startHour: 13, endHour: 15});
});

test('a single time mention beats a vague keyword that happens to overlap it', () => {
  const [intn] = parseIntentions('毎晩23時に日記', now);

  expect(intn.window).toEqual({startHour: 23, endHour: 24});
});

test('a single time mention on a dated event is kept, not discarded to all-day', () => {
  const [intn] = parseIntentions('9月10日15時に歯医者', now);

  expect(intn.kind).toBe('event');
  expect(intn.allDay).toBeUndefined();
  expect(intn.window).toEqual({startHour: 15, endHour: 17});
});

// Kanji numerals directly before 時 ("十時", "十二時") are a common casual/
// voice-input style and used to be completely invisible to every \d regex.
test('kanji numeral hours ("十時から十二時") are recognized', () => {
  const [intn] = parseIntentions('毎週水曜日十時から十二時に英語', now);

  expect(intn.window).toEqual({startHour: 10, endHour: 12});
  expect(intn.title).toBe('英語');
});

test('"今日中に" / "明日中に" / "N日以内に" / "N週間以内に" resolve to real dates', () => {
  expect(parseIntentions('今日中にメール返信', now)[0].deadline).toBe('2026-08-26');
  expect(parseIntentions('明日中にレポート提出', now)[0].deadline).toBe('2026-08-27');
  expect(parseIntentions('3日以内にレポート提出', now)[0].deadline).toBe('2026-08-29');
  expect(parseIntentions('1週間以内に返信する', now)[0].deadline).toBe('2026-09-02');
  const [intn] = parseIntentions('1週間以内に返信する', now);
  expect(intn.title).toBe('返信'); // trailing する must not survive
});

test('"今年中に" resolves to the last day of the current year', () => {
  const [intn] = parseIntentions('今年中に資格を取る', now);
  expect(intn.deadline).toBe('2026-12-31');
});

// "月曜から金曜まで" is a RANGE, not just its two endpoints — used to silently
// drop Tue/Wed/Thu and turn "weekdays" into "Monday and Friday only".
test('a weekday range ("月曜から金曜まで") expands to every day in between', () => {
  const [intn] = parseIntentions('月曜から金曜まで9時から18時は仕事', now);

  expect(intn.days).toEqual([1, 2, 3, 4, 5]);
});

// "土日以外" means weekdays — the opposite of the literal 土日/週末 match that
// used to fire here, silently inverting the user's intent.
test('"土日以外" resolves to weekdays, not the literal weekend', () => {
  const [intn] = parseIntentions('土日以外の18時からジム', now);

  expect(intn.days).toEqual([1, 2, 3, 4, 5]);
});

test('"平日以外" resolves to the weekend', () => {
  const [intn] = parseIntentions('平日以外の朝にジョギング', now);

  expect(intn.days).toEqual([0, 6]);
});

// The generic leftover-particle strip used to run unanchored, so it also ate
// は/が/に/で/と/の/を when they occur *inside* an ordinary word, not just as
// grammatical residue — e.g. "ごはん" (rice) lost its は and became "ごん".
test('title cleanup does not mangle a word that happens to contain a particle character', () => {
  const [intn] = parseIntentions('毎週月曜日の朝ごはんを食べる', now);

  expect(intn.title).toContain('ごはん');
});

test('"だけ" is stripped from the title', () => {
  const [intn] = parseIntentions('毎週月曜日5分だけ瞑想', now);

  expect(intn.title).toBe('瞑想');
});

// Monthly cadences ("第2土曜日" / "毎月1日") fit neither the weekly 'fixed'
// model nor a one-off 'event' — they used to fall through to 'recurring'
// with a meaningless ~3x/week default and leftover garbage in the title.
test('"第N◯曜日" (Nth weekday of the month) classifies as monthly', () => {
  const [intn] = parseIntentions('第2土曜日にサークル活動', now);

  expect(intn.kind).toBe('monthly');
  expect(intn.monthWeek).toBe(2);
  expect(intn.days).toEqual([6]);
  expect(intn.title).toBe('サークル活動');
});

test('"毎月N日" (day-of-month) classifies as monthly', () => {
  const [intn] = parseIntentions('毎月1日に家賃支払い', now);

  expect(intn.kind).toBe('monthly');
  expect(intn.monthDay).toBe(1);
  expect(intn.title).toBe('家賃支払い');
});

// A dangling "から" with no matching range end ("18時から給料日会" has only
// one 時 mention) must not survive into the title.
test('a single time mention with a dangling から does not leak into the title', () => {
  const [intn] = parseIntentions('毎月25日の18時から給料日会', now);

  expect(intn.monthDay).toBe(25);
  expect(intn.window).toEqual({startHour: 18, endHour: 20});
  expect(intn.title).toBe('給料日会');
});

// ── English support ("Japanese-first, light English") ──────────────────────
// The from–to range matcher requires \d\d時 in JP, which never fires on a
// fully English sentence — this used to lose the time entirely.
test('an English "from X to Y" time range is recognized', () => {
  const [intn] = parseIntentions('study English every Monday from 10 to 12', now);

  expect(intn.days).toEqual([1]);
  expect(intn.window).toEqual({startHour: 10, endHour: 12});
  expect(intn.durationMin).toBe(120);
  expect(intn.title).toBe('勉強'); // "study" hits the JP lexicon
});

test('English am/pm times convert to 24-hour and clean titles without a lexicon match', () => {
  const [intn] = parseIntentions('team sync every Monday from 10am to 11am', now);

  expect(intn.window).toEqual({startHour: 10, endHour: 11});
  expect(intn.title).toBe('team sync');
});

test('a bare hyphen range without am/pm is NOT misread as a time (avoids false positives)', () => {
  const [intn] = parseIntentions('書類を3-5部用意して', now);

  expect(intn.window).toBeUndefined();
});

test('English frequency phrasing ("N times a week", "for N hour(s)") is recognized', () => {
  const [intn] = parseIntentions('workout 3 times a week for 1 hour', now);

  expect(intn.kind).toBe('recurring');
  expect(intn.timesPerWeek).toBe(3);
  expect(intn.durationMin).toBe(60);
});

test('English deadline phrasing ("by tomorrow", "within N days") resolves to real dates', () => {
  expect(parseIntentions('submit the report by tomorrow', now)[0].deadline).toBe('2026-08-27');
  expect(parseIntentions('reply within 3 days', now)[0].deadline).toBe('2026-08-29');
  expect(parseIntentions('finish the project by the end of the month', now)[0].deadline).toBe('2026-08-31');
});

test('English duration phrasing ("for N minutes", "daily") is recognized', () => {
  const [intn] = parseIntentions('read for 30 minutes daily', now);

  expect(intn.durationMin).toBe(30);
  expect(intn.timesPerWeek).toBe(7);
  expect(intn.title).toBe('読書');
});

// ── More complex monthly cadences ───────────────────────────────────────────
test('"毎月末" (last calendar day, no 営業日) classifies as monthly with lastDayOfMonth', () => {
  const [intn] = parseIntentions('毎月末に家賃振込', now);

  expect(intn.kind).toBe('monthly');
  expect(intn.lastDayOfMonth).toBe(true);
  expect(intn.lastBusinessDayOfMonth).toBeUndefined();
  expect(intn.title).toBe('家賃振込');
});

test('"最終営業日" classifies as monthly with lastBusinessDayOfMonth', () => {
  const [intn] = parseIntentions('毎月最終営業日に月次報告', now);

  expect(intn.kind).toBe('monthly');
  expect(intn.lastBusinessDayOfMonth).toBe(true);
  expect(intn.title).toBe('月次報告');
});

// A bare "月末" with task language ("までに") must stay a one-off deadline —
// only the recurring "毎月末" reading becomes 'monthly'.
test('"今月末までに" stays a one-off deadline, not monthly', () => {
  const [intn] = parseIntentions('今月末までにレポート提出', now);

  expect(intn.kind).toBe('deadline');
  expect(intn.deadline).toBe('2026-08-31');
});

test('"隔月" combined with a day-of-month sets monthInterval', () => {
  const [intn] = parseIntentions('隔月1日に定例MTG', now);

  expect(intn.kind).toBe('monthly');
  expect(intn.monthDay).toBe(1);
  expect(intn.monthInterval).toBe(2);
  expect(intn.title).toBe('定例MTG');
});

test('"隔月" combined with "第N◯曜日" sets both monthWeek and monthInterval', () => {
  const [intn] = parseIntentions('隔月第2水曜日に会議', now);

  expect(intn.kind).toBe('monthly');
  expect(intn.monthWeek).toBe(2);
  expect(intn.days).toEqual([3]);
  expect(intn.monthInterval).toBe(2);
  expect(intn.title).toBe('会議');
});

// "3ヶ月に1回" with no day-of-month spec has nothing to pin a date to — this
// is a documented, deliberate gap (falls back to the existing 'recurring'
// default rather than a broken/nonsensical monthly guess).
test('a bare interval with no day spec falls back to recurring, not a broken monthly', () => {
  const [intn] = parseIntentions('3ヶ月に1回、歯医者', now);

  expect(intn.kind).toBe('recurring');
});

// A bare "今日/明日/明後日" with no weekday token used to have no eventDate and
// no days, so it fell through to the generic `win || days` branch and became
// a standing weekdays-only 'fixed' commitment — silently turning "明日10時に
// 歯医者" into a recurring appointment every weekday morning.
test.each([
  ['明日10時に歯医者', 1, '2026-08-27'],
  ['今日15時に美容院', 0, '2026-08-26'],
  ['明後日に友達とランチ', 2, '2026-08-28'],
  ['3日後に美容院', 3, '2026-08-29'],
])('relative single-day mention "%s" becomes a one-off event on the right date', (text, _n, expected) => {
  const [intn] = parseIntentions(text, now);
  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe(expected);
});

test('relative single-day mention does not eat the title', () => {
  const [intn] = parseIntentions('明日10時に歯医者', now);
  expect(intn.title).toBe('歯医者');
});

// "明日から毎日ジム" carries an explicit daily frequency — the relative-date
// reading must not outrank it, or a recurring habit collapses into a single
// tomorrow-only event.
test('a relative date combined with an explicit frequency still reads as recurring', () => {
  const [intn] = parseIntentions('明日から毎日ジム', now);
  expect(intn.kind).toBe('recurring');
  expect(intn.timesPerWeek).toBe(7);
});

// 毎朝/毎晩 mean "every single day" just as much as 毎日 — they used to have no
// frequency signal at all and fell through to 'fixed' with a silent
// weekdays-only default, quietly dropping Saturday and Sunday.
test.each([
  ['毎朝ランニング', 7],
  ['毎晩23時に日記', 7],
])('"%s" is read as a daily (7x/week) recurring habit, not weekdays-only', (text, expectedFreq) => {
  const [intn] = parseIntentions(text, now);
  expect(intn.kind).toBe('recurring');
  expect(intn.timesPerWeek).toBe(expectedFreq);
});

// 「火曜と木曜は10時から12時までバイト」 reads just as naturally as this
// week's plan as it does a standing shift pattern — without an explicit
// 毎週/ずっと-style marker, applyPlanToCalendar must not extrapolate this
// into a ~3-month series (see explicitRecurrence's doc comment in types.ts).
test('a bare fixed weekday+time commitment has no explicitRecurrence by default', () => {
  const [intn] = parseIntentions('火曜と木曜は10時から12時までバイト', now);
  expect(intn.kind).toBe('fixed');
  expect(intn.explicitRecurrence).toBeFalsy();
});

test.each([
  '毎週火曜と木曜は10時から12時までバイト',
  '火曜と木曜は10時から12時までずっとバイト',
  '火曜と木曜は10時から12時まで定期的にバイト',
])('"%s" sets explicitRecurrence from a standing-commitment marker', text => {
  const [intn] = parseIntentions(text, now);
  expect(intn.kind).toBe('fixed');
  expect(intn.explicitRecurrence).toBe(true);
});

// "10時から12時にバイト" has a concrete time but names no weekday at all —
// there is no day-of-week to build a standing commitment out of, so this
// must not silently default to every weekday (Mon-Fri). The only day a
// dayless time mention can sensibly mean is today.
test('a bare time range with no weekday at all is a one-off event today, not a Mon-Fri commitment', () => {
  const [intn] = parseIntentions('10時から12時にバイト', now);
  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-08-26'); // `now` is Wed 2026-08-26
  expect(intn.window).toEqual({startHour: 10, endHour: 12});
  expect(intn.title).toBe('バイト');
});

test('a vague time-of-day word with no weekday is also a one-off event today', () => {
  const [intn] = parseIntentions('夜に日記を書く', now);
  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-08-26');
});

// Naming an actual weekday (even just one, even without ever using 毎週)
// still legitimately means "on that day" — this must keep working exactly
// as before; only the *no day at all* case changed.
test('naming an actual weekday still reads as fixed, not event', () => {
  const [intn] = parseIntentions('火曜と木曜は10時から12時までバイト', now);
  expect(intn.kind).toBe('fixed');
  expect(intn.days).toEqual([2, 4]);
});

test('an explicit 死守 focus block still needs its own recurrence marker for the multi-month write', () => {
  const [intn] = parseIntentions('平日午前は深い作業を死守', now);
  expect(intn.kind).toBe('focus');
  expect(intn.explicitRecurrence).toBeFalsy();

  const [withMarker] = parseIntentions('平日午前は深い作業をずっと死守', now);
  expect(withMarker.explicitRecurrence).toBe(true);
});

// "12-14" — a bare, unit-less hour range with no 時/コロン — is a common
// casual way to type a time range on a phone keyboard. It used to be
// invisible to every time parser at once, silently discarding the hours and
// leaving "明日バイト12-14" as an all-day marker with no time at all.
test('a bare "N-M" hour range (no 時, no colon) is recognized', () => {
  const [intn] = parseIntentions('明日バイト12-14', now);
  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-08-27');
  expect(intn.allDay).toBeUndefined();
  expect(intn.window).toEqual({startHour: 12, endHour: 14});
  expect(intn.durationMin).toBe(120);
  expect(intn.title).toBe('バイト');
});

test('a bare hour range also fixes a weekday+time declaration that used to default to the evening window', () => {
  const [intn] = parseIntentions('火曜12-14にバイト', now);
  expect(intn.kind).toBe('fixed');
  expect(intn.days).toEqual([2]);
  expect(intn.window).toEqual({startHour: 12, endHour: 14});
});

// The exclusion guard: a bare range immediately followed by a counter/unit
// word is a quantity or duration, not a time of day, and must not be misread.
test.each([
  ['3-5部用意して', '部'],
  ['5-10分待つ', '分'],
  ['2-3人で行く', '人'],
  ['12-14円くらい', '円'],
])('"%s" is not misread as an hour range (excluded by trailing %s)', text => {
  const [intn] = parseIntentions(text, now);
  expect(intn.window).toBeUndefined();
});

// A longer number like a date must never be split into a false hour range.
test('a bare range does not split a longer number like a date', () => {
  const [intn] = parseIntentions('2026-08-31に予定', now);
  expect(intn.window).toBeUndefined();
});

// "1時間だけ勉強" — a bare *duration* mention ("N時間") with no から/まで range
// used to be misread by singleTimeOf as if "N時" were a clock hour, silently
// producing a nonsense window like {1, 3}. It must never set a window at all.
test('a bare "N時間" duration is never misread as a clock-time window', () => {
  const [intn] = parseIntentions('1時間だけ勉強', now);
  expect(intn.window).toBeUndefined();
  expect(intn.durationMin).toBe(60);
});

// "午後1時から3時" names one afternoon span — the marker on only one side
// used to leave the other side un-adjusted, producing endHour(3) < startHour
// (13), and a garbage negative-then-clamped duration.
test('an AM/PM marker on only one side of a range is inherited by both', () => {
  const [intn] = parseIntentions('土曜日午後1時から3時にジム', now);
  expect(intn.window).toEqual({startHour: 13, endHour: 15});
  expect(intn.durationMin).toBe(120);
});

// "9/10" — the slash M/D format is at least as common as "9月10日".
test('slash-format dates (M/D) are recognized like 月/日', () => {
  const [asEvent] = parseIntentions('9/10に美容院', now);
  expect(asEvent.kind).toBe('event');
  expect(asEvent.eventDate).toBe('2026-09-10');
  expect(asEvent.title).not.toMatch(/\d/);

  const [asDeadline] = parseIntentions('9/10までにレポート提出', now);
  expect(asDeadline.kind).toBe('deadline');
  expect(asDeadline.deadline).toBe('2026-09-10');
});

// An unrelated fraction-shaped "1/3" must not be misread as a date.
test('a slash fraction is not misread as a date', () => {
  const [intn] = parseIntentions('1/3の確率で当たる', now);
  expect(intn.eventDate).toBeUndefined();
  expect(intn.deadline).toBeUndefined();
});

// "再来週" (the week after next) is one substring-of "来週" away from being
// silently misread as just "来週" — a whole week early.
test('"再来週の" + a weekday means the week after next, not next week', () => {
  const [intn] = parseIntentions('再来週の月曜日に歯医者', now);
  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-09-14'); // two Mondays after 2026-08-26
  expect(intn.title).toBe('歯医者');
});

// "9月末"/"9末" name a SPECIFIC month's end — the bare 月末 fallback used to
// silently resolve to "whichever month we're in right now" instead.
test.each([
  '9月末までにレポート提出',
  '9末までにレポート提出',
])('"%s" resolves to that specific month\'s end, not the current month', text => {
  const [intn] = parseIntentions(text, now);
  expect(intn.kind).toBe('deadline');
  expect(intn.deadline).toBe('2026-09-30');
});

// Compound time-of-day words must be stripped as whole units, or the bare
// half left behind strands a stray character in the title.
test.each([
  ['夜中の2時までゲーム', 'ゲーム'],
  ['深夜作業', '作業'],
])('"%s" strips the compound time word cleanly from the title', (text, expected) => {
  const [intn] = parseIntentions(text, now);
  expect(intn.title).toBe(expected);
});

test('"昼寝" is stripped as a whole word, not just its "昼" half', () => {
  const [intn] = parseIntentions('昼寝する', now);
  expect(intn.title).not.toContain('寝');
});

// "毎月最終日曜" (the last occurrence of a specific weekday in the month) is a
// third distinct "last ~" pattern alongside 毎月末 and 最終営業日 — it used to
// fall through to a bare weekly-Sunday 'fixed' commitment, discarding "最終".
test('"毎月最終日曜" classifies as monthly with lastWeekdayOfMonth, not a weekly Sunday commitment', () => {
  const [intn] = parseIntentions('毎月最終日曜にサークル', now);
  expect(intn.kind).toBe('monthly');
  expect(intn.lastWeekdayOfMonth).toBe(0);
  expect(intn.title).toBe('サークル');
});

// "9/10から9/12まで旅行" is a 3-day span, not a single date — the single-date
// match used to grab just the 10th and leave "から9/12まで" leaking into the
// title, silently discarding when the trip actually ended.
test.each([
  '9/10から9/12まで旅行',
  '9月10日から9月12日まで旅行',
])('"%s" is recognized as a multi-day span with eventEndDate set', text => {
  const [intn] = parseIntentions(text, now);
  expect(intn.kind).toBe('event');
  expect(intn.eventDate).toBe('2026-09-10');
  expect(intn.eventEndDate).toBe('2026-09-12');
  expect(intn.title).toBe('旅行');
});

test('a single (non-range) date never sets eventEndDate', () => {
  const [intn] = parseIntentions('9/10に美容院', now);
  expect(intn.eventEndDate).toBeUndefined();
});

// "来週中に" (within next week) is one week further out than the already-
// supported 今週中 — it used to be unrecognized entirely and fall through to
// a meaningless generic 'recurring' default.
test('"来週中に" resolves to next week\'s Saturday, one week past 今週中', () => {
  const [intn] = parseIntentions('来週中にレポート', now);
  expect(intn.kind).toBe('deadline');
  expect(intn.deadline).toBe('2026-09-05'); // this Sat (08-29) + 7 days
});

// "明日15時までに" — the deadline word まで is not immediately next to 明日
// (there's "15時" in the way), so it used to miss the 明日 branch entirely
// and fall through to the generic までに fallback, which silently resolved
// to "the end of the current month" instead of tomorrow.
test('"明日15時までに" resolves to tomorrow, not the vague end-of-month fallback', () => {
  const [intn] = parseIntentions('明日15時までにメール返信', now);
  expect(intn.kind).toBe('deadline');
  expect(intn.deadline).toBe('2026-08-27');
});

// The same gap for 今日 — "16時まで" alone (bare まで, no に) must still NOT
// be read as a deadline (it's a same-day event's end time), so this only
// fires for the unambiguous "までに" form.
test('a same-day "まで" time range end is still not misread as a deadline', () => {
  const [intn] = parseIntentions('今日16時まで作業', now);
  expect(intn.kind).not.toBe('deadline');
});

// "在宅勤務" (remote work) matched the bare "勤務" keyword and got silently
// relabeled "バイト" — 勤務 is generic "duty/work", not specifically a
// part-time job the way バイト/アルバイト/シフト are.
test('"在宅勤務" is not mislabeled as "バイト" by an over-broad lexicon match', () => {
  const [intn] = parseIntentions('在宅勤務 水曜', now);
  expect(intn.title).not.toBe('バイト');
});

// Priority-marker words (matching priorityOf's own vocabulary) must be
// stripped from the title too, not just recognized for scoring.
test.each([
  ['マストで参加 火曜13時会議', 'マスト'],
  ['死んでも行く 金曜19時ライブ', '死んでも'],
])('"%s" strips the priority marker from the title', (text, marker) => {
  const [intn] = parseIntentions(text, now);
  expect(intn.title).not.toContain(marker);
});
