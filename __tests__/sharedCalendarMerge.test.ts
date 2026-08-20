/**
 * @format
 *
 * 共有カレンダーの合流規則。全員が対等に編集するので、衝突は避けられない
 * 例外ではなく普通に起きること。ここが唯一の裁定者になる。
 */

import {
  appLinkUrl,
  changedSince,
  codeFromUrl,
  fromRemoteEvent,
  mergeEvents,
  pickNewer,
  shareUrl,
  toRemoteEvent,
} from '../src/services/sharedCalendarService';
import type {LocalEvent} from '../src/services/localCalendarService';

const ev = (id: string, title: string, updatedAt: string, deleted = false): LocalEvent => ({
  id, calendarId: 'lc-1', title,
  startDate: '2030-01-15', endDate: '2030-01-15', allDay: true,
  createdAt: '2030-01-01T00:00:00.000Z', updatedAt, deleted,
});

describe('last-write-wins', () => {
  it('新しい方が勝つ', () => {
    const mine = ev('e1', '飲み会', '2030-01-10T10:00:00.000Z');
    const theirs = ev('e1', '打ち上げ', '2030-01-10T11:00:00.000Z');
    expect(pickNewer(mine, theirs).title).toBe('打ち上げ');
  });

  it('古い方は負ける', () => {
    const mine = ev('e1', '飲み会', '2030-01-10T12:00:00.000Z');
    const theirs = ev('e1', '打ち上げ', '2030-01-10T11:00:00.000Z');
    expect(pickNewer(mine, theirs).title).toBe('飲み会');
  });

  it('同着はローカルを残す（送り直しで更新時刻が進むのを避ける）', () => {
    const t = '2030-01-10T11:00:00.000Z';
    const mine = ev('e1', '飲み会', t);
    expect(pickNewer(mine, ev('e1', '打ち上げ', t)).title).toBe('飲み会');
  });

  it('手元に無ければそのまま受け取る', () => {
    expect(pickNewer(undefined, ev('e1', '新着', '2030-01-10T11:00:00.000Z')).title)
      .toBe('新着');
  });
});

describe('取り込み', () => {
  it('新しい予定が増え、既存は新しい方に置き換わる', () => {
    const local = [ev('a', 'A', '2030-01-10T10:00:00.000Z'),
                   ev('b', 'B', '2030-01-10T10:00:00.000Z')];
    const remote = [ev('b', 'B改', '2030-01-10T12:00:00.000Z'),
                    ev('c', 'C', '2030-01-10T12:00:00.000Z')];
    const merged = mergeEvents(local, remote);
    expect(merged).toHaveLength(3);
    expect(merged.find(e => e.id === 'b')!.title).toBe('B改');
    expect(merged.find(e => e.id === 'a')!.title).toBe('A');
  });

  it('相手が消した予定は、こちらでも消えた状態になる', () => {
    const local = [ev('a', 'A', '2030-01-10T10:00:00.000Z')];
    const remote = [ev('a', 'A', '2030-01-10T12:00:00.000Z', true)];
    expect(mergeEvents(local, remote)[0].deleted).toBe(true);
  });

  it('消した予定を削除済みのまま残す（消すと次の取得で復活する）', () => {
    const local = [ev('a', 'A', '2030-01-10T12:00:00.000Z', true)];
    const remote = [ev('a', 'A', '2030-01-10T10:00:00.000Z')];
    const merged = mergeEvents(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].deleted).toBe(true);
  });

  it('相手が消したあとに自分が編集し直したら、編集が勝つ', () => {
    const local = [ev('a', '復活させた', '2030-01-10T13:00:00.000Z')];
    const remote = [ev('a', 'A', '2030-01-10T12:00:00.000Z', true)];
    expect(mergeEvents(local, remote)[0].deleted).toBe(false);
  });
});

describe('差分の切り出し', () => {
  it('前回以降に変わったものだけ送る', () => {
    const list = [ev('a', 'A', '2030-01-10T09:00:00.000Z'),
                  ev('b', 'B', '2030-01-10T11:00:00.000Z')];
    const out = changedSince(list, '2030-01-10T10:00:00.000Z');
    expect(out.map(e => e.id)).toEqual(['b']);
  });

  it('初回は全部送る', () => {
    const list = [ev('a', 'A', '2030-01-10T09:00:00.000Z')];
    expect(changedSince(list, null)).toHaveLength(1);
  });
});

describe('サーバとの形の変換', () => {
  it('往復しても内容が変わらない', () => {
    const original = ev('a', '飲み会', '2030-01-10T09:00:00.000Z');
    const back = fromRemoteEvent(
      {...toRemoteEvent(original),
       start_date: original.startDate, end_date: original.endDate,
       all_day: original.allDay, start_time: null, end_time: null,
       updated_at: original.updatedAt},
      'lc-1');
    expect(back.title).toBe('飲み会');
    expect(back.startDate).toBe('2030-01-15');
    expect(back.updatedAt).toBe(original.updatedAt);
    expect(back.calendarId).toBe('lc-1');
  });

  it('時刻なしの終日予定で undefined と null を取り違えない', () => {
    const r = toRemoteEvent(ev('a', 'A', '2030-01-10T09:00:00.000Z'));
    expect(r.startTime).toBeNull();
    expect(fromRemoteEvent({...r, start_time: null, updated_at: r.updatedAt}, 'lc-1').startTime)
      .toBeUndefined();
  });
});

describe('招待リンク', () => {
  const code = 'a'.repeat(32);

  it('作ったリンクから読み戻せる', () => {
    expect(codeFromUrl(shareUrl(code))).toBe(code);
  });

  it('コードが無いURLでは何も返さない', () => {
    expect(codeFromUrl('https://gan-67f.pages.dev/?app=calendar')).toBeNull();
  });

  it('長さの足りないコードは受け取らない', () => {
    expect(codeFromUrl('https://x/join?code=abc123')).toBeNull();
  });

  it('アプリスキームからも読める（https はまだアプリを開けない）', () => {
    expect(codeFromUrl(appLinkUrl(code))).toBe(code);
  });
});
