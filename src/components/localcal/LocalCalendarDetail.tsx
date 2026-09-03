// A single local calendar opened into a month view: header + month navigation +
// the month grid + an add button, plus the add/edit event modal. Reads & writes
// only the on-device localCalendarService.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, TextInput, AppState} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {CalendarEventReadable} from 'react-native-calendar-events';
import {LocalCalendar, LocalEvent, getLocalEvents, saveLocalEvent, deleteLocalEvent} from '../../services/localCalendarService';
import Calendar, {CalendarRef} from '../Calendar';
import AddEventModal from '../AddEventModal';
import EventDetailModal from '../EventDetailModal';
import {CalendarEventStore, CalendarEventDraft} from '../../types/calendarEventStore';
import ShareMembersModal from './ShareMembersModal';
import CalendarSwitcherModal from './CalendarSwitcherModal';
import {
  getShareCode,
  syncCalendar,
  getMembers,
  getOrCreateMe,
  ShareMember,
  markSharedEventDirty,
  subscribeSharedCalendar,
  clearUnseenChanges,
} from '../../services/sharedCalendarService';
import {scheduleWakeAlarm, cancelWakeAlarm, shiftWakeAlarm} from '../../services/wakeAlarmService';

interface Props {
  calendar: LocalCalendar;
  onBack: () => void;
  /** The user's other local calendars, for the title-tap switcher below —
   * the caller already has this list loaded (it's the list screen's own
   * state), so this screen doesn't fetch a duplicate copy. */
  calendars?: LocalCalendar[];
  /** Jump straight to another of the user's local calendars without going
   * back to the list screen first. */
  onSwitchCalendar?: (calendarId: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const datePart = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timePart = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const LocalCalendarDetail: React.FC<Props> = ({calendar, onBack, calendars = [], onSwitchCalendar}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<CalendarEventReadable | null>(null);
  const [selected, setSelected] = useState<CalendarEventReadable | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [initialDate, setInitialDate] = useState(() => new Date());
  const [shared, setShared] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [members, setMembers] = useState<ShareMember[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | undefined>();
  // Set whenever a sync (initial open, poll, or realtime-triggered) pulls in
  // something someone ELSE added/changed/deleted — cleared when the user
  // taps it. Session-scoped only (not persisted): the point is "did anything
  // arrive while I've had this calendar open", not an unread count that
  // survives app restarts.
  const [hasNewChanges, setHasNewChanges] = useState(false);
  const calendarRef = useRef<CalendarRef>(null);

  const noteRemoteChanges = useCallback((result: {changedByOthers: {added: number; updated: number; deleted: number}} | null) => {
    if (!result) return;
    const {added, updated, deleted} = result.changedByOthers;
    if (added || updated || deleted) setHasNewChanges(true);
  }, []);

  const reload = useCallback(async () => {
    const [nextEvents, nextMembers, me] = await Promise.all([
      getLocalEvents(calendar.id),
      getMembers(calendar.id),
      getOrCreateMe(),
    ]);
    setEvents(nextEvents);
    setMembers(nextMembers);
    setMyMemberId(me.id);
  }, [calendar.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 開いたときに一度だけ取りに行く。共有していなければ何も起きない。
  useEffect(() => {
    let alive = true;
    (async () => {
      const code = await getShareCode(calendar.id);
      if (!alive) return;
      setShared(!!code);
      if (!code) return;
      // Opening the calendar is what "seeing" it means for the list
      // screen's persistent badge — clear it regardless of whether this
      // particular sync below finds anything further.
      clearUnseenChanges(calendar.id).catch(() => {});
      try {
        const result = await syncCalendar(calendar.id);
        if (!alive) return;
        noteRemoteChanges(result);
        await reload();
      } catch {
        // 圏外でも自分の予定は見られる。黙って諦める。
      }
    })();
    return () => {
      alive = false;
    };
  }, [calendar.id, reload, noteRemoteChanges]);

  // Keep an open shared calendar fresh. Foreground polling is deliberately
  // modest; local edits remain instant and failed pulls retry on the next tick.
  useEffect(() => {
    if (!shared) return;
    let active = AppState.currentState === 'active';
    let syncing = false;
    const run = async () => {
      if (!active || syncing) return;
      syncing = true;
      try {
        const result = await syncCalendar(calendar.id);
        noteRemoteChanges(result);
        await reload();
      } catch {
        // Offline is an expected state; local changes stay queued by updatedAt.
      } finally {
        syncing = false;
      }
    };
    // Realtime broadcasts call run immediately. A slow fallback remains for
    // networks that block WebSockets and for reconnect gaps.
    const timer = setInterval(run, 60_000);
    let mounted = true;
    let unsubscribe = () => {};
    subscribeSharedCalendar(calendar.id, run).then(fn => { if (mounted) unsubscribe = fn; else fn(); });
    const sub = AppState.addEventListener('change', state => {
      active = state === 'active';
      if (active) run();
    });
    run();
    return () => { mounted = false; clearInterval(timer); sub.remove(); unsubscribe(); };
  }, [calendar.id, reload, shared, noteRemoteChanges]);

  // 「共有する」と「誰と共有しているか見る」を1枚にまとめたシートを開く。
  // 招待リンクの送信もその中。ここから分岐させると、共有済みかどうかで
  // 同じボタンの意味が変わることになる。
  const onShare = useCallback(() => setMembersOpen(true), []);

  const onMembersClose = useCallback(async () => {
    setMembersOpen(false);
    setShared(!!(await getShareCode(calendar.id)));
    await reload();
  }, [calendar.id, reload]);

  const openNew = (date: Date) => {
    setEditing(null);
    setInitialDate(date);
    setModalVisible(true);
  };
  const openEdit = (e: CalendarEventReadable) => {
    setEditing(e);
    setModalVisible(true);
  };

  const readableEvents = useMemo<CalendarEventReadable[]>(() => events.map(e => {
    const start = new Date(`${e.startDate}T${e.allDay ? '00:00' : (e.startTime || '00:00')}:00`);
    const end = new Date(`${e.endDate}T${e.allDay ? '23:59' : (e.endTime || '01:00')}:00`);
    return {
      id: e.id,
      title: e.title,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      allDay: e.allDay,
      notes: e.memo,
      calendar: {id: calendar.id, title: calendar.name, color: calendar.color, allowsModifications: true} as any,
      mustWake: e.mustWake,
      mustWakeOffsetMinutes: e.mustWakeOffsetMinutes,
    } as CalendarEventReadable;
  }), [events, calendar]);

  const eventColors = useMemo(() => {
    const memberColors = new Map(members.map(m => [m.id, m.color || calendar.color]));
    return Object.fromEntries(events.map(e => [e.id, memberColors.get(e.creatorId || '') || calendar.color]));
  }, [events, members, calendar.color]);

  const visibleReadableEvents = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase();
    if (!q) return readableEvents;
    return readableEvents.filter(event =>
      `${event.title || ''}\n${event.notes || ''}`.toLocaleLowerCase().includes(q));
  }, [readableEvents, searchQuery]);

  const readOnly = shared && members.find(member => member.id === myMemberId)?.role === 'viewer';

  const saveSharedEvent = useCallback(async (draft: CalendarEventDraft) => {
    const old = draft.id ? events.find(e => e.id === draft.id) : undefined;
    const start = new Date(draft.startDate);
    const end = new Date(draft.endDate);
    const saved = await saveLocalEvent({
      id: draft.id,
      calendarId: calendar.id,
      title: draft.title,
      startDate: datePart(start),
      endDate: datePart(end),
      allDay: draft.allDay,
      startTime: draft.allDay ? undefined : timePart(start),
      endTime: draft.allDay ? undefined : timePart(end),
      memo: draft.notes?.trim() || undefined,
      creatorId: old?.creatorId || myMemberId,
      mustWake: draft.mustWake,
      mustWakeOffsetMinutes: draft.mustWakeOffsetMinutes,
    });
    if (shared) await markSharedEventDirty(calendar.id, saved.id);

    // 「絶対に起きる」を立てた/動かした/消したのはこの端末での操作なので、この
    // 端末だけがアラームを登録する。同期で他端末に mustWake=true が届いても、
    // そちらの pull/merge 経路からは絶対にここを呼ばない
    // (=鳴るのは操作した本人の端末だけ、という仕様)。
    if (!saved.allDay) {
      if (saved.mustWake) {
        const offsetMin = saved.mustWakeOffsetMinutes ?? 0;
        const fireDate = new Date(start.getTime() + offsetMin * 60_000);
        await scheduleWakeAlarm({eventId: saved.id, title: saved.title, fireDate}).catch(() => {});
      } else {
        await cancelWakeAlarm(saved.id).catch(() => {});
      }
    }

    await reload();
    syncCalendar(calendar.id).catch(() => {});
    return saved.id;
  }, [calendar.id, events, myMemberId, reload, shared]);

  const removeSharedEvent = useCallback(async (id: string) => {
    await deleteLocalEvent(calendar.id, id);
    await cancelWakeAlarm(id).catch(() => {});
    if (shared) await markSharedEventDirty(calendar.id, id);
    await reload();
    syncCalendar(calendar.id).catch(() => {});
  }, [calendar.id, reload, shared]);

  const eventStore = useMemo<CalendarEventStore>(() => ({
    events: visibleReadableEvents,
    colors: eventColors,
    save: saveSharedEvent,
    remove: removeSharedEvent,
    refresh: reload,
    sharedCalendarId: shared ? calendar.id : undefined,
    readOnly,
  }), [visibleReadableEvents, eventColors, saveSharedEvent, removeSharedEvent, reload, shared, calendar.id, readOnly]);
  const handleSaved = async () => {
    setModalVisible(false);
    await reload();
    // 送るのは背景で。失敗しても手元の予定は保存済みなので、次に開いたときに
    // まとめて流れる。
    syncCalendar(calendar.id).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.titleWrap}
          onPress={onSwitchCalendar ? () => setSwitcherOpen(true) : undefined}
          accessibilityRole="button">
          <Text style={styles.emoji}>{calendar.emoji}</Text>
          <Text style={styles.title} numberOfLines={1}>{calendar.name}</Text>
          {!!onSwitchCalendar && <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />}
        </TouchableOpacity>
        {hasNewChanges && (
          <TouchableOpacity
            onPress={() => setHasNewChanges(false)}
            style={styles.newDot}
            accessibilityRole="button"
            accessibilityLabel={t('sharedNewChangesLabel', {defaultValue: '新着の変更があります'})}
          />
        )}
        <TouchableOpacity
          onPress={() => {setSearchOpen(v => !v); if (searchOpen) setSearchQuery('');}}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('search', {defaultValue: '検索'})}>
          <Ionicons name={searchOpen ? 'close' : 'search-outline'} size={21} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onShare}
          style={styles.shareBtn}
          accessibilityRole="button"
          accessibilityLabel={t('shareMembersTitle')}>
          <Ionicons
            name={shared ? 'people' : 'person-add-outline'}
            size={shared ? 24 : 22}
            color={shared ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {searchOpen && (
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('searchEvents', {defaultValue: '予定・メモを検索'})}
            placeholderTextColor={colors.textTertiary}
            autoFocus
            returnKeyType="search"
          />
        </View>
      )}

      <Calendar
        ref={calendarRef}
        eventStore={eventStore}
        hasPermission
        onDateSelect={readOnly ? undefined : openNew}
        onDateDoubleSelect={readOnly ? undefined : openNew}
        onDateRangeSelect={readOnly ? undefined : (start) => openNew(start)}
        onEventPress={event => {setSelected(event); setDetailVisible(true);}}
      />

      {!readOnly && <TouchableOpacity
        style={[styles.fab, {backgroundColor: calendar.color}]}
        activeOpacity={0.85}
        onPress={() => openNew(new Date())}>
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>}

      <ShareMembersModal
        visible={membersOpen}
        calendar={calendar}
        onClose={onMembersClose}
        onLeft={onBack}
      />

      {onSwitchCalendar && (
        <CalendarSwitcherModal
          visible={switcherOpen}
          calendars={calendars}
          currentCalendarId={calendar.id}
          onClose={() => setSwitcherOpen(false)}
          onSelect={onSwitchCalendar}
        />
      )}

      <AddEventModal
        visible={modalVisible}
        eventStore={eventStore}
        editingEvent={editing}
        initialDate={initialDate}
        onClose={() => setModalVisible(false)}
        onEventAdded={handleSaved}
        onDeleted={handleSaved}
      />
      <EventDetailModal
        visible={detailVisible}
        event={selected}
        eventStore={eventStore}
        onClose={() => setDetailVisible(false)}
        onEdit={event => {setDetailVisible(false); openEdit(event);}}
        onDeleted={handleSaved}
        onCopied={handleSaved}
      />
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: colors.background},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: {width: 44, height: 32, justifyContent: 'center'},
    iconBtn: {width: 36, height: 32, alignItems: 'center', justifyContent: 'center'},
    // The invite/share button used to reuse backBtn, whose icon sits flush
    // to the box's left edge (fine for the back chevron flush against the
    // screen edge, but it crowded this button right up against the search
    // icon to its left). Centered, with a bit of its own breathing room.
    shareBtn: {width: 44, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 6},
    titleWrap: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
    newDot: {width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.error, marginRight: 2},
    emoji: {fontSize: 18},
    title: {fontSize: 17, fontWeight: '600', color: colors.text, maxWidth: '70%'},
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: 12, marginVertical: 8, paddingHorizontal: 12,
      borderRadius: 10, backgroundColor: colors.surface,
    },
    searchInput: {flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text},
    monthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    arrowBtn: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
    monthLabel: {fontSize: 17, fontWeight: '600', color: colors.text, minWidth: 130, textAlign: 'center'},
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 28,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 4,
    },
  });

export default LocalCalendarDetail;
