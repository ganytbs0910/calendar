import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@sleep_settings';
// Set when the user dismisses the first-run setup with "later". Without it the
// prompt has no memory and reappears on every launch, which is what makes an
// otherwise skippable modal feel mandatory.
const DEFERRED_KEY = '@sleep_settings_deferred';

export interface DayTimeSetting {
  wakeUpHour: number;   // 0-23
  wakeUpMinute: number;  // 0-59
  sleepHour: number;     // 0-24 (24 = midnight, end of day)
  sleepMinute: number;   // 0-59
}

export interface SleepSettings {
  weekday: DayTimeSetting;
  weekend: DayTimeSetting;
}

const DEFAULT_WEEKDAY: DayTimeSetting = {
  wakeUpHour: 7, wakeUpMinute: 0, sleepHour: 23, sleepMinute: 0,
};

const DEFAULT_WEEKEND: DayTimeSetting = {
  wakeUpHour: 8, wakeUpMinute: 0, sleepHour: 24, sleepMinute: 0,
};

export const getDefaultSettings = (): SleepSettings => ({
  weekday: {...DEFAULT_WEEKDAY},
  weekend: {...DEFAULT_WEEKEND},
});

/**
 * Migrate old flat format to new weekday/weekend format.
 */
const migrate = (data: any): SleepSettings | null => {
  if (data && data.weekday && data.weekend) {
    return data as SleepSettings;
  }
  // Old flat format
  if (data && typeof data.wakeUpHour === 'number') {
    const day: DayTimeSetting = {
      wakeUpHour: data.wakeUpHour,
      wakeUpMinute: data.wakeUpMinute ?? 0,
      sleepHour: data.sleepHour,
      sleepMinute: data.sleepMinute ?? 0,
    };
    return {weekday: {...day}, weekend: {...day}};
  }
  return null;
};

export const getSleepSettings = async (): Promise<SleepSettings | null> => {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (json) {
      return migrate(JSON.parse(json));
    }
    return null;
  } catch {
    return null;
  }
};

export const saveSleepSettings = async (settings: SleepSettings): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Save failed silently
  }
};

/** True once the user has dismissed the first-run setup with "later". */
export const isSleepSetupDeferred = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(DEFERRED_KEY)) === '1';
  } catch {
    // Treat a read failure as "not deferred" — worst case the user sees the
    // prompt once more, which beats silently losing the feature.
    return false;
  }
};

export const deferSleepSetup = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(DEFERRED_KEY, '1');
  } catch {
    // Save failed silently
  }
};

/** Get the setting for a specific date (weekday or weekend). */
export const getSettingsForDate = (settings: SleepSettings, date: Date): DayTimeSetting => {
  const day = date.getDay();
  return (day === 0 || day === 6) ? settings.weekend : settings.weekday;
};

/** Get the setting for today. */
export const getTodaySettings = (settings: SleepSettings): DayTimeSetting => {
  return getSettingsForDate(settings, new Date());
};

/** Get display range that covers both weekday and weekend. */
export const getDisplayRange = (settings: SleepSettings): {startHour: number; endHour: number} => {
  const startHour = Math.min(settings.weekday.wakeUpHour, settings.weekend.wakeUpHour);
  const endHour = Math.max(settings.weekday.sleepHour, settings.weekend.sleepHour);
  return {startHour, endHour};
};

/**
 * NOTE: "remaining active minutes" used to live here and read the clock itself.
 * It disagreed with the rest of the app before the wake time — it reported zero
 * for someone up at 5am with a 7am alarm, who in fact has the whole day ahead.
 * The single definition now lives in freeTimeService.getAwakeWindow.
 */
