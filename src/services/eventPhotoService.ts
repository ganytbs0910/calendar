// ── ⑦ 写真ライフログ ────────────────────────────────────────────────────────
//
// Attach photos to events to turn the calendar into a life log. Photos are
// copied into the app's Documents sandbox (so they persist) and indexed by the
// EventKit event id. A lightweight count map lets the month view show a 📷 badge
// *before* you tap an event — so looking back, you can see at a glance which day
// held which event with photos. Fully on-device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

const KEY = '@event_photos';
const DIR = `${RNFS.DocumentDirectoryPath}/event_photos`;

export interface EventPhoto {
  uri: string; // file:// path inside the app sandbox
  addedAt: string;
}

type PhotoMap = Record<string, EventPhoto[]>;

// Serialize read-modify-write so concurrent add/remove can't clobber the map.
let writeChain: Promise<unknown> = Promise.resolve();
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

const loadMap = async (): Promise<PhotoMap> => {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PhotoMap;
  } catch {
    return {};
  }
};

const saveMap = async (map: PhotoMap): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
};

const ensureDir = async (): Promise<void> => {
  const exists = await RNFS.exists(DIR);
  if (!exists) await RNFS.mkdir(DIR);
};

const stripScheme = (uri: string): string => uri.replace(/^file:\/\//, '');

export const getEventPhotos = async (eventId: string): Promise<EventPhoto[]> => {
  const map = await loadMap();
  return map[eventId] ?? [];
};

/** eventId → photo count, for cheap month-view badges. */
export const getAllEventPhotoCounts = async (): Promise<Record<string, number>> => {
  const map = await loadMap();
  const counts: Record<string, number> = {};
  for (const id of Object.keys(map)) {
    const n = map[id]?.length ?? 0;
    if (n > 0) counts[id] = n;
  }
  return counts;
};

export interface EventPhotoEntry extends EventPhoto {
  eventId: string;
}

/** Every attached photo across all events, newest first — for the gallery tab. */
export const getAllEventPhotos = async (): Promise<EventPhotoEntry[]> => {
  const map = await loadMap();
  const all: EventPhotoEntry[] = [];
  for (const eventId of Object.keys(map)) {
    for (const p of map[eventId] ?? []) {
      all.push({...p, eventId});
    }
  }
  all.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
  return all;
};

/** Copy a picked image into the sandbox and attach it to the event. */
export const addEventPhoto = async (eventId: string, srcUri: string): Promise<EventPhoto[]> =>
  withLock(async () => {
    await ensureDir();
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
    const dest = `${DIR}/${filename}`;
    await RNFS.copyFile(stripScheme(srcUri), dest);
    const map = await loadMap();
    const list = map[eventId] ?? [];
    const photo: EventPhoto = {uri: `file://${dest}`, addedAt: new Date().toISOString()};
    map[eventId] = [...list, photo];
    await saveMap(map);
    return map[eventId];
  });

/** Detach a photo and delete its file. */
export const removeEventPhoto = async (eventId: string, uri: string): Promise<EventPhoto[]> =>
  withLock(async () => {
    const map = await loadMap();
    const list = map[eventId] ?? [];
    map[eventId] = list.filter(p => p.uri !== uri);
    if (map[eventId].length === 0) delete map[eventId];
    await saveMap(map);
    try {
      await RNFS.unlink(stripScheme(uri));
    } catch {
      // file may already be gone — ignore
    }
    return map[eventId] ?? [];
  });

/**
 * Move an event's photos to a different event id, leaving the files alone.
 *
 * Undoing a delete cannot restore the original event — the calendar hands back
 * a new id — so the photos have to follow it there. Copying via addEventPhoto
 * would duplicate every file, hence this re-key.
 */
export const reassignEventPhotos = async (fromId: string, toId: string): Promise<void> =>
  withLock(async () => {
    const map = await loadMap();
    const list = map[fromId];
    if (!list || list.length === 0) return;
    delete map[fromId];
    map[toId] = [...(map[toId] ?? []), ...list];
    await saveMap(map);
  });

/** When an event is deleted, drop its photos (and files). */
export const removeAllEventPhotos = async (eventId: string): Promise<void> =>
  withLock(async () => {
    const map = await loadMap();
    const list = map[eventId];
    if (!list) return;
    delete map[eventId];
    await saveMap(map);
    for (const p of list) {
      try {
        await RNFS.unlink(stripScheme(p.uri));
      } catch {
        // ignore
      }
    }
  });
