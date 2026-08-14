// ── dateParts — combining a calendar date with a clock time ─────────────────
//
// Built because doing it the obvious way is wrong. Mutating a Date field by
// field walks through states that may not exist:
//
//   const d = new Date(2026, 0, 31);   // Jan 31
//   d.setMonth(1);                     // "Feb 31" → Mar 3
//   d.setDate(15);                     // Mar 15, a month late
//
// Every intermediate value is a real date, so nothing throws and nothing looks
// wrong until a user notices their event is in the wrong month. It only bites
// when the starting day is past the end of the target month, which is why it
// survives casual testing: pick any date while sitting on the 15th and it works.
//
// The constructor takes all the parts at once and normalises them together, so
// there is no intermediate state to fall through.

/**
 * The calendar date from `date`, the clock time from `time`.
 *
 * Seconds and milliseconds are zeroed: these come from pickers that only offer
 * hours and minutes, and carrying stray seconds makes two "equal" times unequal.
 */
export const combineDateAndTime = (date: Date, time: Date): Date =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
    0,
    0,
  );

/**
 * The first day of the month `offset` months from `from`.
 *
 * Anchored to the 1st for the same reason as above: stepping months from the
 * 31st skips any month that is shorter, so "two months ago" from August 31st
 * lands in July.
 */
export const monthStart = (from: Date, offset = 0): Date =>
  new Date(from.getFullYear(), from.getMonth() + offset, 1);
