/**
 * The month-grid event chip shows a small 🔔 badge when the event has a
 * reminder — either an OS calendar alarm (event.alarms) or an in-app notifee
 * trigger notification (keyed by event id). Neither path should show it when
 * there's no reminder at all.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import notifee from '@notifee/react-native';

import {Calendar} from '../src/components/Calendar';

const today = new Date();
const at = (day: number, hour: number) =>
  new Date(today.getFullYear(), today.getMonth(), day, hour, 0, 0).toISOString();

const CAL = {id: 'cal1', title: 'Personal', color: '#3B82F6', allowsModifications: true};

jest.mock('react-native-calendar-events', () => ({
  requestPermissions: jest.fn().mockResolvedValue('authorized'),
  checkPermissions: jest.fn().mockResolvedValue('authorized'),
  findCalendars: jest.fn().mockResolvedValue([]),
  fetchAllEvents: jest.fn(() => Promise.resolve(require('./__reminderFixture').EVENTS)),
}));
jest.mock('./__reminderFixture', () => ({EVENTS: []}), {virtual: true});

const calendarEvents = require('react-native-calendar-events');

const render = async (events: unknown[]) => {
  calendarEvents.fetchAllEvents.mockImplementation(() => Promise.resolve(events));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Calendar hasPermission />);
  });
  // Flush the async getEventIdsWithTriggerNotifications()/getAllEventPhotoCounts() .then() chains.
  await ReactTestRenderer.act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return tree;
};

const hasReminderBadge = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => (n.type as unknown) === 'Ionicons' && n.props.name === 'notifications', {deep: true}).length > 0;

beforeEach(() => {
  (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue([]);
});

test('shows the badge for an event with an OS calendar alarm', async () => {
  const tree = await render([
    {id: 'e1', title: 'Gym', startDate: at(10, 10), endDate: at(10, 11), calendar: CAL, alarms: [{date: -30}]},
  ]);
  expect(hasReminderBadge(tree)).toBe(true);
});

test('shows the badge for an event with an in-app trigger notification', async () => {
  (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue([
    {notification: {id: 'e1'}, trigger: {}},
  ]);
  const tree = await render([
    {id: 'e1', title: 'Gym', startDate: at(10, 10), endDate: at(10, 11), calendar: CAL},
  ]);
  expect(hasReminderBadge(tree)).toBe(true);
});

test('shows no badge for an event with neither kind of reminder', async () => {
  const tree = await render([
    {id: 'e1', title: 'Gym', startDate: at(10, 10), endDate: at(10, 11), calendar: CAL},
  ]);
  expect(hasReminderBadge(tree)).toBe(false);
});
