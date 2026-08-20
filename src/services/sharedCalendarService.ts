// ── 共有カレンダー ──────────────────────────────────────────────────────────
//
// ローカルカレンダー（localCalendarService）に同期を足したもの。予定の形も
// 画面もそのまま使い、変わるのは「同じものを複数人が編集する」ことだけ。
//
// ★ 認証は無い。招待コードそのものが鍵。
//   参加者は全員が対等に編集するので「誰であるか」の区別が要らず、区別が
//   要らないならログインも要らない。詳しくは
//   supabase/migrations/20260821_calendar_share.sql の冒頭を参照。
//
// ★ feedbackService と同じく @supabase/supabase-js を使わず fetch で叩く。
//   SDKを足すとバンドルが100KB以上増え、URLポリフィルも要る。ここで必要なのは
//   RPC 4本だけなので割に合わない。相乗り先を分けるときに変わるのは
//   SUPABASE_URL と ANON_KEY の2行だけ。

import AsyncStorage from '@react-native-async-storage/async-storage';

import {LocalCalendar, LocalEvent} from './localCalendarService';

const SUPABASE_URL = 'https://llxmsbnqtdlqypnwapzz.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxseG1zYm5xdGRscXlwbndhcHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4MjA5MjEsImV4cCI6MjA1MzM5NjkyMX0.EkqepILQU0KgOTW1ZaXpe54ERpZbSRodf24r5022VKs';

/** DB 側の calendar_share_guard と必ず揃えること。 */
export const MAX_EVENTS_PER_PUSH = 200;

const TIMEOUT_MS = 15000;

/** calendarId -> 共有コード。共有していないカレンダーはここに載らない。 */
const LINK_KEY = '@shared_calendar_links';
/** calendarId -> 最後に取り込めたサーバ時刻。次回はここから後だけ取る。 */
const CURSOR_KEY = '@shared_calendar_cursors';

export type ShareLink = {code: string};

const readMap = async <T,>(key: string): Promise<Record<string, T>> => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
};

export const getShareCode = async (calendarId: string): Promise<string | null> =>
  (await readMap<string>(LINK_KEY))[calendarId] ?? null;

export const setShareCode = async (calendarId: string, code: string): Promise<void> => {
  const map = await readMap<string>(LINK_KEY);
  map[calendarId] = code;
  await AsyncStorage.setItem(LINK_KEY, JSON.stringify(map));
};

export const getCursor = async (calendarId: string): Promise<string | null> =>
  (await readMap<string>(CURSOR_KEY))[calendarId] ?? null;

export const setCursor = async (calendarId: string, iso: string): Promise<void> => {
  const map = await readMap<string>(CURSOR_KEY);
  map[calendarId] = iso;
  await AsyncStorage.setItem(CURSOR_KEY, JSON.stringify(map));
};

// ── マージ ──────────────────────────────────────────────────────────────────

/** サーバの行（snake_case）を端末の形に直す。 */
export const fromRemoteEvent = (r: any, calendarId: string): LocalEvent => ({
  id: r.id,
  calendarId,
  title: r.title,
  startDate: r.start_date,
  endDate: r.end_date,
  allDay: !!r.all_day,
  startTime: r.start_time ?? undefined,
  endTime: r.end_time ?? undefined,
  memo: r.memo ?? undefined,
  // サーバには createdAt を持たせていない（同期に要らない）。初めて受け取った
  // 予定は更新時刻を作成時刻とみなす。
  createdAt: r.created_at ?? r.updated_at,
  updatedAt: r.updated_at,
  deleted: !!r.deleted,
});

export const toRemoteEvent = (e: LocalEvent) => ({
  id: e.id,
  title: e.title,
  startDate: e.startDate,
  endDate: e.endDate,
  allDay: e.allDay,
  startTime: e.startTime ?? null,
  endTime: e.endTime ?? null,
  memo: e.memo ?? null,
  updatedAt: e.updatedAt,
  deleted: !!e.deleted,
});

/**
 * last-write-wins で1件ぶんを選ぶ。
 *
 * 同着はローカルを残す。送り直しのたびに中身が入れ替わると、編集していない
 * のに更新時刻だけが進んで、他端末に不要な差分が流れ続ける。
 */
export const pickNewer = <T extends {updatedAt: string}>(local: T | undefined, remote: T): T => {
  if (!local) return remote;
  return Date.parse(remote.updatedAt) > Date.parse(local.updatedAt) ? remote : local;
};

/**
 * ローカルの一覧にサーバぶんを取り込む。削除済みも「消えた」という状態として
 * 残す（消してしまうと、次の取得でまた降ってきて復活する）。
 */
export const mergeEvents = (local: LocalEvent[], remote: LocalEvent[]): LocalEvent[] => {
  const byId = new Map(local.map(e => [e.id, e]));
  for (const r of remote) byId.set(r.id, pickNewer(byId.get(r.id), r));
  return [...byId.values()];
};

/** 前回の取り込み以降に、こちらで変わったものだけ。 */
export const changedSince = <T extends {updatedAt: string}>(
  list: T[], since: string | null,
): T[] => (since ? list.filter(e => Date.parse(e.updatedAt) > Date.parse(since)) : list);

// ── 通信 ────────────────────────────────────────────────────────────────────

const rpc = async (fn: string, body: Record<string, unknown>): Promise<any> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

/** 共有を作り、コードを返す。呼び出し側が setShareCode で紐づける。 */
export const createShare = async (cal: LocalCalendar): Promise<string> =>
  rpc('calendar_share_create', {p_name: cal.name, p_color: cal.color, p_emoji: cal.emoji});

/** 参加前に「何に参加しようとしているか」を見せるため。予定の中身は来ない。 */
export const fetchShareMeta = async (
  code: string,
): Promise<{name: string; color: string; emoji: string; events: number} | null> =>
  (await rpc('calendar_share_meta', {p_code: code})) ?? null;

export const pullShare = async (code: string, since: string | null) =>
  rpc('calendar_share_pull', {p_code: code, p_since: since ?? '-infinity'});

export const pushShare = async (
  code: string, calendar: LocalCalendar | null, events: LocalEvent[],
) =>
  rpc('calendar_share_push', {
    p_code: code,
    p_calendar: calendar
      ? {name: calendar.name, color: calendar.color, emoji: calendar.emoji,
         deleted: !!calendar.deleted, updatedAt: calendar.updatedAt}
      : null,
    p_events: events.slice(0, MAX_EVENTS_PER_PUSH).map(toRemoteEvent),
  });

/** 招待リンク。アプリが無い相手にも「何のリンクか」は分かる形にしておく。 */
export const shareUrl = (code: string): string =>
  `https://gan-67f.pages.dev/join?app=calendar&code=${code}`;

export const codeFromUrl = (url: string): string | null => {
  const m = url.match(/[?&]code=([0-9a-f]{32})\b/i);
  return m ? m[1].toLowerCase() : null;
};
