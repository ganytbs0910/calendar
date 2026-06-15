/**
 * Records events created via AddEventModal so they can be reused with one tap.
 *
 * Entries are merged by a signature of (title + duration + color + reminder +
 * recurrence) so identical creations bump a usage counter rather than spawning
 * a new row. Sort order is usage count desc, then last-used desc, so frequent
 * creations float to the top.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@event_history_v1';
const MAX_ENTRIES = 100;

export interface EventHistoryEntry {
  id: string;
  title: string;
  durationMinutes: number;
  color: string;
  reminder: number | null;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  // Payroll context so a バイト preset restores its job / wage exactly.
  jobId?: string | null;
  hourlyWage?: number | null;
  count: number;
  lastUsedAt: string; // ISO
}

export type EventHistoryInput = Omit<EventHistoryEntry, 'id' | 'count' | 'lastUsedAt'>;

const signature = (e: EventHistoryInput): string =>
  [e.title.trim(), e.durationMinutes, e.color, e.reminder ?? 'none', e.recurrence, e.jobId ?? '', e.hourlyWage ?? ''].join('|');

const load = async (): Promise<EventHistoryEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EventHistoryEntry[]) : [];
  } catch {
    return [];
  }
};

const save = async (entries: EventHistoryEntry[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

// Serialize read-modify-write so two concurrent mutations (e.g. a double-tapped
// save) don't clobber each other's update — each runs against the prior result.
let writeChain: Promise<unknown> = Promise.resolve();
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

export const recordEventCreation = async (input: EventHistoryInput): Promise<void> =>
  withLock(async () => {
    if (!input.title || !input.title.trim()) return;
    const trimmed: EventHistoryInput = {...input, title: input.title.trim()};
    const sig = signature(trimmed);
    const all = await load();
    const now = new Date().toISOString();
    const existing = all.find(e => signature(e) === sig);
    if (existing) {
      existing.count += 1;
      existing.lastUsedAt = now;
    } else {
      all.push({
        ...trimmed,
        id: Date.now().toString(),
        count: 1,
        lastUsedAt: now,
      });
    }
    // Prune lowest-priority entries beyond the cap.
    if (all.length > MAX_ENTRIES) {
      all.sort((a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt));
      all.length = MAX_ENTRIES;
    }
    await save(all);
  });

export const getEventHistory = async (): Promise<EventHistoryEntry[]> => {
  const all = await load();
  return all.sort((a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt));
};

export const deleteEventHistoryEntry = async (id: string): Promise<void> =>
  withLock(async () => {
    const all = await load();
    await save(all.filter(e => e.id !== id));
  });

export const clearEventHistory = async (): Promise<void> => {
  await AsyncStorage.removeItem(STORAGE_KEY);
};
