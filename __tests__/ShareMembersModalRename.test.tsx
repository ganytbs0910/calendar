/**
 * Tapping the "my name" row to rename used to pre-fill the input with the
 * literal auto-generated placeholder string ("名前未設定") whenever the
 * member hadn't picked a name yet, forcing the user to delete it before
 * typing anything. It must open empty in that case, and still pre-fill with
 * the real name once one has been set.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {TextInput, TouchableOpacity} from 'react-native';

import ShareMembersModal from '../src/components/localcal/ShareMembersModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('../src/services/sharedCalendarService', () => ({
  getMe: jest.fn(),
  getMembers: jest.fn().mockResolvedValue([]),
  setMyName: jest.fn(),
  setMyColor: jest.fn(),
  MEMBER_COLORS: ['#007AFF'],
  shareLocalCalendar: jest.fn(),
  sortMembers: (list: unknown[]) => list,
  syncCalendar: jest.fn().mockResolvedValue(undefined),
  setSharedMemberRole: jest.fn(),
  kickMember: jest.fn(),
  leaveSharedCalendar: jest.fn(),
  isInviteClosed: jest.fn().mockResolvedValue(false),
  setInviteClosed: jest.fn(),
  isSharedCalendarMuted: jest.fn().mockResolvedValue(false),
  setSharedCalendarMuted: jest.fn(),
}));

import {getMe} from '../src/services/sharedCalendarService';

const CAL = {id: 'cal-1', name: 'Family', color: '#3B82F6'} as any;

const render = async (me: {name: string; auto?: boolean} | null) => {
  (getMe as jest.Mock).mockResolvedValue(me);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ShareMembersModal visible calendar={CAL} onClose={() => {}} />,
    );
  });
  return tree;
};

test('tapping the name row opens an empty field when the current name is auto-generated', async () => {
  const tree = await render({name: '名前未設定', auto: true});

  const row = tree.root.findAll(
    n => n.type === TouchableOpacity && Array.isArray(n.props.children) && n.props.children[0]?.props?.children,
  ).find(n => (n.props.children[0].props.children ?? '').includes?.('名前未設定') || n.props.children[0].props.children === 'shareNameUnset');

  expect(row).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    row!.props.onPress();
  });

  const input = tree.root.findByType(TextInput);
  expect(input.props.value).toBe('');
});

test('tapping the name row pre-fills the real name once one has been set', async () => {
  const tree = await render({name: 'かなこ', auto: false});

  const row = tree.root.findAll(
    n => n.type === TouchableOpacity && Array.isArray(n.props.children) && n.props.children[0]?.props?.children,
  ).find(n => n.props.children[0].props.children === 'かなこ');

  expect(row).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    row!.props.onPress();
  });

  const input = tree.root.findByType(TextInput);
  expect(input.props.value).toBe('かなこ');
});
