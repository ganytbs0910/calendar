/**
 * applyPlanToCalendar used to write `taskType: 'schedule'` tasks into a
 * separate AsyncStorage bucket that only ever rendered inside the week view's
 * per-day bottom sheet — the month view (the default screen) never read it,
 * so a declared plan looked like it vanished. It now writes real calendar
 * events instead, which the existing calendar UI already knows how to show.
 *
 * 'fixed'/'focus' (weekday-pinned) blocks with explicitRecurrence set (a
 * 毎週/ずっと-style marker was in the original text) additionally get a
 * multi-week look-ahead: instead of one non-repeating event or a single
 * EventKit RecurrenceRule (which can't skip an individual future
 * occurrence), each of the next ~3 months' worth of weeks is checked
 * independently and only written when free, so one busy week doesn't sink
 * the whole commitment. Without that marker, only what the solver actually
 * placed in its own horizon is written — a bare "火曜と木曜は10-12にバイト"
 * must not silently turn into a 3-month series.
 */

import RNCalendarEvents from 'react-native-calendar-events';

import {applyPlanToCalendar} from '../src/agent/intentionService';
import {SchedulePlan, PlacedBlock} from '../src/agent/types';

jest.mock('react-native-calendar-events', () => ({
  findCalendars: jest.fn(),
  saveEvent: jest.fn(),
  fetchAllEvents: jest.fn().mockResolvedValue([]),
}));

const mockSetEventColor = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/components/AddEventModal', () => ({
  setEventColor: (...args: unknown[]) => mockSetEventColor(...args),
}));

const AGENT_RECURRENCE_WEEKS = 13; // 3 months of weekly occurrences

const block = (overrides: Partial<PlacedBlock> = {}): PlacedBlock => ({
  id: 'blk-1',
  intentionId: 'int-1',
  title: 'アプリをリリース',
  kind: 'deadline', // a non-weekday-pinned kind — stays a single one-off write
  dateKey: '2026-08-27',
  startMin: 9 * 60,
  endMin: 11 * 60,
  color: '#007AFF',
  status: 'planned',
  reason: 'deadline session',
  ...overrides,
});

const plan = (blocks: PlacedBlock[]): SchedulePlan => ({
  generatedAt: new Date().toISOString(),
  horizonDays: 7,
  startDateKey: '2026-08-26',
  blocks,
  unplaced: [],
  conflicts: [],
  score: 0,
});

const saveEventCalls = () => (RNCalendarEvents.saveEvent as jest.Mock).mock.calls;

beforeEach(() => {
  jest.clearAllMocks();
  (RNCalendarEvents.findCalendars as jest.Mock).mockResolvedValue([
    {id: 'cal-1', title: 'Default', isPrimary: true, allowsModifications: true},
  ]);
  (RNCalendarEvents.saveEvent as jest.Mock).mockResolvedValue('event-1');
  (RNCalendarEvents.fetchAllEvents as jest.Mock).mockResolvedValue([]);
});

test('writes a real calendar event for a one-off block, colored per intention', async () => {
  const count = await applyPlanToCalendar(plan([block()]));

  expect(count).toBe(1);
  expect(RNCalendarEvents.saveEvent).toHaveBeenCalledTimes(1);
  const [title, config] = saveEventCalls()[0];
  expect(title).toBe('アプリをリリース');
  expect(config.calendarId).toBe('cal-1');
  expect(config.allDay).toBe(false);
  expect(config.recurrenceRule).toBeUndefined();
  expect(new Date(config.startDate).getHours()).toBe(9);
  expect(new Date(config.endDate).getHours()).toBe(11);
  expect(mockSetEventColor).toHaveBeenCalledWith('event-1', '#007AFF');
});

test('skips blocks marked skipped', async () => {
  const count = await applyPlanToCalendar(plan([block({status: 'skipped'})]));

  expect(count).toBe(0);
  expect(RNCalendarEvents.saveEvent).not.toHaveBeenCalled();
});

test('returns 0 without writing when no calendar is writable', async () => {
  (RNCalendarEvents.findCalendars as jest.Mock).mockResolvedValue([
    {id: 'cal-1', title: 'Read-only', isPrimary: true, allowsModifications: false},
  ]);

  const count = await applyPlanToCalendar(plan([block()]));

  expect(count).toBe(0);
  expect(RNCalendarEvents.saveEvent).not.toHaveBeenCalled();
});

test('a failure on one block does not stop the rest from being applied', async () => {
  (RNCalendarEvents.saveEvent as jest.Mock)
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce('event-2');

  const count = await applyPlanToCalendar(
    plan([block({id: 'blk-1'}), block({id: 'blk-2', dateKey: '2026-08-28'})]),
  );

  expect(count).toBe(1);
  expect(RNCalendarEvents.saveEvent).toHaveBeenCalledTimes(2);
});

// 「毎週月曜日の10時から12時に英語基礎」 with nothing else on the calendar:
// every one of the next ~3 months' Mondays is free, so all of them get an
// event — not a single EventKit recurring series (see file header). The
// explicit 毎週 marker is what unlocks this; see the "no explicit marker"
// tests below for the (now different) default.
test('a clear weekly commitment fills every week for ~3 months when explicitly recurring', async () => {
  const count = await applyPlanToCalendar(
    plan([block({
      kind: 'fixed', title: '英語基礎', dateKey: '2026-08-31', startMin: 10 * 60, endMin: 12 * 60,
      explicitRecurrence: true,
    })]),
  );

  expect(count).toBe(AGENT_RECURRENCE_WEEKS);
  expect(RNCalendarEvents.saveEvent).toHaveBeenCalledTimes(AGENT_RECURRENCE_WEEKS);
  const calls = saveEventCalls();
  // Anchored at the declared Monday, not before it.
  expect(calls[0][1].startDate.startsWith('2026-08-31')).toBe(true);
  // One week apart, same clock time, every occurrence — and never recurring.
  calls.forEach(([title, config], i) => {
    expect(title).toBe('英語基礎');
    expect(config.recurrenceRule).toBeUndefined();
    const start = new Date(config.startDate);
    expect(start.getHours()).toBe(10);
    expect(start.getDay()).toBe(1); // Monday
    if (i > 0) {
      const prev = new Date(calls[i - 1][1].startDate);
      expect(start.getTime() - prev.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });
});

// The point of this session: a week that's already busy is skipped on its
// own — it must not sink the other, still-free weeks of the same commitment.
test('skips just the busy week of a weekly commitment, keeps the rest', async () => {
  // Same local-time construction the code itself uses (dateFromDateKeyAndMin),
  // so this genuinely overlaps the second Monday's 10:00-12:00 occurrence
  // regardless of the test runner's timezone.
  (RNCalendarEvents.fetchAllEvents as jest.Mock).mockResolvedValue([
    {
      startDate: new Date(2026, 8, 7, 10, 30).toISOString(),
      endDate: new Date(2026, 8, 7, 11, 0).toISOString(),
      allDay: false,
      calendar: {title: 'Default'},
    },
  ]);

  await applyPlanToCalendar(
    plan([block({
      kind: 'fixed', title: '英語基礎', dateKey: '2026-08-31', startMin: 10 * 60, endMin: 12 * 60,
      explicitRecurrence: true,
    })]),
  );

  const bookedDates = saveEventCalls().map(([, config]) => config.startDate.slice(0, 10));
  expect(bookedDates).not.toContain('2026-09-07');
  expect(bookedDates).toContain('2026-08-31');
  expect(bookedDates).toContain('2026-09-14');
  // Only the one busy week was dropped from the full ~3-month run.
  expect(bookedDates).toHaveLength(AGENT_RECURRENCE_WEEKS - 1);
});

// The look-ahead is anchored at the block the solver already placed today or
// later — it must never generate (or query) anything before that date.
test('the weekly look-ahead never reaches before the anchor date', async () => {
  await applyPlanToCalendar(
    plan([block({
      kind: 'focus', title: '深い作業', dateKey: '2026-08-31', startMin: 9 * 60, endMin: 10 * 60,
      explicitRecurrence: true,
    })]),
  );

  const anchor = new Date('2026-08-31T09:00:00').getTime();
  for (const [, config] of saveEventCalls()) {
    expect(new Date(config.startDate).getTime()).toBeGreaterThanOrEqual(anchor);
  }
  const [rangeStart] = (RNCalendarEvents.fetchAllEvents as jest.Mock).mock.calls[0];
  expect(new Date(rangeStart).getTime()).toBeGreaterThanOrEqual(anchor);
});

// A crosses-midnight block's endMin exceeds 1440 (e.g. 25:00 = 1am the next
// day) — dateFromDateKeyAndMin must let that roll over into a real next-day
// timestamp rather than clamping or wrapping incorrectly.
test('a crosses-midnight block writes an end time that rolls into the next calendar day', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'recurring', // any non-fixed/focus kind stays a one-off write
        title: 'バイト',
        dateKey: '2026-08-31',
        startMin: 22 * 60,
        endMin: 25 * 60,
      }),
    ]),
  );

  expect(count).toBe(1);
  const [, config] = saveEventCalls()[0];
  const start = new Date(config.startDate);
  const end = new Date(config.endDate);
  expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([7, 31, 22]);
  expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([8, 1, 1]);
});

// An 'event' block with allDay writes as a full-day EventKit entry (no time
// slot to defend), unlike every other kind which always writes allDay: false.
test('an all-day event block writes as a full-day calendar entry', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'event',
        title: '誕生日',
        dateKey: '2026-09-10',
        startMin: 0,
        endMin: 0,
        allDay: true,
      }),
    ]),
  );

  expect(count).toBe(1);
  const [title, config] = saveEventCalls()[0];
  expect(title).toBe('誕生日');
  expect(config.allDay).toBe(true);
  // dateFromDateKeyAndMin builds local-time Dates, so compare local fields
  // (like the other tests' getHours() checks) rather than the ISO string,
  // which shifts by the runner's UTC offset.
  const start = new Date(config.startDate);
  const end = new Date(config.endDate);
  expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 8, 10]);
  expect([start.getHours(), start.getMinutes()]).toEqual([0, 0]);
  expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 8, 10]);
  expect([end.getHours(), end.getMinutes()]).toEqual([23, 59]);
});

// A declared multi-day span ("9/10から9/12まで旅行") must write as ONE all-day
// event covering the whole span, not just its first day.
test('a multi-day event block (eventEndDate set) spans through its last day', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'event',
        title: '旅行',
        dateKey: '2026-09-10',
        startMin: 0,
        endMin: 0,
        allDay: true,
        eventEndDate: '2026-09-12',
      }),
    ]),
  );

  expect(count).toBe(1);
  const [, config] = saveEventCalls()[0];
  const start = new Date(config.startDate);
  const end = new Date(config.endDate);
  expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 8, 10]);
  expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 8, 12]);
  expect([end.getHours(), end.getMinutes()]).toEqual([23, 59]);
});

// 'monthly' commitments recur by month, not by week — the anchor's own
// monthDay/monthWeek pattern must be re-applied to each future month, not
// just "same date + N weeks" like fixed/focus.
test('a monthly day-of-month commitment writes one occurrence per month for 6 months', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'monthly',
        title: '家賃支払い',
        dateKey: '2026-09-01',
        startMin: 18 * 60,
        endMin: 20 * 60,
        monthDay: 1,
      }),
    ]),
  );

  expect(count).toBe(6);
  const dates = saveEventCalls().map(([, config]) => {
    const d = new Date(config.startDate);
    return [d.getFullYear(), d.getMonth(), d.getDate()];
  });
  expect(dates).toEqual([
    [2026, 8, 1], [2026, 9, 1], [2026, 10, 1],
    [2026, 11, 1], [2027, 0, 1], [2027, 1, 1],
  ]);
});

test('a monthly Nth-weekday commitment recomputes the correct date each month', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'monthly',
        title: 'サークル活動',
        dateKey: '2026-09-12', // the 2nd Saturday of September
        startMin: 18 * 60,
        endMin: 20 * 60,
        monthWeek: 2,
      }),
    ]),
  );

  expect(count).toBe(6);
  const dates = saveEventCalls().map(([, config]) => new Date(config.startDate));
  // Every written date must actually be a Saturday, and the 2nd one that month.
  for (const d of dates) {
    expect(d.getDay()).toBe(6);
    expect(Math.ceil(d.getDate() / 7)).toBe(2);
  }
});

test('a lastBusinessDayOfMonth commitment recomputes the last weekday each month', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'monthly',
        title: '月次報告',
        dateKey: '2026-08-31', // last business day of August (a Monday)
        startMin: 18 * 60,
        endMin: 20 * 60,
        lastBusinessDayOfMonth: true,
      }),
    ]),
  );

  expect(count).toBe(6);
  const dates = saveEventCalls().map(([, config]) => new Date(config.startDate));
  for (const d of dates) {
    expect(d.getDay()).not.toBe(0);
    expect(d.getDay()).not.toBe(6);
  }
  // October 2026 ends on a Saturday — its business day must be Oct 30 (Fri).
  const octDate = dates.find(d => d.getMonth() === 9);
  expect(octDate?.getDate()).toBe(30);
});

test('a lastWeekdayOfMonth commitment recomputes the last occurrence of that weekday each month', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'monthly',
        title: 'サークル',
        dateKey: '2026-08-30', // last Sunday of August
        startMin: 18 * 60,
        endMin: 20 * 60,
        lastWeekdayOfMonth: 0, // Sunday
      }),
    ]),
  );

  expect(count).toBe(6);
  const dates = saveEventCalls().map(([, config]) => new Date(config.startDate));
  for (const d of dates) {
    expect(d.getDay()).toBe(0); // every occurrence is a Sunday
  }
  // September 2026's last Sunday is the 27th, not the 30th (a Wednesday).
  const sepDate = dates.find(d => d.getMonth() === 8);
  expect(sepDate?.getDate()).toBe(27);
});

test('monthInterval (隔月) writes only every other month, not every month', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({
        kind: 'monthly',
        title: '定例MTG',
        dateKey: '2026-09-01',
        startMin: 18 * 60,
        endMin: 20 * 60,
        monthDay: 1,
        monthInterval: 2,
      }),
    ]),
  );

  expect(count).toBe(6);
  const months = saveEventCalls().map(([, config]) => new Date(config.startDate).getMonth());
  // Sep(8), Nov(10), Jan(0), Mar(2), May(4), Jul(6) — every other month from the anchor.
  expect(months).toEqual([8, 10, 0, 2, 4, 6]);
});

// The point of this fix: 「火曜と木曜は10時から12時までバイト」 has no 毎週/
// ずっと-style marker, so it must not silently balloon into a ~3-month
// series — only the occurrences the solver actually placed within its own
// horizon (here: exactly the two blocks handed in) get written.
test('a fixed commitment with no explicit recurrence marker writes only what the solver placed', async () => {
  const count = await applyPlanToCalendar(
    plan([
      block({kind: 'fixed', title: 'バイト', dateKey: '2026-09-01', startMin: 10 * 60, endMin: 12 * 60}), // Tue
      block({kind: 'fixed', title: 'バイト', dateKey: '2026-09-03', startMin: 10 * 60, endMin: 12 * 60}), // Thu
    ]),
  );

  expect(count).toBe(2);
  expect(RNCalendarEvents.saveEvent).toHaveBeenCalledTimes(2);
  const bookedDates = saveEventCalls().map(([, config]) => config.startDate.slice(0, 10)).sort();
  expect(bookedDates).toEqual(['2026-09-01', '2026-09-03']);
});

test('a focus block with no explicit recurrence marker also skips the multi-month look-ahead', async () => {
  const count = await applyPlanToCalendar(
    plan([block({kind: 'focus', title: '深い作業', dateKey: '2026-08-31', startMin: 9 * 60, endMin: 10 * 60})]),
  );

  expect(count).toBe(1);
  expect(RNCalendarEvents.saveEvent).toHaveBeenCalledTimes(1);
});

test('recurring (frequency-based) blocks stay one-off, even sharing a weekday', async () => {
  const sessions = ['2026-08-31', '2026-09-07'].map(dateKey =>
    block({kind: 'recurring', title: '筋トレ', dateKey}),
  );

  const count = await applyPlanToCalendar(plan(sessions));

  expect(count).toBe(2);
  expect(RNCalendarEvents.saveEvent).toHaveBeenCalledTimes(2);
  for (const [, config] of saveEventCalls()) {
    expect(config.recurrenceRule).toBeUndefined();
  }
});
