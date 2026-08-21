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
/** この端末の名乗り。全部の共有カレンダーで同じものを使う。 */
const ME_KEY = '@shared_calendar_me';
/** calendarId -> 参加者一覧。圏外でも「誰と共有しているか」は出したい。 */
const MEMBERS_KEY = '@shared_calendar_members';

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
  /** 最後にこの共有を同期した時刻。「まだ見ていない」を出すのに使う。 */
  lastSeenAt: string;
  updatedAt: string;
  /** 自分自身かどうか。サーバから来る値ではなく、読み出すときに付ける。 */
  isMe?: boolean;
};

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
  updatedAt: string;
  /** 本人が決めた名前ではなく、こちらが仮に付けたもの。 */
  auto?: boolean;
};

export const getMe = async (): Promise<Me | null> => {
  const raw = await AsyncStorage.getItem(ME_KEY);
  if (!raw) return null;
  try {
    const me = JSON.parse(raw) as Me;
    return me.id && me.name ? me : null;
  } catch {
    return null;
  }
};

/** 名乗りを決める / 変える。id は一度作ったら引き継ぐ。 */
export const setMyName = async (name: string, emoji = '', auto = false): Promise<Me> => {
  const prev = await getMe();
  const me: Me = {
    id: prev?.id ?? newMemberId(),
    name: name.trim().slice(0, 24),
    emoji,
    updatedAt: new Date().toISOString(),
    auto,
  };
  await AsyncStorage.setItem(ME_KEY, JSON.stringify(me));
  return me;
};

/**
 * 仮の名前。**必ず defaultValue を付ける。**
 *
 * i18next は訳が見つからないとキー文字列をそのまま返すので、付けないと
 * 「shareNameUnset」という名前で相手の一覧に並ぶ。実際に一度そうなった。
 * これは自分の画面では確認しづらい（相手の端末にだけ出る）。
 */
const autoName = (): string => i18n.t('shareNameUnset', {defaultValue: 'No name set'});

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
  if (me && (!me.auto || me.name === autoName())) return me;
  return setMyName(autoName(), '', true);
};

/** calendarId ごとに覚えている参加者。自分には isMe を立てて返す。 */
export const getMembers = async (calendarId: string): Promise<ShareMember[]> => {
  const [map, me] = await Promise.all([
    readMap<ShareMember[]>(MEMBERS_KEY),
    getMe(),
  ]);
  return (map[calendarId] ?? []).map(m => ({...m, isMe: !!me && m.id === me.id}));
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
  lastSeenAt: r.last_seen_at,
  updatedAt: r.updated_at,
});

/** 自分を先頭に、あとは最後に同期した順。誰が動いているかが上に来る。 */
export const sortMembers = (list: ShareMember[]): ShareMember[] =>
  [...list].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });

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

const toRemoteMember = (me: Me | null) =>
  me ? {id: me.id, name: me.name, emoji: me.emoji, updatedAt: me.updatedAt} : null;

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
): Promise<{pushed: number; pulled: number} | null> => {
  const code = await getShareCode(calendarId);
  if (!code) return null;

  const since = await getCursor(calendarId);
  const [cal, events] = await Promise.all([deps.readCalendar(), deps.readEvents()]);
  if (!cal) return null;

  const outgoing = changedSince(events, since);
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

  // 参加者は差分ではなく毎回全部返ってくるので、そのまま置き換える。
  if (Array.isArray(res.members)) {
    await setMembers(calendarId, res.members.map(fromRemoteMember));
  }

  const remoteEvents: LocalEvent[] = (res.events ?? []).map((r: any) =>
    fromRemoteEvent(r, calendarId));
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
  }

  // push は全件を返すので、そのときのカーソルは「今」。pull は差分だけ。
  if (res.now) await setCursor(calendarId, res.now);
  return {pushed: outgoing.length, pulled: remoteEvents.length};
};

// ── 画面から呼ぶ入口 ────────────────────────────────────────────────────────
//
// ここだけが localCalendarService に触る。画面側は共有かどうかを気にせず、
// 「共有する」「参加する」「同期する」の3つだけ知っていればいい。

import {
  addLocalCalendar,
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
export const joinSharedCalendar = async (code: string): Promise<LocalCalendar | null> => {
  const meta = await fetchShareMeta(code);
  if (!meta) return null;
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
