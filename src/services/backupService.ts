// ── backupService — everything this app knows, in one file ──────────────────
//
// The calendar events themselves live in EventKit and travel with the phone.
// Everything the app adds on top does not: colours, wages, jobs, tasks, the
// on-device sub-calendars, templates, the rhythm. Forty-odd AsyncStorage keys
// with no export of any kind, so changing phones silently lost all of it.
//
// One JSON file, written out and read back in.
//
// What is deliberately NOT in it:
//
//   @is_premium          A purchase is not data the user owns a copy of. If it
//                        rode along in a hand-editable file, unlocking premium
//                        would be a text edit. Restoring a purchase is the
//                        store's job, and the paywall already offers it.
//   @lock_pin_hash       The lock exists to keep someone out of this phone. A
//   @lock_pin_salt       backup is a file that leaves the phone, so its secret
//                        should not be in it. The restored device asks again.
//   @dev_*               Seeding bookkeeping for development builds.
//   @event_photos        Carried, but not through the generic key copy: the
//                        map points at files under Documents, and a map without
//                        its files restores as a wall of broken references. The
//                        images ride along as base64 under `photos`, up to a
//                        budget — see PHOTO_BUDGET_BYTES. Past that the backup
//                        is still written, without them, and says so, because a
//                        phone building a 200MB string is a phone that crashes.

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

export const BACKUP_VERSION = 2;

/**
 * How much photo data one backup will carry. Base64 inflates by a third, and
 * the whole file is held in memory while it is serialised, so this is the
 * ceiling on a string this device has to build in one piece.
 */
export const PHOTO_BUDGET_BYTES = 10 * 1024 * 1024;

const PHOTO_MAP_KEY = '@event_photos';
const PHOTO_DIR = `${RNFS.DocumentDirectoryPath}/event_photos`;
/** Marks a file as ours, so a JSON from somewhere else is refused politely. */
export const BACKUP_MAGIC = 'ideal-calendar-backup';

export interface Backup {
  magic: string;
  version: number;
  /** ISO timestamp, for showing the user what they are about to restore. */
  createdAt: string;
  data: Record<string, string>;
  /** file name → base64 contents. Absent when nothing was attached. */
  photos?: Record<string, string>;
  /** True when photos existed but did not fit the budget. */
  photosOmitted?: boolean;
}

// @event_photos is excluded from the generic copy on purpose: it is handled
// alongside the image files, so the map and the files can never be restored
// independently of one another.
const EXCLUDED_EXACT = new Set([
  '@is_premium',
  '@lock_pin_hash',
  '@lock_pin_salt',
  PHOTO_MAP_KEY,
]);

const EXCLUDED_PREFIXES = ['@dev_'];

export const isBackedUp = (key: string): boolean =>
  key.startsWith('@') &&
  !EXCLUDED_EXACT.has(key) &&
  !EXCLUDED_PREFIXES.some(p => key.startsWith(p));

/** A photo's file name, which is how the map and the files are matched up. */
const fileNameOf = (uri: string): string => uri.split('/').pop() ?? '';

/**
 * Read the attached images, newest first, until the budget runs out.
 *
 * Newest first because if a user is over the budget, the recent months are the
 * ones they would miss. Returns `omitted` when anything had to be left behind,
 * so the caller can say so rather than let the user discover it on the new
 * phone.
 */
const collectPhotos = async (
  photoMapRaw: string | null,
): Promise<{photos: Record<string, string>; omitted: boolean}> => {
  if (!photoMapRaw) return {photos: {}, omitted: false};

  let entries: {uri: string; addedAt: string}[] = [];
  try {
    const map = JSON.parse(photoMapRaw) as Record<string, {uri: string; addedAt: string}[]>;
    entries = Object.values(map).flat();
  } catch {
    return {photos: {}, omitted: false};
  }
  entries.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  const photos: Record<string, string> = {};
  let used = 0;
  let omitted = false;
  for (const entry of entries) {
    const name = fileNameOf(entry.uri);
    if (!name || photos[name]) continue;
    const path = `${PHOTO_DIR}/${name}`;
    try {
      const stat = await RNFS.stat(path);
      const size = Number(stat.size) || 0;
      if (used + size > PHOTO_BUDGET_BYTES) {
        omitted = true;
        continue;
      }
      photos[name] = await RNFS.readFile(path, 'base64');
      used += size;
    } catch {
      // The map can outlive its file. Nothing to carry, nothing to report.
    }
  }
  return {photos, omitted};
};

/** Collect everything worth carrying to another phone. */
export const createBackup = async (now: Date = new Date()): Promise<Backup> => {
  const keys = (await AsyncStorage.getAllKeys()).filter(isBackedUp);
  const pairs = await AsyncStorage.multiGet(keys);
  const data: Record<string, string> = {};
  for (const [key, value] of pairs) {
    // A key can disappear between the listing and the read; skip rather than
    // write a null into the file and fail validation on the way back in.
    if (typeof value === 'string') data[key] = value;
  }

  // The photo map travels with its files or not at all, so it is added here
  // rather than through the generic copy above.
  const photoMapRaw = await AsyncStorage.getItem(PHOTO_MAP_KEY);
  const {photos, omitted} = await collectPhotos(photoMapRaw);
  if (photoMapRaw && Object.keys(photos).length > 0) {
    data[PHOTO_MAP_KEY] = photoMapRaw;
  }

  const backup: Backup = {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    data,
  };
  if (Object.keys(photos).length > 0) backup.photos = photos;
  if (omitted) backup.photosOmitted = true;
  return backup;
};

export const serializeBackup = (backup: Backup): string =>
  JSON.stringify(backup, null, 2);

export type ParseResult =
  | {ok: true; backup: Backup}
  | {ok: false; reason: 'unreadable' | 'foreign' | 'tooNew' | 'empty'};

/**
 * Parse without trusting anything. A restore overwrites the user's current
 * state, so a malformed file has to be refused before that happens, not
 * half-applied and then discovered.
 */
export const parseBackup = (raw: string): ParseResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {ok: false, reason: 'unreadable'};
  }
  if (typeof parsed !== 'object' || parsed === null) return {ok: false, reason: 'unreadable'};

  const candidate = parsed as Partial<Backup>;
  if (candidate.magic !== BACKUP_MAGIC) return {ok: false, reason: 'foreign'};
  if (typeof candidate.version !== 'number') return {ok: false, reason: 'foreign'};
  // A file from a future version may use keys this build would mishandle.
  if (candidate.version > BACKUP_VERSION) return {ok: false, reason: 'tooNew'};
  if (typeof candidate.data !== 'object' || candidate.data === null) {
    return {ok: false, reason: 'unreadable'};
  }

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate.data)) {
    // Re-apply the exclusion list on the way in as well: a hand-edited file
    // must not be able to grant premium or install a lock secret. The photo
    // map is allowed through explicitly, since it is paired with the files.
    if (typeof value !== 'string') continue;
    if (isBackedUp(key) || key === PHOTO_MAP_KEY) data[key] = value;
  }
  if (Object.keys(data).length === 0) return {ok: false, reason: 'empty'};

  const photos: Record<string, string> = {};
  if (typeof candidate.photos === 'object' && candidate.photos !== null) {
    for (const [name, b64] of Object.entries(candidate.photos)) {
      // A file name only; anything with a separator could write outside the
      // photo directory when restored.
      if (typeof b64 === 'string' && name && !name.includes('/') && !name.includes('..')) {
        photos[name] = b64;
      }
    }
  }

  const backup: Backup = {
    magic: BACKUP_MAGIC,
    version: candidate.version,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    data,
  };
  if (Object.keys(photos).length > 0) backup.photos = photos;
  return {ok: true, backup};
};

/**
 * Replace the backed-up keys with the file's.
 *
 * Keys the file doesn't mention are cleared, so restoring gives the state the
 * backup described rather than that state merged with whatever this phone had
 * — a merge would leave, say, a job the user deleted before backing up. The
 * excluded keys are untouched: the purchase and the lock stay as they are on
 * this device.
 *
 * Photos are the one deliberate exception to "replace". They are only ever
 * added, never cleared, because the alternative is deleting someone's pictures
 * on the strength of a backup that happened not to carry any — for instance one
 * written when the images were over the size budget. Being left with a photo
 * the backup didn't describe is recoverable; losing one is not.
 */
export const restoreBackup = async (backup: Backup): Promise<number> => {
  const existing = (await AsyncStorage.getAllKeys()).filter(isBackedUp);
  const incoming = Object.keys(backup.data);
  const stale = existing.filter(k => !incoming.includes(k));

  if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  await AsyncStorage.multiSet(incoming.map(k => [k, backup.data[k]] as [string, string]));

  // Files first, then the map that points at them: written the other way round,
  // an interrupted restore leaves a map referring to images that are not there.
  if (backup.photos) {
    await RNFS.mkdir(PHOTO_DIR).catch(() => {});
    for (const [name, b64] of Object.entries(backup.photos)) {
      await RNFS.writeFile(`${PHOTO_DIR}/${name}`, b64, 'base64').catch(() => {});
    }
  }
  const photoMap = backup.data[PHOTO_MAP_KEY];
  if (photoMap) await rewritePhotoMap(photoMap);

  return incoming.length;
};

/**
 * The stored map holds absolute paths, and the sandbox path changes on every
 * install — the same photo lives at a different absolute path on the new phone.
 * Rewriting each entry against this device's directory is what makes a restored
 * photo actually open.
 */
const rewritePhotoMap = async (raw: string): Promise<void> => {
  try {
    const map = JSON.parse(raw) as Record<string, {uri: string; addedAt: string}[]>;
    for (const list of Object.values(map)) {
      for (const photo of list) {
        photo.uri = `file://${PHOTO_DIR}/${fileNameOf(photo.uri)}`;
      }
    }
    await AsyncStorage.setItem(PHOTO_MAP_KEY, JSON.stringify(map));
  } catch {
    // Unparseable map: leave whatever multiSet already wrote.
  }
};

/** `ideal-calendar-backup-2026-08-14.json` */
export const backupFileName = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${BACKUP_MAGIC}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
};
