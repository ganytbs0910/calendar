import AsyncStorage from '@react-native-async-storage/async-storage';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {Task} from './taskService';
import {getAllEventWages, getAllEventJobs, getAllEventBreaks} from './eventWageService';
import {getJobs, Job} from './jobService';

// The "work" category color. Per-event wages only apply to work-colored events.
export const WORK_COLOR = '#007AFF';

const TASKS_STORAGE_KEY = '@today_tasks';
const EVENT_COLOR_STORAGE_KEY = '@event_colors';

export const COLOR_LABEL_MAP: Record<string, string> = {
  '#007AFF': 'colorWork',
  '#FF3B30': 'colorImportant',
  '#34C759': 'colorFun',
  '#FFCC00': 'colorOther',
  '#FF9500': 'colorPromise',
  '#AF52DE': 'colorHobby',
  '#FF2D92': 'colorSchedule',
};

export interface CategoryStat {
  color: string;
  labelKey: string;
  minutes: number;
  count: number;
}

export interface WeekdayStat {
  weekday: number; // 0 = Sun
  minutes: number;
  count: number;
}

export interface HourStat {
  hour: number;
  minutes: number;
}

export interface TitleStat {
  title: string;
  count: number;
  totalMinutes: number;
  color: string;
}

export interface MonthlySummary {
  totalEvents: number;
  totalMinutes: number;
  averageMinutesPerEvent: number;
  byCategory: CategoryStat[];
  byWeekday: WeekdayStat[];
  busiestWeekdays: WeekdayStat[];
  byHour: HourStat[];
  morningRatio: number; // 0..1 — share of minutes between 5-12
  nightRatio: number;   // 0..1 — share of minutes between 18-26
  heatmap: number[][];  // [7][24] minutes
  topTitles: TitleStat[];
}

export interface TaskStats {
  total: number;
  completed: number;
  completionRate: number; // 0..1
  streakDays: number;     // consecutive days (ending today) with ≥1 task and all completed
  byWeekday: { weekday: number; total: number; completed: number; rate: number }[];
  averageDuration: number; // minutes
}

// --- Shift / payroll engine --------------------------------------------
// Per-shift pay broken into base + premiums, the way JP wage apps present it.
export interface ShiftPayBreakdown {
  paidMinutes: number;
  breakMinutes: number;   // unpaid break deducted from this shift
  nightMinutes: number;
  overtimeMinutes: number;
  isHoliday: boolean;
  base: number;
  nightPremium: number;
  overtimePremium: number;
  holidayPremium: number;
  transport: number;
  total: number;
}

// Legally-required unpaid break by gross shift length (労働基準法 第34条):
//   over 6h → 45min, over 8h → 60min, otherwise none.
// "over" is strict: exactly 6h/8h needs no extra break.
export const legalBreakMinutes = (grossMin: number): number => {
  if (grossMin > 480) return 60;
  if (grossMin > 360) return 45;
  return 0;
};

export interface JobEarning {
  jobId: string | null; // null = manual per-event wages bucket
  name: string;
  color: string;
  shiftCount: number;
  minutes: number;
  base: number;
  nightPremium: number;
  overtimePremium: number;
  holidayPremium: number;
  transport: number;
  total: number;
  monthlyTarget?: number;
}

export interface ShiftRow {
  jobId: string | null;
  jobName: string; // '' for the manual-wage bucket; UI localizes
  startISO: string;
  endISO: string;
  minutes: number;
  total: number;
}

export interface PayrollSummary {
  total: number;
  totalMinutes: number;
  base: number;
  nightPremium: number;
  overtimePremium: number;
  holidayPremium: number;
  transport: number;
  byJob: JobEarning[];
  shifts: ShiftRow[];
}

export interface IncomeThresholdStat {
  amount: number;
  reached: boolean;
  remaining: number; // yen until this wall (0 if passed)
}

export interface IncomeWallSummary {
  yearTotal: number;     // total income across the whole displayed year (incl. future-entered shifts)
  year: number;
  thresholds: IncomeThresholdStat[];
  nextWall: IncomeThresholdStat | null;
}

export interface StatsBundle {
  monthly: MonthlySummary;
  tasks: TaskStats;
  payroll: PayrollSummary;
  incomeWall: IncomeWallSummary;
  rangeStart: Date;
  rangeEnd: Date;
}

const loadAllTasks = async (): Promise<Task[]> => {
  const raw = await AsyncStorage.getItem(TASKS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
};

const loadEventColors = async (): Promise<Record<string, string>> => {
  const raw = await AsyncStorage.getItem(EVENT_COLOR_STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const eventDurationMinutes = (event: CalendarEventReadable): number => {
  if (!event.startDate || !event.endDate) return 0;
  const start = new Date(event.startDate).getTime();
  const end = new Date(event.endDate).getTime();
  if (end <= start) return 0;
  if (event.allDay) return 0;
  return Math.round((end - start) / 60000);
};

const normalizeColor = (color?: string): string => {
  if (!color) return '#999999';
  const c = color.trim();
  if (c.startsWith('#')) return c.toUpperCase();
  return c.toUpperCase();
};

const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const computeMonthlySummary = (
  events: CalendarEventReadable[],
  eventColors: Record<string, string>,
): MonthlySummary => {
  let totalMinutes = 0;
  const categoryMap = new Map<string, CategoryStat>();
  const weekdayArr: WeekdayStat[] = Array.from({length: 7}, (_, i) => ({weekday: i, minutes: 0, count: 0}));
  const hourArr: HourStat[] = Array.from({length: 24}, (_, i) => ({hour: i, minutes: 0}));
  const heatmap: number[][] = Array.from({length: 7}, () => Array(24).fill(0));
  const titleMap = new Map<string, TitleStat>();

  let countedEvents = 0;

  for (const event of events) {
    const dur = eventDurationMinutes(event);
    if (dur <= 0) continue;
    countedEvents += 1;
    totalMinutes += dur;

    const color = normalizeColor(eventColors[event.id || ''] || (event as any).color);
    const labelKey = COLOR_LABEL_MAP[color] || 'colorOther';
    const cat = categoryMap.get(color) || {color, labelKey, minutes: 0, count: 0};
    cat.minutes += dur;
    cat.count += 1;
    categoryMap.set(color, cat);

    const start = new Date(event.startDate!);
    const wd = start.getDay();
    weekdayArr[wd].minutes += dur;
    weekdayArr[wd].count += 1;

    // Distribute duration across hour buckets.
    // We advance one minute at a time and re-read the local hour to stay
    // correct across DST transitions (where "next hour" can be 0 or 2 hours away).
    const endMs = new Date(event.endDate!).getTime();
    let cursor = start.getTime();
    let guard = 0;
    while (cursor < endMs && guard < 60 * 24 * 31) {
      const cur = new Date(cursor);
      const hour = cur.getHours();
      // Step to the start of the next local clock-hour. Using setHours respects
      // the timezone's DST rules instead of assuming exactly 3600s per hour.
      const nextBoundary = new Date(cur);
      nextBoundary.setMinutes(0, 0, 0);
      nextBoundary.setHours(nextBoundary.getHours() + 1);
      const sliceEnd = Math.min(endMs, nextBoundary.getTime());
      if (sliceEnd <= cursor) break; // defensive: prevent infinite loop
      const sliceMin = Math.round((sliceEnd - cursor) / 60000);
      if (sliceMin > 0) {
        hourArr[hour].minutes += sliceMin;
        heatmap[cur.getDay()][hour] += sliceMin;
      }
      cursor = sliceEnd;
      guard += 1;
    }

    const titleKey = (event.title || '').trim();
    if (titleKey) {
      const t = titleMap.get(titleKey) || {title: titleKey, count: 0, totalMinutes: 0, color};
      t.count += 1;
      t.totalMinutes += dur;
      titleMap.set(titleKey, t);
    }
  }

  const byCategory = Array.from(categoryMap.values()).sort((a, b) => b.minutes - a.minutes);
  const byWeekday = weekdayArr;
  const busiestWeekdays = [...weekdayArr]
    .filter(w => w.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3);

  const morningMin = hourArr.slice(5, 12).reduce((s, h) => s + h.minutes, 0);
  const nightMin = hourArr.slice(18, 24).reduce((s, h) => s + h.minutes, 0);
  const morningRatio = totalMinutes > 0 ? morningMin / totalMinutes : 0;
  const nightRatio = totalMinutes > 0 ? nightMin / totalMinutes : 0;

  const topTitles = Array.from(titleMap.values())
    .sort((a, b) => b.count - a.count || b.totalMinutes - a.totalMinutes)
    .slice(0, 5);

  return {
    totalEvents: countedEvents,
    totalMinutes,
    averageMinutesPerEvent: countedEvents > 0 ? Math.round(totalMinutes / countedEvents) : 0,
    byCategory,
    byWeekday,
    busiestWeekdays,
    byHour: hourArr,
    morningRatio,
    nightRatio,
    heatmap,
    topTitles,
  };
};

export const computeTaskStats = (tasks: Task[], rangeStart: Date, rangeEnd: Date): TaskStats => {
  const startKey = getDateKey(rangeStart);
  const endKey = getDateKey(rangeEnd);

  const inRange = tasks.filter(t => t.dateKey >= startKey && t.dateKey <= endKey);
  const total = inRange.length;
  const completed = inRange.filter(t => t.completed).length;
  const completionRate = total > 0 ? completed / total : 0;

  const byWeekday = Array.from({length: 7}, (_, i) => ({weekday: i, total: 0, completed: 0, rate: 0}));
  let durationSum = 0;
  let durationCount = 0;
  for (const t of inRange) {
    const [y, m, d] = t.dateKey.split('-').map(n => parseInt(n, 10));
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const wd = new Date(y, m - 1, d).getDay();
      byWeekday[wd].total += 1;
      if (t.completed) byWeekday[wd].completed += 1;
    }
    if (t.duration && t.duration > 0) {
      durationSum += t.duration;
      durationCount += 1;
    }
  }
  for (const w of byWeekday) {
    w.rate = w.total > 0 ? w.completed / w.total : 0;
  }

  // Streak: consecutive days back from today where the day had ≥1 task and all were completed
  const tasksByDate = new Map<string, Task[]>();
  for (const t of tasks) {
    const arr = tasksByDate.get(t.dateKey) || [];
    arr.push(t);
    tasksByDate.set(t.dateKey, arr);
  }
  const today = new Date();
  let streakDays = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = getDateKey(d);
    const list = tasksByDate.get(key);
    if (!list || list.length === 0) {
      // Skip today if empty (don't break streak yet on today)
      if (i === 0) continue;
      break;
    }
    const allDone = list.every(t => t.completed);
    if (!allDone) break;
    streakDays += 1;
  }

  return {
    total,
    completed,
    completionRate,
    streakDays,
    byWeekday,
    averageDuration: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
  };
};

const parseHM = (s?: string): number | null => {
  if (!s) return null;
  const parts = s.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

// Minutes of [start,end] that fall inside the (possibly midnight-wrapping)
// night window defined by minutes-from-midnight nightStart/nightEnd.
const nightOverlapMinutes = (
  start: Date,
  end: Date,
  nightStart: number,
  nightEnd: number,
): number => {
  const dayMs = 86_400_000;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const atMinutes = (base: Date, mins: number): number => {
    const x = new Date(base);
    x.setHours(0, 0, 0, 0);
    return x.getTime() + mins * 60_000;
  };
  let total = 0;
  // Start one day early so a window opened the previous night is counted.
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  cursor = new Date(cursor.getTime() - dayMs);
  const lastDay = new Date(end);
  lastDay.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cursor.getTime() <= lastDay.getTime() && guard < 400) {
    const ns = atMinutes(cursor, nightStart);
    // If the window ends at/before it starts it wraps into the next day.
    const ne = nightEnd <= nightStart
      ? atMinutes(new Date(cursor.getTime() + dayMs), nightEnd)
      : atMinutes(cursor, nightEnd);
    const lo = Math.max(ns, startMs);
    const hi = Math.min(ne, endMs);
    if (hi > lo) total += (hi - lo) / 60_000;
    cursor = new Date(cursor.getTime() + dayMs);
    guard += 1;
  }
  return total;
};

// Compute one shift's pay from a job's wage rules. Exported so the event
// editor can show a live pay preview using the same logic as the stats.
// `breakOverrideMin`: an explicit per-shift break (minutes). When null/undefined
// the break is auto-derived as max(legal minimum, the job's fixed break).
export const computeShiftPay = (start: Date, end: Date, job: Job, breakOverrideMin?: number | null): ShiftPayBreakdown => {
  const empty: ShiftPayBreakdown = {
    paidMinutes: 0, breakMinutes: 0, nightMinutes: 0, overtimeMinutes: 0, isHoliday: false,
    base: 0, nightPremium: 0, overtimePremium: 0, holidayPremium: 0, transport: 0, total: 0,
  };
  const grossMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  if (grossMin <= 0 || !job.hourlyWage || job.hourlyWage <= 0) return empty;

  const autoBreak = Math.max(legalBreakMinutes(grossMin), job.unpaidBreakMin || 0);
  const breakMin = Math.min(grossMin, Math.max(0, breakOverrideMin != null ? breakOverrideMin : autoBreak));
  const paidMin = Math.max(0, grossMin - breakMin);
  const wage = job.hourlyWage;
  const base = (paidMin / 60) * wage;

  let nightMin = 0;
  let nightPremium = 0;
  if (job.nightEnabled) {
    const ns = parseHM(job.nightStart) ?? parseHM(DEFAULT_NIGHT_START_LOCAL);
    const ne = parseHM(job.nightEnd) ?? parseHM(DEFAULT_NIGHT_END_LOCAL);
    if (ns !== null && ne !== null) {
      nightMin = Math.min(paidMin, Math.round(nightOverlapMinutes(start, end, ns, ne)));
      const rate = (job.nightRate || 1.25) - 1;
      nightPremium = (nightMin / 60) * wage * rate;
    }
  }

  let overtimeMin = 0;
  let overtimePremium = 0;
  if (job.overtimeEnabled) {
    const threshold = job.overtimeThresholdMin || 480;
    overtimeMin = Math.max(0, paidMin - threshold);
    const rate = (job.overtimeRate || 1.25) - 1;
    overtimePremium = (overtimeMin / 60) * wage * rate;
  }

  let isHoliday = false;
  let holidayPremium = 0;
  if (job.holidayEnabled) {
    const days = job.holidayWeekdays && job.holidayWeekdays.length > 0 ? job.holidayWeekdays : [0, 6];
    isHoliday = days.includes(start.getDay());
    if (isHoliday) {
      const rate = (job.holidayRate || 1.35) - 1;
      holidayPremium = (paidMin / 60) * wage * rate;
    }
  }

  const transport = Math.max(0, job.transportPerShift || 0);
  const total = base + nightPremium + overtimePremium + holidayPremium + transport;
  return {
    paidMinutes: paidMin, breakMinutes: breakMin, nightMinutes: nightMin, overtimeMinutes: overtimeMin, isHoliday,
    base, nightPremium, overtimePremium, holidayPremium, transport, total,
  };
};

// Local copies so computeShiftPay doesn't need the jobService import for constants.
const DEFAULT_NIGHT_START_LOCAL = '22:00';
const DEFAULT_NIGHT_END_LOCAL = '05:00';

// Aggregate a set of events into per-job earnings + premium totals. Events
// linked to a job use the full wage-rule engine; events with only a manual
// per-event wage fall into a single "manual" bucket.
// Manual-wage events (no job) collect under this sentinel bucket; the UI
// renders a localized label when jobId === null.
export const computePayroll = (
  events: CalendarEventReadable[],
  eventWages: Record<string, number>,
  eventJobs: Record<string, string>,
  jobs: Job[],
  eventBreaks: Record<string, number> = {},
): PayrollSummary => {
  const jobMap = new Map(jobs.map(j => [j.id, j]));
  const buckets = new Map<string, JobEarning>();
  const shifts: ShiftRow[] = [];
  const bucketFor = (key: string, init: () => JobEarning): JobEarning => {
    let b = buckets.get(key);
    if (!b) { b = init(); buckets.set(key, b); }
    return b;
  };

  for (const event of events) {
    const id = event.id || '';
    if (!event.startDate || !event.endDate || event.allDay) continue;
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    const jobId = eventJobs[id];
    const job = jobId ? jobMap.get(jobId) : undefined;
    const breakOverride = id in eventBreaks ? eventBreaks[id] : null;

    if (job) {
      const bd = computeShiftPay(start, end, job, breakOverride);
      if (bd.total <= 0 && bd.paidMinutes <= 0) continue;
      const b = bucketFor(job.id, () => ({
        jobId: job.id, name: job.name, color: job.color, shiftCount: 0, minutes: 0,
        base: 0, nightPremium: 0, overtimePremium: 0, holidayPremium: 0, transport: 0, total: 0,
        monthlyTarget: job.monthlyTarget,
      }));
      b.shiftCount += 1;
      b.minutes += bd.paidMinutes;
      b.base += bd.base;
      b.nightPremium += bd.nightPremium;
      b.overtimePremium += bd.overtimePremium;
      b.holidayPremium += bd.holidayPremium;
      b.transport += bd.transport;
      b.total += bd.total;
      shifts.push({jobId: job.id, jobName: job.name, startISO: event.startDate, endISO: event.endDate, minutes: bd.paidMinutes, total: bd.total});
    } else {
      const wage = eventWages[id];
      if (!wage || wage <= 0) continue;
      const dur = eventDurationMinutes(event);
      if (dur <= 0) continue;
      const breakMin = Math.min(dur, Math.max(0, breakOverride != null ? breakOverride : legalBreakMinutes(dur)));
      const paidDur = Math.max(0, dur - breakMin);
      const amount = (paidDur / 60) * wage;
      const b = bucketFor('__manual__', () => ({
        jobId: null, name: '', color: WORK_COLOR, shiftCount: 0, minutes: 0,
        base: 0, nightPremium: 0, overtimePremium: 0, holidayPremium: 0, transport: 0, total: 0,
      }));
      b.shiftCount += 1;
      b.minutes += paidDur;
      b.base += amount;
      b.total += amount;
      shifts.push({jobId: null, jobName: '', startISO: event.startDate, endISO: event.endDate, minutes: paidDur, total: amount});
    }
  }

  shifts.sort((a, b) => a.startISO.localeCompare(b.startISO));
  const byJob = Array.from(buckets.values()).sort((a, b) => b.total - a.total);
  const sum = (sel: (j: JobEarning) => number) => byJob.reduce((acc, j) => acc + sel(j), 0);
  return {
    total: sum(j => j.total),
    totalMinutes: sum(j => j.minutes),
    base: sum(j => j.base),
    nightPremium: sum(j => j.nightPremium),
    overtimePremium: sum(j => j.overtimePremium),
    holidayPremium: sum(j => j.holidayPremium),
    transport: sum(j => j.transport),
    byJob,
    shifts,
  };
};

// --- 年収の壁 (income thresholds) --------------------------------------
const INCOME_THRESHOLDS_KEY = '@income_thresholds';
// JP dependent/tax/social-insurance walls. Configurable because the 2025/2026
// tax reform is actively changing these — never hardcode as final truth.
export const DEFAULT_INCOME_THRESHOLDS = [1030000, 1060000, 1300000, 1500000];

export const getIncomeThresholds = async (): Promise<number[]> => {
  try {
    const raw = await AsyncStorage.getItem(INCOME_THRESHOLDS_KEY);
    if (!raw) return [...DEFAULT_INCOME_THRESHOLDS];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every(n => typeof n === 'number')) {
      return [...arr].sort((a, b) => a - b);
    }
    return [...DEFAULT_INCOME_THRESHOLDS];
  } catch {
    return [...DEFAULT_INCOME_THRESHOLDS];
  }
};

export const setIncomeThresholds = async (list: number[]): Promise<void> => {
  const clean = list.filter(n => typeof n === 'number' && n > 0).sort((a, b) => a - b);
  await AsyncStorage.setItem(INCOME_THRESHOLDS_KEY, JSON.stringify(clean));
};

const computeIncomeWall = (yearTotal: number, year: number, thresholds: number[]): IncomeWallSummary => {
  const stats: IncomeThresholdStat[] = thresholds.map(amount => ({
    amount,
    reached: yearTotal >= amount,
    remaining: Math.max(0, amount - yearTotal),
  }));
  const nextWall = stats.find(s => !s.reached) || null;
  return {yearTotal, year, thresholds: stats, nextWall};
};

export const fetchStats = async (rangeStart: Date, rangeEnd: Date): Promise<StatsBundle> => {
  const startISO = rangeStart.toISOString();
  const endISO = rangeEnd.toISOString();

  let events: CalendarEventReadable[] = [];
  try {
    events = await RNCalendarEvents.fetchAllEvents(startISO, endISO);
  } catch {
    events = [];
  }

  const eventColors = await loadEventColors();
  const monthly = computeMonthlySummary(events, eventColors);

  const tasks = await loadAllTasks();
  const taskStats = computeTaskStats(tasks, rangeStart, rangeEnd);

  // Shift/payroll: month buckets per job, plus full-year income for 年収の壁.
  const eventWages = await getAllEventWages();
  const eventJobs = await getAllEventJobs();
  const eventBreaks = await getAllEventBreaks();
  const jobs = await getJobs();
  const payroll = computePayroll(events, eventWages, eventJobs, jobs, eventBreaks);

  const year = rangeStart.getFullYear();
  let yearEvents: CalendarEventReadable[] = [];
  try {
    yearEvents = await RNCalendarEvents.fetchAllEvents(
      new Date(year, 0, 1, 0, 0, 0).toISOString(),
      new Date(year, 11, 31, 23, 59, 59).toISOString(),
    );
  } catch {
    yearEvents = [];
  }
  const yearPayroll = computePayroll(yearEvents, eventWages, eventJobs, jobs, eventBreaks);
  const thresholds = await getIncomeThresholds();
  const incomeWall = computeIncomeWall(yearPayroll.total, year, thresholds);

  return {
    monthly,
    tasks: taskStats,
    payroll,
    incomeWall,
    rangeStart,
    rangeEnd,
  };
};

export const getMonthRange = (date: Date): {start: Date; end: Date} => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return {start, end};
};
