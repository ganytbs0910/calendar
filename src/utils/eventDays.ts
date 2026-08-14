// ── eventDays — which calendar days an event actually occupies ──────────────
//
// Shared because the month grid and the week view both need it and used to
// answer it differently: the month grid spanned an all-day event across its
// days, while the week view filed it under its start day alone, so a three-day
// trip showed on one column and the other two looked empty.

import {CalendarEventReadable} from 'react-native-calendar-events';

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * First and last day an event appears on, both at local midnight.
 *
 * An all-day event's end is exclusive — a single day ends at midnight of the
 * next one — so a midnight end belongs to the previous day. Producers disagree
 * about this, though: an all-day event whose end equals its start (an iCalendar
 * DTSTART with no DTEND, say) would otherwise end up with its last day before
 * its first, and a range that runs backwards renders as no days at all. The
 * event would simply not appear. Hence the clamp.
 */
export const eventDayRange = (
  event: CalendarEventReadable,
): {firstDay: Date; lastDay: Date} | null => {
  if (!event.startDate || !event.endDate) return null;

  const start = new Date(event.startDate);
  let end = new Date(event.endDate);
  if (event.allDay && end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
    end = new Date(end.getTime() - 1);
  }

  const firstDay = midnight(start);
  const lastDay = midnight(end);
  return {firstDay, lastDay: lastDay < firstDay ? firstDay : lastDay};
};

/** Every day key the event covers, in `YYYY-M-D` form (month is 0-based). */
export const eventDayKeys = (event: CalendarEventReadable): string[] => {
  const range = eventDayRange(event);
  if (!range) return [];
  const keys: string[] = [];
  const day = new Date(range.firstDay);
  // Guard against a pathological range (a corrupt end date years away) turning
  // one event into an unbounded loop over the grid.
  while (day <= range.lastDay && keys.length < 400) {
    keys.push(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
    day.setDate(day.getDate() + 1);
  }
  return keys;
};
