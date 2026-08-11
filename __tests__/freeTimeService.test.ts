/**
 * getTodayFreeTime produces the app's headline number, so the subtraction it
 * performs is worth pinning down: which events count, how much of each, and
 * what happens at the edges of the waking day.
 *
 * @format
 */

import RNCalendarEvents from 'react-native-calendar-events';
import {freeMinutesForDay, getTodayFreeTime} from '../src/services/freeTimeService';
import {SleepSettings} from '../src/services/sleepSettingsService';

jest.mock('react-native-calendar-events', () => ({
  fetchAllEvents: jest.fn(),
}));

const fetchAllEvents = RNCalendarEvents.fetchAllEvents as unknown as jest.Mock;

// Awake 07:00–23:00 every day, so weekday/weekend never changes the answer.
const settings: SleepSettings = {
  weekday: {wakeUpHour: 7, wakeUpMinute: 0, sleepHour: 23, sleepMinute: 0},
  weekend: {wakeUpHour: 7, wakeUpMinute: 0, sleepHour: 23, sleepMinute: 0},
};

/** 2026-08-11 is a Tuesday. */
const at = (hour: number, minute = 0) => new Date(2026, 7, 11, hour, minute);

const event = (
  startHour: number,
  endHour: number,
  extra: Record<string, unknown> = {},
) => ({
  startDate: at(startHour).toISOString(),
  endDate: at(endHour).toISOString(),
  allDay: false,
  calendar: {title: 'Personal'},
  ...extra,
});

beforeEach(() => {
  fetchAllEvents.mockReset();
  fetchAllEvents.mockResolvedValue([]);
});

it('counts the whole of an event that has not started yet', async () => {
  fetchAllEvents.mockResolvedValue([event(14, 16)]);

  const {remainingMin, busyMin, freeMin} = await getTodayFreeTime(settings, at(10));

  expect(remainingMin).toBe(13 * 60); // 10:00 → 23:00
  expect(busyMin).toBe(2 * 60);
  expect(freeMin).toBe(11 * 60);
});

it('counts only the part of an in-progress event that is still ahead', async () => {
  fetchAllEvents.mockResolvedValue([event(9, 12)]);

  // Half past ten: the 9:00–10:30 stretch is already spent either way.
  const {busyMin, freeMin} = await getTodayFreeTime(settings, at(10, 30));

  expect(busyMin).toBe(90);
  expect(freeMin).toBe(12 * 60 + 30 - 90);
});

it('clamps an event that runs past bedtime to bedtime', async () => {
  fetchAllEvents.mockResolvedValue([event(22, 26)]); // 22:00 → 02:00 next day

  const {busyMin} = await getTodayFreeTime(settings, at(20));

  expect(busyMin).toBe(60); // only 22:00–23:00 sits inside the waking day
});

it('ignores all-day entries and holiday calendars', async () => {
  fetchAllEvents.mockResolvedValue([
    event(9, 18, {allDay: true}),
    event(14, 16, {calendar: {title: '祝日'}}),
    event(9, 18, {calendar: {title: 'Japan Holidays'}}),
  ]);

  const {busyMin, freeMin} = await getTodayFreeTime(settings, at(10));

  expect(busyMin).toBe(0);
  expect(freeMin).toBe(13 * 60);
});

it('skips events that finished before now', async () => {
  fetchAllEvents.mockResolvedValue([event(7, 9)]);

  const {busyMin} = await getTodayFreeTime(settings, at(10));

  expect(busyMin).toBe(0);
});

it('reports nothing left once bedtime has passed, without asking the calendar', async () => {
  const {remainingMin, freeMin} = await getTodayFreeTime(settings, at(23, 30));

  expect(remainingMin).toBe(0);
  expect(freeMin).toBe(0);
  expect(fetchAllEvents).not.toHaveBeenCalled();
});

it('never goes negative when events overlap', async () => {
  // Three overlapping events covering far more than the hours that remain.
  fetchAllEvents.mockResolvedValue([event(11, 23), event(11, 23), event(11, 23)]);

  const {freeMin} = await getTodayFreeTime(settings, at(11));

  expect(freeMin).toBe(0);
});

it('falls back to the waking hours when the calendar cannot be read', async () => {
  fetchAllEvents.mockRejectedValue(new Error('no permission'));

  const {busyMin, freeMin} = await getTodayFreeTime(settings, at(10));

  expect(busyMin).toBe(0);
  expect(freeMin).toBe(13 * 60);
});

describe('before the wake time', () => {
  it('treats the whole waking day as still ahead', async () => {
    // Up at 5am with a 7am alarm: the day has not started, not ended.
    const {remainingMin, freeMin} = await getTodayFreeTime(settings, at(5));

    expect(remainingMin).toBe(16 * 60); // 07:00 → 23:00
    expect(freeMin).toBe(16 * 60);
  });
});

describe('a bedtime after midnight', () => {
  const nightOwl: SleepSettings = {
    weekday: {wakeUpHour: 7, wakeUpMinute: 0, sleepHour: 2, sleepMinute: 0},
    weekend: {wakeUpHour: 7, wakeUpMinute: 0, sleepHour: 2, sleepMinute: 0},
  };

  it('runs the window into the following day', async () => {
    const {remainingMin} = await getTodayFreeTime(nightOwl, at(20));

    expect(remainingMin).toBe(6 * 60); // 20:00 → 02:00
  });

  it('counts an event on the far side of midnight', async () => {
    fetchAllEvents.mockResolvedValue([
      {
        startDate: new Date(2026, 7, 12, 0, 0).toISOString(),
        endDate: new Date(2026, 7, 12, 1, 0).toISOString(),
        allDay: false,
        calendar: {title: 'Personal'},
      },
    ]);

    const {busyMin, freeMin} = await getTodayFreeTime(nightOwl, at(23));

    expect(busyMin).toBe(60);
    expect(freeMin).toBe(2 * 60); // 23:00 → 02:00, less the booked hour
  });
});

describe('freeMinutesForDay', () => {
  it('gives a future day its whole waking window', () => {
    const tomorrow = new Date(2026, 7, 12);

    expect(freeMinutesForDay([], settings, tomorrow, at(10))).toBe(16 * 60);
  });

  it('subtracts a future day’s events in full, not just what is ahead of now', () => {
    const tomorrow = new Date(2026, 7, 12);
    const event = {
      startDate: new Date(2026, 7, 12, 9, 0).toISOString(),
      endDate: new Date(2026, 7, 12, 12, 0).toISOString(),
      allDay: false,
      calendar: {title: 'Personal'},
    };

    expect(freeMinutesForDay([event], settings, tomorrow, at(10))).toBe(16 * 60 - 180);
  });

  it('reports null for a day already behind us', () => {
    const yesterday = new Date(2026, 7, 10);

    expect(freeMinutesForDay([], settings, yesterday, at(10))).toBeNull();
  });
});
