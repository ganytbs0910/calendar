/**
 * @format
 *
 * 一往復の流れ。ネットワークは fetch を差し替えて、RPC に何を送り、返ってきた
 * ものをどう取り込むかだけを見る。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  setShareCode, getCursor, syncSharedCalendar,
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
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
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
});
