/**
 * @format
 *
 * The start time a fresh 予定を追加 sheet lands on.
 *
 * The rule that matters: on today it must never be in the past. Adding a shift
 * that started twenty minutes ago is not a thing anyone does, and the old
 * behaviour (14:00, or one hour after the day's last event) suggested exactly
 * that all afternoon.
 */

jest.mock('react-native-calendar-events', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));

import {suggestStart} from '../src/components/AddEventModal';

const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('suggestStart', () => {
  const today = at(2026, 8, 18, 0);

  it('rounds up to the next o\'clock on an empty today', () => {
    const s = suggestStart(today, [], at(2026, 8, 18, 17, 30));
    expect(hhmm(s)).toBe('18:00');
    expect(s.getDate()).toBe(18);
  });

  it('keeps the current hour when it is exactly on the hour', () => {
    expect(hhmm(suggestStart(today, [], at(2026, 8, 18, 17, 0)))).toBe('17:00');
  });

  it('still uses 14:00 in the morning, before the clock forces it later', () => {
    expect(hhmm(suggestStart(today, [], at(2026, 8, 18, 9, 10)))).toBe('14:00');
  });

  it('follows the day\'s last event when that is later than now', () => {
    const events = [{endDate: at(2026, 8, 18, 19, 0).toISOString()}];
    expect(hhmm(suggestStart(today, events, at(2026, 8, 18, 12, 0)))).toBe('20:00');
  });

  it('does not go back in time when the last event already ended', () => {
    const events = [{endDate: at(2026, 8, 18, 12, 0).toISOString()}];
    // 13:00 by the old rule — which is in the past at 17:30.
    expect(hhmm(suggestStart(today, events, at(2026, 8, 18, 17, 30)))).toBe('18:00');
  });

  it('ignores all-day events when looking for the last one', () => {
    const events = [
      {allDay: true, endDate: at(2026, 8, 18, 23, 59).toISOString()},
      {endDate: at(2026, 8, 18, 16, 0).toISOString()},
    ];
    expect(hhmm(suggestStart(today, events, at(2026, 8, 18, 9, 0)))).toBe('17:00');
  });

  it('leaves a future day alone — the clock only constrains today', () => {
    const future = at(2026, 8, 25, 0);
    expect(hhmm(suggestStart(future, [], at(2026, 8, 18, 17, 30)))).toBe('14:00');
  });

  it('leaves a past day alone', () => {
    const past = at(2026, 8, 10, 0);
    expect(hhmm(suggestStart(past, [], at(2026, 8, 18, 17, 30)))).toBe('14:00');
  });

  it('stays on today late at night instead of rolling into tomorrow', () => {
    const s = suggestStart(today, [], at(2026, 8, 18, 23, 20));
    expect(s.getDate()).toBe(18);
    expect(hhmm(s)).toBe('23:30');
  });

  it('clamps to 23:45 in the last quarter hour', () => {
    const s = suggestStart(today, [], at(2026, 8, 18, 23, 52));
    expect(s.getDate()).toBe(18);
    expect(hhmm(s)).toBe('23:45');
  });

  it('does not push past midnight when the last event ends at 23:30', () => {
    const events = [{endDate: at(2026, 8, 25, 23, 30).toISOString()}];
    const future = at(2026, 8, 25, 0);
    const s = suggestStart(future, events, at(2026, 8, 18, 9, 0));
    expect(s.getDate()).toBe(25);
    expect(hhmm(s)).toBe('23:00');
  });
});
