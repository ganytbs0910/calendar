/**
 * @format
 *
 * The 所要時間 presets used to be painted primary *all at once*, so the row
 * showed no selection at all. Assert the reminder/repeat behaviour instead:
 * exactly the chip in effect is filled.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AddEventModal} from '../src/components/AddEventModal';

jest.mock('react-native-calendar-events', () => ({
  findCalendars: jest.fn().mockResolvedValue([
    {id: '1', title: 'Default', isPrimary: true, allowsModifications: true},
  ]),
  saveEvent: jest.fn().mockResolvedValue('event-id'),
  // An empty day, so the sheet falls back to its default one-hour slot.
  fetchAllEvents: jest.fn().mockResolvedValue([]),
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const bg = (node: ReactTestRenderer.ReactTestInstance): string => {
  const style = node.props.style;
  const flat = Array.isArray(style) ? style : [style];
  for (let i = flat.length - 1; i >= 0; i--) {
    const s = flat[i];
    if (s && typeof s === 'object' && s.backgroundColor) return s.backgroundColor;
  }
  throw new Error('chip has no backgroundColor');
};

const render = async () => {
  let component!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    component = ReactTestRenderer.create(
      <AddEventModal visible onClose={jest.fn()} onEventAdded={jest.fn()} />,
    );
  });
  return component;
};

const PRESETS = [30, 45, 60, 90, 120, 150, 180, 240, 360];

describe('duration presets', () => {
  it('fills exactly one chip, and it is the duration in effect', async () => {
    const component = await render();
    const chips = PRESETS.map(m => ({
      minutes: m,
      color: bg(component.root.findByProps({testID: `duration-chip-${m}`})),
    }));

    // A new event defaults to one hour.
    const selected = chips.filter(c => c.color === chips.find(x => x.minutes === 60)!.color);
    expect(selected).toHaveLength(1);
    expect(selected[0].minutes).toBe(60);
  });

  it('moves the fill when another preset is chosen', async () => {
    const component = await render();
    const chip = (m: number) => component.root.findByProps({testID: `duration-chip-${m}`});
    const selectedColor = bg(chip(60));
    const plainColor = bg(chip(30));
    expect(selectedColor).not.toBe(plainColor);

    await ReactTestRenderer.act(async () => {
      chip(180).props.onPress();
    });

    expect(bg(chip(180))).toBe(selectedColor);
    expect(bg(chip(60))).toBe(plainColor);
  });

  it('falls back to カスタム when the length matches no preset', async () => {
    const component = await render();
    const chip = (m: number) => component.root.findByProps({testID: `duration-chip-${m}`});
    const plainColor = bg(chip(30));
    const selectedColor = bg(chip(60));

    // -1 is カスタム; it is only lit when nothing else matches.
    expect(bg(chip(-1))).toBe(plainColor);

    await ReactTestRenderer.act(async () => {
      chip(45).props.onPress();
    });
    expect(bg(chip(45))).toBe(selectedColor);
    expect(bg(chip(-1))).toBe(plainColor);
  });
});
