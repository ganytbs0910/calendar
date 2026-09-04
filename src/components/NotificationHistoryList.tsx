import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../theme/ThemeContext';
import {
  NotificationHistoryEntry,
  getNotificationHistory,
} from '../services/notificationHistoryService';

interface NotificationHistoryListProps {
  refreshKey?: number;
}

const relativeTime = (iso: string, t: (k: string, opts?: any) => string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return t('minutesAgo', {count: minutes});
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('hoursAgo', {count: hours});
  const days = Math.floor(hours / 24);
  if (days < 7) return t('daysAgo', {count: days});
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const NotificationHistoryList: React.FC<NotificationHistoryListProps> = ({refreshKey}) => {
  const {t} = useTranslation();
  const {colors} = useTheme();
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await getNotificationHistory();
    setEntries(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  if (loaded && entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, {color: colors.text}]}>{t('noNotificationHistory')}</Text>
        <Text style={[styles.emptyHint, {color: colors.textTertiary}]}>{t('notificationHistoryHint')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={item => item.id}
      renderItem={({item}) => (
        <View style={[styles.row, {borderBottomColor: colors.borderLight}]}>
          <View style={styles.body}>
            <Text style={[styles.title, {color: colors.text}]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.bodyText, {color: colors.textSecondary}]} numberOfLines={2}>
              {item.body}
            </Text>
          </View>
          <Text style={[styles.time, {color: colors.textTertiary}]}>{relativeTime(item.createdAt, t)}</Text>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  bodyText: {
    fontSize: 13,
  },
  time: {
    fontSize: 11,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 6,
  },
  emptyHint: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default NotificationHistoryList;
