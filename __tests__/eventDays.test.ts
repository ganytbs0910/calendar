/**
 * The month grid and the week view both place events with this. They used to
 * disagree — the week view filed all-day events under their start day only —
 * and the month grid dropped an all-day event whose end equalled its start.
 *
 * @format
 */

import {eventDayKeys, eventDayRange} from '../src/utils/eventDays';

const ev = (start: string, end: string, allDay = false) =>
  ({startDate: start, endDate: end, allDay} as any);

const iso = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s).toISOString();

const days = (e: any) => eventDayKeys(e).map(k => k.split('-').slice(1).join('/'));

describe('timed events', () => {
  it('covers the one day it sits in', () => {
    expect(days(ev(iso(2026, 8, 14, 10), iso(2026, 8, 14, 11)))).toEqual(['7/14']);
  });

  it('covers both days when it runs past midnight', () => {
    expect(days(ev(iso(2026, 8, 14, 23), iso(2026, 8, 15, 1)))).toEqual(['7/14', '7/15']);
  });
});

describe('all-day events', () => {
  it('treats a midnight end as exclusive', () => {
    // 14th 00:00 → 15th 00:00 is one day, not two.
    expect(days(ev(iso(2026, 8, 14), iso(2026, 8, 15), true))).toEqual(['7/14']);
  });

  it('spans every day of a multi-day run', () => {
    expect(days(ev(iso(2026, 8, 14), iso(2026, 8, 17), true))).toEqual(['7/14', '7/15', '7/16']);
  });

  it('still appears when the end equals the start', () => {
    // A producer that omits the end leaves start == end. Subtracting a
    // millisecond puts the last day before the first, and a backwards range
    // renders as nothing at all — the event silently vanished from the grid.
    expect(days(ev(iso(2026, 8, 14), iso(2026, 8, 14), true))).toEqual(['7/14']);
  });

  it('accepts an inclusive end from producers that use one', () => {
    expect(days(ev(iso(2026, 8, 14), iso(2026, 8, 14, 23, 59, 59), true))).toEqual(['7/14']);
  });
});

describe('robustness', () => {
  it('returns nothing without both dates', () => {
    expect(eventDayRange({startDate: iso(2026, 8, 14)} as any)).toBeNull();
    expect(eventDayRange({endDate: iso(2026, 8, 14)} as any)).toBeNull();
  });

  it('caps a corrupt far-future end rather than walking forever', () => {
    const keys = eventDayKeys(ev(iso(2026, 8, 14), iso(2126, 8, 14)));
    expect(keys.length).toBe(400);
  });
});
