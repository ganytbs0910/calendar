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
//   @event_photos        The map is small, but the images it points at are
//                        files under Documents, and inlining them as base64
//                        would turn a settings backup into tens of megabytes
//                        built in memory on a phone. Restoring the map without
//                        the files would leave every photo a broken reference,
//                        which is worse than not restoring it. Photos need
//                        their own path — see the note in the settings row.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const BACKUP_VERSION = 1;
/** Marks a file as ours, so a JSON from somewhere else is refused politely. */
export const BACKUP_MAGIC = 'ideal-calendar-backup';

export interface Backup {
  magic: string;
  version: number;
  /** ISO timestamp, for showing the user what they are about to restore. */
  createdAt: string;
  data: Record<string, string>;
}

const EXCLUDED_EXACT = new Set([
  '@is_premium',
  '@lock_pin_hash',
  '@lock_pin_salt',
  '@event_photos',
]);

const EXCLUDED_PREFIXES = ['@dev_'];

export const isBackedUp = (key: string): boolean =>
  key.startsWith('@') &&
  !EXCLUDED_EXACT.has(key) &&
  !EXCLUDED_PREFIXES.some(p => key.startsWith(p));

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
  return {magic: BACKUP_MAGIC, version: BACKUP_VERSION, createdAt: now.toISOString(), data};
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
    // must not be able to grant premium or install a lock secret.
    if (typeof value === 'string' && isBackedUp(key)) data[key] = value;
  }
  if (Object.keys(data).length === 0) return {ok: false, reason: 'empty'};

  return {
    ok: true,
    backup: {
      magic: BACKUP_MAGIC,
      version: candidate.version,
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
      data,
    },
  };
};

/**
 * Replace the backed-up keys with the file's.
 *
 * Keys the file doesn't mention are cleared, so restoring gives the state the
 * backup described rather than that state merged with whatever this phone had
 * — a merge would leave, say, a job the user deleted before backing up. The
 * excluded keys are untouched: the purchase and the lock stay as they are on
 * this device.
 */
export const restoreBackup = async (backup: Backup): Promise<number> => {
  const existing = (await AsyncStorage.getAllKeys()).filter(isBackedUp);
  const incoming = Object.keys(backup.data);
  const stale = existing.filter(k => !incoming.includes(k));

  if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  await AsyncStorage.multiSet(incoming.map(k => [k, backup.data[k]] as [string, string]));
  return incoming.length;
};

/** `ideal-calendar-backup-2026-08-14.json` */
export const backupFileName = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${BACKUP_MAGIC}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
};
