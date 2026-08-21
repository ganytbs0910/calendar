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
  getMembers, setMyName,
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

/**
 * 名乗りを別人に付け替える。setMyName は既存の id を引き継ぐので、
 * 消してから呼ばないと2台目が1台目と同じ人になってしまう。
 */
const becomeSomeoneElse = async (name: string) => {
  await AsyncStorage.removeItem('@shared_calendar_me');
  await setMyName(name);
};

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

  // 名乗りは共有ごとに溜まっていくので、前の it が作った人が混ざらないよう
  // このかたまりだけ専用のコードを引く。
  describe('参加者の一覧', () => {
    let mcode = '';
    beforeAll(async () => {
      mcode = await createShare(cal('M'));
    });
    beforeEach(async () => {
      await AsyncStorage.removeItem('@shared_calendar_cursors');
    });

    it('お互いの名前が一覧に出る', async () => {
      await becomeSomeoneElse('あかり');
      const A = device('mA');
      await setShareCode('mA', mcode);
      await syncSharedCalendar('mA', A.io);

      await becomeSomeoneElse('ばん');
      const B = device('mB');
      await setShareCode('mB', mcode);
      await syncSharedCalendar('mB', B.io);

      const seenByB = await getMembers('mB');
      expect(seenByB.map(m => m.name).sort()).toEqual(['あかり', 'ばん']);
      expect(seenByB.find(m => m.isMe)!.name).toBe('ばん');
    });

    it('名乗り直すと相手側の表示も変わる', async () => {
      // 同じ id のまま改名する。別人が増えるのではなく、その行が書き換わる。
      await setMyName('ばんちゃん');
      const B = device('mB');
      await syncSharedCalendar('mB', B.io);

      await becomeSomeoneElse('あかり2');
      const A = device('mA');
      await setShareCode('mA', mcode);
      await syncSharedCalendar('mA', A.io);

      const names = (await getMembers('mA')).map(m => m.name);
      expect(names).toContain('ばんちゃん');
      expect(names).not.toContain('ばん');
    });
  });

  it('参加前プレビューでは人数だけ分かる（名前は出ない）', async () => {
    const meta: any = await fetchShareMeta(code);
    expect(meta.members).toBeGreaterThan(0);
    expect(JSON.stringify(meta)).not.toContain('ばん');
  });

  it('参加前プレビューが引ける', async () => {
    const meta = await fetchShareMeta(code);
    expect(meta!.name).toBe('結合テスト');
  });

  it('知らないコードでは参加できない', async () => {
    expect(await fetchShareMeta('0'.repeat(32))).toBeNull();
  });
});
