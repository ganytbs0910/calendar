/**
 * @format
 *
 * Choosing a reminder is the moment the user says they want to be notified,
 * so it is where the app asks the OS — and, if that is refused, points at
 * Settings rather than silently doing nothing.
 */

import React from 'react';
import {Alert, Linking} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import notifee from '@notifee/react-native';

import {AddEventModal} from '../src/components/AddEventModal';

jest.mock('react-native-calendar-events', () => ({
  findCalendars: jest.fn().mockResolvedValue([
    {id: '1', title: 'Default', isPrimary: true, allowsModifications: true},
  ]),
  saveEvent: jest.fn().mockResolvedValue('event-id'),
  fetchAllEvents: jest.fn().mockResolvedValue([]),
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const AUTHORIZED = {authorizationStatus: 1};
const DENIED = {authorizationStatus: 0};

const render = async () => {
  let component!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    component = ReactTestRenderer.create(
      <AddEventModal visible onClose={jest.fn()} onEventAdded={jest.fn()} />,
    );
  });
  return component;
};

const pressReminder = async (
  component: ReactTestRenderer.ReactTestRenderer,
  value: number | null,
) => {
  await ReactTestRenderer.act(async () => {
    component.root.findByProps({testID: `reminder-chip-${value}`}).props.onPress();
  });
};

describe('reminder permission prompt', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'openSettings').mockImplementation(async () => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('asks the OS when permission is missing', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(DENIED);
    (notifee.requestPermission as jest.Mock).mockResolvedValue(AUTHORIZED);

    const component = await render();
    await pressReminder(component, -15);

    expect(notifee.requestPermission).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();   // granted — nothing to nag about
  });

  it('points at Settings when the OS refuses', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(DENIED);
    (notifee.requestPermission as jest.Mock).mockResolvedValue(DENIED);

    const component = await render();
    await pressReminder(component, -15);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as Array<{onPress?: () => void}>;
    buttons[buttons.length - 1].onPress?.();
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('stays quiet when permission is already granted', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(AUTHORIZED);

    const component = await render();
    await pressReminder(component, -15);

    expect(notifee.requestPermission).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not ask when the reminder is turned off', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(DENIED);
    (notifee.requestPermission as jest.Mock).mockResolvedValue(DENIED);

    const component = await render();
    await pressReminder(component, null);   // 「なし」

    expect(notifee.requestPermission).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('asks once per opening, not once per chip', async () => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue(DENIED);
    (notifee.requestPermission as jest.Mock).mockResolvedValue(DENIED);

    const component = await render();
    await pressReminder(component, -5);
    await pressReminder(component, -15);
    await pressReminder(component, -30);

    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});
