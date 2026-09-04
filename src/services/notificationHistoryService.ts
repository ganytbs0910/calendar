/**
 * A browsable log of past in-app notifications (currently: shared-calendar
 * change alerts from notificationService.ts's displaySharedCalendarChangeNotification).
 * notifee only handles OS-level display — nothing about a shown notification
 * was persisted anywhere before this, so there was no way to see one again
 * once its banner disappeared.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@notification_history_v1';
const MAX_ENTRIES = 100;

export interface NotificationHistoryEntry {
  id: string;
  title: string;
  body: string;
  /** For a future "tap to open the calendar" — not read by the list UI yet. */
  calendarId?: string;
  createdAt: string; // ISO
  read: boolean;
}

const load = async (): Promise<NotificationHistoryEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NotificationHistoryEntry[]) : [];
  } catch {
    return [];
  }
};

const save = async (entries: NotificationHistoryEntry[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

// Serialize read-modify-write — shared calendars can sync (and notify)
// concurrently, and two unlocked writes here would let one clobber the other.
let writeChain: Promise<unknown> = Promise.resolve();
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

export const addNotificationHistoryEntry = async (
  input: {title: string; body: string; calendarId?: string},
): Promise<void> =>
  withLock(async () => {
    const all = await load();
    all.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      body: input.body,
      calendarId: input.calendarId,
      createdAt: new Date().toISOString(),
      read: false,
    });
    if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
    await save(all);
  });

/** Newest first — already stored in that order. */
export const getNotificationHistory = async (): Promise<NotificationHistoryEntry[]> => load();

export const getUnreadNotificationCount = async (): Promise<number> =>
  (await load()).filter(e => !e.read).length;

export const markAllNotificationsRead = async (): Promise<void> =>
  withLock(async () => {
    const all = await load();
    if (all.every(e => e.read)) return;
    await save(all.map(e => (e.read ? e : {...e, read: true})));
  });

export const clearNotificationHistory = async (): Promise<void> =>
  withLock(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
  });
