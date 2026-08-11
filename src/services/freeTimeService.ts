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

import {
  SleepSettings,
  getRemainingActiveMinutes,
  getTodaySettings,
} from './sleepSettingsService';

export interface TodayFreeTime {
  /** Awake minutes between now and bedtime. */
  remainingMin: number;
  /** Of those, the ones already committed to events. */
  busyMin: number;
  /** What is left. Never negative. */
  freeMin: number;
}

/** A holiday feed is a label on the day, not a claim on your time. */
const isHolidayCalendar = (title?: string): boolean => {
  const t = (title || '').toLowerCase();
  return t.includes('祝日') || t.includes('holiday');
};

export const getTodayFreeTime = async (
  settings: SleepSettings,
  now: Date = new Date(),
): Promise<TodayFreeTime> => {
  const day = getTodaySettings(settings);
  const remainingMin = getRemainingActiveMinutes(day, now);

  // Already past bedtime — nothing left to divide up, and no need to ask the
  // calendar for events we would only clamp away to zero.
  if (remainingMin <= 0) {
    return {remainingMin: 0, busyMin: 0, freeMin: 0};
  }

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  // sleepHour is allowed to be 24, which Date reads as 00:00 tomorrow — exactly
  // what a bedtime of midnight means.
  const bedtime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    day.sleepHour,
    day.sleepMinute,
  );

  let busyMin = 0;
  try {
    const events = await RNCalendarEvents.fetchAllEvents(
      dayStart.toISOString(),
      dayEnd.toISOString(),
    );

    for (const event of events) {
      if (event.allDay) continue;
      if (!event.startDate || !event.endDate) continue;
      if (isHolidayCalendar(event.calendar?.title)) continue;

      const start = new Date(event.startDate);
      const end = new Date(event.endDate);

      const from = start < now ? now : start;
      const to = end > bedtime ? bedtime : end;
      if (from >= to) continue;

      busyMin += Math.round((to.getTime() - from.getTime()) / 60000);
    }
  } catch {
    // No calendar access (or a read failure): report the awake time we know
    // about rather than nothing at all.
    return {remainingMin, busyMin: 0, freeMin: remainingMin};
  }

  // Overlapping events can double-count, so clamp rather than go negative.
  return {remainingMin, busyMin, freeMin: Math.max(0, remainingMin - busyMin)};
};
