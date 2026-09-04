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

import i18n from '../i18n/i18n';
import {displaySharedCalendarChangeNotification} from './notificationService';
import {addNotificationHistoryEntry} from './notificationHistoryService';

import {LocalCalendar, LocalEvent} from './localCalendarService';

const SUPABASE_URL = 'https://llxmsbnqtdlqypnwapzz.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxseG1zYm5xdGRscXlwbndhcHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4MjA5MjEsImV4cCI6MjA1MzM5NjkyMX0.EkqepILQU0KgOTW1ZaXpe54ERpZbSRodf24r5022VKs';

/** DB 側の calendar_share_guard と必ず揃えること。 */
export const MAX_EVENTS_PER_PUSH = 200;

const TIMEOUT_MS = 15000;

/**
 * Thrown when the server actually answered (not a network/timeout failure)
 * but rejected the request — `reason` is the raw plpgsql `RAISE EXCEPTION`
 * message (e.g. 'forbidden', 'unauthorized member'), passed through as-is so
 * callers can show something more useful than "check your connection" for
 * what's actually a permission/state problem, not a network one.
 */
export class SharedRpcError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'SharedRpcError';
  }
}

/** calendarId -> 共有コード。共有していないカレンダーはここに載らない。 */
const LINK_KEY = '@shared_calendar_links';
/** calendarId -> 最後に取り込めたサーバ時刻。次回はここから後だけ取る。 */
const CURSOR_KEY = '@shared_calendar_cursors';
/** この端末の名乗り。全部の共有カレンダーで同じものを使う。 */
const ME_KEY = '@shared_calendar_me';
/** calendarId -> 参加者一覧。圏外でも「誰と共有しているか」は出したい。 */
const MEMBERS_KEY = '@shared_calendar_members';
/** calendarId -> event ids that must be pushed even when the device clock is behind. */
const DIRTY_EVENTS_KEY = '@shared_calendar_dirty_events';
/** calendarId -> true if this device doesn't want a notification when someone else changes this calendar. */
const MUTE_KEY = '@shared_calendar_muted';
/** calendarId -> whether the owner has closed the invite to new joiners (mirrors the server's calendar_shared.invite_closed). */
const INVITE_CLOSED_KEY = '@shared_calendar_invite_closed';
/**
 * calendarId -> count of changes by others not yet seen. Persists across app
 * restarts (unlike LocalCalendarDetail's own session-only header badge) so
 * the calendar LIST screen can show "something's new here" without the user
 * having to open every shared calendar to check. Cleared when that
 * calendar's detail screen is opened.
 */
const UNSEEN_CHANGES_KEY = '@shared_calendar_unseen_changes';

export type ShareLink = {code: string};

/**
 * 共有相手として表示される1人。
 *
 * ★ 本人確認ではない。id は端末が自分で振った乱数で、名前も自由に書ける。
 *   コードを知っている人なら誰でも任意の名前で名乗れる。信頼できる相手と
 *   共有する前提の機能なので、そこは割り切っている。
 */
export type ShareMember = {
  id: string;
  name: string;
  emoji: string;
  color?: string;
  /** 最後にこの共有を同期した時刻。「まだ見ていない」を出すのに使う。 */
  lastSeenAt: string;
  updatedAt: string;
  /** 自分自身かどうか。サーバから来る値ではなく、読み出すときに付ける。 */
  isMe?: boolean;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
};

export type SharedComment = {id: string; eventId: string; memberId: string; body: string; createdAt: string};
export type SharedAttendance = {memberId: string; status: 'going' | 'maybe' | 'declined'; updatedAt: string};
export type SharedPhoto = {id: string; eventId: string; memberId: string; mimeType: string; base64: string; createdAt: string};
export type SharedActivity = {seq: number; eventId?: string; memberId: string; action: string; detail: Record<string, unknown>; createdAt: string};
export type SharedRevision = {revisionId: number; editorId: string; snapshot: Record<string, unknown>; createdAt: string};
export type SharedEventContext = {comments: SharedComment[]; attendance: SharedAttendance[]; photos: SharedPhoto[]; activity: SharedActivity[]; revisions: SharedRevision[]};

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

/**
 * この端末を表す32桁。初回に作って以降変えない。
 *
 * 暗号強度は要らない。当てられて困る秘密ではなく、「同じ端末の名乗りを
 * 上書きする」ためだけの鍵で、参加の可否はあくまで招待コードが決めている。
 */
const newMemberId = (): string => {
  let out = '';
  while (out.length < 32) out += Math.floor(Math.random() * 16).toString(16);
  return out;
};

type Me = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  updatedAt: string;
  /** 本人が決めた名前ではなく、こちらが仮に付けたもの。 */
  auto?: boolean;
  secret?: string;
};

const newMemberSecret = (): string => `${newMemberId()}${newMemberId()}`;

/**
 * The server rejects (and never backfills a hash for) any secret that isn't
 * exactly 64 hex chars — but until now, this side never checked that either,
 * only whether *some* value was present. A secret that got corrupted, or was
 * ever written by an earlier/different format, would sit there forever
 * passing every local truthiness check while the server permanently refused
 * to authenticate it — confirmed live: a real member row stayed
 * `member_secret_hash IS NULL` (see 20260829's self-heal, which explicitly
 * refuses to touch a badly-shaped secret) because the device kept resending
 * the same malformed one on every sync. Owner/admin actions on that
 * member_id (invite-close, kick, leave, role-set) always came back
 * 'unauthorized member' as a result, with no way for either side to recover.
 */
const isValidSecret = (secret: string | undefined): secret is string =>
  !!secret && /^[0-9a-f]{64}$/.test(secret);

export const MEMBER_COLORS = [
  '#007AFF', '#FF2D55', '#34C759', '#AF52DE', '#FF9500',
  '#30B0C7', '#5856D6', '#E85D75', '#8A6D3B',
];

const colorForId = (id: string): string => {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
};

export const getMe = async (): Promise<Me | null> => {
  const raw = await AsyncStorage.getItem(ME_KEY);
  if (!raw) return null;
  try {
    const me = JSON.parse(raw) as Me;
    return me.id && me.name ? {...me, color: me.color || colorForId(me.id)} : null;
  } catch {
    return null;
  }
};

/** 名乗りを決める / 変える。id は一度作ったら引き継ぐ。 */
export const setMyName = async (name: string, emoji = '', auto = false): Promise<Me> => {
  const prev = await getMe();
  const id = prev?.id ?? newMemberId();
  const me: Me = {
    id,
    name: name.trim().slice(0, 24),
    emoji,
    color: prev?.color ?? colorForId(id),
    updatedAt: new Date().toISOString(),
    auto,
    secret: prev && isValidSecret(prev.secret) ? prev.secret : newMemberSecret(),
  };
  await AsyncStorage.setItem(ME_KEY, JSON.stringify(me));
  return me;
};

export const setMyColor = async (color: string): Promise<Me> => {
  const prev = await ensureMe();
  const me: Me = {...prev, color, updatedAt: new Date().toISOString(), auto: prev.auto};
  await AsyncStorage.setItem(ME_KEY, JSON.stringify(me));
  return me;
};

export const getOrCreateMe = (): Promise<Me> => ensureMe();

/**
 * 仮の名前。**必ず defaultValue を付ける。**
 *
 * i18next は訳が見つからないとキー文字列をそのまま返すので、付けないと
 * 「shareNameUnset」という名前で相手の一覧に並ぶ。実際に一度そうなった。
 * これは自分の画面では確認しづらい（相手の端末にだけ出る）。
 */
const autoName = (): string => i18n.t('shareNameUnset', {defaultValue: '名前未設定'});

/**
 * 同期で送る名乗り。まだ決めていなければ仮の名前を付けてでも1つ作る。
 *
 * 名前を決めるまで名乗らない作りにすると、招待した側の一覧に相手が
 * いつまでも出てこない。参加したことだけは先に伝えて、名前は後から
 * 直せるようにする方が事故が少ない。
 *
 * 仮名のままなら毎回引き直す。訳が後から入った場合や端末の言語が
 * 変わった場合に、古い仮名が残り続けるのを防ぐ。本人が決めた名前
 * （auto でない）には触らない。
 */
const ensureMe = async (): Promise<Me> => {
  const me = await getMe();
  if (me && isValidSecret(me.secret) && (!me.auto || me.name === autoName())) return me;
  // 有効な secret が無い（未生成 or 壊れた形式）だけが理由なら、本人が
  // 決めた名前は消さずに setMyName 経由で secret だけ作り直す。
  if (me && !me.auto) return setMyName(me.name, me.emoji, false);
  return setMyName(autoName(), '', true);
};

/** calendarId ごとに覚えている参加者。自分には isMe を立てて返す。 */
export const getMembers = async (calendarId: string): Promise<ShareMember[]> => {
  const [map, me] = await Promise.all([
    readMap<ShareMember[]>(MEMBERS_KEY),
    getMe(),
  ]);
  return (map[calendarId] ?? []).map(m => ({
    ...m,
    color: m.color || colorForId(m.id),
    isMe: !!me && m.id === me.id,
  }));
};

const setMembers = async (calendarId: string, list: ShareMember[]): Promise<void> => {
  const map = await readMap<ShareMember[]>(MEMBERS_KEY);
  map[calendarId] = list;
  await AsyncStorage.setItem(MEMBERS_KEY, JSON.stringify(map));
};

export const fromRemoteMember = (r: any): ShareMember => ({
  id: r.member_id,
  name: r.name,
  emoji: r.emoji ?? '',
  ...(r.color ? {color: r.color} : {}),
  lastSeenAt: r.last_seen_at,
  updatedAt: r.updated_at,
  ...(r.role ? {role: r.role} : {}),
});

/** 自分を先頭に、あとは最後に同期した順。誰が動いているかが上に来る。 */
export const sortMembers = (list: ShareMember[]): ShareMember[] =>
  [...list].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });

/** Whether this device wants a notification when another member changes this calendar. Default: notify. */
export const isSharedCalendarMuted = async (calendarId: string): Promise<boolean> =>
  !!(await readMap<boolean>(MUTE_KEY))[calendarId];

export const setSharedCalendarMuted = async (calendarId: string, muted: boolean): Promise<void> => {
  const map = await readMap<boolean>(MUTE_KEY);
  if (muted) map[calendarId] = true;
  else delete map[calendarId];
  await AsyncStorage.setItem(MUTE_KEY, JSON.stringify(map));
};

/** Last-known "is the invite closed" state, refreshed on every sync. Cached locally so the UI can render it without a round trip. */
export const isInviteClosed = async (calendarId: string): Promise<boolean> =>
  !!(await readMap<boolean>(INVITE_CLOSED_KEY))[calendarId];

const setInviteClosedCache = async (calendarId: string, closed: boolean): Promise<void> => {
  const map = await readMap<boolean>(INVITE_CLOSED_KEY);
  if (closed) map[calendarId] = true;
  else delete map[calendarId];
  await AsyncStorage.setItem(INVITE_CLOSED_KEY, JSON.stringify(map));
};

/** calendarId -> unseen change count, for the calendar list screen's badge. */
export const getUnseenChangeCounts = async (): Promise<Record<string, number>> =>
  readMap<number>(UNSEEN_CHANGES_KEY);

/** Marks a calendar's changes as seen — call when its detail screen opens. */
export const clearUnseenChanges = async (calendarId: string): Promise<void> => {
  const map = await readMap<number>(UNSEEN_CHANGES_KEY);
  delete map[calendarId];
  await AsyncStorage.setItem(UNSEEN_CHANGES_KEY, JSON.stringify(map));
};

const addUnseenChanges = async (calendarId: string, count: number): Promise<void> => {
  if (count <= 0) return;
  const map = await readMap<number>(UNSEEN_CHANGES_KEY);
  map[calendarId] = (map[calendarId] ?? 0) + count;
  await AsyncStorage.setItem(UNSEEN_CHANGES_KEY, JSON.stringify(map));
};

/** Owner-only: stop (or resume) new people from joining via the invite link. Existing members are unaffected. */
export const setInviteClosed = async (calendarId: string, closed: boolean): Promise<void> => {
  const [code, me] = await Promise.all([getShareCode(calendarId), ensureMe()]);
  if (!code) throw new Error('calendar is not shared');
  await rpc('calendar_share_set_invite_closed', {p_code: code, p_actor_id: me.id, p_secret: me.secret, p_closed: closed});
  await setInviteClosedCache(calendarId, closed);
};

/** Owner/admin-only: remove another member. They can no longer sync under their old identity. */
export const kickMember = async (calendarId: string, targetMemberId: string): Promise<ShareMember[]> => {
  const [code, me] = await Promise.all([getShareCode(calendarId), ensureMe()]);
  if (!code) throw new Error('calendar is not shared');
  const rows = await rpc('calendar_share_kick_member', {
    p_code: code, p_actor_id: me.id, p_secret: me.secret, p_target_member_id: targetMemberId,
  });
  const list = (rows ?? []).map(fromRemoteMember);
  await setMembers(calendarId, list);
  return getMembers(calendarId);
};

/**
 * Self-removal for a non-owner. Also drops the local copy (matching what a
 * non-owner deleting the calendar already did locally before this existed —
 * this just pairs it with actually telling the server, so the departure
 * shows up in everyone else's member list instead of leaving a ghost row).
 */
export const leaveSharedCalendar = async (calendarId: string): Promise<void> => {
  const [code, me] = await Promise.all([getShareCode(calendarId), ensureMe()]);
  if (!code) return;
  await rpc('calendar_share_leave', {p_code: code, p_member_id: me.id, p_secret: me.secret});
  await deleteLocalCalendar(calendarId);
  const map = await readMap<string>(LINK_KEY);
  delete map[calendarId];
  await AsyncStorage.setItem(LINK_KEY, JSON.stringify(map));
};

export const getCursor = async (calendarId: string): Promise<string | null> =>
  (await readMap<string>(CURSOR_KEY))[calendarId] ?? null;

export const setCursor = async (calendarId: string, iso: string): Promise<void> => {
  const map = await readMap<string>(CURSOR_KEY);
  map[calendarId] = iso;
  await AsyncStorage.setItem(CURSOR_KEY, JSON.stringify(map));
};

export const markSharedEventDirty = async (calendarId: string, eventId: string): Promise<void> => {
  const map = await readMap<string[]>(DIRTY_EVENTS_KEY);
  map[calendarId] = [...new Set([...(map[calendarId] ?? []), eventId])];
  await AsyncStorage.setItem(DIRTY_EVENTS_KEY, JSON.stringify(map));
};

const getDirtyEventIds = async (calendarId: string): Promise<Set<string>> =>
  new Set((await readMap<string[]>(DIRTY_EVENTS_KEY))[calendarId] ?? []);

const clearDirtyEventIds = async (calendarId: string, ids: string[]): Promise<void> => {
  if (!ids.length) return;
  const map = await readMap<string[]>(DIRTY_EVENTS_KEY);
  const sent = new Set(ids);
  map[calendarId] = (map[calendarId] ?? []).filter(id => !sent.has(id));
  await AsyncStorage.setItem(DIRTY_EVENTS_KEY, JSON.stringify(map));
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
  creatorId: r.creator_id ?? r.creatorId ?? undefined,
  // サーバには createdAt を持たせていない（同期に要らない）。初めて受け取った
  // 予定は更新時刻を作成時刻とみなす。
  createdAt: r.created_at ?? r.updated_at,
  updatedAt: r.updated_at,
  deleted: !!r.deleted,
  mustWake: !!r.must_wake,
  mustWakeOffsetMinutes: r.must_wake_offset_minutes ?? null,
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
  creatorId: e.creatorId ?? null,
  updatedAt: e.updatedAt,
  deleted: !!e.deleted,
  mustWake: !!e.mustWake,
  mustWakeOffsetMinutes: e.mustWakeOffsetMinutes ?? null,
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
    if (!res.ok) {
      // PostgREST turns a plpgsql `raise exception 'forbidden'` into
      // {"code":"P0001","message":"forbidden",...} — surface that message
      // verbatim rather than collapsing every non-2xx response into the
      // same opaque "<fn> <status>" the caller can't act on.
      let reason = `${fn} ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody?.message === 'string' && errBody.message) reason = errBody.message;
      } catch {
        // No JSON body (or not the shape we expect) — keep the generic reason.
      }
      throw new SharedRpcError(reason);
    }
    // A `returns void` function (calendar_share_set_invite_closed,
    // calendar_share_leave) comes back as HTTP 204 with a genuinely empty
    // body — confirmed live. res.json() throws on that (not a
    // SharedRpcError), which used to surface as the generic "check your
    // connection" alert even though the call had already succeeded on the
    // server, and reverted the UI's optimistic update on top of it.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
};

const mapEventContext = (raw: any): SharedEventContext => ({
  comments: (raw?.comments ?? []).map((x: any) => ({id:x.id,eventId:x.event_id,memberId:x.member_id,body:x.body,createdAt:x.created_at})),
  attendance: (raw?.attendance ?? []).map((x: any) => ({memberId:x.member_id,status:x.status,updatedAt:x.updated_at})),
  photos: (raw?.photos ?? []).map((x: any) => ({id:x.id,eventId:x.event_id,memberId:x.member_id,mimeType:x.mime_type,base64:x.data_base64,createdAt:x.created_at})),
  activity: (raw?.activity ?? []).map((x: any) => ({seq:x.seq,eventId:x.event_id,memberId:x.member_id,action:x.action,detail:x.detail ?? {},createdAt:x.created_at})),
  revisions: (raw?.revisions ?? []).map((x: any) => ({revisionId:x.revision_id,editorId:x.editor_id,snapshot:x.snapshot ?? {},createdAt:x.created_at})),
});

export const getSharedEventContext = async (calendarId: string, eventId: string): Promise<SharedEventContext> => {
  const code = await getShareCode(calendarId);
  if (!code) return {comments:[],attendance:[],photos:[],activity:[],revisions:[]};
  return mapEventContext(await rpc('calendar_share_event_context', {p_code:code,p_event_id:eventId}));
};

export const sharedEventAction = async (
  calendarId: string, eventId: string, action: string, payload: Record<string, unknown> = {},
): Promise<SharedEventContext> => {
  const [code, me] = await Promise.all([getShareCode(calendarId), ensureMe()]);
  if (!code) throw new Error('calendar is not shared');
  return mapEventContext(await rpc('calendar_share_event_action', {
    p_code:code,p_event_id:eventId,p_member_id:me.id,p_secret:me.secret,p_action:action,p_payload:payload,
  }));
};

export const setSharedMemberRole = async (
  calendarId: string, memberId: string, role: 'admin' | 'member' | 'viewer',
): Promise<ShareMember[]> => {
  const [code, me] = await Promise.all([getShareCode(calendarId), ensureMe()]);
  if (!code) throw new Error('calendar is not shared');
  const rows = await rpc('calendar_share_member_role_set', {
    p_code:code,p_actor_id:me.id,p_secret:me.secret,p_member_id:memberId,p_role:role,
  });
  const list = (rows ?? []).map(fromRemoteMember);
  await setMembers(calendarId, list);
  return getMembers(calendarId);
};

/** 共有を作り、コードを返す。呼び出し側が setShareCode で紐づける。 */
export const createShare = async (cal: LocalCalendar): Promise<string> =>
  rpc('calendar_share_create', {p_name: cal.name, p_color: cal.color, p_emoji: cal.emoji});

export interface ShareMetaMember {
  name: string;
  emoji: string;
  color: string;
}

/** 参加前に「何に参加しようとしているか」を見せるため。予定の中身は来ない。 */
export const fetchShareMeta = async (
  code: string,
): Promise<{name: string; color: string; emoji: string; events: number; members: number; memberPreview: ShareMetaMember[]} | null> => {
  const raw = await rpc('calendar_share_meta', {p_code: code});
  if (!raw) return null;
  return {...raw, memberPreview: raw.memberPreview ?? []};
};

const toRemoteMember = (me: Me | null) =>
  me ? {id: me.id, name: me.name, emoji: me.emoji, color: me.color, secret: me.secret, updatedAt: me.updatedAt} : null;

export const pullShare = async (code: string, since: string | null, me: Me | null = null) =>
  rpc('calendar_share_pull', {
    p_code: code, p_since: since ?? '-infinity', p_member: toRemoteMember(me),
  });

/**
 * 1回ぶんの push。**1回に載せられるのは MAX_EVENTS_PER_PUSH 件まで**で、
 * 超えた分をここで切り捨ててはいけない。切り捨てるとカーソルだけが進んで、
 * あふれた予定は二度と送られなくなる（本人の画面には見えているので、
 * 気づけるのは相手に見えていないと言われたときだけ）。
 * 分割は syncSharedCalendar の責任。
 */
export const pushShare = async (
  code: string, calendar: LocalCalendar | null, events: LocalEvent[],
  me: Me | null = null,
) => {
  if (events.length > MAX_EVENTS_PER_PUSH) {
    throw new Error(`pushShare: ${events.length} events exceeds ${MAX_EVENTS_PER_PUSH}`);
  }
  return rpc('calendar_share_push', {
    p_code: code,
    p_calendar: calendar
      ? {name: calendar.name, color: calendar.color, emoji: calendar.emoji,
         deleted: !!calendar.deleted, updatedAt: calendar.updatedAt}
      : null,
    p_events: events.map(toRemoteEvent),
    p_member: toRemoteMember(me),
  });
};

/**
 * 招待リンク。https を配るのは、アプリを持っていない相手にも「何のリンクか」が
 * 分かり、開けば案内ページに着けるから。
 *
 * ただし現状 https からアプリは開かない（Universal Links / App Links を
 * 張っていない）。それには apple-app-site-association と assetlinks.json を
 * gan-67f.pages.dev に置き、iOS 側に associated-domains を足す必要がある。
 * それまでの間、確実にアプリが開くのは idealcal:// の方。
 */
export const shareUrl = (code: string): string =>
  `https://gan-67f.pages.dev/join?app=calendar&code=${code}`;

export const appLinkUrl = (code: string): string => `idealcal://join?code=${code}`;

/** https でも idealcal:// でも、コードだけ取り出す。 */
export const codeFromUrl = (url: string): string | null => {
  const m = url.match(/[?&]code=([0-9a-f]{32})\b/i);
  return m ? m[1].toLowerCase() : null;
};

/**
 * 通知履歴の1行分。「変更されました」だけでは何が変わったか分からず、
 * わざわざカレンダーを開いて探し直す羽目になるので、予定名と日時まで
 * その場で分かるようにする。
 */
const formatChangeHistoryEntry = (
  type: 'added' | 'updated' | 'deleted',
  event: LocalEvent,
  creatorName?: string,
): {title: string; body: string} => {
  const typeLabel = i18n.t(`notifChangeType_${type}`, {
    defaultValue: type === 'added' ? '追加' : type === 'updated' ? '変更' : '削除',
  });
  // 誰の変更かは、抜けた/古いメンバーだと分からないことがある — その場合は
  // 種別だけの表示に自然に落ちる(「Aさんが追加」→「追加」)。
  const byLine = creatorName
    ? i18n.t('notifChangeByLine', {name: creatorName, type: typeLabel, defaultValue: `${creatorName}さんが${typeLabel}`})
    : typeLabel;
  const d = new Date(`${event.startDate}T00:00:00`);
  const weekdays = i18n.t('weekdaysSingle', {returnObjects: true}) as string[];
  const when = Number.isNaN(d.getTime())
    ? event.startDate
    : i18n.t('dateDayOfWeek', {month: d.getMonth() + 1, day: d.getDate(), weekday: weekdays[d.getDay()]});
  let timePart = '';
  if (event.allDay) {
    timePart = ` ${i18n.t('allDay', {defaultValue: '終日'})}`;
  } else if (event.startTime) {
    timePart = event.endTime
      ? ` ${i18n.t('notifTimeRange', {start: event.startTime, end: event.endTime})}`
      : ` ${event.startTime}`;
  }
  return {title: event.title, body: `${byLine} · ${when}${timePart}`};
};

// ── 同期 ────────────────────────────────────────────────────────────────────

/**
 * 1つの共有カレンダーを一往復させる。押してから引く。
 *
 * 押す→引くの順なのは、こちらの変更をサーバに載せてから、それを含んだ最新を
 * 受け取るため。逆順だと、送った直後の状態を取り逃して次回まで反映が遅れる。
 *
 * カーソル（前回どこまで取り込んだか）は **サーバが返した時刻** を使う。端末の
 * 時計は信用できず、数分ずれているだけで「自分が送った変更が降ってこない」
 * または「毎回全部降ってくる」のどちらかになる。
 */
export const syncSharedCalendar = async (
  calendarId: string,
  deps: {
    readCalendar: () => Promise<LocalCalendar | undefined>;
    readEvents: () => Promise<LocalEvent[]>;
    writeCalendar: (c: LocalCalendar) => Promise<void>;
    writeEvents: (list: LocalEvent[]) => Promise<void>;
  },
): Promise<{pushed: number; pulled: number; changedByOthers: {added: number; updated: number; deleted: number}} | null> => {
  const code = await getShareCode(calendarId);
  if (!code) return null;

  const since = await getCursor(calendarId);
  const [cal, events, dirtyIds] = await Promise.all([deps.readCalendar(), deps.readEvents(), getDirtyEventIds(calendarId)]);
  if (!cal) return null;

  const outgoing = events.filter(event => dirtyIds.has(event.id) || !since || Date.parse(event.updatedAt) > Date.parse(since));
  const calChanged = !since || Date.parse(cal.updatedAt) > Date.parse(since);

  // 送るものが多いときは分けて全部送り切る。初回共有では手元の予定が丸ごと
  // outgoing になるので、ここが1回で済む保証はない。カレンダー本体は最初の
  // 1回にだけ載せれば足りる。
  // 名乗りは push でも pull でも送る。分岐のどちらか一方に付けると、
  // しばらく予定を編集していない人が相手の一覧から古びていく。
  const me = await ensureMe();

  let res: any;
  if (outgoing.length || calChanged) {
    for (let i = 0; i < Math.max(outgoing.length, 1); i += MAX_EVENTS_PER_PUSH) {
      res = await pushShare(
        code,
        i === 0 && calChanged ? cal : null,
        outgoing.slice(i, i + MAX_EVENTS_PER_PUSH),
        me,
      );
    }
  } else {
    res = await pullShare(code, since, me);
  }
  if (!res) return null;
  await clearDirtyEventIds(calendarId, outgoing.map(event => event.id));

  // 参加者は差分ではなく毎回全部返ってくるので、そのまま置き換える。
  if (Array.isArray(res.members)) {
    await setMembers(calendarId, res.members.map(fromRemoteMember));
  }
  // 通知履歴に「誰が」を出すための引き当て用。抜けたメンバーは載らないので
  // その場合は名前なしにフォールバックする(下の formatChangeHistoryEntry)。
  const memberNameById = new Map<string, string>(
    (Array.isArray(res.members) ? res.members : []).map((m: any) => [m.member_id, m.name]),
  );

  const remoteEvents: LocalEvent[] = (res.events ?? []).map((r: any) =>
    fromRemoteEvent(r, calendarId));

  // What someone ELSE changed since our own last successful sync — never our
  // own edits (creatorId === me.id), and never the very first sync of a
  // freshly-joined calendar (since === null), which would otherwise report
  // every existing event as "new" in one flood. Drives both the one-off
  // notification below and the persistent "new" indicator the caller shows
  // (e.g. LocalCalendarDetail's header badge next to the search icon).
  let changedByOthers = {added: 0, updated: 0, deleted: 0};
  if (since) {
    const priorById = new Map(events.map(e => [e.id, e]));
    let added = 0, updated = 0, deleted = 0;
    const changeEntries: Array<{type: 'added' | 'updated' | 'deleted'; event: LocalEvent}> = [];
    for (const r of remoteEvents) {
      if (r.creatorId && r.creatorId === me.id) continue;
      const prior = priorById.get(r.id);
      if (!prior || Date.parse(r.updatedAt) > Date.parse(prior.updatedAt)) {
        if (r.deleted) { if (prior && !prior.deleted) { deleted += 1; changeEntries.push({type: 'deleted', event: r}); } }
        else if (!prior) { added += 1; changeEntries.push({type: 'added', event: r}); }
        else { updated += 1; changeEntries.push({type: 'updated', event: r}); }
      }
    }
    changedByOthers = {added, updated, deleted};
    if (added || updated || deleted) {
      // The list-screen badge and the notification-history log are both
      // passive "you haven't looked at this yet" records, independent of
      // the push-notification mute — muting pings shouldn't also hide that
      // something happened or erase the log of what it was.
      await addUnseenChanges(calendarId, added + updated + deleted);
      for (const {type, event} of changeEntries) {
        const creatorName = event.creatorId ? memberNameById.get(event.creatorId) : undefined;
        const {title, body} = formatChangeHistoryEntry(type, event, creatorName);
        addNotificationHistoryEntry({title, body, calendarId}).catch(() => {});
      }
      const muted = await isSharedCalendarMuted(calendarId);
      if (!muted) {
        displaySharedCalendarChangeNotification(cal.name, {added, updated, deleted}).catch(() => {});
      }
    }
  }

  const merged = mergeEvents(events, remoteEvents);
  await deps.writeEvents(merged);

  if (res.calendar) {
    const remoteCal: LocalCalendar = {
      ...cal,
      name: res.calendar.name,
      color: res.calendar.color,
      emoji: res.calendar.emoji,
      updatedAt: res.calendar.updated_at,
      deleted: !!res.calendar.deleted,
    };
    await deps.writeCalendar(pickNewer(cal, remoteCal));
    await setInviteClosedCache(calendarId, !!res.calendar.invite_closed);
  }

  // push は全件を返すので、そのときのカーソルは「今」。pull は差分だけ。
  if (res.now) await setCursor(calendarId, res.now);
  return {pushed: outgoing.length, pulled: remoteEvents.length, changedByOthers};
};

// ── 画面から呼ぶ入口 ────────────────────────────────────────────────────────
//
// ここだけが localCalendarService に触る。画面側は共有かどうかを気にせず、
// 「共有する」「参加する」「同期する」の3つだけ知っていればいい。

import {
  addLocalCalendar,
  deleteLocalCalendar,
  getLocalCalendars,
  getLocalEventsRaw,
  replaceLocalCalendar,
  replaceLocalEvents,
} from './localCalendarService';

const io = (calendarId: string) => ({
  readCalendar: async () =>
    (await getLocalCalendars()).find(c => c.id === calendarId),
  readEvents: () => getLocalEventsRaw(calendarId),
  writeCalendar: replaceLocalCalendar,
  writeEvents: (list: LocalEvent[]) => replaceLocalEvents(calendarId, list),
});

/** 既存のローカルカレンダーを共有に切り替え、配るリンクを返す。 */
export const shareLocalCalendar = async (cal: LocalCalendar): Promise<string> => {
  const existing = await getShareCode(cal.id);
  if (existing) return shareUrl(existing);
  const code = await createShare(cal);
  await setShareCode(cal.id, code);
  // 手元の予定を最初に一度載せる。ここを忘れると、招待された側が空の
  // カレンダーを見ることになる。
  await syncSharedCalendar(cal.id, io(cal.id));
  return shareUrl(code);
};

/**
 * 招待リンクから参加する。端末ごとにローカルの id は別で構わない
 * （サーバ側はコードで束ねていて、予定は自分の id を持って回る）。
 */
export const joinSharedCalendar = async (
  code: string,
  profile?: {name: string; color: string},
): Promise<LocalCalendar | null> => {
  const meta = await fetchShareMeta(code);
  if (!meta) return null;
  // 名乗りを先に決めてから最初の同期に載せる — 決めずに参加すると仮の
  // 「名前未設定」で相手の一覧に出てしまい、後から自分で名乗り直す
  // 手間が要る(joinShareScreen が導入される前の挙動)。
  if (profile) {
    await setMyName(profile.name, '', false);
    await setMyColor(profile.color);
  }
  const cal = await addLocalCalendar(meta.name, meta.color, meta.emoji);
  await setShareCode(cal.id, code);
  await syncSharedCalendar(cal.id, io(cal.id));
  return cal;
};

/** 1つ同期する。共有していなければ何もしない。 */
export const syncCalendar = (calendarId: string) =>
  syncSharedCalendar(calendarId, io(calendarId));

/** 共有中のものを全部同期する。前面復帰時などに。 */
export const syncAllShared = async (): Promise<void> => {
  const cals = await getLocalCalendars();
  for (const c of cals) {
    try {
      await syncCalendar(c.id);
    } catch {
      // 1つ失敗しても残りは続ける
    }
  }
};

/** Subscribe to a public Realtime topic whose unguessable share code is the capability. */
export const subscribeSharedCalendar = async (
  calendarId: string, onChange: () => void,
): Promise<() => void> => {
  const code = await getShareCode(calendarId);
  if (!code || typeof WebSocket === 'undefined') return () => {};
  let closed = false;
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const topic = `realtime:calendar:${code}`;
  const connect = () => {
    if (closed) return;
    socket = new WebSocket(`${SUPABASE_URL.replace('https://','wss://')}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`);
    socket.onopen = () => {
      attempt = 0;
      socket?.send(JSON.stringify({topic,event:'phx_join',payload:{config:{broadcast:{ack:false,self:false},presence:{enabled:false},private:false}},ref:'1',join_ref:'1'}));
      heartbeat = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(Date.now())})),25_000);
    };
    socket.onmessage = event => {
      try { const msg=JSON.parse(String(event.data)); if (msg.topic===topic && msg.event==='broadcast' && msg.payload?.event==='changed') onChange(); } catch {}
    };
    socket.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (!closed) retry=setTimeout(connect,Math.min(30_000,1000*2**attempt++));
    };
    socket.onerror = () => socket?.close();
  };
  connect();
  return () => { closed=true; if(heartbeat)clearInterval(heartbeat);if(retry)clearTimeout(retry);socket?.close(); };
};
