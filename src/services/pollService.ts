// ── ③ グループ日程調整（持ち寄り） ──────────────────────────────────────────
//
// On-device scheduling polls ("飲み会いつ?"). You pick candidate dates, share
// them, and tally who can make it — the 調整さん flow, built into the calendar.
//
// NOTE: live remote collection (invitees answering via a link without the app)
// requires a backend, which is out of the current zero-cost scope. Until then
// this is a manual tally / pass-the-phone board: you enter responses you gather
// in LINE, or hand the phone around. The data model is already shaped so a sync
// layer can be added later without changing the UI.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type Availability = 'yes' | 'maybe' | 'no';

export interface Attendee {
  id: string;
  name: string;
  responses: Record<string, Availability>; // candidate dateKey -> availability
}

export interface Poll {
  id: string;
  title: string;
  candidates: string[]; // dateKeys "YYYY-MM-DD", sorted
  attendees: Attendee[];
  createdAt: string;
}

const KEY = '@schedule_polls';

const genId = (prefix: string): string =>
  prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

export const getPolls = async (): Promise<Poll[]> => {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Poll[];
  } catch {
    return [];
  }
};

const saveAll = async (list: Poll[]): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
};

// Serialize read-modify-write on the poll list so two rapid mutations (e.g.
// tapping availability cells faster than a storage round-trip) don't each read
// the same pre-write list and clobber each other's change.
let writeChain: Promise<unknown> = Promise.resolve();
const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

export const createPoll = async (title: string, candidates: string[]): Promise<Poll> =>
  withLock(async () => {
    const list = await getPolls();
    const poll: Poll = {
      id: genId('poll'),
      title: title.trim() || '日程調整',
      candidates: [...candidates].sort(),
      attendees: [],
      createdAt: new Date().toISOString(),
    };
    list.unshift(poll);
    await saveAll(list);
    return poll;
  });

export const updatePoll = async (poll: Poll): Promise<void> =>
  withLock(async () => {
    const list = await getPolls();
    const idx = list.findIndex(p => p.id === poll.id);
    if (idx === -1) return;
    list[idx] = poll;
    await saveAll(list);
  });

export const deletePoll = async (id: string): Promise<Poll[]> =>
  withLock(async () => {
    const list = await getPolls();
    const next = list.filter(p => p.id !== id);
    await saveAll(next);
    return next;
  });

export const addAttendee = (poll: Poll, name: string): Poll => ({
  ...poll,
  attendees: [...poll.attendees, {id: genId('att'), name: name.trim() || 'ゲスト', responses: {}}],
});

export const cycleResponse = (poll: Poll, attendeeId: string, dateKey: string): Poll => {
  const order: (Availability | undefined)[] = ['yes', 'maybe', 'no', undefined];
  return {
    ...poll,
    attendees: poll.attendees.map(a => {
      if (a.id !== attendeeId) return a;
      const cur = a.responses[dateKey];
      const next = order[(order.indexOf(cur) + 1) % order.length];
      const responses = {...a.responses};
      if (next === undefined) delete responses[dateKey];
      else responses[dateKey] = next;
      return {...a, responses};
    }),
  };
};

export interface CandidateTally {
  dateKey: string;
  yes: number;
  maybe: number;
  no: number;
}

/** Per-candidate counts and the best date (most yes, then most maybe). */
export const tally = (poll: Poll): {tallies: CandidateTally[]; bestKey: string | null} => {
  const tallies: CandidateTally[] = poll.candidates.map(dateKey => {
    let yes = 0;
    let maybe = 0;
    let no = 0;
    for (const a of poll.attendees) {
      const r = a.responses[dateKey];
      if (r === 'yes') yes++;
      else if (r === 'maybe') maybe++;
      else if (r === 'no') no++;
    }
    return {dateKey, yes, maybe, no};
  });
  let bestKey: string | null = null;
  let bestScore = -1;
  for (const t of tallies) {
    const score = t.yes * 2 + t.maybe - t.no * 3;
    if (poll.attendees.length > 0 && score > bestScore) {
      bestScore = score;
      bestKey = t.dateKey;
    }
  }
  return {tallies, bestKey};
};
