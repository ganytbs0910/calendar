// ── ローカルカレンダー（TimeTree風サブカレンダー）─────────────────────────────
//
// Lets the user create extra, fully on-device calendars (e.g. "プライベート",
// "推し活") that are SEPARATE from the main iCloud/EventKit calendar. Each local
// calendar owns its own events, stored in AsyncStorage — nothing here touches
// EventKit, so these never sync to the cloud or appear in the system Calendar.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CAL_KEY = '@local_calendars';
const EVT_KEY = '@local_calendar_events';

export interface LocalCalendar {
  id: string;
  name: string;
  color: string;
  emoji: string;
  createdAt: string;
}

export interface LocalEvent {
  id: string;
  calendarId: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (== startDate for single-day)
  allDay: boolean;
  startTime?: string; // HH:mm (when !allDay)
  endTime?: string; // HH:mm (when !allDay)
  memo?: string;
  createdAt: string;
}

type EventMap = Record<string, LocalEvent[]>; // calendarId -> events

const genId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Serialize read-modify-write so concurrent saves can't clobber the map.
let writeChain: Promise<unknown> = Promise.resolve();
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

// ── Calendars ────────────────────────────────────────────────────────────────

export const getLocalCalendars = async (): Promise<LocalCalendar[]> => {
  const raw = await AsyncStorage.getItem(CAL_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LocalCalendar[];
  } catch {
    return [];
  }
};

const writeCalendars = async (list: LocalCalendar[]): Promise<void> => {
  await AsyncStorage.setItem(CAL_KEY, JSON.stringify(list));
};

export const addLocalCalendar = async (
  name: string,
  color: string,
  emoji: string,
): Promise<LocalCalendar> =>
  withLock(async () => {
    const list = await getLocalCalendars();
    const cal: LocalCalendar = {
      id: genId('lc'),
      name: name.trim(),
      color,
      emoji,
      createdAt: new Date().toISOString(),
    };
    list.push(cal);
    await writeCalendars(list);
    return cal;
  });

export const updateLocalCalendar = async (
  id: string,
  patch: Partial<Pick<LocalCalendar, 'name' | 'color' | 'emoji'>>,
): Promise<void> =>
  withLock(async () => {
    const list = await getLocalCalendars();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return;
    list[idx] = {
      ...list[idx],
      ...(patch.name !== undefined ? {name: patch.name.trim()} : {}),
      ...(patch.color !== undefined ? {color: patch.color} : {}),
      ...(patch.emoji !== undefined ? {emoji: patch.emoji} : {}),
    };
    await writeCalendars(list);
  });

export const deleteLocalCalendar = async (id: string): Promise<void> =>
  withLock(async () => {
    const list = await getLocalCalendars();
    await writeCalendars(list.filter(c => c.id !== id));
    const map = await loadEventMap();
    if (map[id]) {
      delete map[id];
      await writeEventMap(map);
    }
  });

// ── Events ───────────────────────────────────────────────────────────────────

const loadEventMap = async (): Promise<EventMap> => {
  const raw = await AsyncStorage.getItem(EVT_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as EventMap;
  } catch {
    return {};
  }
};

const writeEventMap = async (map: EventMap): Promise<void> => {
  await AsyncStorage.setItem(EVT_KEY, JSON.stringify(map));
};

export const getLocalEvents = async (calendarId: string): Promise<LocalEvent[]> => {
  const map = await loadEventMap();
  return map[calendarId] ?? [];
};

/** calendarId -> event count, for the calendar list. */
export const getLocalEventCounts = async (): Promise<Record<string, number>> => {
  const map = await loadEventMap();
  const counts: Record<string, number> = {};
  for (const id of Object.keys(map)) counts[id] = map[id]?.length ?? 0;
  return counts;
};

/** Create (no id) or update (existing id) an event. Returns the saved event. */
export const saveLocalEvent = async (
  evt: Omit<LocalEvent, 'id' | 'createdAt'> & {id?: string; createdAt?: string},
): Promise<LocalEvent> =>
  withLock(async () => {
    const map = await loadEventMap();
    const list = map[evt.calendarId] ?? [];
    if (evt.id) {
      const idx = list.findIndex(e => e.id === evt.id);
      if (idx !== -1) {
        const saved: LocalEvent = {...list[idx], ...evt, id: evt.id} as LocalEvent;
        list[idx] = saved;
        map[evt.calendarId] = list;
        await writeEventMap(map);
        return saved;
      }
    }
    const saved: LocalEvent = {
      ...evt,
      id: genId('le'),
      createdAt: new Date().toISOString(),
    } as LocalEvent;
    map[evt.calendarId] = [...list, saved];
    await writeEventMap(map);
    return saved;
  });

export const deleteLocalEvent = async (
  calendarId: string,
  eventId: string,
): Promise<void> =>
  withLock(async () => {
    const map = await loadEventMap();
    const list = map[calendarId];
    if (!list) return;
    map[calendarId] = list.filter(e => e.id !== eventId);
    await writeEventMap(map);
  });
