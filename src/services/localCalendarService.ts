// ── ローカルカレンダー（TimeTree風サブカレンダー）─────────────────────────────
//
// Lets the user create extra, fully on-device calendars (e.g. "プライベート",
// "推し活") that are SEPARATE from the main iCloud/EventKit calendar. Each local
// calendar owns its own events, stored in AsyncStorage — nothing here touches
// EventKit, so these never sync to the cloud or appear in the system Calendar.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CAL_KEY = '@local_calendars';
const EVT_KEY = '@local_calendar_events';

export interface LocalCalendar {
  id: string;
  name: string;
  color: string;
  emoji: string;
  createdAt: string;
  /** 最終更新時刻。共有時にどちらの編集が新しいかを決めるのに使う。 */
  updatedAt: string;
  /** 論理削除。物理削除すると「消したこと」が相手に伝わらない。 */
  deleted?: boolean;
}

export interface LocalEvent {
  id: string;
  calendarId: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (== startDate for single-day)
  allDay: boolean;
  startTime?: string; // HH:mm (when !allDay)
  endTime?: string; // HH:mm (when !allDay)
  memo?: string;
  /** 共有メンバーID。作成者は後から別の人が編集しても変えない。 */
  creatorId?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  /** 絶対起床アラーム(着信画面風通知)を有効にするか。allDayイベントには適用不可。 */
  mustWake?: boolean;
  /** 発火オフセット(分、開始時刻からの相対値。0またはnullは開始時刻ちょうど)。 */
  mustWakeOffsetMinutes?: number | null;
}

type EventMap = Record<string, LocalEvent[]>; // calendarId -> events

const genId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Serialize read-modify-write so concurrent saves can't clobber the map.
let writeChain: Promise<unknown> = Promise.resolve();
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

// ── Calendars ────────────────────────────────────────────────────────────────

/**
 * 生の保存内容。論理削除ぶんも含む。同期層はこちらを見る。
 *
 * updatedAt が無い時代のデータは createdAt で補う。移行スクリプトを別に持つと
 * 「走ったかどうか」を気にし続けることになるので、読むたびに埋める。
 */
export const getLocalCalendarsRaw = async (): Promise<LocalCalendar[]> => {
  const raw = await AsyncStorage.getItem(CAL_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as LocalCalendar[];
    return list.map(c => (c.updatedAt ? c : {...c, updatedAt: c.createdAt}));
  } catch {
    return [];
  }
};

/** 画面に出すぶん。消したものは除く。 */
export const getLocalCalendars = async (): Promise<LocalCalendar[]> =>
  (await getLocalCalendarsRaw()).filter(c => !c.deleted);

const writeCalendars = async (list: LocalCalendar[]): Promise<void> => {
  await AsyncStorage.setItem(CAL_KEY, JSON.stringify(list));
};

export const addLocalCalendar = async (
  name: string,
  color: string,
  emoji: string,
): Promise<LocalCalendar> =>
  withLock(async () => {
    const now = new Date().toISOString();
    const list = await getLocalCalendarsRaw();
    const cal: LocalCalendar = {
      id: genId('lc'),
      name: name.trim(),
      color,
      emoji,
      createdAt: now,
      updatedAt: now,
    };
    list.push(cal);
    await writeCalendars(list);
    return cal;
  });

export const updateLocalCalendar = async (
  id: string,
  patch: Partial<Pick<LocalCalendar, 'name' | 'color' | 'emoji'>>,
): Promise<void> =>
  withLock(async () => {
    const list = await getLocalCalendarsRaw();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return;
    list[idx] = {
      ...list[idx],
      ...(patch.name !== undefined ? {name: patch.name.trim()} : {}),
      ...(patch.color !== undefined ? {color: patch.color} : {}),
      ...(patch.emoji !== undefined ? {emoji: patch.emoji} : {}),
      updatedAt: new Date().toISOString(),
    };
    await writeCalendars(list);
  });

export const deleteLocalCalendar = async (id: string): Promise<void> =>
  withLock(async () => {
    const now = new Date().toISOString();
    const list = await getLocalCalendarsRaw();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return;
    list[idx] = {...list[idx], deleted: true, updatedAt: now};
    await writeCalendars(list);
    // 中の予定も消したことにする。残しておくと、共有先で親だけ消えて
    // 子が孤児として残る。
    const map = await loadEventMap();
    if (map[id]) {
      map[id] = map[id].map(e => ({...e, deleted: true, updatedAt: now}));
      await writeEventMap(map);
    }
  });

// ── Events ───────────────────────────────────────────────────────────────────

const loadEventMap = async (): Promise<EventMap> => {
  const raw = await AsyncStorage.getItem(EVT_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as EventMap;
  } catch {
    return {};
  }
};

const writeEventMap = async (map: EventMap): Promise<void> => {
  await AsyncStorage.setItem(EVT_KEY, JSON.stringify(map));
};

/** 生の予定。論理削除ぶんも含む。同期層はこちらを見る。 */
export const getLocalEventsRaw = async (calendarId: string): Promise<LocalEvent[]> => {
  const map = await loadEventMap();
  return (map[calendarId] ?? []).map(e => (e.updatedAt ? e : {...e, updatedAt: e.createdAt}));
};

/** 画面に出すぶん。消したものは除く。 */
export const getLocalEvents = async (calendarId: string): Promise<LocalEvent[]> =>
  (await getLocalEventsRaw(calendarId)).filter(e => !e.deleted);

/** calendarId -> event count, for the calendar list. */
export const getLocalEventCounts = async (): Promise<Record<string, number>> => {
  const map = await loadEventMap();
  const counts: Record<string, number> = {};
  for (const id of Object.keys(map)) {
    counts[id] = (map[id] ?? []).filter(e => !e.deleted).length;
  }
  return counts;
};

/** Create (no id) or update (existing id) an event. Returns the saved event. */
export const saveLocalEvent = async (
  evt: Omit<LocalEvent, 'id' | 'createdAt' | 'updatedAt' | 'deleted'> &
    {id?: string; createdAt?: string},
): Promise<LocalEvent> =>
  withLock(async () => {
    const map = await loadEventMap();
    const list = map[evt.calendarId] ?? [];
    if (evt.id) {
      const idx = list.findIndex(e => e.id === evt.id);
      if (idx !== -1) {
        const saved: LocalEvent = {
          ...list[idx], ...evt, id: evt.id, updatedAt: new Date().toISOString(),
        } as LocalEvent;
        list[idx] = saved;
        map[evt.calendarId] = list;
        await writeEventMap(map);
        return saved;
      }
    }
    const now = new Date().toISOString();
    const saved: LocalEvent = {
      ...evt,
      id: genId('le'),
      createdAt: now,
      updatedAt: now,
    } as LocalEvent;
    map[evt.calendarId] = [...list, saved];
    await writeEventMap(map);
    return saved;
  });

/**
 * 1カレンダーぶんの予定をまとめて置き換える。同期の取り込み用。
 *
 * 1件ずつ saveLocalEvent を呼ぶと、取り込みのたびに updatedAt が「今」に
 * 書き換わってしまい、サーバから受け取った時刻が消える。合流の勝ち負けが
 * 次の同期で狂うので、受け取った値のまま書く経路が要る。
 */
export const replaceLocalEvents = async (
  calendarId: string, list: LocalEvent[],
): Promise<void> =>
  withLock(async () => {
    const map = await loadEventMap();
    map[calendarId] = list;
    await writeEventMap(map);
  });

/** 同期で受け取ったカレンダー情報をそのまま書く（updatedAt を保つ）。 */
export const replaceLocalCalendar = async (cal: LocalCalendar): Promise<void> =>
  withLock(async () => {
    const list = await getLocalCalendarsRaw();
    const idx = list.findIndex(c => c.id === cal.id);
    if (idx === -1) list.push(cal);
    else list[idx] = cal;
    await writeCalendars(list);
  });

export const deleteLocalEvent = async (
  calendarId: string,
  eventId: string,
): Promise<void> =>
  withLock(async () => {
    const map = await loadEventMap();
    const list = map[calendarId];
    if (!list) return;
    // 物理削除だと「消した」という事実が残らず、共有相手から次の同期で
    // 復活してくる。印だけ付けて残す。
    map[calendarId] = list.map(e =>
      e.id === eventId ? {...e, deleted: true, updatedAt: new Date().toISOString()} : e,
    );
    await writeEventMap(map);
  });
