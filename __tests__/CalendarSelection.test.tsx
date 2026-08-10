/**
 * Bulk-selection behaviour of the month grid.
 *
 * The real device could not be driven for this, so the interaction is exercised
 * through the component tree instead: what a tap on an event chip does, what a
 * tap on a day does while selecting, and how occurrences of a repeating series
 * are told apart.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TouchableOpacity} from 'react-native';
import {Calendar, eventOccurrenceKey} from '../src/components/Calendar';

const today = new Date();
const at = (day: number, hour: number) =>
  new Date(today.getFullYear(), today.getMonth(), day, hour, 0, 0).toISOString();

const CAL = {id: 'cal1', title: 'Personal', color: '#3B82F6', allowsModifications: true};

// Two plain events on the 10th, plus two occurrences of one weekly series.
const EVENTS = [
  {id: 'e1', title: 'Gym', startDate: at(10, 10), endDate: at(10, 11), calendar: CAL},
  {id: 'e2', title: 'Lunch', startDate: at(10, 12), endDate: at(10, 13), calendar: CAL},
  {
    id: 'r1', title: 'Shift', startDate: at(11, 9), endDate: at(11, 17),
    calendar: CAL, recurrence: 'weekly', occurrenceDate: at(11, 9),
  },
  {
    id: 'r1', title: 'Shift', startDate: at(18, 9), endDate: at(18, 17),
    calendar: CAL, recurrence: 'weekly', occurrenceDate: at(18, 9),
  },
];

jest.mock('react-native-calendar-events', () => ({
  requestPermissions: jest.fn().mockResolvedValue('authorized'),
  checkPermissions: jest.fn().mockResolvedValue('authorized'),
  findCalendars: jest.fn().mockResolvedValue([]),
  fetchAllEvents: jest.fn(() => Promise.resolve(require('./__eventFixture').EVENTS)),
}));
jest.mock('./__eventFixture', () => ({EVENTS: []}), {virtual: true});

// Feed the fixture in through the mock defined above.
const calendarEvents = require('react-native-calendar-events');
calendarEvents.fetchAllEvents.mockImplementation(() => Promise.resolve(EVENTS));

const render = async (props: Record<string, unknown>) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Calendar hasPermission {...props} />);
  });
  return tree;
};

/**
 * Every pressable that renders `label`.
 *
 * Found by locating the Text nodes and walking up to the enclosing pressable —
 * scanning every TouchableOpacity and re-walking its subtree for text is
 * quadratic over a 42-cell grid and takes minutes.
 */
const pressablesWithText = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const hits = tree.root.findAll(
    n => n.type === Text && String(n.props?.children ?? '').includes(label),
    {deep: true},
  );

  const found: ReactTestRenderer.ReactTestInstance[] = [];
  for (const hit of hits) {
    let node: ReactTestRenderer.ReactTestInstance | null = hit;
    while (node && node.type !== TouchableOpacity) {
      node = node.parent ?? null;
    }
    if (node && !found.includes(node)) found.push(node);
  }
  return found;
};

describe('eventOccurrenceKey', () => {
  it('separates occurrences that share an event id', () => {
    const [, , first, second] = EVENTS;
    expect(first.id).toBe(second.id);
    expect(eventOccurrenceKey(first as any)).not.toBe(eventOccurrenceKey(second as any));
  });

  it('is stable for the same occurrence', () => {
    expect(eventOccurrenceKey(EVENTS[0] as any)).toBe(eventOccurrenceKey({...EVENTS[0]} as any));
  });
});

describe('Calendar selection mode', () => {
  it('opens an event normally when not selecting', async () => {
    const onEventPress = jest.fn();
    const onToggle = jest.fn();
    const tree = await render({onEventPress, onToggleEventSelection: onToggle});

    const chip = pressablesWithText(tree, 'Gym').pop();
    expect(chip).toBeDefined();
    await ReactTestRenderer.act(async () => { chip!.props.onPress(); });

    expect(onEventPress).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('marks the event instead of opening it while selecting', async () => {
    const onEventPress = jest.fn();
    const onToggle = jest.fn();
    const tree = await render({
      selectionMode: true,
      selectedEventKeys: new Set<string>(),
      onEventPress,
      onToggleEventSelection: onToggle,
    });

    const chip = pressablesWithText(tree, 'Gym').pop();
    await ReactTestRenderer.act(async () => { chip!.props.onPress(); });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0][0].title).toBe('Gym');
    expect(onEventPress).not.toHaveBeenCalled();
  });

  it('reports the tapped occurrence, not just the series', async () => {
    const onToggle = jest.fn();
    const tree = await render({
      selectionMode: true,
      selectedEventKeys: new Set<string>(),
      onToggleEventSelection: onToggle,
    });

    const shifts = pressablesWithText(tree, 'Shift');
    expect(shifts.length).toBeGreaterThanOrEqual(2);

    await ReactTestRenderer.act(async () => { shifts[shifts.length - 1].props.onPress(); });

    const passed = onToggle.mock.calls[0][0];
    expect(passed.occurrenceDate).toBeDefined();
    // The key must pin the date, or selecting one week would select them all.
    expect(eventOccurrenceKey(passed)).toContain(passed.occurrenceDate);
  });

  it('suppresses the day-sheet tap while selecting', async () => {
    const onDateSelect = jest.fn();

    const normal = await render({onDateSelect});
    const dayCells = normal.root.findAll(
      n => typeof n.type !== 'string' && n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function',
      {deep: true},
    );
    expect(dayCells.length).toBeGreaterThan(0);

    const selecting = await render({
      onDateSelect,
      selectionMode: true,
      selectedEventKeys: new Set<string>(),
      onToggleEventSelection: jest.fn(),
    });
    const inertDays = selecting.root.findAll(
      n => typeof n.type !== 'string' && n.props?.accessibilityRole === 'button' && n.props?.onPress === undefined,
      {deep: true},
    );
    expect(inertDays.length).toBeGreaterThan(0);
  });

  it('fades what is not selected and badges what is', async () => {
    const selectedKey = eventOccurrenceKey(EVENTS[0] as any);
    const tree = await render({
      selectionMode: true,
      selectedEventKeys: new Set([selectedKey]),
      onToggleEventSelection: jest.fn(),
    });

    const flat = (s: unknown): Record<string, unknown> =>
      Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : (s && typeof s === 'object' ? s as any : {});

    const styleOf = (label: string) => flat(pressablesWithText(tree, label).pop()!.props.style);

    expect(styleOf('Gym').borderColor).toBe('#fff');
    expect(styleOf('Gym').opacity).toBeUndefined();
    expect(styleOf('Lunch').opacity).toBe(0.35);
  });
});
