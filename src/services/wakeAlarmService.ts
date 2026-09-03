/**
 * Wake alarm: a call-screen-style full-screen notification for events flagged
 * `mustWake`, for the local/shared calendars only (see LocalEvent.mustWake).
 *
 * Android-only for now. It rings through silent/DND mode by using its own
 * "wake-alarm" notification channel (AudioAttributes.USAGE_ALARM — not
 * settable from notifee's JS API, so WakeAlarmModule creates it natively) and
 * bypasses notifee entirely for posting: WakeAlarmModule schedules the fire
 * via AlarmManager, and WakeAlarmReceiver posts a plain NotificationCompat
 * notification with setFullScreenIntent pointing at WakeAlarmActivity. That
 * keeps the launch intent's extras (eventId/title) ones this app controls,
 * rather than depending on notifee's own undocumented full-screen-action
 * serialization.
 *
 * iOS needs CallKit + a server-triggered VoIP push instead (a local trigger
 * can't bypass the mute switch on iOS), which lands in a later change.
 *
 * Kept fully separate from notificationService.ts's regular in-app reminders
 * (different channel, different scheduling path), so both can fire for the
 * same event without colliding.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';

const {WakeAlarmModule} = NativeModules;
const SCHEDULE_KEY = '@wake_alarm_schedule';

let channelReady = false;

const ensureChannel = async (): Promise<void> => {
  if (channelReady || Platform.OS !== 'android') {
    channelReady = true;
    return;
  }
  await WakeAlarmModule?.ensureChannel();
  channelReady = true;
};

/** Android 14+ can withhold this permission; callers should fall back to a
 * plain high-priority notification when it comes back false. */
export const canUseFullScreenIntent = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !WakeAlarmModule) return true;
  try {
    return await WakeAlarmModule.canUseFullScreenIntent();
  } catch {
    return true;
  }
};

type ScheduleMap = Record<string, number>; // eventId -> fire timestamp (ms)

const loadSchedule = async (): Promise<ScheduleMap> => {
  const raw = await AsyncStorage.getItem(SCHEDULE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const saveSchedule = async (map: ScheduleMap): Promise<void> => {
  await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(map));
};

export interface ScheduleWakeAlarmParams {
  eventId: string;
  title: string;
  fireDate: Date;
}

export const scheduleWakeAlarm = async (params: ScheduleWakeAlarmParams): Promise<void> => {
  if (Platform.OS !== 'android') return; // iOS lands with CallKit/PushKit later
  if (params.fireDate.getTime() <= Date.now()) return;
  await ensureChannel();

  await WakeAlarmModule.scheduleWakeAlarm(params.eventId, params.title, params.fireDate.getTime());

  const schedule = await loadSchedule();
  schedule[params.eventId] = params.fireDate.getTime();
  await saveSchedule(schedule);
};

export const cancelWakeAlarm = async (eventId: string): Promise<void> => {
  if (Platform.OS !== 'android') return;
  try {
    await WakeAlarmModule?.cancelWakeAlarm(eventId);
  } catch {
    // Alarm may not exist — that's fine.
  }
  const schedule = await loadSchedule();
  if (schedule[eventId] !== undefined) {
    delete schedule[eventId];
    await saveSchedule(schedule);
  }
};

/** Mirrors shiftEventNotification: moves the alarm by the same delta the
 * event itself moved, so it keeps its distance from the new start time. */
export const shiftWakeAlarm = async (params: {
  eventId: string;
  title: string;
  deltaMs: number;
}): Promise<void> => {
  if (Platform.OS !== 'android' || !params.eventId || !params.deltaMs) return;
  const schedule = await loadSchedule();
  const timestamp = schedule[params.eventId];
  if (timestamp === undefined) return; // no wake alarm scheduled for this event

  await cancelWakeAlarm(params.eventId);
  const fireDate = new Date(timestamp + params.deltaMs);
  if (fireDate.getTime() <= Date.now()) return;
  await scheduleWakeAlarm({eventId: params.eventId, title: params.title, fireDate});
};

/** Drop any past-due entries left behind by a fired (or missed) alarm. Mirrors
 * cleanupExpiredEventNotifications; call once at app launch. */
export const cleanupExpiredWakeAlarms = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  const schedule = await loadSchedule();
  const now = Date.now();
  let changed = false;
  for (const [eventId, timestamp] of Object.entries(schedule)) {
    if (timestamp <= now) {
      delete schedule[eventId];
      changed = true;
    }
  }
  if (changed) await saveSchedule(schedule);
};

interface WakeAlarmEventPayload {
  eventId: string;
  title: string;
}

/**
 * Wires up WakeAlarmActivity's "起きた"/"あと5分" buttons, which fire these
 * DeviceEventEmitter events from native code. Call once at app startup.
 */
export const initWakeAlarmListeners = (onAnswer: (eventId: string) => void): void => {
  if (Platform.OS !== 'android') return;

  DeviceEventEmitter.addListener('WakeAlarmAnswered', ({eventId}: WakeAlarmEventPayload) => {
    cancelWakeAlarm(eventId).catch(() => {});
    onAnswer(eventId);
  });

  DeviceEventEmitter.addListener('WakeAlarmSnoozed', ({eventId, title}: WakeAlarmEventPayload) => {
    cancelWakeAlarm(eventId)
      .then(() => scheduleWakeAlarm({eventId, title, fireDate: new Date(Date.now() + 5 * 60_000)}))
      .catch(() => {});
  });
};
