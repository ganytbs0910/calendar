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

/** The last weekday (Mon-Fri) on or before the last calendar day of the
 * given 1-based month (e.g. m=9 for September). Doesn't account for public
 * holidays — just Sat/Sun. */
const lastBusinessDayKey = (y: number, m: number): string => {
  let d = new Date(y, m, 0); // day 0 of the next (0-based) month = last day of month `m`
  if (d.getDay() === 0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2);
  else if (d.getDay() === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  return fmtKey(d);
};

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
  ({fixed: 0, focus: 1, event: 1, monthly: 1, deadline: 2, recurring: 3, preference: 9} as Record<string, number>)[k] ?? 5;

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
  // An all-day 'event' (no time given) is a calendar marker, not time to
  // defend — it places unconditionally rather than competing for a free slot.
  const allDayEventBlocks: PlacedBlock[] = [];
  // A crosses-midnight fixed/focus/event ("22時から翌1時") can't be expressed
  // as a same-day search window — TimeWindow caps at 24:00 — so it's pinned
  // directly at its declared start time instead of going through
  // findSlot/occupy. Best-effort like the all-day case above: no conflict
  // check against that day's other bookings.
  const pinnedBlocks: PlacedBlock[] = [];
  const pinBlock = (intn: Intention, dateKey: string): PlacedBlock => {
    const startMin = (intn.window?.startHour ?? 0) * 60;
    return {
      id: `blk-${dateKey}-pin-${intn.id}`,
      intentionId: intn.id,
      title: intn.title,
      kind: intn.kind,
      dateKey,
      startMin,
      endMin: startMin + intn.durationMin,
      color: intn.color,
      protect: intn.protect,
      explicitRecurrence: intn.explicitRecurrence,
      status: 'planned',
      reason: '深夜をまたぐため直接配置しました',
    };
  };

  for (const intn of intentions) {
    if (!intn.active || intn.kind === 'preference') continue;
    const allowedDays = (dow: DayOfWeek) => !intn.days || intn.days.includes(dow);

    if (intn.kind === 'event') {
      if (!intn.eventDate) continue;
      if (intn.allDay) {
        allDayEventBlocks.push({
          id: `blk-${intn.eventDate}-allday-${intn.id}`,
          intentionId: intn.id,
          title: intn.title,
          kind: intn.kind,
          dateKey: intn.eventDate,
          startMin: 0,
          endMin: 0,
          color: intn.color,
          allDay: true,
          eventEndDate: intn.eventEndDate,
          status: 'planned',
          reason: '指定日',
        });
      } else if (intn.crossesMidnight) {
        pinnedBlocks.push(pinBlock(intn, intn.eventDate));
      } else {
        demands.push({
          intention: intn,
          durationMin: intn.durationMin,
          candidateKeys: [intn.eventDate],
          required: true,
          urgency: intn.priority + 3,
          label: intn.title,
        });
      }
    } else if (intn.kind === 'fixed' || intn.kind === 'focus') {
      for (const day of days) {
        if (!allowedDays(day.dow)) continue;
        if (intn.crossesMidnight) {
          pinnedBlocks.push(pinBlock(intn, day.dateKey));
          continue;
        }
        demands.push({
          intention: intn,
          durationMin: intn.durationMin,
          candidateKeys: [day.dateKey],
          required: true,
          urgency: intn.priority + (intn.kind === 'fixed' ? 2 : 1),
          label: intn.title,
        });
      }
    } else if (intn.kind === 'monthly') {
      // "毎月1日" (day-of-month) / "第2土曜日" (Nth weekday) / "毎月末"
      // (last calendar day) / "最終営業日" (last weekday) — checked per
      // day-in-horizon like fixed's weekday check, just against a different
      // rule for "does this date match". "隔月"/"3ヶ月に1回" (monthInterval)
      // additionally requires the date's month to be an eligible multiple of
      // that interval away from the solve's start month.
      const anchorMonthIdx = startDate.getFullYear() * 12 + startDate.getMonth();
      for (const day of days) {
        const [dy, dm, dd] = day.dateKey.split('-').map(n => parseInt(n, 10));
        if (intn.monthInterval && intn.monthInterval > 1) {
          const monthIdx = dy * 12 + (dm - 1);
          if (((monthIdx - anchorMonthIdx) % intn.monthInterval + intn.monthInterval) % intn.monthInterval !== 0) {
            continue;
          }
        }
        let matches = false;
        if (intn.lastBusinessDayOfMonth) {
          matches = day.dateKey === lastBusinessDayKey(dy, dm);
        } else if (intn.lastDayOfMonth) {
          matches = dd === new Date(dy, dm, 0).getDate();
        } else if (intn.monthDay !== undefined) {
          matches = dd === intn.monthDay;
        } else if (intn.monthWeek !== undefined && intn.days?.length) {
          matches = day.dow === intn.days[0] && Math.ceil(dd / 7) === intn.monthWeek;
        } else if (intn.lastWeekdayOfMonth !== undefined) {
          // The last occurrence of this weekday in the month: true exactly
          // when adding one more week would push past the month's last day.
          matches = day.dow === intn.lastWeekdayOfMonth && dd + 7 > new Date(dy, dm, 0).getDate();
        }
        if (!matches) continue;
        demands.push({
          intention: intn,
          durationMin: intn.durationMin,
          candidateKeys: [day.dateKey],
          required: true,
          urgency: intn.priority + 2,
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
      } else if (dem.required && dem.intention.priority >= 5) {
        // A required occurrence the user explicitly marked 死守 (priority 5)
        // silently not landing on its declared day is exactly the kind of
        // failure that must never be quiet — unlike a routine "missed one
        // weekday out of five" (see the comment below this loop), the user
        // said this one must never be skipped, so every miss gets its own
        // advisory note even though the intention may still land on other
        // days within the horizon.
        conflicts.push(
          `「${dem.label}」を${dem.candidateKeys[0]}に死守できませんでした（既存の予定と重複しています）`,
        );
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
      explicitRecurrence: dem.intention.explicitRecurrence,
      monthDay: dem.intention.monthDay,
      monthWeek: dem.intention.monthWeek,
      lastDayOfMonth: dem.intention.lastDayOfMonth,
      lastBusinessDayOfMonth: dem.intention.lastBusinessDayOfMonth,
      lastWeekdayOfMonth: dem.intention.lastWeekdayOfMonth,
      monthInterval: dem.intention.monthInterval,
      status: 'planned',
      reason: reasonParts.join('・'),
    });
  }

  blocks.push(...allDayEventBlocks, ...pinnedBlocks);

  // 6. A required (fixed/focus) demand that never lands anywhere still needs a
  // human-visible reason — the per-demand loop above deliberately skips
  // logging "unplaced" for those (a focus block missing one day out of five
  // weekdays is normal), but an intention that ends up with *zero* placed
  // blocks in the whole horizon — e.g. "毎週月曜10-12" whose only Monday was
  // already busy — must not fail completely silently. That looks identical to
  // the feature being broken.
  //
  // The most common reason a required slot is busy is that this exact
  // commitment was already applied to the calendar on an earlier run — a
  // same-titled busy entry sitting inside the intention's own window/days is
  // a near-certain signal of that, and re-declaring it isn't a bug, it's
  // "already done". That reads very differently from a genuine clash with an
  // unrelated event, so it gets its own message.
  const placedIntentionIds = new Set(blocks.map(b => b.intentionId));
  for (const intn of intentions) {
    if (!intn.active || intn.kind === 'preference') continue;
    if (placedIntentionIds.has(intn.id)) continue;
    if (unplaced.some(u => u.intentionId === intn.id)) continue;

    const allowedDays = (dow: DayOfWeek) => !intn.days || intn.days.includes(dow);
    const win = winToMin(intn.window);
    const alreadyScheduled = busy.some(b => {
      if (b.title !== intn.title) return false;
      const day = keyToDay.get(b.dateKey);
      if (!day || !allowedDays(day.dow)) return false;
      return win ? overlap({s: b.startMin, e: b.endMin}, win) > 0 : true;
    });

    unplaced.push({
      intentionId: intn.id,
      title: intn.title,
      reason: alreadyScheduled
        ? 'すでに同じ内容の予定がカレンダーに入っています'
        : intn.kind === 'event' || intn.kind === 'monthly'
        ? '指定した日に空きがありませんでした'
        : intn.window
        ? '指定した曜日・時間帯に空きがありませんでした'
        : '指定した曜日に空き時間が足りませんでした',
    });
  }

  // 7. Time-defense notes: focus/protected blocks adjacent to existing busy.
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
