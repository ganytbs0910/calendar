import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@user_calendars';
const SEEDED_FLAG_KEY = '@user_calendars_seeded';

export interface UserCalendar {
  id: string;
  /** Translation key for default-provided calendars; falls back to literal `name` if absent. */
  nameKey?: string;
  /** Literal name for user-added or renamed calendars. Wins over nameKey when present. */
  name?: string;
  color: string;
}

/**
 * Default calendar set seeded on first run, mirroring the existing color-label
 * map so users start with familiar categories rather than an empty list.
 */
const DEFAULTS: UserCalendar[] = [
  {id: 'default-work', nameKey: 'colorWork', color: '#007AFF'},
  {id: 'default-important', nameKey: 'colorImportant', color: '#FF3B30'},
  {id: 'default-fun', nameKey: 'colorFun', color: '#34C759'},
  {id: 'default-other', nameKey: 'colorOther', color: '#FFCC00'},
  {id: 'default-promise', nameKey: 'colorPromise', color: '#FF9500'},
  {id: 'default-hobby', nameKey: 'colorHobby', color: '#AF52DE'},
  {id: 'default-schedule', nameKey: 'colorSchedule', color: '#FF2D92'},
];

const generateId = (): string =>
  'uc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

export const getUserCalendars = async (): Promise<UserCalendar[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as UserCalendar[];
  } catch {
    return [];
  }
};

const writeAll = async (list: UserCalendar[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

/** Seed the defaults on first launch only. Safe to call repeatedly. */
export const ensureDefaultsSeeded = async (): Promise<UserCalendar[]> => {
  const flag = await AsyncStorage.getItem(SEEDED_FLAG_KEY);
  if (flag === '1') {
    return getUserCalendars();
  }
  const existing = await getUserCalendars();
  if (existing.length === 0) {
    await writeAll(DEFAULTS);
  }
  await AsyncStorage.setItem(SEEDED_FLAG_KEY, '1');
  return getUserCalendars();
};

export const addUserCalendar = async (
  name: string,
  color: string,
): Promise<UserCalendar> => {
  const list = await getUserCalendars();
  const newCal: UserCalendar = {
    id: generateId(),
    name: name.trim(),
    color,
  };
  list.push(newCal);
  await writeAll(list);
  return newCal;
};

export const updateUserCalendar = async (
  id: string,
  patch: Partial<Pick<UserCalendar, 'name' | 'color'>>,
): Promise<void> => {
  const list = await getUserCalendars();
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return;
  // When the user renames a default, drop the i18n key so the literal name wins.
  if (patch.name !== undefined) {
    list[idx] = {...list[idx], name: patch.name.trim(), nameKey: undefined};
  }
  if (patch.color !== undefined) {
    list[idx] = {...list[idx], color: patch.color};
  }
  await writeAll(list);
};

export const deleteUserCalendar = async (id: string): Promise<void> => {
  const list = await getUserCalendars();
  await writeAll(list.filter(c => c.id !== id));
};

/** Render-time name resolution. */
export const resolveCalendarName = (
  cal: UserCalendar,
  t: (key: string) => string,
): string => {
  if (cal.name && cal.name.length > 0) return cal.name;
  if (cal.nameKey) return t(cal.nameKey);
  return '';
};
