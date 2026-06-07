/**
 * In-app local notifications backed by notifee.
 *
 * Why in-app notifications when the OS calendar already alarms?
 *   - Branded delivery (our app name shows in the banner, not "Calendar")
 *   - Works even if the user disables system Calendar notifications
 *   - Gives us a single in-app toggle the user controls
 *
 * To avoid double-firing, we suppress OS calendar alarms when these are
 * enabled (see AddEventModal save flow).
 *
 * The notifee notification id mirrors the OS calendar event id so we can
 * cancel by event id on delete/update.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  RepeatFrequency,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';
import {Platform} from 'react-native';

const CHANNEL_ID = 'event-reminders';
const ENABLED_KEY = '@notifications_enabled';
const SOUND_KEY = '@notifications_sound_enabled';

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

let channelRegistered = false;

export const isNotificationsEnabled = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(ENABLED_KEY);
  // Default: enabled.
  return raw === null ? true : raw === '1';
};

export const setNotificationsEnabled = async (enabled: boolean): Promise<void> => {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  if (!enabled) {
    await cancelAllEventNotifications();
  }
};

export const isSoundEnabled = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(SOUND_KEY);
  return raw === null ? true : raw === '1';
};

export const setSoundEnabled = async (enabled: boolean): Promise<void> => {
  await AsyncStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
};

const ensureChannel = async (): Promise<void> => {
  if (channelRegistered || Platform.OS !== 'android') {
    channelRegistered = true;
    return;
  }
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Event reminders',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
  channelRegistered = true;
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  await ensureChannel();
  const result = await notifee.requestPermission();
  return (
    result.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    result.authorizationStatus === AuthorizationStatus.PROVISIONAL
  );
};

export const hasNotificationPermission = async (): Promise<boolean> => {
  const settings = await notifee.getNotificationSettings();
  return (
    settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
  );
};

const recurrenceToFrequency = (r: Recurrence): RepeatFrequency | undefined => {
  switch (r) {
    case 'daily':
      return RepeatFrequency.DAILY;
    case 'weekly':
      return RepeatFrequency.WEEKLY;
    // Monthly isn't natively supported; we just schedule the first occurrence.
    default:
      return undefined;
  }
};

export interface ScheduleEventNotificationParams {
  eventId: string;
  title: string;
  fireDate: Date;
  recurrence?: Recurrence;
}

export const scheduleEventNotification = async (
  params: ScheduleEventNotificationParams,
): Promise<void> => {
  const enabled = await isNotificationsEnabled();
  if (!enabled) return;

  // Don't schedule in the past.
  if (params.fireDate.getTime() <= Date.now()) return;

  await ensureChannel();
  const sound = await isSoundEnabled();

  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: params.fireDate.getTime(),
    alarmManager: Platform.OS === 'android' ? {allowWhileIdle: true} : undefined,
  };
  const freq = params.recurrence ? recurrenceToFrequency(params.recurrence) : undefined;
  if (freq !== undefined) {
    trigger.repeatFrequency = freq;
  }

  await notifee.createTriggerNotification(
    {
      id: params.eventId,
      title: params.title || ' ',
      body: ' ',
      android: {
        channelId: CHANNEL_ID,
        pressAction: {id: 'default'},
        smallIcon: 'ic_launcher',
        sound: sound ? 'default' : undefined,
      },
      ios: {
        sound: sound ? 'default' : undefined,
      },
    },
    trigger,
  );
};

export const cancelEventNotification = async (eventId: string): Promise<void> => {
  try {
    await notifee.cancelTriggerNotification(eventId);
  } catch {
    // Notification may not exist — that's fine.
  }
};

export const cancelAllEventNotifications = async (): Promise<void> => {
  try {
    await notifee.cancelTriggerNotifications();
  } catch {
    // ignore
  }
};

/**
 * Remove any scheduled (non-recurring) trigger notifications whose fire time
 * has already passed. Useful on app launch to clean up entries left behind
 * by system clock changes or notifications the OS failed to deliver.
 * Returns the number of notifications cancelled.
 */
export const cleanupExpiredEventNotifications = async (): Promise<number> => {
  try {
    const triggers = await notifee.getTriggerNotifications();
    const now = Date.now();
    let cancelled = 0;
    for (const entry of triggers) {
      const trigger: any = (entry as any).trigger;
      if (!trigger || trigger.type !== TriggerType.TIMESTAMP) continue;
      // Leave repeating notifications alone — they roll forward on their own.
      if (trigger.repeatFrequency !== undefined && trigger.repeatFrequency !== null) continue;
      if (typeof trigger.timestamp === 'number' && trigger.timestamp <= now) {
        const id = entry.notification.id;
        if (id) {
          await notifee.cancelTriggerNotification(id).catch(() => {});
          cancelled += 1;
        }
      }
    }
    return cancelled;
  } catch {
    return 0;
  }
};

export const sendTestNotification = async (): Promise<void> => {
  await ensureChannel();
  const sound = await isSoundEnabled();
  await notifee.displayNotification({
    title: 'Test',
    body: 'Notifications are working.',
    android: {
      channelId: CHANNEL_ID,
      pressAction: {id: 'default'},
      smallIcon: 'ic_launcher',
      sound: sound ? 'default' : undefined,
    },
    ios: {
      sound: sound ? 'default' : undefined,
    },
  });
};
