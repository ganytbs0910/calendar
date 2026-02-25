import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@sleep_settings';

export interface DayTimeSetting {
  wakeUpHour: number;   // 0-23
  wakeUpMinute: number;  // 0-59
  sleepHour: number;     // 0-23
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

/** Calculate remaining active minutes from now until sleep time. */
export const getRemainingActiveMinutes = (day: DayTimeSetting): number => {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sleepMin = day.sleepHour * 60 + day.sleepMinute;
  const wakeMin = day.wakeUpHour * 60 + day.wakeUpMinute;

  if (sleepMin > wakeMin) {
    if (nowMin < wakeMin || nowMin >= sleepMin) return 0;
    return sleepMin - nowMin;
  } else {
    if (nowMin >= sleepMin && nowMin < wakeMin) return 0;
    if (nowMin >= wakeMin) return (24 * 60 - nowMin) + sleepMin;
    return sleepMin - nowMin;
  }
};
