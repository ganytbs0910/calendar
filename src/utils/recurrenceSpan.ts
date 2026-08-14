// ── recurrenceSpan — how many occurrences make up a given stretch of time ────
//
// EventKit takes a repeat rule as a count, not an end date, so every caller has
// to convert "about five years of this" into a number. Two places did it
// independently and both got some frequencies wrong:
//
//   creating an event   daily and weekly both used 260 — five years of weeks,
//                       but only eight and a half months of days, so a daily
//                       repeat quietly stopped less than a year out
//   undoing a delete    every frequency used 52 — a year of weeks, seven weeks
//                       of days, four years of months, and fifty-two years of
//                       a yearly event
//
// The undo case is the worse of the two: restoring a deleted yearly event put
// back half a century of it.

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Roughly how many of each fit in a year. */
const PER_YEAR: Record<RecurrenceFrequency, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  yearly: 1,
};

/**
 * Occurrence count covering `years` of repeats at `frequency`.
 *
 * Always at least 2 — a repeat rule of one occurrence is not a repeat, and
 * would silently turn a series the user asked for into a single event.
 */
export const occurrencesForYears = (frequency: string, years = 5): number => {
  const perYear = PER_YEAR[frequency as RecurrenceFrequency];
  // An unrecognised frequency comes from a calendar we don't control. Weekly is
  // the safest guess: wrong by a factor of seven at worst, rather than the
  // fifty-two years a yearly event used to get.
  if (!perYear) return Math.round(PER_YEAR.weekly * years);
  return Math.max(2, Math.round(perYear * years));
};
