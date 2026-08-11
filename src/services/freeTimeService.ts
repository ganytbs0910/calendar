// ── Today's remaining free time ─────────────────────────────────────────────
//
// The number the whole app is organised around: of the hours you are still
// awake today, how many are not already spoken for.
//
//   free = (awake minutes left before bedtime) − (minutes those hours already
//           owe to events)
//
// Only the *future* part of an event counts — an event you are halfway through
// has already spent the minutes behind you, and they are gone either way.
//
// The logic used to live inside TodayTasks, which nothing rendered, so the
// figure the store listing promises was never actually shown. It lives here so
// the calendar header and anything else can share one definition of it.

import RNCalendarEvents from 'react-native-calendar-events';

import {SleepSettings, getSettingsForDate} from './sleepSettingsService';

export interface TodayFreeTime {
  /** Awake minutes between now and bedtime. */
  remainingMin: number;
  /** Of those, the ones already committed to events. */
  busyMin: number;
  /** What is left. Never negative. */
  freeMin: number;
}

/** The shape of an event this module needs — anything the calendar returns. */
export interface DayEventLike {
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  calendar?: {title?: string};
}

/** A holiday feed is a label on the day, not a claim on your time. */
const isHolidayCalendar = (title?: string): boolean => {
  const t = (title || '').toLowerCase();
  return t.includes('祝日') || t.includes('holiday');
};

/**
 * The stretch of `date` the user expects to be awake for and hasn't lived
 * through yet, or null once it has passed.
 *
 * A bedtime that is earlier in the clock than the wake time means "after
 * midnight", so it lands on the following day — sleepHour is also allowed to be
 * 24, which Date reads as 00:00 tomorrow, exactly what a midnight bedtime means.
 *
 * Before the wake time the whole window is still ahead: someone reading this at
 * 5am with a 7am alarm has the entire day left, not none of it.
 */
export const getAwakeWindow = (
  settings: SleepSettings,
  date: Date,
  now: Date = new Date(),
): {start: Date; end: Date} | null => {
  const day = getSettingsForDate(settings, date);
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();

  const wake = new Date(y, mo, d, day.wakeUpHour, day.wakeUpMinute);
  const end = new Date(y, mo, d, day.sleepHour, day.sleepMinute);
  if (end <= wake) end.setDate(end.getDate() + 1);

  const start = now > wake ? now : wake;
  if (start >= end) return null;
  return {start, end};
};

/** Minutes inside [start, end) that events already claim. */
export const busyMinutesInWindow = (
  events: DayEventLike[],
  start: Date,
  end: Date,
): number => {
  let busy = 0;
  for (const event of events) {
    if (event.allDay) continue;
    if (!event.startDate || !event.endDate) continue;
    if (isHolidayCalendar(event.calendar?.title)) continue;

    const evStart = new Date(event.startDate);
    const evEnd = new Date(event.endDate);
    const from = evStart < start ? start : evStart;
    const to = evEnd > end ? end : evEnd;
    if (from >= to) continue;

    busy += Math.round((to.getTime() - from.getTime()) / 60000);
  }
  return busy;
};

/**
 * Free minutes left on `date`, given the events already known for it. Null once
 * the day's waking hours are behind us — there is no "left" to report.
 *
 * Synchronous on purpose: callers that already hold a day's events (the week
 * view) shouldn't have to re-fetch them per column.
 */
export const freeMinutesForDay = (
  events: DayEventLike[],
  settings: SleepSettings,
  date: Date,
  now: Date = new Date(),
): number | null => {
  const window = getAwakeWindow(settings, date, now);
  if (!window) return null;
  const windowMin = Math.round((window.end.getTime() - window.start.getTime()) / 60000);
  const busy = busyMinutesInWindow(events, window.start, window.end);
  // Overlapping events can double-count, so clamp rather than go negative.
  return Math.max(0, windowMin - busy);
};

export const getTodayFreeTime = async (
  settings: SleepSettings,
  now: Date = new Date(),
): Promise<TodayFreeTime> => {
  const window = getAwakeWindow(settings, now, now);

  // The waking day is over — nothing left to divide up, and no reason to ask
  // the calendar for events we would only clamp away to zero.
  if (!window) return {remainingMin: 0, busyMin: 0, freeMin: 0};

  const remainingMin = Math.round(
    (window.end.getTime() - window.start.getTime()) / 60000,
  );

  // The window can run past midnight, so the fetch has to reach into tomorrow
  // rather than stopping at 23:59 today.
  const fetchFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let events;
  try {
    events = await RNCalendarEvents.fetchAllEvents(
      fetchFrom.toISOString(),
      window.end.toISOString(),
    );
  } catch {
    // No calendar access (or a read failure): report the awake time we know
    // about rather than nothing at all.
    return {remainingMin, busyMin: 0, freeMin: remainingMin};
  }

  const busyMin = busyMinutesInWindow(events, window.start, window.end);
  return {remainingMin, busyMin, freeMin: Math.max(0, remainingMin - busyMin)};
};
