/**
 * The "my name" field in the shared-calendar sheet.
 *
 * Tapping the row to rename used to pre-fill the input with the literal
 * auto-generated placeholder string ("名前未設定") whenever the member
 * hadn't picked a name yet, forcing the user to delete it before typing
 * anything. It must open empty in that case, and still pre-fill with the
 * real name once one has been set.
 *
 * There is also no longer a save button — a save button on a single-line
 * name field just adds a step people forget, and forgetting it used to
 * silently discard the edit. Typing now auto-saves after a short pause, and
 * leaving the field (blur or the keyboard's "done") always commits whatever
 * is there.
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
  setMyName: jest.fn().mockResolvedValue(undefined),
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

import {getMe, setMyName} from '../src/services/sharedCalendarService';

const CAL = {id: 'cal-1', name: 'Family', color: '#3B82F6'} as any;

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

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

const openEditor = async (tree: ReactTestRenderer.ReactTestRenderer, currentLabel: string) => {
  const row = tree.root.findAll(
    n => n.type === TouchableOpacity && Array.isArray(n.props.children) && n.props.children[0]?.props?.children,
  ).find(n => {
    const child = n.props.children[0].props.children;
    return child === currentLabel || (typeof child === 'string' && child.includes?.(currentLabel));
  });
  expect(row).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    row!.props.onPress();
  });
  return tree.root.findByType(TextInput);
};

test('tapping the name row opens an empty field when the current name is auto-generated', async () => {
  const tree = await render({name: '名前未設定', auto: true});
  const input = await openEditor(tree, '名前未設定');
  expect(input.props.value).toBe('');
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});

test('tapping the name row pre-fills the real name once one has been set', async () => {
  const tree = await render({name: 'かなこ', auto: false});
  const input = await openEditor(tree, 'かなこ');
  expect(input.props.value).toBe('かなこ');
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});

test('there is no save button — typing alone eventually saves', async () => {
  const tree = await render({name: '名前未設定', auto: true});
  const input = await openEditor(tree, '名前未設定');

  expect(tree.root.findAllByProps({children: 'save'}).length).toBe(0);

  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('しおり');
  });
  expect(setMyName).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(700);
  });
  expect(setMyName).toHaveBeenCalledWith('しおり');

  await ReactTestRenderer.act(async () => { tree.unmount(); });
});

test('further typing resets the auto-save timer instead of saving every keystroke', async () => {
  const tree = await render({name: '名前未設定', auto: true});
  const input = await openEditor(tree, '名前未設定');

  await ReactTestRenderer.act(async () => { input.props.onChangeText('し'); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(400); });
  await ReactTestRenderer.act(async () => { input.props.onChangeText('しお'); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(400); });
  expect(setMyName).not.toHaveBeenCalled(); // 700ms never elapsed without a keystroke

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(300); });
  expect(setMyName).toHaveBeenCalledWith('しお');
  expect(setMyName).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => { tree.unmount(); });
});

test('leaving the field (blur) commits immediately without waiting for the debounce', async () => {
  const tree = await render({name: '名前未設定', auto: true});
  const input = await openEditor(tree, '名前未設定');

  await ReactTestRenderer.act(async () => { input.props.onChangeText('ばん'); });
  await ReactTestRenderer.act(async () => { await input.props.onBlur(); });

  expect(setMyName).toHaveBeenCalledWith('ばん');
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});

test('leaving an empty field saves nothing and does not alert', async () => {
  const tree = await render({name: 'かなこ', auto: false});
  const input = await openEditor(tree, 'かなこ');

  await ReactTestRenderer.act(async () => { input.props.onChangeText('  '); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(700); });
  await ReactTestRenderer.act(async () => { await input.props.onBlur(); });

  expect(setMyName).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});
