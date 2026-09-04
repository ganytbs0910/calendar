/**
 * @format
 *
 * The bell icon's history — a browsable log of past shared-calendar change
 * notifications. Before this, a notifee banner was fire-and-forget: nothing
 * about it was kept anywhere, so once it disappeared it was gone for good.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addNotificationHistoryEntry,
  getNotificationHistory,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  clearNotificationHistory,
} from '../src/services/notificationHistoryService';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('notificationHistoryService', () => {
  it('records an entry, newest first', async () => {
    await addNotificationHistoryEntry({title: '古い方', body: '追加 1件'});
    await addNotificationHistoryEntry({title: '新しい方', body: '変更 1件', calendarId: 'lc-1'});

    const list = await getNotificationHistory();
    expect(list.map(e => e.title)).toEqual(['新しい方', '古い方']);
    expect(list[0].calendarId).toBe('lc-1');
    expect(list[0].read).toBe(false);
  });

  it('caps the log at 100 entries, dropping the oldest', async () => {
    for (let i = 0; i < 105; i++) {
      await addNotificationHistoryEntry({title: `#${i}`, body: ''});
    }
    const list = await getNotificationHistory();
    expect(list.length).toBe(100);
    // Newest (#104) survives, oldest (#0..#4) were pruned.
    expect(list[0].title).toBe('#104');
    expect(list.some(e => e.title === '#0')).toBe(false);
  });

  it('counts unread entries and marks them all read', async () => {
    await addNotificationHistoryEntry({title: 'A', body: ''});
    await addNotificationHistoryEntry({title: 'B', body: ''});
    expect(await getUnreadNotificationCount()).toBe(2);

    await markAllNotificationsRead();
    expect(await getUnreadNotificationCount()).toBe(0);
    const list = await getNotificationHistory();
    expect(list.every(e => e.read)).toBe(true);
  });

  it('clears the log', async () => {
    await addNotificationHistoryEntry({title: 'A', body: ''});
    await clearNotificationHistory();
    expect(await getNotificationHistory()).toEqual([]);
  });
});
