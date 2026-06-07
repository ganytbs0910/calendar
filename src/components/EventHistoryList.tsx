import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../theme/ThemeContext';
import {
  EventHistoryEntry,
  getEventHistory,
  deleteEventHistoryEntry,
} from '../services/eventHistoryService';

interface EventHistoryListProps {
  onPick: (entry: EventHistoryEntry) => void;
  refreshKey?: number;
}

const formatDuration = (
  minutes: number,
  t: (k: string, opts?: any) => string,
): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return t('hoursMinutesFmt', {h, m});
  if (h > 0) return t('hoursFmt', {h});
  return t('minutesFmt', {m});
};

export const EventHistoryList: React.FC<EventHistoryListProps> = ({onPick, refreshKey}) => {
  const {t} = useTranslation();
  const {colors} = useTheme();
  const [entries, setEntries] = useState<EventHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await getEventHistory();
    setEntries(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const handleDelete = useCallback(
    (entry: EventHistoryEntry) => {
      Alert.alert(
        t('deleteHistoryEntry'),
        t('deleteHistoryEntryConfirm', {title: entry.title}),
        [
          {text: t('cancel'), style: 'cancel'},
          {
            text: t('delete'),
            style: 'destructive',
            onPress: async () => {
              await deleteEventHistoryEntry(entry.id);
              refresh();
            },
          },
        ],
      );
    },
    [t, refresh],
  );

  if (loaded && entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, {color: colors.text}]}>{t('noEventHistory')}</Text>
        <Text style={[styles.emptyHint, {color: colors.textTertiary}]}>{t('eventHistoryHint')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={item => item.id}
      keyboardShouldPersistTaps="handled"
      renderItem={({item}) => (
        <TouchableOpacity
          style={[styles.row, {borderBottomColor: colors.borderLight}]}
          onPress={() => onPick(item)}
          onLongPress={() => handleDelete(item)}>
          <View style={[styles.colorDot, {backgroundColor: item.color}]} />
          <View style={styles.body}>
            <Text style={[styles.title, {color: colors.text}]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.meta, {color: colors.textTertiary}]} numberOfLines={1}>
              {formatDuration(item.durationMinutes, t)}
              {item.recurrence !== 'none' ? ` · ${t(`repeat${item.recurrence.charAt(0).toUpperCase()}${item.recurrence.slice(1)}`)}` : ''}
            </Text>
          </View>
          <View style={[styles.countBadge, {backgroundColor: colors.surfaceSecondary}]}>
            <Text style={[styles.countText, {color: colors.textSecondary}]}>
              {t('eventHistoryUseCount', {count: item.count})}
            </Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  meta: {
    fontSize: 12,
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
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

export default EventHistoryList;
