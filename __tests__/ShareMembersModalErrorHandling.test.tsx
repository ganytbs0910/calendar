/**
 * Owner/admin actions in the shared-calendar sheet (invite-close toggle,
 * kick, leave, role change) used to collapse every non-2xx RPC response into
 * the same "check your connection" alert — including a legitimate
 * `unauthorized member` rejection caused by this device's member row never
 * having had its secret hash backfilled. That's now surfaced as a specific
 * message, and retried once (after a resync) before giving up, since a
 * resync is exactly what backfills the hash.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Alert, Switch} from 'react-native';

import ShareMembersModal from '../src/components/localcal/ShareMembersModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('../src/services/sharedCalendarService', () => {
  const actual = jest.requireActual('../src/services/sharedCalendarService');
  return {
    SharedRpcError: actual.SharedRpcError,
    getMe: jest.fn().mockResolvedValue({id: 'me', name: 'オーナー', auto: false}),
    getMembers: jest.fn().mockResolvedValue([
      {id: 'me', name: 'オーナー', emoji: '', lastSeenAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z', isMe: true, role: 'owner'},
    ]),
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
  };
});

import {SharedRpcError, setInviteClosed, syncCalendar} from '../src/services/sharedCalendarService';

const CAL = {id: 'cal-1', name: 'Family', color: '#3B82F6'} as any;

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ShareMembersModal visible calendar={CAL} onClose={() => {}} />,
    );
  });
  return tree;
};

beforeEach(() => jest.clearAllMocks());

test('招待停止で unauthorized member が返ったら、一度同期し直して自動で再試行する', async () => {
  (setInviteClosed as jest.Mock)
    .mockRejectedValueOnce(new SharedRpcError('unauthorized member'))
    .mockResolvedValueOnce(undefined);
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const tree = await render();
  const toggle = tree.root.findAllByType(Switch)[0]; // 招待の受け付けトグル(オーナーのみ表示)

  await ReactTestRenderer.act(async () => {
    await toggle.props.onValueChange(false); // 「新しい参加を受け付ける」をオフに
  });

  expect(setInviteClosed).toHaveBeenCalledTimes(2);
  expect(syncCalendar).toHaveBeenCalledWith('cal-1');
  expect(alertSpy).not.toHaveBeenCalled(); // 再試行で成功したのでエラーは出ない

  alertSpy.mockRestore();
});

test('再試行しても失敗する権限エラーは、通信エラーではなく具体的な理由を出す', async () => {
  (setInviteClosed as jest.Mock).mockRejectedValue(new SharedRpcError('forbidden'));
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const tree = await render();
  const toggle = tree.root.findAllByType(Switch)[0];

  await ReactTestRenderer.act(async () => {
    await toggle.props.onValueChange(false);
  });

  expect(alertSpy).toHaveBeenCalledWith('shareInviteClosedErrorTitle', 'shareErrorForbidden');

  alertSpy.mockRestore();
});
