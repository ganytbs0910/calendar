import AsyncStorage from '@react-native-async-storage/async-storage';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {Task} from './taskService';

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

export interface StatsBundle {
  monthly: MonthlySummary;
  tasks: TaskStats;
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

    // Distribute duration across hour buckets
    const startMs = start.getTime();
    const endMs = new Date(event.endDate!).getTime();
    let cursor = startMs;
    while (cursor < endMs) {
      const cur = new Date(cursor);
      const hour = cur.getHours();
      const nextHourMs = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), hour + 1, 0, 0, 0).getTime();
      const sliceEnd = Math.min(endMs, nextHourMs);
      const sliceMin = Math.round((sliceEnd - cursor) / 60000);
      if (sliceMin > 0) {
        hourArr[hour].minutes += sliceMin;
        heatmap[cur.getDay()][hour] += sliceMin;
      }
      cursor = sliceEnd;
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

  return {
    monthly,
    tasks: taskStats,
    rangeStart,
    rangeEnd,
  };
};

export const getMonthRange = (date: Date): {start: Date; end: Date} => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return {start, end};
};
