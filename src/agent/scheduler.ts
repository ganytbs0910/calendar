// ── The solver (heart of the agent) ────────────────────────────────────────
//
// A deterministic, on-device scheduler. It treats a planning horizon (default
// 7 days) as a constrained placement problem:
//   hard:  sleep window, existing events/commitments, fixed intentions
//   soft:  preferred time windows, intra-day energy curve, batching by tag,
//          spreading recurring sessions, deadline urgency
// and greedily places each demand occurrence into the slot that maximises a
// transparent score. Greedy + per-slot scoring is fast, explainable, and good
// enough to feel magical; it is the seam where a real OR optimiser would slot in
// later without changing the rest of the app.

import {
  BusySlot,
  DayOfWeek,
  Intention,
  PlacedBlock,
  SchedulePlan,
  TimeWindow,
  Unplaced,
} from './types';

interface Interval {
  s: number; // minutes from midnight
  e: number;
}
interface DaySlots {
  dateKey: string;
  dow: DayOfWeek;
  dayStart: number; // wake (min)
  dayEnd: number; // sleep (min)
  free: Interval[];
  placedTags: {mid: number; tag?: string}[]; // for batching/spread scoring
  intentionDays: Set<string>; // intentionIds already placed this day
}

export interface SolveInput {
  startDate: Date;
  horizonDays: number;
  intentions: Intention[];
  busy: BusySlot[];
  /** wake/sleep minutes per day-of-week (0=Sun..6=Sat). */
  dayWindow: (dow: DayOfWeek) => {wake: number; sleep: number};
}

const SESSION_MAX = 90; // deadline work split into ≤90-min sessions

const fmtKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const winToMin = (w?: TimeWindow): Interval | null =>
  w ? {s: w.startHour * 60, e: w.endHour * 60} : null;

// Intra-day energy curve in [0,1]; morning and late-afternoon peaks, post-lunch dip.
const energyAt = (mid: number): number => {
  const h = mid / 60;
  if (h < 6) return 0.2;
  if (h < 11) return 0.7 + 0.3 * Math.min(1, (h - 6) / 4); // ramp to peak ~10–11
  if (h < 13) return 0.95 - 0.25 * (h - 11); // gentle pre-lunch decline
  if (h < 14.5) return 0.45; // post-lunch dip
  if (h < 18) return 0.6 + 0.25 * Math.min(1, (h - 14.5) / 3.5); // afternoon recovery
  if (h < 21) return 0.6 - 0.15 * (h - 18);
  return 0.3;
};

const overlap = (a: Interval, b: Interval): number =>
  Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s));

/** Find the best free sub-slot of `len` in a day, optionally inside `win`. */
const findSlot = (
  day: DaySlots,
  len: number,
  win: Interval | null,
): {start: number; inWindow: boolean} | null => {
  let bestIn: number | null = null;
  let bestAny: number | null = null;
  for (const iv of day.free) {
    if (iv.e - iv.s < len) continue;
    if (bestAny === null) bestAny = iv.s;
    if (win) {
      const lo = Math.max(iv.s, win.s);
      const hi = Math.min(iv.e, win.e);
      if (hi - lo >= len && bestIn === null) bestIn = lo;
    }
  }
  if (bestIn !== null) return {start: bestIn, inWindow: true};
  if (bestAny !== null) return {start: bestAny, inWindow: false};
  return null;
};

/** Carve [start,start+len] out of the day's free intervals. */
const occupy = (day: DaySlots, start: number, len: number, tag?: string): void => {
  const end = start + len;
  const next: Interval[] = [];
  for (const iv of day.free) {
    if (end <= iv.s || start >= iv.e) {
      next.push(iv);
      continue;
    }
    if (start > iv.s) next.push({s: iv.s, e: start});
    if (end < iv.e) next.push({s: end, e: iv.e});
  }
  day.free = next.sort((a, b) => a.s - b.s);
  day.placedTags.push({mid: start + len / 2, tag});
};

// One unit of work the solver must place.
interface Demand {
  intention: Intention;
  durationMin: number;
  candidateKeys: string[]; // dateKeys this occurrence may land on
  required?: boolean; // fixed/focus → must be that day
  urgency: number; // higher = place earlier / score sooner
  label: string;
}

const orderRank = (k: Intention['kind']): number =>
  ({fixed: 0, focus: 1, deadline: 2, recurring: 3, preference: 9} as Record<string, number>)[k] ?? 5;

export const solve = (input: SolveInput): SchedulePlan => {
  const {startDate, horizonDays, intentions, busy, dayWindow} = input;

  // 1. Build day skeletons with sleep windows as the outer bound.
  const days: DaySlots[] = [];
  const keyToDay = new Map<string, DaySlots>();
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const dow = d.getDay() as DayOfWeek;
    const {wake, sleep} = dayWindow(dow);
    const key = fmtKey(d);
    // For today, don't schedule in the past.
    const isToday = i === 0;
    const nowMin = isToday ? new Date().getHours() * 60 + new Date().getMinutes() + 5 : wake;
    const start = Math.max(wake, isToday ? nowMin : wake);
    const ds: DaySlots = {
      dateKey: key,
      dow,
      dayStart: start,
      dayEnd: sleep,
      free: start < sleep ? [{s: start, e: sleep}] : [],
      placedTags: [],
      intentionDays: new Set(),
    };
    days.push(ds);
    keyToDay.set(key, ds);
  }

  // 2. Subtract pre-existing busy slots (events, schedule-tasks, sleep spillover).
  for (const b of busy) {
    const day = keyToDay.get(b.dateKey);
    if (!day) continue;
    occupy(day, b.startMin, Math.max(0, b.endMin - b.startMin), 'busy');
  }

  // 3. Build demand from active intentions.
  const demands: Demand[] = [];
  const conflicts: string[] = [];
  const horizonKeys = days.map(d => d.dateKey);

  for (const intn of intentions) {
    if (!intn.active || intn.kind === 'preference') continue;
    const allowedDays = (dow: DayOfWeek) => !intn.days || intn.days.includes(dow);

    if (intn.kind === 'fixed' || intn.kind === 'focus') {
      for (const day of days) {
        if (!allowedDays(day.dow)) continue;
        demands.push({
          intention: intn,
          durationMin: intn.durationMin,
          candidateKeys: [day.dateKey],
          required: true,
          urgency: intn.priority + (intn.kind === 'fixed' ? 2 : 1),
          label: intn.title,
        });
      }
    } else if (intn.kind === 'recurring') {
      const target = Math.max(1, Math.min(7, intn.timesPerWeek ?? 3));
      const cand = days.filter(d => allowedDays(d.dow)).map(d => d.dateKey);
      for (let n = 0; n < target; n++) {
        demands.push({
          intention: intn,
          durationMin: intn.durationMin,
          candidateKeys: cand.length ? cand : horizonKeys,
          urgency: intn.priority,
          label: intn.title,
        });
      }
    } else if (intn.kind === 'deadline') {
      const total = intn.totalEstimateMin ?? 600;
      const sessions = Math.max(1, Math.ceil(total / SESSION_MAX));
      const cand = days
        .filter(d => !intn.deadline || d.dateKey <= intn.deadline)
        .filter(d => allowedDays(d.dow))
        .map(d => d.dateKey);
      const useKeys = cand.length ? cand : horizonKeys;
      const per = Math.min(SESSION_MAX, Math.ceil(total / sessions));
      for (let n = 0; n < sessions; n++) {
        demands.push({
          intention: intn,
          durationMin: per,
          candidateKeys: useKeys,
          urgency: intn.priority + 3 - n * 0.1, // front-load
          label: intn.title,
        });
      }
      if (!cand.length && intn.deadline) {
        conflicts.push(`「${intn.title}」の締切(${intn.deadline})までに使える日がありません`);
      }
    }
  }

  // 4. Placement order: kind rank, then urgency desc.
  demands.sort((a, b) => {
    const r = orderRank(a.intention.kind) - orderRank(b.intention.kind);
    if (r !== 0) return r;
    return b.urgency - a.urgency;
  });

  // 5. Greedily place each demand into its best-scoring (day, slot).
  const blocks: PlacedBlock[] = [];
  const unplaced: Unplaced[] = [];
  let totalScore = 0;
  let seq = 0;

  for (const dem of demands) {
    const win = winToMin(dem.intention.window);
    let best: {day: DaySlots; start: number; score: number; inWindow: boolean} | null = null;

    for (const key of dem.candidateKeys) {
      const day = keyToDay.get(key);
      if (!day) continue;
      const slot = findSlot(day, dem.durationMin, win);
      if (!slot) continue;
      const mid = slot.start + dem.durationMin / 2;

      let score = 10;
      if (slot.inWindow) score += 6;
      else if (win) score -= 4;
      // energy: weight more for focus / high priority
      const eW = dem.intention.kind === 'focus' ? 8 : dem.intention.priority >= 4 ? 5 : 3;
      score += energyAt(mid) * eW;
      // batching: reward placing near same-tag work already on this day
      if (dem.intention.tag) {
        const near = day.placedTags.some(
          p => p.tag === dem.intention.tag && Math.abs(p.mid - mid) <= 150,
        );
        if (near) score += 4;
      }
      // spread: penalise stacking the same intention on a day it already has
      if (day.intentionDays.has(dem.intention.id)) score -= 7;
      // earliness: gentle preference for sooner days (deadline urgency etc.)
      const dayIdx = days.indexOf(day);
      score -= dayIdx * 0.4;
      score += dem.urgency * 0.5;

      if (!best || score > best.score) best = {day, start: slot.start, score, inWindow: slot.inWindow};
    }

    // A window-bound, required occurrence (focus / fixed) must land *inside* its
    // window — e.g. "weekday-morning deep work" should be skipped today once the
    // morning has passed, never shoved into the evening.
    const windowMissed = !!best && dem.required && !!win && !best.inWindow;
    if (!best || windowMissed) {
      // Only non-required demands count as "unplaced"; a required occurrence that
      // can't honour its window today simply doesn't happen today (expected).
      if (!dem.required && !unplaced.some(u => u.intentionId === dem.intention.id)) {
        unplaced.push({
          intentionId: dem.intention.id,
          title: dem.label,
          reason: win ? '希望の時間帯に空きが足りませんでした' : '空き時間が足りませんでした',
        });
      }
      continue;
    }

    occupy(best.day, best.start, dem.durationMin, dem.intention.tag);
    best.day.intentionDays.add(dem.intention.id);
    totalScore += best.score;
    seq += 1;

    const reasonParts: string[] = [];
    if (best.inWindow && dem.intention.window) reasonParts.push('希望の時間帯');
    if (energyAt(best.start + dem.durationMin / 2) >= 0.8) reasonParts.push('高い集中力の時間');
    if (dem.intention.kind === 'deadline') reasonParts.push('締切から逆算');
    if (dem.intention.kind === 'focus') reasonParts.push('集中ブロックを確保');
    if (!reasonParts.length) reasonParts.push('空き時間に最適配置');

    blocks.push({
      id: `blk-${best.day.dateKey}-${best.start}-${seq}`,
      intentionId: dem.intention.id,
      title: dem.label,
      kind: dem.intention.kind,
      dateKey: best.day.dateKey,
      startMin: best.start,
      endMin: best.start + dem.durationMin,
      color: dem.intention.color,
      protect: dem.intention.protect,
      status: 'planned',
      reason: reasonParts.join('・'),
    });
  }

  // 6. Time-defense notes: focus/protected blocks adjacent to existing busy.
  for (const blk of blocks) {
    if (!blk.protect) continue;
    const touchesBusy = busy.some(
      b =>
        b.dateKey === blk.dateKey &&
        b.source === 'event' &&
        overlap({s: blk.startMin, e: blk.endMin}, {s: b.startMin, e: b.endMin}) === 0 &&
        (Math.abs(b.endMin - blk.startMin) <= 15 || Math.abs(blk.endMin - b.startMin) <= 15),
    );
    if (touchesBusy) {
      conflicts.push(`「${blk.title}」を予定の隣に防衛配置しました（${blk.dateKey}）`);
    }
  }

  blocks.sort((a, b) =>
    a.dateKey === b.dateKey ? a.startMin - b.startMin : a.dateKey < b.dateKey ? -1 : 1,
  );

  return {
    generatedAt: new Date().toISOString(),
    horizonDays,
    startDateKey: fmtKey(startDate),
    blocks,
    unplaced,
    conflicts,
    score: Math.round(totalScore),
  };
};
