// ── 年収の壁ナビ (income-wall navigator) ────────────────────────────────────
//
// A thin, fast layer over the canonical payroll computation so the rest of the
// app can ask two questions cheaply:
//   1. "How close am I to the next 年収の壁 right now?"  → getWallStatus()
//   2. "Would saving this shift push me over a wall?"     → wallCrossedBy()
// All on-device; reuses statisticsService.computePayroll so the number always
// matches the Stats screen. The walls (103/106/130/150万) are user-configurable.

import RNCalendarEvents from 'react-native-calendar-events';

import {computePayroll, getIncomeThresholds} from './statisticsService';
import {getAllEventWages, getAllEventJobs} from './eventWageService';
import {getJobs} from './jobService';

export interface WallThreshold {
  amount: number;
  reached: boolean;
  remaining: number; // yen until this wall (0 once reached)
}

export interface WallStatus {
  year: number;
  yearTotal: number; // total work income across the calendar year
  thresholds: WallThreshold[];
  nextWall: WallThreshold | null;
}

/** Total work income for the given calendar year (incl. future-entered shifts). */
export const getYearWorkTotal = async (year: number): Promise<number> => {
  let events: Awaited<ReturnType<typeof RNCalendarEvents.fetchAllEvents>> = [];
  try {
    events = await RNCalendarEvents.fetchAllEvents(
      new Date(year, 0, 1, 0, 0, 0).toISOString(),
      new Date(year, 11, 31, 23, 59, 59).toISOString(),
    );
  } catch {
    return 0;
  }
  const [wages, ejobs, jobs] = await Promise.all([
    getAllEventWages(),
    getAllEventJobs(),
    getJobs(),
  ]);
  return computePayroll(events, wages, ejobs, jobs).total;
};

/** Current standing against every configured wall. */
export const getWallStatus = async (
  year: number = new Date().getFullYear(),
): Promise<WallStatus> => {
  const [total, thresholds] = await Promise.all([getYearWorkTotal(year), getIncomeThresholds()]);
  const sorted = [...thresholds].sort((a, b) => a - b);
  const ths: WallThreshold[] = sorted.map(amount => ({
    amount,
    reached: total >= amount,
    remaining: Math.max(0, amount - total),
  }));
  return {year, yearTotal: total, thresholds: ths, nextWall: ths.find(t => !t.reached) ?? null};
};

/**
 * The lowest wall that adding `addPay` to `currentTotal` would newly cross,
 * or null if no wall is crossed. Used to warn at shift-save time.
 */
export const wallCrossedBy = (
  currentTotal: number,
  addPay: number,
  thresholds: number[],
): number | null => {
  if (addPay <= 0) return null;
  const after = currentTotal + addPay;
  const crossed = thresholds.filter(a => currentTotal < a && after >= a);
  return crossed.length ? Math.min(...crossed) : null;
};

/** Format a wall amount the way JP users say it: 103万 / 130万 etc. */
export const wallLabel = (amount: number): string => {
  if (amount % 10000 === 0) return `${amount / 10000}万`;
  return amount.toLocaleString();
};
