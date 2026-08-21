/**
 * @format
 *
 * 本物の Supabase に当てる結合テスト。2台の端末を模して一往復させる。
 *
 * 通常のテスト実行では飛ばす（ネットワークとサーバの状態に依存するため、
 * ここが赤いことと「壊れた」ことが一致しない）。動かすときは:
 *
 *   SHARE_LIVE=1 npx jest sharedCalendarLive
 *
 * curl で RPC を個別に叩く確認とは別物で、こちらは **アプリが通るコードそのもの**
 * （syncSharedCalendar とマージ）をサーバ相手に走らせる。
 */

// @types/node を入れていないので、この1つだけ自前で宣言する。
declare const process: {env: Record<string, string | undefined>};

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createShare, setShareCode, syncSharedCalendar, fetchShareMeta,
} from '../src/services/sharedCalendarService';
import type {LocalCalendar, LocalEvent} from '../src/services/localCalendarService';

const live = process.env.SHARE_LIVE === '1';
const d = live ? describe : describe.skip;

const cal = (id: string): LocalCalendar => ({
  id, name: '結合テスト', color: '#007AFF', emoji: '🧪',
  createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z',
});
const ev = (id: string, title: string, updatedAt: string, deleted = false): LocalEvent => ({
  id, calendarId: 'x', title, startDate: '2030-01-15', endDate: '2030-01-15',
  allDay: true, createdAt: updatedAt, updatedAt, deleted,
});

/** 1台ぶんの端末。ストレージは自分だけのものを持つ。 */
const device = (calendarId: string, events: LocalEvent[] = []) => {
  const s = {cal: cal(calendarId), events};
  return {
    s,
    io: {
      readCalendar: async () => s.cal,
      readEvents: async () => s.events,
      writeCalendar: async (c: LocalCalendar) => {s.cal = c;},
      writeEvents: async (l: LocalEvent[]) => {s.events = l;},
    },
  };
};

d('本物のサーバ相手に2台で同期する', () => {
  jest.setTimeout(60000);
  let code = '';

  beforeAll(async () => {
    await AsyncStorage.clear();
    code = await createShare(cal('A'));
  });

  it('A が作った予定を B が受け取る', async () => {
    const A = device('A', [ev('e1', 'Aの予定', '2030-01-10T10:00:00.000Z')]);
    await setShareCode('A', code);
    await syncSharedCalendar('A', A.io);

    const B = device('B');
    await setShareCode('B', code);
    await syncSharedCalendar('B', B.io);

    expect(B.s.events.map(e => e.title)).toContain('Aの予定');
    // 受け取った側でも calendarId は自分のものになる
    expect(B.s.events[0].calendarId).toBe('B');
  });

  it('B の編集が A に返る', async () => {
    const B = device('B', [ev('e1', 'Bが直した', '2030-01-11T00:00:00.000Z')]);
    await syncSharedCalendar('B', B.io);

    const A = device('A', [ev('e1', 'Aの予定', '2030-01-10T10:00:00.000Z')]);
    await AsyncStorage.removeItem('@shared_calendar_cursors');   // 全部引き直す
    await setShareCode('A', code);
    await syncSharedCalendar('A', A.io);

    expect(A.s.events.find(e => e.id === 'e1')!.title).toBe('Bが直した');
  });

  it('B が消した予定は A でも消えた状態になる', async () => {
    const B = device('B', [ev('e1', 'Bが直した', '2030-01-12T00:00:00.000Z', true)]);
    await syncSharedCalendar('B', B.io);

    const A = device('A', [ev('e1', 'Bが直した', '2030-01-11T00:00:00.000Z')]);
    await AsyncStorage.removeItem('@shared_calendar_cursors');
    await setShareCode('A', code);
    await syncSharedCalendar('A', A.io);

    expect(A.s.events.find(e => e.id === 'e1')!.deleted).toBe(true);
  });

  it('参加前プレビューが引ける', async () => {
    const meta = await fetchShareMeta(code);
    expect(meta!.name).toBe('結合テスト');
  });

  it('知らないコードでは参加できない', async () => {
    expect(await fetchShareMeta('0'.repeat(32))).toBeNull();
  });
});
