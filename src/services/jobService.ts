import AsyncStorage from '@react-native-async-storage/async-storage';

// A "job" (勤務先) the user works at. Drives shift/payroll calculation:
// base wage plus night / overtime / holiday premiums, transport and unpaid
// break — the same model the JP category leaders (シフトボード / シフト手帳) use.
export interface Job {
  id: string;
  name: string;
  color: string;            // display color (defaults to work blue)
  hourlyWage: number;       // base hourly wage
  transportPerShift?: number; // 交通費 per shift
  unpaidBreakMin?: number;    // 休憩 (unpaid) minutes deducted per shift
  // Night premium (深夜割増)
  nightEnabled?: boolean;
  nightRate?: number;       // multiplier, e.g. 1.25
  nightStart?: string;      // "HH:MM", e.g. "22:00"
  nightEnd?: string;        // "HH:MM", e.g. "05:00" (may wrap past midnight)
  // Overtime (残業割増) — extra rate for minutes beyond a daily threshold
  overtimeEnabled?: boolean;
  overtimeThresholdMin?: number; // e.g. 480 (8h)
  overtimeRate?: number;    // multiplier, e.g. 1.25
  // Holiday premium (休日割増)
  holidayEnabled?: boolean;
  holidayRate?: number;     // multiplier, e.g. 1.35
  holidayWeekdays?: number[]; // JS getDay() values treated as holiday, e.g. [0,6]
  // Monthly income target (目標給料)
  monthlyTarget?: number;
}

const STORAGE_KEY = '@jobs';

const generateId = (): string =>
  'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

// Sensible JP defaults applied when the user enables a premium without
// specifying numbers (mirrors common 法定割増 conventions).
export const DEFAULT_NIGHT_RATE = 1.25;
export const DEFAULT_NIGHT_START = '22:00';
export const DEFAULT_NIGHT_END = '05:00';
export const DEFAULT_OVERTIME_THRESHOLD_MIN = 480; // 8h
export const DEFAULT_OVERTIME_RATE = 1.25;
export const DEFAULT_HOLIDAY_RATE = 1.35;
export const DEFAULT_HOLIDAY_WEEKDAYS = [0, 6]; // Sun, Sat

export const getJobs = async (): Promise<Job[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Job[]) : [];
  } catch {
    return [];
  }
};

const writeAll = async (list: Job[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

export const getJob = async (id: string): Promise<Job | null> => {
  const list = await getJobs();
  return list.find(j => j.id === id) || null;
};

export const addJob = async (
  job: Omit<Job, 'id'>,
): Promise<Job> => {
  const list = await getJobs();
  const newJob: Job = {...job, id: generateId()};
  list.push(newJob);
  await writeAll(list);
  return newJob;
};

export const updateJob = async (
  id: string,
  patch: Partial<Omit<Job, 'id'>>,
): Promise<void> => {
  const list = await getJobs();
  const idx = list.findIndex(j => j.id === id);
  if (idx === -1) return;
  list[idx] = {...list[idx], ...patch};
  await writeAll(list);
};

export const deleteJob = async (id: string): Promise<void> => {
  const list = await getJobs();
  await writeAll(list.filter(j => j.id !== id));
};
