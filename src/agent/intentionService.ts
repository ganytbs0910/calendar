// ── Agent persistence + orchestration (local-first, zero network) ───────────
//
// Owns the intentions, the latest plan and reality feedback. Gathers the
// "reality" the solver must respect — device calendar events, schedule-tasks,
// sleep windows — runs the solver, and persists the result. Everything is in
// AsyncStorage; nothing leaves the device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';

import {getSleepSettings, getSettingsForDate, getDefaultSettings} from '../services/sleepSettingsService';
import {getTasksForDateRange, getDateKey} from '../services/taskService';
import {setEventColor} from '../components/AddEventModal';
import {occurrencesForYears} from '../utils/recurrenceSpan';
import {solve} from './scheduler';
import {
  BusySlot,
  DayOfWeek,
  Fulfilment,
  Intention,
  PlacedBlock,
  SchedulePlan,
} from './types';

const INTENTIONS_KEY = '@agent_intentions';
const PLAN_KEY = '@agent_plan';

// 7 days gives a weekly-day intention only one candidate occurrence; if
// today happens to be that day and already past its window, it's declared
// unplaceable even though next week is wide open. 14 guarantees two tries.
export const DEFAULT_HORIZON = 14;

// ── Intentions CRUD ─────────────────────────────────────────────────────────

export const getIntentions = async (): Promise<Intention[]> => {
  const raw = await AsyncStorage.getItem(INTENTIONS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Intention[];
  } catch {
    return [];
  }
};

const saveIntentions = async (list: Intention[]): Promise<void> => {
  await AsyncStorage.setItem(INTENTIONS_KEY, JSON.stringify(list));
};

export const addIntentions = async (toAdd: Intention[]): Promise<Intention[]> => {
  const list = await getIntentions();
  const next = [...list, ...toAdd];
  await saveIntentions(next);
  return next;
};

export const updateIntention = async (
  id: string,
  patch: Partial<Intention>,
): Promise<Intention[]> => {
  const list = await getIntentions();
  const next = list.map(i => (i.id === id ? {...i, ...patch} : i));
  await saveIntentions(next);
  return next;
};

export const deleteIntention = async (id: string): Promise<Intention[]> => {
  const list = await getIntentions();
  const next = list.filter(i => i.id !== id);
  await saveIntentions(next);
  return next;
};

export const clearIntentions = async (): Promise<void> => {
  await saveIntentions([]);
};

// ── Plan persistence ────────────────────────────────────────────────────────

export const getPlan = async (): Promise<SchedulePlan | null> => {
  const raw = await AsyncStorage.getItem(PLAN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SchedulePlan;
  } catch {
    return null;
  }
};

/**
 * apply() clears the intentions a plan was built from, but until now never
 * cleared the plan itself from storage — only local screen state. A plan
 * left behind (including any "入りきらなかった予定" notes for intentions
 * that no longer exist) would resurface on the next visit to this tab, or
 * after the app relaunches, looking like a fresh failure instead of stale
 * leftovers from an already-applied run.
 */
export const clearPlan = async (): Promise<void> => {
  await AsyncStorage.removeItem(PLAN_KEY);
};

const savePlan = async (plan: SchedulePlan): Promise<void> => {
  await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
};

// ── Reality gathering ───────────────────────────────────────────────────────

const minutesOf = (d: Date): number => d.getHours() * 60 + d.getMinutes();

/** Collect everything the solver must treat as already-occupied. */
const gatherBusy = async (start: Date, horizonDays: number): Promise<BusySlot[]> => {
  const busy: BusySlot[] = [];
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + horizonDays);

  // Device calendar events (best-effort; needs permission).
  try {
    const events = await RNCalendarEvents.fetchAllEvents(start.toISOString(), end.toISOString());
    for (const ev of events) {
      if (ev.allDay || !ev.startDate || !ev.endDate) continue;
      const calTitle = (ev.calendar?.title || '').toLowerCase();
      if (calTitle.includes('祝日') || calTitle.includes('holiday')) continue;
      const s = new Date(ev.startDate);
      const e = new Date(ev.endDate);
      // Clamp to a single day (skip the rare multi-day case for the MVP).
      if (getDateKey(s) !== getDateKey(e)) continue;
      busy.push({
        dateKey: getDateKey(s),
        startMin: minutesOf(s),
        endMin: minutesOf(e),
        title: ev.title,
        source: 'event',
      });
    }
  } catch {
    // no permission / no events — agent still works on its own blocks
  }

  // Existing schedule-type tasks with a concrete time act as commitments.
  try {
    const keys: string[] = [];
    for (let i = 0; i < horizonDays; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      keys.push(getDateKey(d));
    }
    const map = await getTasksForDateRange(keys);
    for (const [key, tasks] of map) {
      for (const tk of tasks) {
        if (tk.taskType !== 'schedule' || !tk.time) continue;
        const [h, m] = tk.time.split(':').map(n => parseInt(n, 10));
        if (isNaN(h)) continue;
        const startMin = h * 60 + (m || 0);
        busy.push({
          dateKey: key,
          startMin,
          endMin: startMin + (tk.duration || 60),
          title: tk.title,
          source: 'task',
        });
      }
    }
  } catch {
    // ignore
  }

  return busy;
};

// ── Solve orchestration ─────────────────────────────────────────────────────

// "毎月1日" / "第2土曜日" / "毎月末" / "最終営業日" occurs at most once a month
// (or even less often with 隔月/monthInterval), so the next occurrence
// routinely sits weeks or months past the default horizon — this mirrors the
// 'event' widening below, generalized across every 'monthly' sub-pattern.
const daysUntilNextMonthly = (start: Date, intn: Intention): number => {
  const interval = intn.monthInterval && intn.monthInterval > 1 ? intn.monthInterval : 1;
  const anchorMonthIdx = start.getFullYear() * 12 + start.getMonth();
  for (let step = 0; step < 24; step += interval) {
    const monthIdx = anchorMonthIdx + step;
    const y = Math.floor(monthIdx / 12);
    const mo0 = ((monthIdx % 12) + 12) % 12; // 0-based month index

    let candidate: Date | null = null;
    if (intn.lastBusinessDayOfMonth) {
      let d = new Date(y, mo0 + 1, 0);
      if (d.getDay() === 0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2);
      else if (d.getDay() === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
      candidate = d;
    } else if (intn.lastDayOfMonth) {
      candidate = new Date(y, mo0 + 1, 0);
    } else if (intn.monthDay !== undefined) {
      const c = new Date(y, mo0, intn.monthDay);
      candidate = c.getMonth() === mo0 ? c : null; // guard e.g. day 31 in a 30-day month
    } else if (intn.monthWeek !== undefined && intn.days?.length) {
      const dow = intn.days[0];
      const daysInMonth = new Date(y, mo0 + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const probe = new Date(y, mo0, d);
        if (probe.getDay() !== dow) continue;
        if (Math.ceil(d / 7) === intn.monthWeek) {
          candidate = probe;
          break;
        }
      }
    }
    if (candidate && candidate >= start) {
      return Math.round((candidate.getTime() - start.getTime()) / 86400000);
    }
  }
  return 60; // shouldn't happen within a 2-year scan; a safe-ish fallback
};

export const resolvePlan = async (
  horizonDays: number = DEFAULT_HORIZON,
): Promise<SchedulePlan> => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const intentions = await getIntentions();

  // A one-off 'event' intention pins to an exact date that may sit well past
  // the normal planning horizon (e.g. "12月25日はクリスマス会" declared in
  // August) — widen the horizon so that date gets a day to land on and its
  // busy conflicts are actually checked, instead of silently never placing.
  // 'monthly' intentions get the same treatment via the two helpers above.
  let effectiveHorizon = horizonDays;
  for (const intn of intentions) {
    if (!intn.active) continue;
    if (intn.kind === 'event' && intn.eventDate) {
      const [y, m, d] = intn.eventDate.split('-').map(n => parseInt(n, 10));
      const daysOut = Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86400000) + 1;
      if (daysOut > effectiveHorizon) effectiveHorizon = daysOut;
    } else if (intn.kind === 'monthly') {
      const daysOut = daysUntilNextMonthly(start, intn);
      if (daysOut + 1 > effectiveHorizon) effectiveHorizon = daysOut + 1;
    }
  }

  const busy = await gatherBusy(start, effectiveHorizon);
  const settings = (await getSleepSettings()) ?? getDefaultSettings();

  const dayWindow = (dow: DayOfWeek) => {
    const probe = new Date(start.getFullYear(), start.getMonth(), start.getDate() + ((dow - start.getDay() + 7) % 7));
    const s = getSettingsForDate(settings, probe);
    return {
      wake: s.wakeUpHour * 60 + s.wakeUpMinute,
      sleep: s.sleepHour * 60 + s.sleepMinute,
    };
  };

  const prev = await getPlan();
  const plan = solve({startDate: start, horizonDays: effectiveHorizon, intentions, busy, dayWindow});

  // Preserve done/skipped status for occurrences that survived the re-solve
  // (same intention + same day).
  if (prev) {
    for (const blk of plan.blocks) {
      const match = prev.blocks.find(
        b => b.intentionId === blk.intentionId && b.dateKey === blk.dateKey && b.status !== 'planned',
      );
      if (match) blk.status = match.status;
    }
  }

  await savePlan(plan);
  return plan;
};

// ── Reality feedback ────────────────────────────────────────────────────────

export const setBlockStatus = async (
  blockId: string,
  status: PlacedBlock['status'],
): Promise<SchedulePlan | null> => {
  const plan = await getPlan();
  if (!plan) return null;
  const blk = plan.blocks.find(b => b.id === blockId);
  if (!blk) return plan;
  blk.status = status;
  await savePlan(plan);
  return plan;
};

// A "毎週月曜10-12" declaration never states an end date, and asking for one
// every time would defeat "just write it down". Defaulting to the same 5
// years AddEventModal uses for a manually-picked weekly repeat risks a
// long-forgotten commitment cluttering the calendar for years. 3 months means
// an abandoned habit quietly stops instead, and a still-wanted one just gets
// re-declared — cheaper than either an end-date prompt or a silent 5-year tail.
const AGENT_RECURRENCE_YEARS = 0.25;
const AGENT_RECURRENCE_WEEKS = occurrencesForYears('weekly', AGENT_RECURRENCE_YEARS);
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
// 'monthly' commitments occur far less often than weekly ones, so the same
// ~3-month horizon would only ever cover 2-3 occurrences — 6 months gives a
// comparable number of real future instances to write.
const AGENT_RECURRENCE_MONTHS = 6;

const dateFromDateKeyAndMin = (dateKey: string, min: number): Date => {
  const [y, m, d] = dateKey.split('-').map(n => parseInt(n, 10));
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60);
};

const weekdayOfDateKey = (dateKey: string): number => {
  const [y, m, d] = dateKey.split('-').map(n => parseInt(n, 10));
  return new Date(y, m - 1, d).getDay();
};

/**
 * The date for the `occurrenceIndex`-th future occurrence (0 = the anchor's
 * own month) of a 'monthly' block's pattern — day-of-month, the Nth occurrence
 * of the anchor's own weekday, the last calendar day, or the last weekday of
 * the month. `monthInterval` (隔月 etc.) spaces occurrences every N months
 * instead of every month. Returns null when that particular month has no
 * matching date (e.g. monthDay=31 in a 30-day month, or no 5th Saturday) — the
 * caller skips it rather than rolling into an unrelated date.
 */
const nextMonthlyOccurrence = (anchorDate: Date, blk: PlacedBlock, occurrenceIndex: number): Date | null => {
  const interval = blk.monthInterval && blk.monthInterval > 1 ? blk.monthInterval : 1;
  const monthsAhead = occurrenceIndex * interval;
  const targetMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + monthsAhead, 1);
  const y = targetMonth.getFullYear();
  const mo = targetMonth.getMonth();
  if (blk.lastBusinessDayOfMonth) {
    let d = new Date(y, mo + 1, 0);
    if (d.getDay() === 0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2);
    else if (d.getDay() === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    return d;
  }
  if (blk.lastDayOfMonth) {
    return new Date(y, mo + 1, 0);
  }
  if (blk.monthDay !== undefined) {
    const candidate = new Date(y, mo, blk.monthDay);
    return candidate.getMonth() === mo ? candidate : null;
  }
  if (blk.monthWeek !== undefined) {
    const dow = anchorDate.getDay();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const candidate = new Date(y, mo, d);
      if (candidate.getDay() !== dow) continue;
      if (Math.ceil(d / 7) === blk.monthWeek) return candidate;
    }
    return null;
  }
  return null;
};

/** True if any real, non-holiday calendar event overlaps [start, end). */
const overlapsRealEvent = (
  events: CalendarEventReadable[],
  start: Date,
  end: Date,
): boolean =>
  events.some(ev => {
    if (ev.allDay || !ev.startDate || !ev.endDate) return false;
    const title = (ev.calendar?.title || '').toLowerCase();
    if (title.includes('祝日') || title.includes('holiday')) return false;
    const es = new Date(ev.startDate).getTime();
    const ee = new Date(ev.endDate).getTime();
    return start.getTime() < ee && es < end.getTime();
  });

/**
 * Push the current plan's blocks into the *real* calendar (RNCalendarEvents),
 * not a separate task-list bucket — this used to write `taskType: 'schedule'`
 * tasks, which only ever rendered inside the week view's per-day bottom sheet.
 * The month view (the screen most people land on) never reads that storage at
 * all, so a declared plan looked like it vanished. Writing genuine calendar
 * events makes the agent's output show up everywhere an event normally would,
 * with zero changes to the calendar rendering code.
 *
 * PlacedBlock.status ('done'/'skipped') is not wired to any UI action, so
 * nothing is lost by dropping the old status-aware task bookkeeping here.
 *
 * 'fixed' and 'focus' intentions describe a standing weekly commitment (e.g.
 * 「毎週月曜日の10時から12時に英語基礎」) — but the solver only ever sees the
 * declared horizon (7 days by default) and re-derives one block per matching
 * weekday *within that window*, then the intention itself is cleared once
 * applied. Writing each of those as a one-off event made the commitment
 * vanish after its single horizon week instead of recurring.
 *
 * Blocks of these kinds are grouped by (intention, weekday). What happens
 * next depends on PlacedBlock.explicitRecurrence (set by the parser from a
 * standing-commitment marker like 毎週/ずっと/常に — see its doc comment):
 *
 *  - With the marker, the earliest block anchors a look-ahead over the next
 *    AGENT_RECURRENCE_WEEKS (~3 months, see AGENT_RECURRENCE_YEARS) weeks at
 *    that same weekday/time. Each week is checked independently against real
 *    calendar events and only written when free — a week that's already
 *    busy is just skipped, not treated as a failure of the whole commitment.
 *    This can't be a single EventKit recurring event (a RecurrenceRule can't
 *    conditionally skip one future occurrence), so it's written as up to
 *    AGENT_RECURRENCE_WEEKS individual one-off events. The look-ahead only
 *    ever starts at the anchor (today or later, per the solver's own "don't
 *    schedule in the past" rule) and steps forward.
 *  - Without it, a bare "火曜と木曜は10時から12時までバイト" reads just as
 *    naturally as this week's plan as it does a standing shift pattern — so
 *    only the block(s) the solver actually placed within its own horizon are
 *    written, with no forward extrapolation. Enrolling in a months-long
 *    series takes saying so.
 *
 * 'recurring' (frequency-based, no fixed day) and 'deadline' (finite work to
 * distribute) intentions have no single weekday to recur on and keep the
 * one-event-per-block behavior.
 */
export const applyPlanToCalendar = async (plan: SchedulePlan): Promise<number> => {
  const calendars = await RNCalendarEvents.findCalendars();
  const writable = calendars.filter(cal => cal.allowsModifications);
  if (writable.length === 0) return 0;
  const defaultCalendar = writable.find(cal => cal.isPrimary) || writable[0];

  const weeklyGroups = new Map<string, PlacedBlock[]>();
  const monthlyGroups = new Map<string, PlacedBlock[]>();
  const oneOffBlocks: PlacedBlock[] = [];
  for (const blk of plan.blocks) {
    if (blk.status === 'skipped') continue;
    if (blk.kind === 'fixed' || blk.kind === 'focus') {
      const key = `${blk.intentionId}:${weekdayOfDateKey(blk.dateKey)}`;
      const arr = weeklyGroups.get(key) ?? [];
      arr.push(blk);
      weeklyGroups.set(key, arr);
    } else if (blk.kind === 'monthly') {
      const arr = monthlyGroups.get(blk.intentionId) ?? [];
      arr.push(blk);
      monthlyGroups.set(blk.intentionId, arr);
    } else {
      oneOffBlocks.push(blk);
    }
  }

  const saveOneOff = async (
    title: string,
    color: string,
    start: Date,
    end: Date,
    allDay: boolean = false,
  ): Promise<boolean> => {
    try {
      const eventId = await RNCalendarEvents.saveEvent(title, {
        calendarId: defaultCalendar.id,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        allDay,
        notes: 'エージェントが配置',
      });
      if (!eventId) return false;
      await setEventColor(eventId, color);
      return true;
    } catch {
      return false;
    }
  };

  let count = 0;

  for (const group of weeklyGroups.values()) {
    group.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const anchor = group[0];

    if (!anchor.explicitRecurrence) {
      // No 毎週/ずっと-style marker — write exactly what the solver placed
      // within its own horizon, not a months-long extrapolation nobody asked
      // for (see the doc comment above).
      for (const blk of group) {
        const start = dateFromDateKeyAndMin(blk.dateKey, blk.startMin);
        const end = dateFromDateKeyAndMin(blk.dateKey, blk.endMin);
        if (await saveOneOff(blk.title, blk.color, start, end)) count += 1;
      }
      continue;
    }

    const anchorStart = dateFromDateKeyAndMin(anchor.dateKey, anchor.startMin);
    const anchorEnd = dateFromDateKeyAndMin(anchor.dateKey, anchor.endMin);
    const durationMs = anchorEnd.getTime() - anchorStart.getTime();

    const lookaheadEnd = new Date(anchorStart.getTime() + AGENT_RECURRENCE_WEEKS * MS_PER_WEEK);
    let futureEvents: CalendarEventReadable[] = [];
    try {
      futureEvents = await RNCalendarEvents.fetchAllEvents(
        anchorStart.toISOString(),
        lookaheadEnd.toISOString(),
      );
    } catch {
      // No permission / no events — place every week rather than block on it.
    }

    for (let i = 0; i < AGENT_RECURRENCE_WEEKS; i++) {
      const occStart = new Date(anchorStart.getTime() + i * MS_PER_WEEK);
      const occEnd = new Date(occStart.getTime() + durationMs);
      if (overlapsRealEvent(futureEvents, occStart, occEnd)) continue; // busy week — skip, don't fail the series
      if (await saveOneOff(anchor.title, anchor.color, occStart, occEnd)) count += 1;
    }
  }

  for (const group of monthlyGroups.values()) {
    group.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const anchor = group[0];
    const anchorStart = dateFromDateKeyAndMin(anchor.dateKey, anchor.startMin);
    const anchorEnd = dateFromDateKeyAndMin(anchor.dateKey, anchor.endMin);
    const durationMs = anchorEnd.getTime() - anchorStart.getTime();

    const monthSpan = AGENT_RECURRENCE_MONTHS * (anchor.monthInterval && anchor.monthInterval > 1 ? anchor.monthInterval : 1);
    const lookaheadEnd = new Date(anchorStart.getFullYear(), anchorStart.getMonth() + monthSpan, anchorStart.getDate());
    let futureEvents: CalendarEventReadable[] = [];
    try {
      futureEvents = await RNCalendarEvents.fetchAllEvents(anchorStart.toISOString(), lookaheadEnd.toISOString());
    } catch {
      // No permission / no events — place every month rather than block on it.
    }

    for (let i = 0; i < AGENT_RECURRENCE_MONTHS; i++) {
      const occDate = nextMonthlyOccurrence(anchorStart, anchor, i);
      if (!occDate) continue; // this month has no matching date (e.g. no 5th Saturday)
      const occStart = new Date(
        occDate.getFullYear(),
        occDate.getMonth(),
        occDate.getDate(),
        anchorStart.getHours(),
        anchorStart.getMinutes(),
      );
      const occEnd = new Date(occStart.getTime() + durationMs);
      if (overlapsRealEvent(futureEvents, occStart, occEnd)) continue; // busy month — skip, don't fail the series
      if (await saveOneOff(anchor.title, anchor.color, occStart, occEnd)) count += 1;
    }
  }

  for (const blk of oneOffBlocks) {
    const start = dateFromDateKeyAndMin(blk.dateKey, blk.startMin);
    const end = blk.allDay
      ? dateFromDateKeyAndMin(blk.dateKey, 23 * 60 + 59)
      : dateFromDateKeyAndMin(blk.dateKey, blk.endMin);
    if (await saveOneOff(blk.title, blk.color, start, end, blk.allDay)) count += 1;
  }

  return count;
};

// ── Fulfilment stats ────────────────────────────────────────────────────────

export const computeFulfilment = (
  intentions: Intention[],
  plan: SchedulePlan | null,
): Fulfilment[] => {
  if (!plan) return [];
  const byIntention = new Map<string, PlacedBlock[]>();
  for (const b of plan.blocks) {
    const arr = byIntention.get(b.intentionId) ?? [];
    arr.push(b);
    byIntention.set(b.intentionId, arr);
  }
  const out: Fulfilment[] = [];
  for (const intn of intentions) {
    if (!intn.active || intn.kind === 'preference') continue;
    const blocks = byIntention.get(intn.id) ?? [];
    const target =
      intn.kind === 'recurring'
        ? Math.max(1, intn.timesPerWeek ?? 3)
        : intn.kind === 'fixed' || intn.kind === 'focus'
        ? blocks.length || 1
        : blocks.length || 1;
    out.push({
      intentionId: intn.id,
      title: intn.title,
      planned: blocks.length,
      target,
      done: blocks.filter(b => b.status === 'done').length,
    });
  }
  return out;
};
