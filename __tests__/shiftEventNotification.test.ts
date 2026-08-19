/**
 * @format
 *
 * Dragging an event has to take its reminder with it.
 *
 * The trigger is an absolute timestamp keyed by event id, so before this the
 * reminder stayed behind and fired at the moment the event used to be at —
 * and, once the body started naming the start time, said the wrong one too.
 */

import notifee from '@notifee/react-native';
import i18n from '../src/i18n/i18n';
import {shiftEventNotification} from '../src/services/notificationService';

const DAY = 24 * 60 * 60 * 1000;

const existing = (id: string, timestamp: number, repeatFrequency?: number) => [
  {notification: {id}, trigger: {type: 0, timestamp, repeatFrequency: repeatFrequency ?? null}},
];

const created = () => {
  const calls = (notifee.createTriggerNotification as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return {notification: calls[calls.length - 1][0], trigger: calls[calls.length - 1][1]};
};

describe('shiftEventNotification', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await i18n.changeLanguage('ja');
  });

  it('moves the reminder by the same delta as the event', async () => {
    const oldStart = new Date(2030, 0, 15, 18, 0);
    const oldFire = oldStart.getTime() - 15 * 60_000;   // 15分前
    (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue(
      existing('e1', oldFire),
    );

    const newStart = new Date(oldStart.getTime() + 2 * DAY);
    await shiftEventNotification({
      eventId: 'e1', title: 'バイト', deltaMs: 2 * DAY, newStartDate: newStart,
    });

    expect(notifee.cancelTriggerNotification).toHaveBeenCalledWith('e1');
    const {trigger, notification} = created();
    // Still 15 minutes before the start, two days later.
    expect(trigger.timestamp).toBe(newStart.getTime() - 15 * 60_000);
    expect(notification.body).toBe('18:00 開始');
  });

  it('keeps a repeating reminder repeating', async () => {
    const oldStart = new Date(2030, 0, 15, 18, 0);
    (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue(
      existing('e2', oldStart.getTime() - 15 * 60_000, 1),
    );

    await shiftEventNotification({
      eventId: 'e2', title: '週次', deltaMs: DAY,
      newStartDate: new Date(oldStart.getTime() + DAY),
    });

    expect(created().trigger.repeatFrequency).toBe(1);
  });

  it('does nothing for an event that has no reminder', async () => {
    (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue([]);

    await shiftEventNotification({
      eventId: 'e3', title: 'X', deltaMs: DAY, newStartDate: new Date(2030, 0, 16),
    });

    expect(notifee.cancelTriggerNotification).not.toHaveBeenCalled();
    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  it('drops a one-off dragged into the past instead of re-arming it', async () => {
    const future = Date.now() + 5 * DAY;
    (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue(
      existing('e4', future),
    );

    await shiftEventNotification({
      eventId: 'e4', title: 'X', deltaMs: -10 * DAY,
      newStartDate: new Date(Date.now() - 5 * DAY),
    });

    expect(notifee.cancelTriggerNotification).toHaveBeenCalledWith('e4');
    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  it('ignores a zero move', async () => {
    await shiftEventNotification({
      eventId: 'e5', title: 'X', deltaMs: 0, newStartDate: new Date(2030, 0, 15),
    });

    expect(notifee.getTriggerNotifications).not.toHaveBeenCalled();
  });
});
