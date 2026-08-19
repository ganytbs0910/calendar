/**
 * @format
 *
 * What the reminder banner actually says.
 *
 * The body used to be a single space, so a reminder arrived as the event name
 * over a blank line — it told you something was coming but not when.
 */

import notifee from '@notifee/react-native';
import i18n from '../src/i18n/i18n';
import {scheduleEventNotification} from '../src/services/notificationService';

const lastNotification = () => {
  const calls = (notifee.createTriggerNotification as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
};

// Far enough ahead that the scheduler never treats these as already past —
// a one-off whose moment has gone is dropped, not scheduled.
const FUTURE_YEAR = 2030;

describe('reminder notification body', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await i18n.changeLanguage('ja');
  });

  it('carries the event start time', async () => {
    const start = new Date(FUTURE_YEAR, 0, 15, 18, 0);
    await scheduleEventNotification({
      eventId: 'e1',
      title: 'バイト',
      fireDate: new Date(start.getTime() - 15 * 60_000),
      startDate: start,
    });

    const n = lastNotification();
    expect(n.title).toBe('バイト');
    expect(n.body).toBe('18:00 開始');
  });

  it('zero-pads to match how the rest of the app prints a time', async () => {
    const start = new Date(FUTURE_YEAR, 0, 15, 9, 5);
    await scheduleEventNotification({
      eventId: 'e2',
      title: '朝会',
      fireDate: new Date(start.getTime() - 5 * 60_000),
      startDate: start,
    });

    expect(lastNotification().body).toBe('09:05 開始');
  });

  it('follows the selected language', async () => {
    await i18n.changeLanguage('en');
    const start = new Date(FUTURE_YEAR, 0, 15, 18, 0);
    await scheduleEventNotification({
      eventId: 'e3',
      title: 'Shift',
      fireDate: new Date(start.getTime() - 15 * 60_000),
      startDate: start,
    });

    expect(lastNotification().body).toBe('Starts at 18:00');
  });

  it('falls back to a blank body when no start time is given', async () => {
    const start = new Date(FUTURE_YEAR, 0, 15, 18, 0);
    await scheduleEventNotification({
      eventId: 'e4',
      title: 'X',
      fireDate: new Date(start.getTime() - 15 * 60_000),
    });

    expect(lastNotification().body).toBe(' ');
  });
});
