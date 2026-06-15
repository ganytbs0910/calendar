// ── Agent persistence + orchestration (local-first, zero network) ───────────
//
// Owns the intentions, the latest plan and reality feedback. Gathers the
// "reality" the solver must respect — device calendar events, schedule-tasks,
// sleep windows — runs the solver, and persists the result. Everything is in
// AsyncStorage; nothing leaves the device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNCalendarEvents from 'react-native-calendar-events';

import {getSleepSettings, getSettingsForDate, getDefaultSettings} from '../services/sleepSettingsService';
import {getTasksForDateRange, getDateKey, addTaskForDate} from '../services/taskService';
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

export const DEFAULT_HORIZON = 7;

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

export const resolvePlan = async (
  horizonDays: number = DEFAULT_HORIZON,
): Promise<SchedulePlan> => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const intentions = await getIntentions();
  const busy = await gatherBusy(start, horizonDays);
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
  const plan = solve({startDate: start, horizonDays, intentions, busy, dayWindow});

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

/** Push the current plan's blocks into the calendar as schedule-tasks so they
 *  show up on the home calendar — the agent's plan made visible. */
export const applyPlanToCalendar = async (plan: SchedulePlan): Promise<number> => {
  let count = 0;
  for (const blk of plan.blocks) {
    if (blk.status === 'skipped') continue;
    const time = `${String(Math.floor(blk.startMin / 60)).padStart(2, '0')}:${String(blk.startMin % 60).padStart(2, '0')}`;
    try {
      await addTaskForDate(
        blk.title,
        blk.dateKey,
        time,
        blk.endMin - blk.startMin,
        'schedule',
        'エージェントが配置',
      );
      count += 1;
    } catch {
      // ignore individual failures
    }
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
