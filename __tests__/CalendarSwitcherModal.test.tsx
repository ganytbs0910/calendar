/**
 * Tapping the title in LocalCalendarDetail opens this picker so the user can
 * jump to another of their calendars without navigating back to the list.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TouchableOpacity} from 'react-native';

import CalendarSwitcherModal from '../src/components/localcal/CalendarSwitcherModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string, opts?: any) => opts?.defaultValue ?? key}),
}));

const CALENDARS = [
  {id: 'a', name: 'プライベート', color: '#3B82F6', emoji: '🏠', createdAt: '2030-01-01', updatedAt: '2030-01-01'},
  {id: 'b', name: '推し活', color: '#FF2D55', emoji: '✨', createdAt: '2030-01-01', updatedAt: '2030-01-01'},
];

const render = async (currentCalendarId: string, onSelect = jest.fn(), onClose = jest.fn()) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CalendarSwitcherModal visible calendars={CALENDARS as any} currentCalendarId={currentCalendarId} onClose={onClose} onSelect={onSelect} />,
    );
  });
  return {tree, onSelect, onClose};
};

const rowFor = (tree: ReactTestRenderer.ReactTestRenderer, name: string) => {
  const hit = tree.root.findAll(n => n.type === Text && n.props.children === name, {deep: true})[0];
  let node: ReactTestRenderer.ReactTestInstance | null = hit;
  while (node && node.type !== TouchableOpacity) node = node.parent ?? null;
  return node;
};

test('選んだカレンダーで onSelect が呼ばれ、閉じる', async () => {
  const {tree, onSelect, onClose} = await render('a');
  const row = rowFor(tree, '推し活');
  await ReactTestRenderer.act(async () => { row!.props.onPress(); });

  expect(onSelect).toHaveBeenCalledWith('b');
  expect(onClose).toHaveBeenCalled();
});

test('現在開いているカレンダーの行は押しても何も起きない', async () => {
  const {tree, onSelect, onClose} = await render('a');
  const row = rowFor(tree, 'プライベート');

  expect(row!.props.disabled).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
