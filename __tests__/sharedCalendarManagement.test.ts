/**
 * @format
 *
 * The membership-management additions: a local notification when someone
 * else's change comes in through a sync (never for the first sync of a
 * freshly-joined calendar, never for the device's own changes, never when
 * muted), the mute toggle itself, and the kick/leave/invite-close RPCs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';

import {
  setShareCode, syncSharedCalendar, setMyName, getMe,
  isSharedCalendarMuted, setSharedCalendarMuted,
  isInviteClosed, setInviteClosed,
  kickMember, leaveSharedCalendar,
  getUnseenChangeCounts, clearUnseenChanges,
} from '../src/services/sharedCalendarService';
import {addLocalCalendar, getLocalCalendars} from '../src/services/localCalendarService';
import type {LocalCalendar, LocalEvent} from '../src/services/localCalendarService';

const CAL: LocalCalendar = {
  id: 'lc-1', name: 'サークル', color: '#007AFF', emoji: '🍻',
  createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
};
const ev = (id: string, title: string, updatedAt: string, creatorId?: string): LocalEvent => ({
  id, calendarId: 'lc-1', title,
  startDate: '2030-01-15', endDate: '2030-01-15', allDay: true,
  createdAt: updatedAt, updatedAt, ...(creatorId ? {creatorId} : {}),
});
const remoteRow = (id: string, title: string, updated_at: string, creator_id?: string, deleted = false) => ({
  id, title, start_date: '2030-01-15', end_date: '2030-01-15',
  all_day: true, start_time: null, end_time: null, memo: null, updated_at, deleted,
  ...(creator_id ? {creator_id} : {}),
});

let calls: Array<{fn: string; body: any}>;
const reply = (payload: any) => {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({fn: String(url).split('/rpc/')[1], body: JSON.parse(init.body)});
    return {ok: true, json: async () => payload} as any;
  });
};

const deps = (cal: LocalCalendar, events: LocalEvent[]) => {
  const state = {cal, events};
  return {
    state,
    io: {
      readCalendar: async () => state.cal,
      readEvents: async () => state.events,
      writeCalendar: async (c: LocalCalendar) => {state.cal = c;},
      writeEvents: async (l: LocalEvent[]) => {state.events = l;},
    },
  };
};

const withCursor = async (calendarId: string, iso: string) => {
  await AsyncStorage.setItem('@shared_calendar_cursors', JSON.stringify({[calendarId]: iso}));
};

beforeEach(async () => {
  await AsyncStorage.clear();
  calls = [];
  (notifee.displayNotification as jest.Mock).mockClear();
  await setShareCode('lc-1', 'a'.repeat(32));
});

describe('他のメンバーの変更を通知する', () => {
  it('前回同期後に他人が追加した予定は通知する', async () => {
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else')],
      now: '2030-02-01T00:00:00.000Z',
    });
    const {io} = deps(CAL, []);
    const result = await syncSharedCalendar('lc-1', io);

    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
    const args = (notifee.displayNotification as jest.Mock).mock.calls[0][0];
    expect(args.body).toContain('1');
    // The same diff drives LocalCalendarDetail's persistent "new" header
    // badge — the caller needs it back on the result, not just as a
    // side-effect notification.
    expect(result!.changedByOthers).toEqual({added: 1, updated: 0, deleted: 0});
  });

  it('自分自身の変更では通知しない', async () => {
    const me = await getMe(); // まだ無い
    void me;
    await setMyName('わたし');
    const myId = (await getMe())!.id;
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('b', '自分の予定', '2030-01-20T00:00:00.000Z', myId)],
      now: '2030-02-01T00:00:00.000Z',
    });
    const {io} = deps(CAL, []);
    await syncSharedCalendar('lc-1', io);

    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('参加した直後の初回同期では通知しない（全件が「新規」に見えて溢れるのを防ぐ）', async () => {
    // カーソルを立てていない = 初回。
    reply({
      calendar: null,
      events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else')],
      now: '2030-02-01T00:00:00.000Z',
    });
    const {io} = deps(CAL, []);
    await syncSharedCalendar('lc-1', io);

    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('ミュートしていれば通知しない', async () => {
    await setSharedCalendarMuted('lc-1', true);
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else')],
      now: '2030-02-01T00:00:00.000Z',
    });
    const {io} = deps(CAL, []);
    await syncSharedCalendar('lc-1', io);

    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('他人が削除した予定も通知する', async () => {
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('a', 'A', '2030-01-20T00:00:00.000Z', 'someone-else', true)],
      now: '2030-02-01T00:00:00.000Z',
    });
    const {io} = deps(CAL, [ev('a', 'A', '2030-01-10T00:00:00.000Z')]);
    await syncSharedCalendar('lc-1', io);

    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
  });
});

describe('新着バッジ(一覧画面用の永続化された未読数)', () => {
  it('他人の変更はミュートしていても未読数に積み上がる', async () => {
    await setSharedCalendarMuted('lc-1', true);
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else')],
      now: '2030-02-01T00:00:00.000Z',
    });
    await syncSharedCalendar('lc-1', deps(CAL, []).io);

    // ミュートは通知だけを止める — 一覧画面の未読バッジは別の関心事なので
    // 押し出し通知が出なくても未読数は積み上がる。
    expect(notifee.displayNotification).not.toHaveBeenCalled();
    expect(await getUnseenChangeCounts()).toEqual({'lc-1': 1});
  });

  it('詳細画面を開いた(clearUnseenChanges)後は消える', async () => {
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else')],
      now: '2030-02-01T00:00:00.000Z',
    });
    await syncSharedCalendar('lc-1', deps(CAL, []).io);
    expect(await getUnseenChangeCounts()).toEqual({'lc-1': 1});

    await clearUnseenChanges('lc-1');

    expect(await getUnseenChangeCounts()).toEqual({});
  });

  it('複数回の同期で未読数が積み上がる', async () => {
    await withCursor('lc-1', '2030-01-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else')],
      now: '2030-02-01T00:00:00.000Z',
    });
    await syncSharedCalendar('lc-1', deps(CAL, []).io);

    await withCursor('lc-1', '2030-02-01T00:00:00.000Z');
    reply({
      calendar: null,
      events: [
        remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z', 'someone-else'),
        remoteRow('c', '二次会', '2030-01-21T00:00:00.000Z', 'someone-else'),
      ],
      now: '2030-02-02T00:00:00.000Z',
    });
    await syncSharedCalendar('lc-1', deps(CAL, [ev('b', '打ち上げ', '2030-01-20T00:00:00.000Z')]).io);

    expect(await getUnseenChangeCounts()).toEqual({'lc-1': 2});
  });
});

describe('ミュート設定', () => {
  it('既定では通知が有効', async () => {
    expect(await isSharedCalendarMuted('lc-1')).toBe(false);
  });

  it('切り替えると保存され、他のカレンダーには影響しない', async () => {
    await setSharedCalendarMuted('lc-1', true);
    expect(await isSharedCalendarMuted('lc-1')).toBe(true);
    expect(await isSharedCalendarMuted('lc-2')).toBe(false);
    await setSharedCalendarMuted('lc-1', false);
    expect(await isSharedCalendarMuted('lc-1')).toBe(false);
  });
});

describe('招待の停止', () => {
  it('サーバのRPCを呼び、結果をローカルにキャッシュする', async () => {
    await setMyName('オーナー');
    reply({});
    await setInviteClosed('lc-1', true);

    expect(calls[0].fn).toBe('calendar_share_set_invite_closed');
    expect(calls[0].body.p_closed).toBe(true);
    expect(await isInviteClosed('lc-1')).toBe(true);
  });

  it('同期で返る calendar.invite_closed をキャッシュに反映する', async () => {
    reply({
      calendar: {name: 'サークル', color: '#007AFF', emoji: '🍻',
                 updated_at: '2030-03-01T00:00:00.000Z', deleted: false, invite_closed: true},
      events: [], now: '2030-03-02T00:00:00.000Z',
    });
    await syncSharedCalendar('lc-1', deps(CAL, []).io);

    expect(await isInviteClosed('lc-1')).toBe(true);
  });
});

describe('メンバー管理', () => {
  it('kickMember は calendar_share_kick_member を呼ぶ', async () => {
    await setMyName('オーナー');
    reply([{member_id: 'm2', name: '残る人', emoji: '', last_seen_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z', role: 'member'}]);
    await kickMember('lc-1', 'm-bad-actor');

    expect(calls[0].fn).toBe('calendar_share_kick_member');
    expect(calls[0].body.p_target_member_id).toBe('m-bad-actor');
  });

  it('leaveSharedCalendar はサーバに伝えたうえでローカルのカレンダーを消す', async () => {
    await setMyName('わたし');
    await addLocalCalendar('サークル', '#007AFF', '🍻');
    const [added] = await getLocalCalendars();
    await setShareCode(added.id, 'b'.repeat(32));
    reply({});

    await leaveSharedCalendar(added.id);

    expect(calls[0].fn).toBe('calendar_share_leave');
    const after = await getLocalCalendars();
    expect(after.find(c => c.id === added.id)).toBeUndefined();
  });
});
