/**
 * These pin the month-overflow behaviour that shipped: picking a date in the
 * event editor while the event sat on the 31st put it a month later, and the
 * stats screen skipped months when today was the 31st.
 *
 * @format
 */

import {combineDateAndTime, monthStart} from '../src/utils/dateParts';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('combineDateAndTime', () => {
  it('takes the day from one and the clock from the other', () => {
    const picked = new Date(2026, 1, 15);
    const existing = new Date(2026, 0, 31, 10, 30);

    const result = combineDateAndTime(picked, existing);

    expect(ymd(result)).toBe('2026-02-15');
    expect(hm(result)).toBe('10:30');
  });

  it('lands in the picked month even from the 31st', () => {
    // The bug: Jan 31 → setMonth(Feb) → "Feb 31" → Mar 3 → setDate(15) → Mar 15.
    expect(ymd(combineDateAndTime(new Date(2026, 1, 15), new Date(2026, 0, 31, 10)))).toBe(
      '2026-02-15',
    );
    expect(ymd(combineDateAndTime(new Date(2026, 5, 10), new Date(2026, 4, 31, 9)))).toBe(
      '2026-06-10',
    );
  });

  it('handles the last day of a leap February', () => {
    expect(ymd(combineDateAndTime(new Date(2028, 1, 29), new Date(2028, 0, 31, 8)))).toBe(
      '2028-02-29',
    );
  });

  it('drops seconds so two picks of the same minute compare equal', () => {
    const a = combineDateAndTime(new Date(2026, 2, 1), new Date(2026, 2, 1, 9, 5, 42, 500));
    const b = combineDateAndTime(new Date(2026, 2, 1), new Date(2026, 2, 1, 9, 5, 7, 900));

    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('monthStart', () => {
  it('gives the first of the month', () => {
    expect(ymd(monthStart(new Date(2026, 7, 31)))).toBe('2026-08-01');
  });

  it('does not skip short months when stepping back from the 31st', () => {
    // The bug: Aug 31 → setMonth(-2) → "Jun 31" → Jul 1, so June was unreachable.
    const from = new Date(2026, 7, 31);
    expect(ymd(monthStart(from, -1))).toBe('2026-07-01');
    expect(ymd(monthStart(from, -2))).toBe('2026-06-01');
    expect(ymd(monthStart(from, -6))).toBe('2026-02-01');
  });

  it('crosses the year boundary in both directions', () => {
    expect(ymd(monthStart(new Date(2026, 0, 31), -1))).toBe('2025-12-01');
    expect(ymd(monthStart(new Date(2026, 11, 31), 1))).toBe('2027-01-01');
  });
});
