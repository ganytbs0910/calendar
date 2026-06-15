import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-event hourly wage, keyed by the EventKit event id. This mirrors the
// per-event color store (@event_colors) — EventKit can't hold this custom
// metadata, so we keep it alongside in AsyncStorage.
export const EVENT_WAGE_STORAGE_KEY = '@event_wages';

// Serialize read-modify-write on the wage map so two concurrent setEventWage
// calls (e.g. copying an event to several days) can't clobber each other.
let eventWageWriteChain: Promise<unknown> = Promise.resolve();
const withEventWageLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = eventWageWriteChain.then(fn, fn);
  eventWageWriteChain = next.catch(() => {});
  return next;
};

export const getEventWage = async (eventId: string): Promise<number | null> => {
  try {
    const json = await AsyncStorage.getItem(EVENT_WAGE_STORAGE_KEY);
    if (!json) return null;
    const map = JSON.parse(json);
    const w = map[eventId];
    return typeof w === 'number' && w > 0 ? w : null;
  } catch {
    return null;
  }
};

export const setEventWage = async (eventId: string, wage: number): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const json = await AsyncStorage.getItem(EVENT_WAGE_STORAGE_KEY);
      const map = json ? JSON.parse(json) : {};
      map[eventId] = wage;
      await AsyncStorage.setItem(EVENT_WAGE_STORAGE_KEY, JSON.stringify(map));
    } catch (error) {
      console.error('Error saving event wage:', error);
    }
  });

export const removeEventWage = async (eventId: string): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const json = await AsyncStorage.getItem(EVENT_WAGE_STORAGE_KEY);
      if (!json) return;
      const map = JSON.parse(json);
      if (eventId in map) {
        delete map[eventId];
        await AsyncStorage.setItem(EVENT_WAGE_STORAGE_KEY, JSON.stringify(map));
      }
    } catch (error) {
      console.error('Error removing event wage:', error);
    }
  });

export const getAllEventWages = async (): Promise<Record<string, number>> => {
  try {
    const json = await AsyncStorage.getItem(EVENT_WAGE_STORAGE_KEY);
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
};

// --- Event ↔ Job link ---------------------------------------------------
// Maps an EventKit event id to a Job id (@jobs). An event is either linked to
// a job (payroll rules apply) OR carries a manual per-event wage (@event_wages),
// never both — the AddEventModal clears one when the other is set.
export const EVENT_JOB_STORAGE_KEY = '@event_jobs';

export const getEventJob = async (eventId: string): Promise<string | null> => {
  try {
    const json = await AsyncStorage.getItem(EVENT_JOB_STORAGE_KEY);
    if (!json) return null;
    const map = JSON.parse(json);
    return typeof map[eventId] === 'string' ? map[eventId] : null;
  } catch {
    return null;
  }
};

export const setEventJob = async (eventId: string, jobId: string): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const json = await AsyncStorage.getItem(EVENT_JOB_STORAGE_KEY);
      const map = json ? JSON.parse(json) : {};
      map[eventId] = jobId;
      await AsyncStorage.setItem(EVENT_JOB_STORAGE_KEY, JSON.stringify(map));
    } catch (error) {
      console.error('Error saving event job:', error);
    }
  });

export const removeEventJob = async (eventId: string): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const json = await AsyncStorage.getItem(EVENT_JOB_STORAGE_KEY);
      if (!json) return;
      const map = JSON.parse(json);
      if (eventId in map) {
        delete map[eventId];
        await AsyncStorage.setItem(EVENT_JOB_STORAGE_KEY, JSON.stringify(map));
      }
    } catch (error) {
      console.error('Error removing event job:', error);
    }
  });

export const getAllEventJobs = async (): Promise<Record<string, string>> => {
  try {
    const json = await AsyncStorage.getItem(EVENT_JOB_STORAGE_KEY);
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
};

// --- Per-event unpaid break (minutes) -----------------------------------
// Explicit break for a single shift. Absent key = no override → the payroll
// engine auto-applies the legal minimum (45min over 6h, 60min over 8h).
// A stored 0 is meaningful: "this shift has no break" (overrides the auto).
export const EVENT_BREAK_STORAGE_KEY = '@event_breaks';

export const getEventBreak = async (eventId: string): Promise<number | null> => {
  try {
    const json = await AsyncStorage.getItem(EVENT_BREAK_STORAGE_KEY);
    if (!json) return null;
    const map = JSON.parse(json);
    const b = map[eventId];
    return typeof b === 'number' && b >= 0 ? b : null;
  } catch {
    return null;
  }
};

export const setEventBreak = async (eventId: string, minutes: number): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const json = await AsyncStorage.getItem(EVENT_BREAK_STORAGE_KEY);
      const map = json ? JSON.parse(json) : {};
      map[eventId] = Math.max(0, Math.round(minutes));
      await AsyncStorage.setItem(EVENT_BREAK_STORAGE_KEY, JSON.stringify(map));
    } catch (error) {
      console.error('Error saving event break:', error);
    }
  });

export const removeEventBreak = async (eventId: string): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const json = await AsyncStorage.getItem(EVENT_BREAK_STORAGE_KEY);
      if (!json) return;
      const map = JSON.parse(json);
      if (eventId in map) {
        delete map[eventId];
        await AsyncStorage.setItem(EVENT_BREAK_STORAGE_KEY, JSON.stringify(map));
      }
    } catch (error) {
      console.error('Error removing event break:', error);
    }
  });

export const getAllEventBreaks = async (): Promise<Record<string, number>> => {
  try {
    const json = await AsyncStorage.getItem(EVENT_BREAK_STORAGE_KEY);
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
};

// Recently used wage values, for one-tap re-entry. Most recent first.
export const RECENT_WAGES_STORAGE_KEY = '@recent_wages';
const MAX_RECENT_WAGES = 6;

export const getRecentWages = async (): Promise<number[]> => {
  try {
    const json = await AsyncStorage.getItem(RECENT_WAGES_STORAGE_KEY);
    if (!json) return [];
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((n): n is number => typeof n === 'number' && n > 0);
  } catch {
    return [];
  }
};

// Move `wage` to the front of the recents list (deduped, capped).
export const addRecentWage = async (wage: number): Promise<void> =>
  withEventWageLock(async () => {
    if (!wage || wage <= 0) return;
    try {
      const existing = await getRecentWages();
      const next = [wage, ...existing.filter(w => w !== wage)].slice(0, MAX_RECENT_WAGES);
      await AsyncStorage.setItem(RECENT_WAGES_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error('Error saving recent wage:', error);
    }
  });

// Drop `wage` from the recents list (e.g. long-press to delete a chip).
export const removeRecentWage = async (wage: number): Promise<void> =>
  withEventWageLock(async () => {
    try {
      const existing = await getRecentWages();
      const next = existing.filter(w => w !== wage);
      await AsyncStorage.setItem(RECENT_WAGES_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error('Error removing recent wage:', error);
    }
  });
