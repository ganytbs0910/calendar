// ── 写真フォルダタブ ─────────────────────────────────────────────────────────
//
// A gallery that gathers every photo attached to events (see eventPhotoService)
// into one place. The user can group by month / event / category(color), flip
// the sort order, and filter to a single category — so a growing life log stays
// browsable. Fully on-device; reads the same @event_photos store as the badges.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import RNCalendarEvents from 'react-native-calendar-events';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../theme/ThemeContext';
import {ThemeColors} from '../theme/colors';
import {getAllEventPhotos, EventPhotoEntry} from '../services/eventPhotoService';
import {getEventColor} from './AddEventModal';
import {getUserCalendars, resolveCalendarName} from '../services/userCalendarService';

interface Props {
  visible: boolean;
}

type GroupMode = 'month' | 'event' | 'category';

interface EventInfo {
  title: string;
  date?: string; // event start ISO
  color: string; // resolved category color (hex)
}

interface Group {
  key: string;
  label: string;
  sublabel?: string;
  color?: string;
  items: EventPhotoEntry[];
}

const OTHER_COLOR = '#8E8E93';
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const PhotosScreen: React.FC<Props> = ({visible}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const {width} = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [entries, setEntries] = useState<EventPhotoEntry[]>([]);
  const [info, setInfo] = useState<Record<string, EventInfo>>({});
  const [colorLabels, setColorLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [viewer, setViewer] = useState<EventPhotoEntry | null>(null);

  const [groupMode, setGroupMode] = useState<GroupMode>('month');
  const [sortDesc, setSortDesc] = useState(true);
  const [filterColor, setFilterColor] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // Only the first load gets a spinner. Re-entering the tab refreshes in the
    // background so the grid never blanks out on a switch.
    if (!loadedOnce.current) setLoading(true);
    const all = await getAllEventPhotos();
    setEntries(all);
    loadedOnce.current = true;
    setLoading(false);

    // Category color → label map (from the user's calendar/category palette).
    try {
      const cals = await getUserCalendars();
      const map: Record<string, string> = {};
      for (const c of cals) map[c.color.toUpperCase()] = resolveCalendarName(c, t);
      setColorLabels(map);
    } catch {
      // ignore
    }

    // Enrich each event with title / date / resolved category color (best-effort).
    const ids = Array.from(new Set(all.map(e => e.eventId)));
    const map: Record<string, EventInfo> = {};
    await Promise.all(
      ids.map(async id => {
        let title = '';
        let date: string | undefined;
        let calColor: string | undefined;
        try {
          const ev = await RNCalendarEvents.findEventById(id);
          if (ev) {
            title = ev.title || '';
            date = ev.startDate;
            calColor = ev.calendar?.color;
          }
        } catch {
          // ignore missing/inaccessible events
        }
        let custom: string | null = null;
        try {
          custom = await getEventColor(id);
        } catch {
          // ignore
        }
        map[id] = {title, date, color: (custom || calColor || OTHER_COLOR).toUpperCase()};
      }),
    );
    setInfo(map);
  }, [t]);

  useEffect(() => {
    if (visible) reload();
  }, [visible, reload]);

  const colorOf = useCallback(
    (e: EventPhotoEntry) => info[e.eventId]?.color || OTHER_COLOR,
    [info],
  );
  const labelOf = useCallback(
    (color: string) => colorLabels[color.toUpperCase()] || t('photosOther'),
    [colorLabels, t],
  );

  // Category chips: distinct colors present, with counts (palette/most-used order).
  const categoryChips = useMemo(() => {
    const m = new Map<string, {color: string; count: number}>();
    for (const e of entries) {
      const color = colorOf(e);
      const key = color.toUpperCase();
      const cur = m.get(key);
      if (cur) cur.count++;
      else m.set(key, {color, count: 1});
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [entries, colorOf]);

  // Apply sort + filter, then group.
  const groups: Group[] = useMemo(() => {
    let list = [...entries];
    list.sort((a, b) =>
      a.addedAt < b.addedAt ? (sortDesc ? 1 : -1) : a.addedAt > b.addedAt ? (sortDesc ? -1 : 1) : 0,
    );
    if (filterColor) list = list.filter(e => colorOf(e).toUpperCase() === filterColor.toUpperCase());

    const m = new Map<string, Group>();
    for (const e of list) {
      let key: string;
      let make: () => Group;
      if (groupMode === 'month') {
        const d = new Date(e.addedAt);
        key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        make = () => ({
          key,
          label: t('photosMonthLabel', {year: d.getFullYear(), month: d.getMonth() + 1}),
          items: [],
        });
      } else if (groupMode === 'event') {
        key = e.eventId;
        const inf = info[e.eventId];
        make = () => ({
          key,
          label: inf?.title || t('photosNoEvent'),
          sublabel: inf?.date ? fmtDate(inf.date) : undefined,
          color: inf?.color,
          items: [],
        });
      } else {
        const color = colorOf(e);
        key = color.toUpperCase();
        make = () => ({key, label: labelOf(color), color, items: []});
      }
      let g = m.get(key);
      if (!g) {
        g = make();
        m.set(key, g);
      }
      g.items.push(e);
    }
    return Array.from(m.values());
  }, [entries, groupMode, sortDesc, filterColor, info, colorOf, labelOf, t]);

  const cols = 3;
  const gap = 3;
  const outer = 12;
  const thumb = Math.floor((width - outer * 2 - gap * (cols - 1)) / cols);

  const viewerInfo = viewer ? info[viewer.eventId] : undefined;

  const GROUP_MODES: {key: GroupMode; labelKey: string}[] = [
    {key: 'month', labelKey: 'photosGroupMonth'},
    {key: 'event', labelKey: 'photosGroupEvent'},
    {key: 'category', labelKey: 'photosGroupCategory'},
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('tabPhotos')}</Text>
        {!loading && entries.length > 0 && (
          <View style={styles.headerRight}>
            <Text style={styles.headerCount}>{t('photosCount', {count: entries.length})}</Text>
            <TouchableOpacity
              style={styles.sortBtn}
              onPress={() => setSortDesc(s => !s)}
              accessibilityLabel={sortDesc ? t('photosSortDesc') : t('photosSortAsc')}>
              <Ionicons
                name={sortDesc ? 'arrow-down' : 'arrow-up'}
                size={15}
                color={colors.primary}
              />
              <Text style={styles.sortText}>{sortDesc ? t('photosSortDesc') : t('photosSortAsc')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="images-outline" size={56} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>{t('photosEmptyTitle')}</Text>
          <Text style={styles.emptyDesc}>{t('photosEmptyDesc')}</Text>
        </View>
      ) : (
        <>
          {/* Grouping segmented control */}
          <View style={styles.segment}>
            {GROUP_MODES.map(m => {
              const active = groupMode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.segmentBtn, active && {backgroundColor: colors.surface}]}
                  onPress={() => setGroupMode(m.key)}>
                  <Text style={[styles.segmentText, active && {color: colors.primary, fontWeight: '700'}]}>
                    {t(m.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Category filter chips */}
          {categoryChips.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipBar}
              contentContainerStyle={styles.chipBarContent}>
              <TouchableOpacity
                style={[styles.chip, !filterColor && {backgroundColor: colors.primary, borderColor: colors.primary}]}
                onPress={() => setFilterColor(null)}>
                <Text style={[styles.chipText, !filterColor && {color: colors.onPrimary}]}>
                  {t('photosAll')}
                </Text>
              </TouchableOpacity>
              {categoryChips.map(c => {
                const active = filterColor?.toUpperCase() === c.color.toUpperCase();
                return (
                  <TouchableOpacity
                    key={c.color}
                    style={[styles.chip, active && {backgroundColor: colors.surfaceSecondary, borderColor: c.color}]}
                    onPress={() => setFilterColor(active ? null : c.color)}>
                    <View style={[styles.chipDot, {backgroundColor: c.color}]} />
                    <Text style={styles.chipText}>{labelOf(c.color)}</Text>
                    <Text style={styles.chipCount}>{c.count}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {groups.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyDesc}>{t('photosFilterEmpty')}</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{paddingBottom: 24}}>
              {groups.map(g => (
                <View key={g.key}>
                  <View style={styles.groupHeader}>
                    {!!g.color && <View style={[styles.groupDot, {backgroundColor: g.color}]} />}
                    <Text style={styles.groupLabel} numberOfLines={1}>{g.label}</Text>
                    {!!g.sublabel && <Text style={styles.groupSub}>{g.sublabel}</Text>}
                    <View style={{flex: 1}} />
                    <Text style={styles.groupCount}>{g.items.length}</Text>
                  </View>
                  <View style={[styles.grid, {paddingHorizontal: outer}]}>
                    {g.items.map(e => (
                      <TouchableOpacity
                        key={e.uri}
                        activeOpacity={0.85}
                        onPress={() => setViewer(e)}
                        style={{marginRight: gap, marginBottom: gap}}>
                        <Image
                          source={{uri: e.uri}}
                          style={{width: thumb, height: thumb, borderRadius: 4, backgroundColor: colors.surfaceSecondary}}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}

      <Modal
        visible={!!viewer}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerBg}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewer(null)}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          {viewer && <Image source={{uri: viewer.uri}} style={styles.viewerImg} resizeMode="contain" />}
          {viewer && (
            <View style={styles.viewerCaption}>
              {!!viewerInfo?.title && (
                <View style={styles.viewerTitleRow}>
                  {!!viewerInfo?.color && <View style={[styles.groupDot, {backgroundColor: viewerInfo.color}]} />}
                  <Text style={styles.viewerTitle}>{viewerInfo.title}</Text>
                </View>
              )}
              <Text style={styles.viewerDate}>{fmtDate(viewerInfo?.date) || fmtDate(viewer.addedAt)}</Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: colors.background},
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {fontSize: 17, fontWeight: '600', color: colors.text},
    headerRight: {flexDirection: 'row', alignItems: 'center', gap: 12},
    headerCount: {fontSize: 13, color: colors.textSecondary},
    sortBtn: {flexDirection: 'row', alignItems: 'center', gap: 2},
    sortText: {fontSize: 13, color: colors.primary, fontWeight: '600'},
    center: {flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 32},
    emptyTitle: {fontSize: 16, fontWeight: '600', color: colors.text},
    emptyDesc: {fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19},
    segment: {
      flexDirection: 'row',
      margin: 12,
      padding: 2,
      borderRadius: 9,
      backgroundColor: colors.inputBackground,
    },
    segmentBtn: {flex: 1, paddingVertical: 7, borderRadius: 7, alignItems: 'center'},
    segmentText: {fontSize: 13, color: colors.textSecondary},
    chipBar: {flexGrow: 0, marginBottom: 4},
    chipBarContent: {paddingHorizontal: 12, gap: 8, paddingBottom: 6},
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipDot: {width: 9, height: 9, borderRadius: 5},
    chipText: {fontSize: 13, color: colors.text},
    chipCount: {fontSize: 12, color: colors.textTertiary},
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: 14,
      paddingBottom: 8,
    },
    groupDot: {width: 10, height: 10, borderRadius: 5},
    groupLabel: {fontSize: 14, fontWeight: '700', color: colors.text, maxWidth: '60%'},
    groupSub: {fontSize: 12, color: colors.textSecondary},
    groupCount: {fontSize: 12, color: colors.textTertiary},
    grid: {flexDirection: 'row', flexWrap: 'wrap'},
    viewerBg: {flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center'},
    viewerClose: {position: 'absolute', top: 60, right: 24, zIndex: 2},
    viewerImg: {width: '100%', height: '80%'},
    viewerCaption: {position: 'absolute', bottom: 56, alignItems: 'center', paddingHorizontal: 24},
    viewerTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4},
    viewerTitle: {color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center'},
    viewerDate: {color: 'rgba(255,255,255,0.7)', fontSize: 13},
  });

// Memoised: App re-renders on every tab switch, and without this each
// tab's whole subtree would re-render even while hidden.
export default React.memo(PhotosScreen);
