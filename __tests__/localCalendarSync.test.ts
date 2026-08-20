/**
 * @format
 *
 * 共有カレンダーの土台。
 *
 * 同期方式が何であれ、この2つが無いと成立しない:
 *   - updatedAt … どちらの編集が新しいか判定できない
 *   - 論理削除 … 物理削除だと「消した」事実が残らず、次の同期で復活する
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addLocalCalendar,
  deleteLocalCalendar,
  deleteLocalEvent,
  getLocalCalendars,
  getLocalCalendarsRaw,
  getLocalEventCounts,
  getLocalEvents,
  getLocalEventsRaw,
  saveLocalEvent,
  updateLocalCalendar,
} from '../src/services/localCalendarService';

const newEvent = (calendarId: string, title: string) =>
  saveLocalEvent({
    calendarId, title,
    startDate: '2030-01-15', endDate: '2030-01-15', allDay: true,
  });

describe('共有に向けたローカルカレンダー', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('作成時に updatedAt が入る', async () => {
    const cal = await addLocalCalendar('サークル', '#007AFF', '🍻');
    expect(cal.updatedAt).toBeTruthy();
    expect(cal.updatedAt).toBe(cal.createdAt);
  });

  it('編集すると updatedAt だけが進む', async () => {
    const cal = await addLocalCalendar('サークル', '#007AFF', '🍻');
    await new Promise<void>(r => setTimeout(() => r(), 5));
    await updateLocalCalendar(cal.id, {name: '打ち上げ'});

    const after = (await getLocalCalendars())[0];
    expect(after.name).toBe('打ち上げ');
    expect(after.createdAt).toBe(cal.createdAt);
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(cal.updatedAt));
  });

  it('消したカレンダーは画面から消えるが、記録には残る', async () => {
    const cal = await addLocalCalendar('サークル', '#007AFF', '🍻');
    await deleteLocalCalendar(cal.id);

    expect(await getLocalCalendars()).toHaveLength(0);
    const raw = await getLocalCalendarsRaw();
    expect(raw).toHaveLength(1);
    expect(raw[0].deleted).toBe(true);
  });

  it('カレンダーを消すと中の予定も消したことになる', async () => {
    const cal = await addLocalCalendar('サークル', '#007AFF', '🍻');
    await newEvent(cal.id, '飲み会');
    await deleteLocalCalendar(cal.id);

    expect(await getLocalEvents(cal.id)).toHaveLength(0);
    const raw = await getLocalEventsRaw(cal.id);
    expect(raw).toHaveLength(1);
    expect(raw[0].deleted).toBe(true);
  });

  it('消した予定は記録に残る（残さないと同期で復活する）', async () => {
    const cal = await addLocalCalendar('サークル', '#007AFF', '🍻');
    const ev = await newEvent(cal.id, '飲み会');
    await deleteLocalEvent(cal.id, ev.id);

    expect(await getLocalEvents(cal.id)).toHaveLength(0);
    const raw = await getLocalEventsRaw(cal.id);
    expect(raw[0].deleted).toBe(true);
    expect(Date.parse(raw[0].updatedAt)).toBeGreaterThanOrEqual(Date.parse(ev.updatedAt));
  });

  it('件数に消した予定を数えない', async () => {
    const cal = await addLocalCalendar('サークル', '#007AFF', '🍻');
    const a = await newEvent(cal.id, '飲み会');
    await newEvent(cal.id, '二次会');
    await deleteLocalEvent(cal.id, a.id);

    expect((await getLocalEventCounts())[cal.id]).toBe(1);
  });

  it('updatedAt を持たない古いデータは createdAt で補う', async () => {
    // 旧バージョンが書いた形。移行を別途走らせなくても読めること。
    await AsyncStorage.setItem('@local_calendars', JSON.stringify([
      {id: 'lc-old', name: '旧', color: '#000', emoji: '📅',
       createdAt: '2026-01-01T00:00:00.000Z'},
    ]));
    await AsyncStorage.setItem('@local_calendar_events', JSON.stringify({
      'lc-old': [{id: 'le-old', calendarId: 'lc-old', title: '旧予定',
                  startDate: '2026-01-01', endDate: '2026-01-01', allDay: true,
                  createdAt: '2026-01-02T00:00:00.000Z'}],
    }));

    expect((await getLocalCalendars())[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect((await getLocalEvents('lc-old'))[0].updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
