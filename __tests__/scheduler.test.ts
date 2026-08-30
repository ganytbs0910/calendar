import {solve} from '../src/agent/scheduler';
import {Intention} from '../src/agent/types';

const baseIntention = (overrides: Partial<Intention> = {}): Intention => ({
  id: 'int-1',
  raw: '',
  title: '英語基礎',
  kind: 'fixed',
  priority: 4,
  durationMin: 120,
  color: '#007AFF',
  createdAt: new Date().toISOString(),
  active: true,
  days: [1], // Monday
  window: {startHour: 10, endHour: 12},
  ...overrides,
});

const wideOpen = () => ({wake: 6 * 60, sleep: 24 * 60});

test('places a fixed weekly commitment on its only matching day', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27), // Thu 2026-08-27
    horizonDays: 7,
    intentions: [baseIntention()],
    busy: [],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0].dateKey).toBe('2026-08-31'); // the Monday in range
  expect(plan.unplaced).toHaveLength(0);
});

// A "毎週月曜10-12" intention has exactly one candidate day per horizon. If
// that single day is already busy, the per-demand loop treats it as a
// required occurrence that "just doesn't happen today" and stays silent —
// correct for a focus block with five candidate weekdays, wrong here, since
// silence means the whole commitment produced nothing with no explanation.
test('surfaces a reason when a fixed intention with only one candidate day is fully blocked', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27),
    horizonDays: 7,
    intentions: [baseIntention()],
    busy: [{dateKey: '2026-08-31', startMin: 9 * 60, endMin: 13 * 60, source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(0);
  expect(plan.unplaced).toHaveLength(1);
  expect(plan.unplaced[0].intentionId).toBe('int-1');
  expect(plan.unplaced[0].title).toBe('英語基礎');
});

// Re-declaring "毎週月曜10-12 英語基礎" after it already succeeded looks, from
// the solver's view, identical to a genuine clash: the slot is busy. But the
// busy entry is the intention's *own* earlier output, so the user needs a
// different message than "no availability" — this is done, not broken.
test('reports "already scheduled" (not a generic conflict) when the blocker is the same commitment', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27),
    horizonDays: 7,
    intentions: [baseIntention()],
    busy: [{dateKey: '2026-08-31', startMin: 600, endMin: 720, title: '英語基礎', source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(0);
  expect(plan.unplaced).toHaveLength(1);
  expect(plan.unplaced[0].reason).toBe('すでに同じ内容の予定がカレンダーに入っています');
});

test('keeps the generic reason when the blocker is an unrelated event', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27),
    horizonDays: 7,
    intentions: [baseIntention()],
    busy: [{dateKey: '2026-08-31', startMin: 600, endMin: 720, title: '歯医者', source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.unplaced[0].reason).toBe('指定した曜日・時間帯に空きがありませんでした');
});

// Same setup as the "fully blocked" test above, but with the wider horizon
// intentionService.DEFAULT_HORIZON now uses: a second Monday exists within
// range, so a busy (or already-past) first occurrence isn't a dead end.
test('a fixed weekly commitment falls through to its next occurrence over a longer horizon', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27), // Thu 2026-08-27
    horizonDays: 14,
    intentions: [baseIntention()],
    busy: [{dateKey: '2026-08-31', startMin: 9 * 60, endMin: 13 * 60, source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0].dateKey).toBe('2026-09-07'); // the following Monday
  expect(plan.unplaced).toHaveLength(0);
});

// An all-day 'event' (e.g. 誕生日, no time given) is a calendar marker, not
// time to defend — it must place even on a day that's fully booked, and must
// not consume any of that day's free time for other intentions.
test('an all-day event places unconditionally, even on a fully busy day', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27), // Thu 2026-08-27
    horizonDays: 14,
    intentions: [
      baseIntention({
        kind: 'event',
        title: '誕生日',
        eventDate: '2026-09-10',
        allDay: true,
        durationMin: 0,
        days: undefined,
        window: undefined,
      }),
    ],
    busy: [{dateKey: '2026-09-10', startMin: 0, endMin: 24 * 60, source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0]).toMatchObject({dateKey: '2026-09-10', allDay: true, title: '誕生日'});
  expect(plan.unplaced).toHaveLength(0);
});

// A timed one-off event (explicit hour range) goes through the normal
// findSlot/occupy path — it should land on its exact date at that time.
test('a timed one-off event places at its declared date and time', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27),
    horizonDays: 20,
    intentions: [
      baseIntention({
        kind: 'event',
        title: '誕生日会',
        eventDate: '2026-09-10',
        window: {startHour: 19, endHour: 21},
        durationMin: 120,
        days: undefined,
      }),
    ],
    busy: [],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0].dateKey).toBe('2026-09-10');
  expect(plan.blocks[0].startMin).toBe(19 * 60);
});

// "22時から翌1時" crosses midnight — TimeWindow can't bound a same-day search
// for it, so it must be pinned directly at 22:00 with its full real duration
// (180min), even on a day that's otherwise fully busy (best-effort, matching
// the all-day case above — no free-slot search happens for it at all).
test('a crosses-midnight fixed commitment pins directly at its declared start time', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27), // Thu 2026-08-27
    horizonDays: 7,
    intentions: [
      baseIntention({
        title: 'バイト',
        window: {startHour: 22, endHour: 24},
        durationMin: 180,
        crossesMidnight: true,
      }),
    ],
    busy: [{dateKey: '2026-08-31', startMin: 0, endMin: 22 * 60, source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  const blk = plan.blocks[0];
  expect(blk.dateKey).toBe('2026-08-31');
  expect(blk.startMin).toBe(22 * 60);
  expect(blk.endMin).toBe(25 * 60); // rolls past midnight — 1:00 the next day
  expect(plan.unplaced).toHaveLength(0);
});

// "第2土曜日" (Nth weekday of the month) must land on the actual 2nd Saturday,
// not just any Saturday within the horizon.
test('a monthly Nth-weekday commitment places on the correct occurrence', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27), // Thu 2026-08-27
    horizonDays: 20,
    intentions: [
      baseIntention({
        kind: 'monthly',
        title: 'サークル活動',
        monthWeek: 2,
        days: [6], // Saturday
        window: {startHour: 18, endHour: 20},
        durationMin: 90,
      }),
    ],
    busy: [],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0].dateKey).toBe('2026-09-12'); // the 2nd Saturday of September
});

// "毎月1日" (day-of-month) must land on the 1st, regardless of its weekday.
test('a monthly day-of-month commitment places on the correct date', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27),
    horizonDays: 20,
    intentions: [
      baseIntention({
        kind: 'monthly',
        title: '家賃支払い',
        monthDay: 1,
        days: undefined,
        window: {startHour: 18, endHour: 20},
        durationMin: 90,
      }),
    ],
    busy: [],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0].dateKey).toBe('2026-09-01');
});

test('lastDayOfMonth places on the actual last calendar day, weekday or not', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27),
    horizonDays: 40,
    intentions: [
      baseIntention({
        kind: 'monthly',
        title: '家賃振込',
        lastDayOfMonth: true,
        days: undefined,
        window: {startHour: 18, endHour: 20},
        durationMin: 90,
      }),
    ],
    busy: [],
    dayWindow: wideOpen,
  });

  const dateKeys = plan.blocks.map(b => b.dateKey);
  expect(dateKeys).toContain('2026-08-31'); // last day of Aug (a Monday)
  expect(dateKeys).toContain('2026-09-30'); // last day of Sep (a Wednesday)
});

// October 2026 ends on a Saturday — lastBusinessDayOfMonth must roll back to
// the preceding Friday rather than landing on the weekend itself.
test('lastBusinessDayOfMonth rolls back off a weekend', () => {
  const plan = solve({
    startDate: new Date(2026, 9, 1), // Oct 1 2026
    horizonDays: 35,
    intentions: [
      baseIntention({
        kind: 'monthly',
        title: '月次報告',
        lastBusinessDayOfMonth: true,
        days: undefined,
        window: {startHour: 18, endHour: 20},
        durationMin: 90,
      }),
    ],
    busy: [],
    dayWindow: wideOpen,
  });

  expect(plan.blocks).toHaveLength(1);
  expect(plan.blocks[0].dateKey).toBe('2026-10-30'); // Friday, not Sat Oct 31
});

// "隔月1日" (every other month, on the 1st) must skip the alternating months,
// not fire every single month like a plain "毎月1日" would.
test('monthInterval (隔月) skips alternating months', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 30), // Sun 2026-08-30
    horizonDays: 200,
    intentions: [
      baseIntention({
        kind: 'monthly',
        title: '定例MTG',
        monthDay: 1,
        monthInterval: 2,
        days: undefined,
        window: {startHour: 18, endHour: 20},
        durationMin: 90,
      }),
    ],
    busy: [],
    dayWindow: wideOpen,
  });

  const dateKeys = plan.blocks.map(b => b.dateKey);
  expect(dateKeys).toEqual(['2026-10-01', '2026-12-01', '2027-02-01']);
});

test('a focus block missing one of several candidate weekdays stays silent (expected slack)', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 24), // Mon 2026-08-24
    horizonDays: 7,
    intentions: [
      baseIntention({
        kind: 'focus',
        days: [1, 2, 3, 4, 5],
        window: {startHour: 9, endHour: 12},
      }),
    ],
    // Only Monday is busy; the other four weekdays are open.
    busy: [{dateKey: '2026-08-24', startMin: 0, endMin: 24 * 60, source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks.length).toBeGreaterThan(0);
  expect(plan.unplaced).toHaveLength(0);
});

// Unlike the priority-4 case above, a priority-5 (死守) occurrence missing one
// of its candidate days must not stay silent — the user explicitly said this
// one must never be skipped, so a per-day conflict note is expected even
// though the intention still lands on its other candidate days.
test('a 死守 (priority 5) focus block missing a candidate day surfaces a conflict note', () => {
  const plan = solve({
    startDate: new Date(2026, 7, 27), // Thu 2026-08-27
    horizonDays: 7,
    intentions: [
      baseIntention({
        kind: 'focus',
        priority: 5,
        protect: true,
        days: [1, 3], // Mon, Wed
        window: {startHour: 9, endHour: 12},
      }),
    ],
    // Monday is fully busy; Wednesday is open.
    busy: [{dateKey: '2026-08-31', startMin: 0, endMin: 24 * 60, source: 'event'}],
    dayWindow: wideOpen,
  });

  expect(plan.blocks.map(b => b.dateKey)).toEqual(['2026-09-02']); // only Wednesday placed
  expect(plan.unplaced).toHaveLength(0); // not "unplaced": it did land on Wednesday
  expect(plan.conflicts.some(c => c.includes('死守できませんでした') && c.includes('2026-08-31'))).toBe(true);
});
