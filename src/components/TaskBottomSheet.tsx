import React, {useState, useCallback, useRef, useEffect, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  PanResponder,
  Dimensions,
  Keyboard,
  Platform,
  TouchableWithoutFeedback,
  Alert,
  Modal,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import DateTimePicker from '@react-native-community/datetimepicker';
import {useTheme} from '../theme/ThemeContext';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {
  Task,
  getDateKey,
  getTasksForDate,
  addTaskForDate,
  toggleTask,
  deleteTask,
  updateTask,
} from '../services/taskService';
import {getPinnedEventIds, togglePinnedEvent} from '../services/pinnedEventService';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const BOTTOM_SHEET_MIN = 60;
const BOTTOM_SHEET_MAX = SCREEN_HEIGHT * 0.5;

const DURATION_OPTIONS: {label: string; value: number}[] = [
  {label: 'duration5min', value: 5},
  {label: 'duration10min', value: 10},
  {label: 'duration15min', value: 15},
  {label: 'duration20min', value: 20},
  {label: 'duration30min', value: 30},
  {label: 'duration45min', value: 45},
  {label: 'duration1h', value: 60},
  {label: 'duration1_5h', value: 90},
  {label: 'duration2h', value: 120},
  {label: 'duration3h', value: 180},
  {label: 'duration6h', value: 360},
];

const getDeadlineKey = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDeadline = (deadline: string, t: (key: string) => string): string => {
  const today = getDeadlineKey(0);
  const tomorrow = getDeadlineKey(1);
  if (deadline === today) return t('deadlineToday');
  if (deadline === tomorrow) return t('deadlineTomorrow');
  const [y, m, d] = deadline.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
};

const formatMinutes = (m: number): string => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
};

const formatDuration = (minutes: number, tFn: (key: string, opts?: any) => string): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return tFn('hoursMinutesFmt', {h, m});
  if (h > 0) return tFn('hoursFmt', {h});
  return tFn('minutesFmt', {m});
};

const formatEventTime = (dateStr?: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

export interface TaskBottomSheetRef {
  refresh: () => void;
}

interface TaskBottomSheetProps {
  date: Date;
  events: CalendarEventReadable[];
  eventColors: Record<string, string>;
  onEventPress?: (event: CalendarEventReadable) => void;
  onEventsRefresh?: () => void;
}

type ScheduleItem = {
  id: string;
  title: string;
  timeLabel: string;
  color: string;
  sortMinutes: number;
  isEvent: boolean;
  event?: CalendarEventReadable;
  completed?: boolean;
  task?: Task;
};

export const TaskBottomSheet = React.forwardRef<TaskBottomSheetRef, TaskBottomSheetProps>(({
  date,
  events,
  eventColors,
  onEventPress,
  onEventsRefresh,
}, ref) => {
  const {colors, isDark} = useTheme();
  const {t} = useTranslation();

  const dateKey = useMemo(() => getDateKey(date), [date]);

  // ── Data ──
  const [dayTasks, setDayTasks] = useState<Task[]>([]);
  const [pinnedEventSet, setPinnedEventSet] = useState<Set<string>>(new Set());

  const fetchTasks = useCallback(async () => {
    const [tasks, pinned] = await Promise.all([
      getTasksForDate(dateKey),
      getPinnedEventIds(),
    ]);
    setDayTasks(tasks);
    setPinnedEventSet(new Set(pinned));
  }, [dateKey]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  React.useImperativeHandle(ref, () => ({refresh: fetchTasks}), [fetchTasks]);

  const todoTasks = useMemo(() =>
    dayTasks
      .filter(t => t.taskType === 'todo' || (!t.taskType && !t.time))
      .sort((a, b) => {
        // Completed sink to bottom, pinned float to top within each group.
        if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
        if (!!a.pinned !== !!b.pinned) return Number(!!b.pinned) - Number(!!a.pinned);
        return 0;
      }),
  [dayTasks]);

  const scheduleTasks = useMemo(() =>
    dayTasks.filter(t => t.taskType === 'schedule' || (!t.taskType && t.time)),
  [dayTasks]);

  const sheetScheduleItems = useMemo((): ScheduleItem[] => {
    const items: ScheduleItem[] = [];

    events.forEach(event => {
      if (event.allDay) {
        items.push({
          id: event.id || `ev-allday-${Math.random()}`,
          title: event.title || '',
          timeLabel: t('allDay'),
          color: eventColors[event.id] || event.calendar?.color || '#007AFF',
          sortMinutes: -1,
          isEvent: true,
          event,
        });
      } else {
        const d = event.startDate ? new Date(event.startDate) : new Date();
        items.push({
          id: event.id || `ev-${Math.random()}`,
          title: event.title || '',
          timeLabel: `${formatEventTime(event.startDate)}〜${formatEventTime(event.endDate)}`,
          color: eventColors[event.id] || event.calendar?.color || '#007AFF',
          sortMinutes: d.getHours() * 60 + d.getMinutes(),
          isEvent: true,
          event,
        });
      }
    });

    scheduleTasks.filter(task => task.time).forEach(task => {
      const [h, m] = task.time!.split(':').map(Number);
      const startMin = h * 60 + m;
      const endMin = startMin + (task.duration || 30);
      items.push({
        id: `task-${task.id}`,
        title: task.title,
        timeLabel: `${task.time}〜${formatMinutes(endMin)}`,
        color: '#007AFF',
        sortMinutes: startMin,
        isEvent: false,
        completed: task.completed,
        task,
      });
    });

    // Pinned items float to the top regardless of time.
    items.sort((a, b) => {
      const aPinned = a.isEvent ? pinnedEventSet.has(a.id) : !!a.task?.pinned;
      const bPinned = b.isEvent ? pinnedEventSet.has(b.id) : !!b.task?.pinned;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return a.sortMinutes - b.sortMinutes;
    });
    return items;
  }, [events, eventColors, scheduleTasks, t, pinnedEventSet]);

  // ── Sheet height animation ──
  const sheetAnim = useRef(new Animated.Value(BOTTOM_SHEET_MIN)).current;
  const sheetOffset = useRef(BOTTOM_SHEET_MIN);
  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
      onPanResponderMove: (_, gs) => {
        const next = Math.max(BOTTOM_SHEET_MIN, Math.min(BOTTOM_SHEET_MAX, sheetOffset.current - gs.dy));
        sheetAnim.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        const next = sheetOffset.current - gs.dy;
        const target = next > (BOTTOM_SHEET_MIN + BOTTOM_SHEET_MAX) / 2 ? BOTTOM_SHEET_MAX : BOTTOM_SHEET_MIN;
        sheetOffset.current = target;
        Animated.spring(sheetAnim, {toValue: target, useNativeDriver: false, bounciness: 4}).start();
      },
    })
  ).current;

  // ── Swipe-to-delete ──
  const swipedItemIdRef = useRef<string | null>(null);
  const swipeAnims = useRef<Record<string, Animated.Value>>({});
  const getSwipeAnim = useCallback((id: string) => {
    if (!swipeAnims.current[id]) {
      swipeAnims.current[id] = new Animated.Value(0);
    }
    return swipeAnims.current[id];
  }, []);
  const resetSwipe = useCallback((id: string) => {
    const anim = swipeAnims.current[id];
    if (anim) {
      Animated.spring(anim, {toValue: 0, useNativeDriver: true}).start();
    }
    if (swipedItemIdRef.current === id) {
      swipedItemIdRef.current = null;
    }
  }, []);

  const makeSwipeResponder = useCallback((itemId: string, onPin?: () => void) => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy),
    onMoveShouldSetPanResponderCapture: (_, gs) => Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy),
    onPanResponderMove: (_, gs) => {
      const anim = getSwipeAnim(itemId);
      anim.setValue(Math.min(80, Math.max(-72, gs.dx)));
    },
    onPanResponderRelease: (_, gs) => {
      const anim = getSwipeAnim(itemId);
      if (gs.dx < -36) {
        // Reveal delete tray on the right.
        const prev = swipedItemIdRef.current;
        if (prev && prev !== itemId) resetSwipe(prev);
        swipedItemIdRef.current = itemId;
        Animated.spring(anim, {toValue: -72, useNativeDriver: true}).start();
      } else if (gs.dx > 50 && onPin) {
        // Trigger pin toggle and snap back.
        onPin();
        Animated.spring(anim, {toValue: 0, useNativeDriver: true}).start();
      } else {
        resetSwipe(itemId);
      }
    },
  }), [getSwipeAnim, resetSwipe]);

  const handleTogglePinTask = useCallback(async (task: Task) => {
    await updateTask(task.id, {pinned: !task.pinned});
    fetchTasks();
  }, [fetchTasks]);

  const handleTogglePinEvent = useCallback(async (eventId: string) => {
    await togglePinnedEvent(eventId);
    const next = await getPinnedEventIds();
    setPinnedEventSet(new Set(next));
  }, []);

  const taskPanResponders = useMemo(() => {
    const responders: Record<string, ReturnType<typeof PanResponder.create>> = {};
    for (const task of todoTasks) {
      responders[task.id] = makeSwipeResponder(task.id, () => handleTogglePinTask(task));
    }
    return responders;
  }, [todoTasks, makeSwipeResponder, handleTogglePinTask]);

  const schedulePanResponders = useMemo(() => {
    const responders: Record<string, ReturnType<typeof PanResponder.create>> = {};
    for (const item of sheetScheduleItems) {
      responders[item.id] = makeSwipeResponder(item.id, () => {
        if (item.isEvent) handleTogglePinEvent(item.id);
        else if (item.task) handleTogglePinTask(item.task);
      });
    }
    return responders;
  }, [sheetScheduleItems, makeSwipeResponder, handleTogglePinEvent, handleTogglePinTask]);

  // ── Task handlers ──
  const handleToggleTask = useCallback(async (taskId: string) => {
    await toggleTask(taskId);
    fetchTasks();
  }, [fetchTasks]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    fetchTasks();
  }, [fetchTasks]);

  const handleDeleteScheduleItem = useCallback(async (item: ScheduleItem) => {
    if (item.isEvent && item.event?.id) {
      try {
        await RNCalendarEvents.removeEvent(item.event.id);
        onEventsRefresh?.();
      } catch {
        Alert.alert(t('error'), t('deleteFailed'));
      }
    } else if (item.task) {
      await deleteTask(item.task.id);
      fetchTasks();
    }
  }, [fetchTasks, onEventsRefresh, t]);

  // ── Add task overlay ──
  const [addingTask, setAddingTask] = useState(false);
  const [taskInputText, setTaskInputText] = useState('');
  const [taskInputError, setTaskInputError] = useState(false);
  const [taskDuration, setTaskDuration] = useState<number | null>(null);
  const [taskDurationCustom, setTaskDurationCustom] = useState(false);
  const [taskCustomMinutes, setTaskCustomMinutes] = useState('');

  // Track keyboard height so overlay can lift the card above the keyboard
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const resetAddOverlay = () => {
    setTaskInputText('');
    setAddingTask(false);
    setTaskDuration(null);
    setTaskDurationCustom(false);
    setTaskCustomMinutes('');
    setTaskInputError(false);
    setAddDeadline(null);
  };

  const handleAddTask = useCallback(async () => {
    const trimmed = taskInputText.trim();
    if (!trimmed) { setTaskInputError(true); return; }
    try {
      const duration = taskDuration || undefined;
      await addTaskForDate(trimmed, dateKey, undefined, duration, 'todo', undefined, addDeadline || undefined);
      resetAddOverlay();
      Keyboard.dismiss();
      fetchTasks();
    } catch (e) {
      console.error('handleAddTask error:', e);
    }
  }, [taskInputText, dateKey, taskDuration, fetchTasks]);

  // ── Expand to edit a todo task ──
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editTaskDuration, setEditTaskDuration] = useState<number | null>(null);
  const [editDurationCustom, setEditDurationCustom] = useState(false);
  const [editCustomMinutes, setEditCustomMinutes] = useState('');
  const [editTaskTimeHour, setEditTaskTimeHour] = useState('');
  const [editTaskTimeMinute, setEditTaskTimeMinute] = useState('');
  const [editDeadline, setEditDeadline] = useState<string | null>(null);
  const [addDeadline, setAddDeadline] = useState<string | null>(null);
  const [deadlinePickerTarget, setDeadlinePickerTarget] = useState<'add' | 'edit' | null>(null);
  const [deadlinePickerDate, setDeadlinePickerDate] = useState<Date>(new Date());

  const openDeadlinePicker = useCallback((target: 'add' | 'edit', current: string | null) => {
    if (current) {
      const [y, m, d] = current.split('-').map(Number);
      setDeadlinePickerDate(new Date(y, m - 1, d));
    } else {
      setDeadlinePickerDate(new Date());
    }
    setDeadlinePickerTarget(target);
  }, []);

  const commitDeadlinePicker = useCallback((picked: Date) => {
    const key = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`;
    if (deadlinePickerTarget === 'add') setAddDeadline(key);
    else if (deadlinePickerTarget === 'edit') setEditDeadline(key);
    setDeadlinePickerTarget(null);
  }, [deadlinePickerTarget]);

  const handleExpandTask = useCallback((task: Task) => {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(task.id);
    setEditTaskDuration(task.duration || null);
    setEditDeadline(task.deadline || null);
    const isPreset = DURATION_OPTIONS.some(o => o.value === task.duration);
    if (task.duration && !isPreset) {
      setEditDurationCustom(true);
      setEditCustomMinutes(task.duration.toString());
    } else {
      setEditDurationCustom(false);
      setEditCustomMinutes('');
    }
    if (task.time) {
      const [h, m] = task.time.split(':');
      setEditTaskTimeHour(h);
      setEditTaskTimeMinute(m);
    } else {
      const now = new Date();
      setEditTaskTimeHour(now.getHours().toString().padStart(2, '0'));
      setEditTaskTimeMinute((Math.ceil(now.getMinutes() / 15) * 15 % 60).toString().padStart(2, '0'));
    }
  }, [expandedTaskId]);

  const handlePlaceTask = useCallback(async (taskId: string) => {
    const time = `${editTaskTimeHour.padStart(2, '0')}:${editTaskTimeMinute.padStart(2, '0')}`;
    await updateTask(taskId, {time, duration: editTaskDuration || undefined, taskType: 'schedule'});
    setExpandedTaskId(null);
    fetchTasks();
  }, [editTaskTimeHour, editTaskTimeMinute, editTaskDuration, fetchTasks]);

  const handleSaveEdits = useCallback(async (taskId: string) => {
    await updateTask(taskId, {
      duration: editTaskDuration || undefined,
      clearDuration: !editTaskDuration,
      deadline: editDeadline || undefined,
      clearDeadline: !editDeadline,
    });
    setExpandedTaskId(null);
    fetchTasks();
  }, [editTaskDuration, editDeadline, fetchTasks]);

  // ── Render ──
  return (
    <>
      <Animated.View style={[
        styles.bottomSheet,
        {
          height: sheetAnim,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      ]}>
        <View {...sheetPanResponder.panHandlers} style={styles.sheetHandle}>
          <View style={[styles.handleBar, {backgroundColor: colors.textTertiary}]} />
          <View style={styles.sheetHeaderSplit}>
            <View style={styles.sheetHeaderCol}>
              <Text style={[styles.sheetTitle, {color: colors.text}]}>{t('laterTasks')}</Text>
              {todoTasks.length > 0 && (
                <View style={[styles.sheetBadge, {backgroundColor: colors.primary}]}>
                  <Text style={[styles.sheetBadgeText, {color: colors.onPrimary}]}>{todoTasks.length}</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => setAddingTask(true)}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                style={[styles.addInlineBtn, {borderColor: colors.primary}]}>
                <Text style={[styles.addInlineBtnText, {color: colors.primary}]}>＋</Text>
              </TouchableOpacity>
            </View>
            <View style={{width: 1, backgroundColor: colors.textTertiary, height: '100%', opacity: 0.3}} />
            <View style={styles.sheetHeaderCol}>
              <Text style={[styles.sheetTitle, {color: colors.text}]}>{t('schedule')}</Text>
              {sheetScheduleItems.length > 0 && (
                <View style={[styles.sheetBadge, {backgroundColor: colors.primary}]}>
                  <Text style={[styles.sheetBadgeText, {color: colors.onPrimary}]}>{sheetScheduleItems.length}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.sheetColumnsContainer}>
          {/* Left: あとでやる */}
          <ScrollView style={styles.sheetColumnLeft} showsVerticalScrollIndicator={false}>
            {todoTasks.length === 0 ? (
              <Text style={[styles.sheetEmpty, {color: colors.textTertiary}]}>{t('noTasks')}</Text>
            ) : (
              todoTasks.map(task => (
                <View key={task.id} style={styles.swipeRow}>
                  <View style={styles.swipePinBg}>
                    <Ionicons name={task.pinned ? 'bookmark' : 'bookmark-outline'} size={18} color="#fff" />
                  </View>
                  <TouchableOpacity
                    style={styles.swipeDeleteBtn}
                    onPress={() => { resetSwipe(task.id); handleDeleteTask(task.id); }}>
                    <Text style={styles.swipeDeleteText}>{t('delete')}</Text>
                  </TouchableOpacity>
                  <Animated.View
                    {...(taskPanResponders[task.id]?.panHandlers || {})}
                    style={[
                      styles.sheetEventItem,
                      {backgroundColor: colors.surface},
                      {transform: [{translateX: getSwipeAnim(task.id)}]},
                    ]}>
                    <TouchableOpacity
                      onPress={() => handleToggleTask(task.id)}
                      hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                      <View style={[
                        styles.checkbox,
                        {borderColor: colors.textTertiary},
                        task.completed && {backgroundColor: colors.primary, borderColor: colors.primary},
                      ]}>
                        {task.completed && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.sheetEventInfo}
                      activeOpacity={0.7}
                      onPress={() => {
                        if (swipedItemIdRef.current) { resetSwipe(swipedItemIdRef.current); return; }
                        handleExpandTask(task);
                      }}>
                      <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                        {task.pinned && (
                          <Ionicons name="bookmark" size={12} color="#FF9500" />
                        )}
                        <Text
                          style={[
                            styles.sheetEventTitle,
                            {color: colors.text, flex: 1},
                            task.completed && {textDecorationLine: 'line-through', color: colors.textTertiary},
                          ]}
                          numberOfLines={1}>{task.title}</Text>
                      </View>
                      <View style={{flexDirection: 'row', gap: 6}}>
                        {task.duration ? (
                          <Text style={[styles.sheetEventTime, {color: colors.textSecondary}]}>
                            {formatDuration(task.duration, t)}
                          </Text>
                        ) : null}
                        {task.deadline ? (
                          <Text style={[styles.sheetEventTime, {color: task.deadline < getDeadlineKey(0) ? colors.error : task.deadline === getDeadlineKey(0) ? '#FF9500' : colors.textTertiary}]}>
                            {formatDeadline(task.deadline, t)}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              ))
            )}
            {todoTasks.length > 0 && (() => {
              const totalMin = todoTasks.filter(x => !x.completed).reduce((sum, x) => sum + (x.duration || 0), 0);
              if (totalMin === 0) return null;
              return (
                <View style={{paddingVertical: 8, paddingHorizontal: 4, borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 4}}>
                  <Text style={{fontSize: 11, color: colors.textTertiary, textAlign: 'center'}}>
                    {t('total')} {formatDuration(totalMin, t)}
                  </Text>
                </View>
              );
            })()}
            {expandedTaskId && (() => {
              const task = todoTasks.find(x => x.id === expandedTaskId);
              if (!task) return null;
              return (
                <View style={[styles.editPanel, {backgroundColor: colors.surfaceSecondary, borderTopColor: colors.borderLight}]}>
                  <View style={styles.editHeader}>
                    <TouchableOpacity
                      onPress={() => handleToggleTask(task.id)}
                      hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                      style={{marginRight: 8}}>
                      <View style={[
                        styles.checkbox,
                        {borderColor: colors.textTertiary},
                        task.completed && {backgroundColor: colors.primary, borderColor: colors.primary},
                      ]}>
                        {task.completed && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                    <Text style={[styles.editTitle, {color: colors.text}]} numberOfLines={1}>{task.title}</Text>
                    <TouchableOpacity
                      onPress={() => { setExpandedTaskId(null); handleDeleteTask(task.id); }}
                      hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                      <Text style={[styles.deleteBtn, {color: colors.error}]}>{t('delete')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}><Ionicons name="hourglass-outline" size={13} color={colors.textSecondary} /><Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>{t('taskDuration')}</Text></View>
                  <View style={styles.durationOptions}>
                    {DURATION_OPTIONS.map(opt => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.durationChip,
                          {borderColor: colors.border},
                          editTaskDuration === opt.value && !editDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                        ]}
                        onPress={() => { setEditDurationCustom(false); setEditTaskDuration(editTaskDuration === opt.value ? null : opt.value); }}>
                        <Text style={[
                          styles.durationChipText,
                          {color: colors.textSecondary},
                          editTaskDuration === opt.value && !editDurationCustom && {color: colors.onPrimary},
                        ]}>{t(opt.label)}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[
                        styles.durationChip,
                        {borderColor: colors.border},
                        editDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                      ]}
                      onPress={() => {
                        if (editDurationCustom) {
                          setEditDurationCustom(false);
                          setEditTaskDuration(null);
                        } else {
                          setEditDurationCustom(true);
                          setEditTaskDuration(null);
                          setEditCustomMinutes('');
                        }
                      }}>
                      <Text style={[
                        styles.durationChipText,
                        {color: colors.textSecondary},
                        editDurationCustom && {color: colors.onPrimary},
                      ]}>{t('custom')}</Text>
                    </TouchableOpacity>
                  </View>
                  {editDurationCustom && (
                    <View style={styles.customDurationRow}>
                      <TextInput
                        style={[styles.customDurationInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                        value={editCustomMinutes}
                        onChangeText={txt => {
                          const cleaned = txt.replace(/[^0-9]/g, '');
                          setEditCustomMinutes(cleaned);
                          const num = parseInt(cleaned, 10);
                          setEditTaskDuration(num > 0 ? num : null);
                        }}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textTertiary}
                      />
                      <Text style={[styles.customDurationUnit, {color: colors.textSecondary}]}>{t('minutes')}</Text>
                    </View>
                  )}
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10}}><Ionicons name="flag-outline" size={13} color={colors.textSecondary} /><Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>{t('taskDeadline')}</Text></View>
                  <View style={styles.durationOptions}>
                    {(() => {
                      const presetValues = [getDeadlineKey(0), getDeadlineKey(1), getDeadlineKey(7)];
                      const isCustom = !!editDeadline && !presetValues.includes(editDeadline);
                      return (
                        <>
                          {[
                            {label: t('deadlineToday'), value: presetValues[0]},
                            {label: t('deadlineTomorrow'), value: presetValues[1]},
                            {label: t('deadlineNextWeek'), value: presetValues[2]},
                          ].map(opt => (
                            <TouchableOpacity
                              key={opt.value}
                              style={[
                                styles.durationChip,
                                {borderColor: colors.border},
                                editDeadline === opt.value && {backgroundColor: colors.primary, borderColor: colors.primary},
                              ]}
                              onPress={() => setEditDeadline(editDeadline === opt.value ? null : opt.value)}>
                              <Text style={[
                                styles.durationChipText,
                                {color: colors.textSecondary},
                                editDeadline === opt.value && {color: colors.onPrimary},
                              ]}>{opt.label}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity
                            style={[
                              styles.durationChip,
                              {borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 4},
                              isCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                            ]}
                            onPress={() => openDeadlinePicker('edit', editDeadline)}>
                            <Ionicons name="calendar-outline" size={13} color={isCustom ? colors.onPrimary : colors.textSecondary} />
                            <Text style={[
                              styles.durationChipText,
                              {color: colors.textSecondary},
                              isCustom && {color: colors.onPrimary},
                            ]}>{isCustom && editDeadline ? formatDeadline(editDeadline, t) : t('deadlinePickDate')}</Text>
                          </TouchableOpacity>
                          {editDeadline && (
                            <TouchableOpacity
                              style={[styles.durationChip, {borderColor: colors.error}]}
                              onPress={() => setEditDeadline(null)}>
                              <Text style={[styles.durationChipText, {color: colors.error}]}>✕</Text>
                            </TouchableOpacity>
                          )}
                        </>
                      );
                    })()}
                  </View>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10}}><Ionicons name="time-outline" size={13} color={colors.textSecondary} /><Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>{t('taskTimezone')}</Text></View>
                  <View style={styles.taskEditTimeRow}>
                    <View style={styles.addTimeInputs}>
                      <TextInput
                        style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                        value={editTaskTimeHour}
                        onChangeText={txt => setEditTaskTimeHour(txt.replace(/[^0-9]/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        maxLength={2}
                        placeholder="HH"
                        placeholderTextColor={colors.textTertiary}
                      />
                      <Text style={{color: colors.text, fontWeight: '600', marginHorizontal: 2}}>:</Text>
                      <TextInput
                        style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                        value={editTaskTimeMinute}
                        onChangeText={txt => setEditTaskTimeMinute(txt.replace(/[^0-9]/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        maxLength={2}
                        placeholder="MM"
                        placeholderTextColor={colors.textTertiary}
                      />
                    </View>
                    <TouchableOpacity
                      style={[styles.placeBtn, {backgroundColor: colors.primary}]}
                      onPress={() => handlePlaceTask(task.id)}>
                      <Text style={[styles.placeBtnText, {color: colors.onPrimary}]}>{t('place')}</Text>
                    </TouchableOpacity>
                  </View>
                  {(editTaskDuration !== task.duration || editDeadline !== (task.deadline || null)) && (
                    <TouchableOpacity
                      style={[styles.saveDurationBtn, {borderColor: colors.primary}]}
                      onPress={() => handleSaveEdits(task.id)}>
                      <Text style={[styles.saveDurationBtnText, {color: colors.primary}]}>{t('saveChanges')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}
          </ScrollView>

          <View style={[styles.sheetColumnDivider, {backgroundColor: colors.textTertiary, opacity: 0.3}]} />

          {/* Right: 予定 */}
          <ScrollView style={styles.sheetColumnRight} showsVerticalScrollIndicator={false}>
            {sheetScheduleItems.length === 0 ? (
              <Text style={[styles.sheetEmpty, {color: colors.textTertiary}]}>{t('noSchedule')}</Text>
            ) : (
              sheetScheduleItems.map(item => {
                const itemPinned = item.isEvent
                  ? pinnedEventSet.has(item.id)
                  : !!item.task?.pinned;
                return (
                <View key={item.id} style={styles.swipeRow}>
                  <View style={styles.swipePinBg}>
                    <Ionicons name={itemPinned ? 'bookmark' : 'bookmark-outline'} size={18} color="#fff" />
                  </View>
                  <TouchableOpacity
                    style={styles.swipeDeleteBtn}
                    onPress={() => { resetSwipe(item.id); handleDeleteScheduleItem(item); }}>
                    <Text style={styles.swipeDeleteText}>{t('delete')}</Text>
                  </TouchableOpacity>
                  <Animated.View
                    {...(schedulePanResponders[item.id]?.panHandlers || {})}
                    style={[
                      styles.sheetEventItem,
                      {backgroundColor: colors.surface},
                      {transform: [{translateX: getSwipeAnim(item.id)}]},
                    ]}>
                    <TouchableOpacity
                      style={{flexDirection: 'row', alignItems: 'center', flex: 1}}
                      activeOpacity={0.7}
                      onPress={() => {
                        if (swipedItemIdRef.current) {
                          resetSwipe(swipedItemIdRef.current);
                        } else if (item.isEvent && item.event) {
                          onEventPress?.(item.event);
                        }
                      }}>
                      <View style={[styles.sheetEventDot, {backgroundColor: item.color}]} />
                      <View style={styles.sheetEventInfo}>
                        <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                          {itemPinned && (
                            <Ionicons name="bookmark" size={12} color="#FF9500" />
                          )}
                          <Text
                            style={[
                              styles.sheetEventTitle,
                              {color: colors.text, flex: 1},
                              item.completed && {textDecorationLine: 'line-through', color: colors.textTertiary},
                            ]}
                            numberOfLines={1}>{item.title}</Text>
                        </View>
                        <Text style={[styles.sheetEventTime, {color: colors.textSecondary}]}>
                          {item.timeLabel}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Animated.View>

      {/* Add Task overlay */}
      {addingTask && (
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); resetAddOverlay(); }}>
          <View style={[styles.addOverlay, {backgroundColor: 'rgba(0,0,0,0.5)', paddingBottom: keyboardHeight}]}>
            <View style={styles.addKeyboardWrap}>
              <TouchableWithoutFeedback>
                <View style={[styles.addCard, {backgroundColor: colors.surface}]}>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}>
                    <Text style={[styles.addCardTitle, {color: colors.text}]}>{t('laterTasks')}</Text>
                    <TextInput
                  style={[
                    styles.addInput,
                    {
                      color: colors.text,
                      backgroundColor: colors.inputBackground,
                      borderWidth: 1,
                      borderColor: taskInputError ? colors.error : 'transparent',
                    },
                  ]}
                  value={taskInputText}
                  onChangeText={txt => { setTaskInputText(txt); if (taskInputError) setTaskInputError(false); }}
                  placeholder={t('taskPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                />
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12}}><Ionicons name="hourglass-outline" size={13} color={colors.textSecondary} /><Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>{t('taskDuration')}</Text></View>
                <View style={styles.durationOptions}>
                  {DURATION_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.durationChip,
                        {borderColor: colors.border},
                        taskDuration === opt.value && !taskDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                      ]}
                      onPress={() => { setTaskDurationCustom(false); setTaskDuration(taskDuration === opt.value ? null : opt.value); }}>
                      <Text style={[
                        styles.durationChipText,
                        {color: colors.textSecondary},
                        taskDuration === opt.value && !taskDurationCustom && {color: colors.onPrimary},
                      ]}>{t(opt.label)}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[
                      styles.durationChip,
                      {borderColor: colors.border},
                      taskDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                    ]}
                    onPress={() => {
                      if (taskDurationCustom) {
                        setTaskDurationCustom(false);
                        setTaskDuration(null);
                      } else {
                        setTaskDurationCustom(true);
                        setTaskDuration(null);
                        setTaskCustomMinutes('');
                      }
                    }}>
                    <Text style={[
                      styles.durationChipText,
                      {color: colors.textSecondary},
                      taskDurationCustom && {color: colors.onPrimary},
                    ]}>{t('custom')}</Text>
                  </TouchableOpacity>
                </View>
                {taskDurationCustom && (
                  <View style={styles.customDurationRow}>
                    <TextInput
                      style={[styles.customDurationInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                      value={taskCustomMinutes}
                      onChangeText={txt => {
                        const cleaned = txt.replace(/[^0-9]/g, '');
                        setTaskCustomMinutes(cleaned);
                        const num = parseInt(cleaned, 10);
                        setTaskDuration(num > 0 ? num : null);
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                    />
                    <Text style={[styles.customDurationUnit, {color: colors.textSecondary}]}>{t('minutes')}</Text>
                  </View>
                )}
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12}}><Ionicons name="flag-outline" size={13} color={colors.textSecondary} /><Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>{t('taskDeadline')}</Text></View>
                <View style={styles.durationOptions}>
                  {(() => {
                    const presetValues = [getDeadlineKey(0), getDeadlineKey(1), getDeadlineKey(7)];
                    const isCustom = !!addDeadline && !presetValues.includes(addDeadline);
                    return (
                      <>
                        {[
                          {label: t('deadlineToday'), value: presetValues[0]},
                          {label: t('deadlineTomorrow'), value: presetValues[1]},
                          {label: t('deadlineNextWeek'), value: presetValues[2]},
                        ].map(opt => (
                          <TouchableOpacity
                            key={opt.value}
                            style={[
                              styles.durationChip,
                              {borderColor: colors.border},
                              addDeadline === opt.value && {backgroundColor: colors.primary, borderColor: colors.primary},
                            ]}
                            onPress={() => setAddDeadline(addDeadline === opt.value ? null : opt.value)}>
                            <Text style={[
                              styles.durationChipText,
                              {color: colors.textSecondary},
                              addDeadline === opt.value && {color: colors.onPrimary},
                            ]}>{opt.label}</Text>
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                          style={[
                            styles.durationChip,
                            {borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 4},
                            isCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                          ]}
                          onPress={() => openDeadlinePicker('add', addDeadline)}>
                          <Ionicons name="calendar-outline" size={13} color={isCustom ? colors.onPrimary : colors.textSecondary} />
                          <Text style={[
                            styles.durationChipText,
                            {color: colors.textSecondary},
                            isCustom && {color: colors.onPrimary},
                          ]}>{isCustom && addDeadline ? formatDeadline(addDeadline, t) : t('deadlinePickDate')}</Text>
                        </TouchableOpacity>
                        {addDeadline && (
                          <TouchableOpacity
                            style={[styles.durationChip, {borderColor: colors.error}]}
                            onPress={() => setAddDeadline(null)}>
                            <Text style={[styles.durationChipText, {color: colors.error}]}>✕</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  })()}
                </View>
                <View style={styles.addActions}>
                  <TouchableOpacity
                    style={[styles.addActionBtn, {backgroundColor: colors.inputBackground}]}
                    onPress={() => { Keyboard.dismiss(); resetAddOverlay(); }}>
                    <Text style={[styles.addActionText, {color: colors.textSecondary}]}>{t('cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addActionBtn, {backgroundColor: colors.primary}]}
                    onPress={handleAddTask}>
                    <Text style={[styles.addActionText, {color: colors.onPrimary}]}>{t('add')}</Text>
                  </TouchableOpacity>
                </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </View>
        </TouchableWithoutFeedback>
      )}
      {deadlinePickerTarget !== null && Platform.OS === 'ios' && (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={() => setDeadlinePickerTarget(null)}>
          <TouchableWithoutFeedback onPress={() => setDeadlinePickerTarget(null)}>
            <View style={styles.pickerOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.pickerSheet, {backgroundColor: colors.surface}]}>
                  <View style={[styles.pickerHeader, {borderBottomColor: colors.border}]}>
                    <TouchableOpacity onPress={() => setDeadlinePickerTarget(null)}>
                      <Text style={{color: colors.textTertiary, fontSize: 16}}>{t('cancel')}</Text>
                    </TouchableOpacity>
                    <Text style={{color: colors.text, fontSize: 16, fontWeight: '600'}}>{t('taskDeadline')}</Text>
                    <TouchableOpacity onPress={() => commitDeadlinePicker(deadlinePickerDate)}>
                      <Text style={{color: colors.primary, fontSize: 16, fontWeight: '600'}}>OK</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={deadlinePickerDate}
                    mode="date"
                    display="inline"
                    themeVariant={isDark ? 'dark' : 'light'}
                    onChange={(_, picked) => { if (picked) setDeadlinePickerDate(picked); }}
                  />
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
      {deadlinePickerTarget !== null && Platform.OS === 'android' && (
        <DateTimePicker
          value={deadlinePickerDate}
          mode="date"
          display="default"
          onChange={(event, picked) => {
            if (event.type === 'set' && picked) {
              commitDeadlinePicker(picked);
            } else {
              setDeadlinePickerTarget(null);
            }
          }}
        />
      )}
    </>
  );
});

const styles = StyleSheet.create({
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetHandle: {
    paddingTop: 8,
    paddingBottom: 6,
    alignItems: 'center',
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
    marginBottom: 8,
  },
  sheetHeaderSplit: {
    flexDirection: 'row',
    width: '100%',
  },
  sheetHeaderCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  sheetBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addInlineBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addInlineBtnText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  sheetColumnsContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  sheetColumnLeft: {
    flex: 1,
  },
  sheetColumnDivider: {
    width: 1,
  },
  sheetColumnRight: {
    flex: 1,
  },
  swipeRow: {
    overflow: 'hidden',
  },
  swipeDeleteBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 72,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  swipePinBg: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#FF9500',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 18,
  },
  pinnedGlyph: {
    marginLeft: 4,
  },
  sheetEventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sheetEventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sheetEventInfo: {
    flex: 1,
    marginLeft: 8,
  },
  sheetEventTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  sheetEventTime: {
    fontSize: 11,
    marginTop: 1,
  },
  sheetEmpty: {
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    fontSize: 13,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: -1,
  },
  deleteBtn: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Edit panel (inline)
  editPanel: {
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderRadius: 8,
  },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  editTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  taskEditLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
  },
  durationOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  durationChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  durationChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  customDurationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  customDurationInput: {
    width: 50,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  customDurationUnit: {
    fontSize: 13,
    fontWeight: '500',
  },
  taskEditTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addTimeInputs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addTimeField: {
    width: 36,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  placeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  placeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveDurationBtn: {
    marginTop: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  saveDurationBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Add overlay
  addOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 300,
  },
  addKeyboardWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    width: SCREEN_WIDTH - 48,
    maxHeight: SCREEN_HEIGHT * 0.8,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  addCardTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 14,
  },
  addInput: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  addActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 10,
  },
  addActionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  addActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default TaskBottomSheet;
