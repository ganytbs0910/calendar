// ── Intention-driven scheduling: core domain types ──────────────────────────
//
// The product thesis: users do not enter events, they declare *intentions* and
// priorities in natural language. A deterministic on-device solver continuously
// re-arranges reality to honour those intentions. The calendar grid is only the
// visualization of the solver's output — the real product is the agent.
//
// Everything here is plain data, persisted locally (AsyncStorage). No network.

/** What kind of intention this is — drives how the solver places it. */
export type IntentionKind =
  | 'focus' // protected deep-work block to defend, e.g. 平日午前は深い作業を死守
  | 'recurring' // a goal with a weekly frequency, e.g. 週3で筋トレ
  | 'fixed' // an immovable recurring commitment, e.g. 金曜夜は夕飯
  | 'deadline' // a project to finish by a date, e.g. 今月末までにリリース
  | 'preference'; // a global preference that only scores, e.g. 移動はまとめたい

/** 0 = Sunday … 6 = Saturday (matches Date.getDay()). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A time-of-day window in whole hours, e.g. morning = {6, 12}. */
export interface TimeWindow {
  startHour: number; // inclusive
  endHour: number; // exclusive
}

/** A declared intention. The solver consumes these; the user can edit them. */
export interface Intention {
  id: string;
  raw: string; // the original natural-language fragment it was parsed from
  title: string; // short label, e.g. 筋トレ / 深い作業 / アプリをリリース
  kind: IntentionKind;
  priority: number; // 1 (nice-to-have) … 5 (must / 死守)
  durationMin: number; // length of one occurrence
  timesPerWeek?: number; // recurring: how many sessions per week
  days?: DayOfWeek[]; // allowed days (focus/recurring) or required days (fixed)
  window?: TimeWindow; // preferred time-of-day window
  deadline?: string; // deadline kind: YYYY-MM-DD
  totalEstimateMin?: number; // deadline kind: total work to distribute
  protect?: boolean; // focus: defend the block against incoming meetings
  tag?: string; // batching category, e.g. exercise / errand / work
  color: string;
  createdAt: string;
  active: boolean;
}

/** A block the solver has placed on a concrete day/time. */
export interface PlacedBlock {
  id: string;
  intentionId: string;
  title: string;
  kind: IntentionKind;
  dateKey: string; // YYYY-MM-DD
  startMin: number; // minutes from local midnight
  endMin: number; // minutes from local midnight
  color: string;
  protect?: boolean;
  locked?: boolean; // user pinned this — solver must not move it
  status: 'planned' | 'done' | 'skipped';
  reason: string; // why the solver chose this slot (explainability)
}

/** A slot the solver must treat as already occupied. */
export interface BusySlot {
  dateKey: string;
  startMin: number;
  endMin: number;
  title?: string;
  source: 'event' | 'task' | 'fixed' | 'sleep';
}

/** An intention the solver could not fully place, with the human reason. */
export interface Unplaced {
  intentionId: string;
  title: string;
  reason: string;
}

/** The output of one solve run over the planning horizon. */
export interface SchedulePlan {
  generatedAt: string;
  horizonDays: number;
  startDateKey: string;
  blocks: PlacedBlock[];
  unplaced: Unplaced[];
  conflicts: string[]; // human-readable notes (e.g. defended/at-risk blocks)
  score: number; // total soft-score of the placement (higher = better)
}

/** Per-intention fulfilment for the current horizon. */
export interface Fulfilment {
  intentionId: string;
  title: string;
  planned: number; // sessions placed
  target: number; // sessions intended (timesPerWeek or 1)
  done: number; // sessions marked done
}

export const KIND_META: Record<
  IntentionKind,
  {icon: string; labelJa: string; defaultColor: string}
> = {
  focus: {icon: 'shield-checkmark-outline', labelJa: '集中時間', defaultColor: '#007AFF'},
  recurring: {icon: 'repeat-outline', labelJa: '習慣', defaultColor: '#34C759'},
  fixed: {icon: 'calendar-outline', labelJa: '毎週の予定', defaultColor: '#FF3B30'},
  deadline: {icon: 'flag-outline', labelJa: '締切', defaultColor: '#FF9500'},
  preference: {icon: 'options-outline', labelJa: 'こだわり', defaultColor: '#AF52DE'},
};
