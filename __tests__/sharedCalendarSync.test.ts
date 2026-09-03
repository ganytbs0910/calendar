/**
 * @format
 *
 * 一往復の流れ。ネットワークは fetch を差し替えて、RPC に何を送り、返ってきた
 * ものをどう取り込むかだけを見る。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  setShareCode, getCursor, syncSharedCalendar,
  getMembers, setMyName, sortMembers, fromRemoteMember,
  markSharedEventDirty,
} from '../src/services/sharedCalendarService';
import type {LocalCalendar, LocalEvent} from '../src/services/localCalendarService';

const CAL: LocalCalendar = {
  id: 'lc-1', name: 'サークル', color: '#007AFF', emoji: '🍻',
  createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
};
const ev = (id: string, title: string, updatedAt: string): LocalEvent => ({
  id, calendarId: 'lc-1', title,
  startDate: '2030-01-15', endDate: '2030-01-15', allDay: true,
  createdAt: updatedAt, updatedAt,
});

const remoteRow = (id: string, title: string, updated_at: string, deleted = false) => ({
  id, title, start_date: '2030-01-15', end_date: '2030-01-15',
  all_day: true, start_time: null, end_time: null, memo: null, updated_at, deleted,
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

describe('共有カレンダーの一往復', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    calls = [];
    await setShareCode('lc-1', 'a'.repeat(32));
  });

  it('共有していないカレンダーは何もしない', async () => {
    await AsyncStorage.clear();
    reply({});
    const {io} = deps(CAL, []);
    expect(await syncSharedCalendar('lc-1', io)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('端末時計がサーバより遅くても送信待ちの編集は失わない', async () => {
    await AsyncStorage.setItem('@shared_calendar_cursors', JSON.stringify({'lc-1':'2040-01-01T00:00:00.000Z'}));
    const oldClockEdit = ev('behind-clock', 'offline edit', '2030-01-10T00:00:00.000Z');
    await markSharedEventDirty('lc-1', oldClockEdit.id);
    reply({calendar:null,events:[],members:[],now:'2040-01-02T00:00:00.000Z'});
    const {io}=deps(CAL,[oldClockEdit]);
    await syncSharedCalendar('lc-1',io);
    expect(calls[0].fn).toBe('calendar_share_push');
    expect(calls[0].body.p_events.map((event: LocalEvent)=>event.id)).toContain('behind-clock');
  });

  it('初回は全部送る', async () => {
    reply({calendar: null, events: [], now: '2030-02-01T00:00:00.000Z'});
    const {io} = deps(CAL, [ev('a', 'A', '2030-01-10T00:00:00.000Z')]);
    const r = await syncSharedCalendar('lc-1', io);
    expect(calls[0].fn).toBe('calendar_share_push');
    expect(calls[0].body.p_events).toHaveLength(1);
    expect(r!.pushed).toBe(1);
  });

  it('前回以降に変更が無ければ push ではなく pull する', async () => {
    reply({calendar: null, events: [], now: '2030-02-02T00:00:00.000Z'});
    await syncSharedCalendar('lc-1', deps(CAL, []).io);   // 1回目でカーソルが立つ
    calls = [];
    reply({calendar: null, events: [], now: '2030-02-03T00:00:00.000Z'});
    await syncSharedCalendar('lc-1', deps(CAL, []).io);
    expect(calls[0].fn).toBe('calendar_share_pull');
  });

  it('相手の予定を取り込む', async () => {
    reply({calendar: null,
           events: [remoteRow('b', '打ち上げ', '2030-01-20T00:00:00.000Z')],
           now: '2030-02-01T00:00:00.000Z'});
    const {state, io} = deps(CAL, [ev('a', 'A', '2030-01-10T00:00:00.000Z')]);
    await syncSharedCalendar('lc-1', io);
    expect(state.events.map(e => e.id).sort()).toEqual(['a', 'b']);
    expect(state.events.find(e => e.id === 'b')!.calendarId).toBe('lc-1');
  });

  it('相手が消した予定は削除済みとして取り込む', async () => {
    reply({calendar: null,
           events: [remoteRow('a', 'A', '2030-01-20T00:00:00.000Z', true)],
           now: '2030-02-01T00:00:00.000Z'});
    const {state, io} = deps(CAL, [ev('a', 'A', '2030-01-10T00:00:00.000Z')]);
    await syncSharedCalendar('lc-1', io);
    expect(state.events[0].deleted).toBe(true);
  });

  it('カーソルは端末の時計ではなくサーバが返した時刻を使う', async () => {
    reply({calendar: null, events: [], now: '2031-06-06T06:06:06.000Z'});
    await syncSharedCalendar('lc-1', deps(CAL, []).io);
    expect(await getCursor('lc-1')).toBe('2031-06-06T06:06:06.000Z');
  });

  it('カレンダー名の変更も取り込む', async () => {
    reply({calendar: {name: '打ち上げ係', color: '#FF0000', emoji: '🎉',
                      updated_at: '2030-03-01T00:00:00.000Z', deleted: false},
           events: [], now: '2030-03-02T00:00:00.000Z'});
    const {state, io} = deps(CAL, []);
    await syncSharedCalendar('lc-1', io);
    expect(state.cal.name).toBe('打ち上げ係');
    expect(state.cal.id).toBe('lc-1');   // ローカルの id は保つ
  });

  // 200件は1回の push の上限。かつて超過分を slice で捨てていて、しかも
  // カーソルだけは進んでいたので、201件目以降は二度と送られなかった。
  // 手元には見えているぶん、相手に見えていないと言われるまで気づけない。
  it('上限を超える予定は分けて全部送る', async () => {
    const many = Array.from({length: 450}, (_, i) =>
      ev(`e${i}`, `予定${i}`, '2030-01-02T00:00:00.000Z'));
    reply({calendar: null, events: [], now: '2030-02-01T00:00:00.000Z'});
    const d = deps(CAL, many);

    await syncSharedCalendar('lc-1', d.io);

    const pushes = calls.filter(c => c.fn === 'calendar_share_push');
    expect(pushes.map(p => p.body.p_events.length)).toEqual([200, 200, 50]);
    // 全件が過不足なく載っている
    const sent = pushes.flatMap(p => p.body.p_events.map((e: any) => e.id));
    expect(new Set(sent).size).toBe(450);
    // カレンダー本体は最初の1回だけ
    expect(pushes.map(p => p.body.p_calendar === null)).toEqual([false, true, true]);
    expect(await getCursor('lc-1')).toBe('2030-02-01T00:00:00.000Z');
  });

  // 共有カレンダーを消す＝自分が抜ける、であって、相手の予定を消すことでは
  // ない。deleteLocalCalendar は中の予定にも削除印を付けるので、消したあとに
  // 一度でも push されると全員のデータが消える。読み出しが削除済みを弾く
  // ことでそれを防いでいる。壊れても手元では気づけない種類の事故なので、
  // 振る舞いとして固定しておく。
  it('消したカレンダーは同期の対象にならない', async () => {
    reply({calendar: null, events: [], now: '2030-02-01T00:00:00.000Z'});
    const gone = {...CAL, deleted: true, updatedAt: '2030-01-09T00:00:00.000Z'};
    const io = {
      // getLocalCalendars 相当。削除済みは画面にも同期にも出てこない。
      readCalendar: async () => undefined,
      readEvents: async () => [ev('e1', '飲み会', '2030-01-09T00:00:00.000Z')],
      writeCalendar: async () => {},
      writeEvents: async () => {},
    };
    void gone;

    const res = await syncSharedCalendar('lc-1', io);

    expect(res).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('名乗りを一緒に送り、返ってきた参加者を覚える', async () => {
    await setMyName('あかり');
    // 1回目でカーソルを立てておく。そうしないと push の枝に入る。
    reply({calendar: null, events: [], now: '2030-02-01T00:00:00.000Z', members: []});
    await syncSharedCalendar('lc-1', deps(CAL, []).io);
    calls = [];

    reply({
      calendar: null, events: [], now: '2030-02-02T00:00:00.000Z',
      members: [
        {member_id: 'm1', name: 'あかり', emoji: '',
         last_seen_at: '2030-02-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z'},
        {member_id: 'm2', name: 'ばん', emoji: '',
         last_seen_at: '2030-01-31T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z'},
      ],
    });
    const d = deps(CAL, []);

    await syncSharedCalendar('lc-1', d.io);

    // 予定に変更が無いので pull。そこにも名乗りが載る。
    const call = calls[calls.length - 1];
    expect(call.fn).toBe('calendar_share_pull');
    expect(call.body.p_member.name).toBe('あかり');
    expect(call.body.p_member.id).toEqual(expect.any(String));

    expect((await getMembers('lc-1')).map(m => m.name)).toEqual(['あかり', 'ばん']);
  });

  // 名前を決めていない人が一覧に出てこないと、招待した側は相手が参加したのか
  // どうか分からない。仮の名前でも先に名乗らせる。
  it('名前を決めていなくても名乗りは送る', async () => {
    reply({calendar: null, events: [], now: '2030-02-01T00:00:00.000Z', members: []});
    const d = deps(CAL, []);

    await syncSharedCalendar('lc-1', d.io);

    const sent = calls[calls.length - 1].body.p_member;
    expect(sent).not.toBeNull();
    expect(typeof sent.name).toBe('string');
    expect(sent.name.length).toBeGreaterThan(0);
  });

  // 一度これで事故った。i18next は訳が無いとキーをそのまま返すので、仮名が
  // 「shareNameUnset」になって相手の一覧に並んだ。自分の画面には出ないので
  // 気づけない類の不具合。
  it('仮の名前に翻訳キーが漏れない', async () => {
    reply({calendar: null, events: [], now: '2030-02-01T00:00:00.000Z', members: []});
    await syncSharedCalendar('lc-1', deps(CAL, []).io);

    const sent = calls[calls.length - 1].body.p_member;
    expect(sent.name).not.toMatch(/^share[A-Z]/);
    expect(['名前未設定', 'No name set']).toContain(sent.name);
  });
});
