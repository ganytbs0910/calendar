/**
 * @format
 *
 * Who actually delivers the reminder.
 *
 * When in-app notifications are on the app schedules through notifee and
 * deliberately leaves the calendar's own alarm off, to avoid a double ping.
 * But notifee accepts a schedule without OS permission and then delivers
 * nothing — so an app the user had declined used to drop the reminder on the
 * floor with no sign of it. The fallback below is what keeps a reminder a
 * reminder in that case.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import notifee from '@notifee/react-native';
import RNCalendarEvents from 'react-native-calendar-events';

import {AddEventModal} from '../src/components/AddEventModal';

jest.mock('react-native-calendar-events', () => ({
  // handleSave gates on calendar access before it writes anything.
  checkPermissions: jest.fn().mockResolvedValue('authorized'),
  requestPermissions: jest.fn().mockResolvedValue('authorized'),
  findCalendars: jest.fn().mockResolvedValue([
    {id: '1', title: 'Default', isPrimary: true, allowsModifications: true},
  ]),
  saveEvent: jest.fn().mockResolvedValue('event-id'),
  fetchAllEvents: jest.fn().mockResolvedValue([]),
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

// Freeze the clock, leaving timers real so async rendering still runs.
//
// The sheet defaults to the next o'clock, so a 15-minutes-before reminder is
// only in the future when the current minute is below 45 — this suite passed
// or failed depending on the time of day it was run. 09:00 puts the default
// 14:00 slot, and its reminder, safely ahead.
beforeAll(() => {
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
      'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
    ],
    now: new Date(2030, 0, 15, 9, 0, 0),
  });
});
afterAll(() => jest.useRealTimers());

// A successful save plays a 520ms animation that outlives the test and then
// touches Animated after the environment is gone. Nothing here is about the
// animation.
jest.mock('../src/components/SuccessOverlay', () => 'SuccessOverlay');

const AUTHORIZED = {authorizationStatus: 1};
const DENIED = {authorizationStatus: 0};

const saveWithReminder = async () => {
  let component!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    component = ReactTestRenderer.create(
      <AddEventModal visible onClose={jest.fn()} onEventAdded={jest.fn()} />,
    );
  });
  await ReactTestRenderer.act(async () => {
    component.root.findByProps({testID: 'reminder-chip--15'}).props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    component.root.findByProps({testID: 'save-event'}).props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    component.unmount();
  });
  return component;
};

const savedAlarms = () => {
  const calls = (RNCalendarEvents.saveEvent as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1].alarms;
};

describe('reminder delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (notifee.requestPermission as jest.Mock).mockResolvedValue(AUTHORIZED);
  });

  it('leaves the calendar alarm off when the app can deliver it', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(AUTHORIZED);

    await saveWithReminder();

    expect(savedAlarms()).toEqual([]);
    expect(notifee.createTriggerNotification).toHaveBeenCalled();
  });

  it('falls back to the calendar alarm when the OS has not authorised us', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(DENIED);
    (notifee.requestPermission as jest.Mock).mockResolvedValue(DENIED);

    await saveWithReminder();

    // The reminder still exists — it just comes from the calendar instead.
    expect(savedAlarms()).toEqual([{date: -15}]);
  });
});
