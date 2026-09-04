/**
 * @format
 *
 * displaySharedCalendarChangeNotification feeds the bell icon's history in
 * addition to the notifee banner — and must keep doing so even when the
 * user has the banner toggle off, since the history is its own record of
 * "this happened," independent of whether a banner was shown for it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee from '@notifee/react-native';
import i18n from '../src/i18n/i18n';
import {
  displaySharedCalendarChangeNotification,
  setNotificationsEnabled,
} from '../src/services/notificationService';
import {getNotificationHistory} from '../src/services/notificationHistoryService';

describe('displaySharedCalendarChangeNotification', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await i18n.changeLanguage('ja');
    await setNotificationsEnabled(true);
  });

  it('shows a notifee banner and records history when enabled', async () => {
    await displaySharedCalendarChangeNotification('サークル', {added: 1, updated: 0, deleted: 0}, 'lc-1');

    expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
    const history = await getNotificationHistory();
    expect(history[0].title).toContain('サークル');
    expect(history[0].calendarId).toBe('lc-1');
  });

  it('still records history when the banner toggle is off', async () => {
    await setNotificationsEnabled(false);
    await displaySharedCalendarChangeNotification('サークル', {added: 0, updated: 1, deleted: 0});

    expect(notifee.displayNotification).not.toHaveBeenCalled();
    const history = await getNotificationHistory();
    expect(history.length).toBe(1);
  });

  it('does nothing at all when there are no changes', async () => {
    await displaySharedCalendarChangeNotification('サークル', {added: 0, updated: 0, deleted: 0});

    expect(notifee.displayNotification).not.toHaveBeenCalled();
    expect(await getNotificationHistory()).toEqual([]);
  });
});
