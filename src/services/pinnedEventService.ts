/**
 * Tracks user-pinned event IDs.
 *
 * Calendar events live in the OS calendar (no native pin concept), so we
 * mirror the user's pinned state in AsyncStorage. The pinned state is purely
 * a UI affordance — it bumps an event to the top of the bottom-sheet schedule
 * column and shows a pin glyph.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@pinned_event_ids';

let cache: Set<string> | null = null;

const load = async (): Promise<Set<string>> => {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    cache = new Set();
    return cache;
  }
  try {
    const arr = JSON.parse(raw) as string[];
    cache = new Set(arr);
  } catch {
    cache = new Set();
  }
  return cache;
};

const persist = async (set: Set<string>): Promise<void> => {
  cache = set;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
};

export const getPinnedEventIds = async (): Promise<Set<string>> => {
  return load();
};

export const isEventPinned = async (id: string): Promise<boolean> => {
  const set = await load();
  return set.has(id);
};

export const togglePinnedEvent = async (id: string): Promise<boolean> => {
  const set = await load();
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  await persist(set);
  return set.has(id);
};
