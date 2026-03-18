import React, {useState, useCallback, useRef, useEffect, useMemo, forwardRef, useImperativeHandle} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Keyboard,
  Animated,
  PanResponder,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Vibration,
  Alert,
} from 'react-native';
import RNCalendarEvents, {CalendarEventReadable} from 'react-native-calendar-events';
import {getAllEventColors} from './AddEventModal';
import {useTheme} from '../theme/ThemeContext';
import {Task, getDateKey, getTasksForDateRange, addTaskForDate, toggleTask, deleteTask, updateTask} from '../services/taskService';
import {SleepSettings, getSleepSettings, getSettingsForDate, saveSleepSettings} from '../services/sleepSettingsService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const STRIP_DAY_WIDTH = (SCREEN_WIDTH - 16) / 7;
const STRIP_BUFFER_DAYS = 7;
const STRIP_INITIAL_OFFSET = STRIP_BUFFER_DAYS * STRIP_DAY_WIDTH;

const BOTTOM_SHEET_MIN = 60;
const BOTTOM_SHEET_MAX = SCREEN_HEIGHT * 0.5;
const DURATION_OPTIONS = [
  {label: '5分', value: 5},
  {label: '10分', value: 10},
  {label: '15分', value: 15},
  {label: '20分', value: 20},
  {label: '30分', value: 30},
  {label: '45分', value: 45},
  {label: '1時間', value: 60},
  {label: '1.5時間', value: 90},
  {label: '2時間', value: 120},
  {label: '3時間', value: 180},
  {label: '6時間', value: 360},
];

// Flow timeline constants
const FLOW_WAKE_HEIGHT = 56;
const FLOW_SLEEP_HEIGHT = 56;
const FLOW_GAP_MARKER_HEIGHT = 28;
const FLOW_GAP_PADDING = 8;
const FLOW_ITEM_PX_PER_MIN = 20 / 60; // 1時間 = 20px
const FLOW_MAX_ITEM_HEIGHT = 80;
const FLOW_MIN_ITEM_HEIGHT = 56;
const FLOW_LEFT_WIDTH = 46;
const FLOW_DOT_COL_WIDTH = 20;
const HOURLY_ROW_HEIGHT = 44;
// ── Types ──

interface TimelineItem {
  type: 'event' | 'task';
  id: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  color?: string;
  completed?: boolean;
  location?: string;
  original: CalendarEventReadable | Task;
  isTodo?: boolean;
}

type GapMarker = { hour: number; label: string };

type Segment =
  | { type: 'wake'; hour: number; minute: number }
  | { type: 'sleep'; hour: number; minute: number }
  | { type: 'gap'; startMin: number; endMin: number; markers: GapMarker[] }
  | { type: 'item'; items: TimelineItem[]; startMin: number; endMin: number; durationMin: number };

type SegmentLayout = { y: number; height: number; startMin: number; endMin: number };

// ── Props / Ref ──

interface DayViewProps {
  currentDate: Date;
  onTimeRangeSelect?: (startDate: Date, endDate: Date) => void;
  onEventPress?: (event: CalendarEventReadable) => void;
  onDayChange?: (newDate: Date) => void;
  hasPermission: boolean;
  sleepSettings?: SleepSettings | null;
  onSleepSettingsChange?: (settings: SleepSettings) => void;
}

export interface DayViewRef {
  refreshEvents: () => void;
  scrollToCurrentTime: () => void;
}

// ── Helpers ──

const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
};

const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}時間${m}分`;
  if (h > 0) return `${h}時間`;
  return `${m}分`;
};

const formatEventTime = (dateStr?: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

const buildGapMarkers = (startMin: number, endMin: number): GapMarker[] => {
  const duration = endMin - startMin;
  if (duration <= 0) return [];

  if (duration <= 60) {
    const midHour = Math.ceil(startMin / 60);
    return [{ hour: midHour, label: `${midHour.toString().padStart(2, '0')}:00` }];
  }

  let intervalHours: number;
  if (duration <= 180) intervalHours = 1;
  else if (duration <= 360) intervalHours = 2;
  else intervalHours = 3;

  const firstHour = Math.ceil(startMin / 60);
  const markers: GapMarker[] = [];
  for (let h = firstHour; h * 60 < endMin; h += intervalHours) {
    markers.push({ hour: h, label: `${h.toString().padStart(2, '0')}:00` });
  }

  if (markers.length === 0) {
    const midHour = Math.round((startMin + endMin) / 2 / 60);
    markers.push({ hour: midHour, label: `${midHour.toString().padStart(2, '0')}:00` });
  }

  return markers;
};

// ── Component ──

export const DayView = forwardRef<DayViewRef, DayViewProps>(({
  currentDate,
  onTimeRangeSelect,
  onEventPress,
  onDayChange,
  hasPermission,
  sleepSettings: sleepSettingsProp,
  onSleepSettingsChange,
}, ref) => {
  const [events, setEvents] = useState<CalendarEventReadable[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [eventColors, setEventColors] = useState<Record<string, string>>({});
  const [dayTasks, setDayTasks] = useState<Task[]>([]);
  const [showAddTypeSelect, setShowAddTypeSelect] = useState(false);
  const [pendingTimeRange, setPendingTimeRange] = useState<{start: Date; end: Date} | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [taskInputText, setTaskInputText] = useState('');
  const [taskTimeEnabled, setTaskTimeEnabled] = useState(false);
  const [taskTimeHour, setTaskTimeHour] = useState('');
  const [taskTimeMinute, setTaskTimeMinute] = useState('');
  const [taskEndTimeHour, setTaskEndTimeHour] = useState('');
  const [taskEndTimeMinute, setTaskEndTimeMinute] = useState('');
  const [taskDuration, setTaskDuration] = useState<number | null>(null);
  const [taskDurationCustom, setTaskDurationCustom] = useState(false);
  const [taskCustomMinutes, setTaskCustomMinutes] = useState('');
  const [taskMemo, setTaskMemo] = useState('');
  const [taskDeadlineHour, setTaskDeadlineHour] = useState('');
  const [taskDeadlineMinute, setTaskDeadlineMinute] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTodoTaskId, setEditingTodoTaskId] = useState<string | null>(null);
  const [editTodoTitle, setEditTodoTitle] = useState('');
  const [editTodoMemo, setEditTodoMemo] = useState('');
  const [editTodoDeadlineHour, setEditTodoDeadlineHour] = useState('');
  const [editTodoDeadlineMinute, setEditTodoDeadlineMinute] = useState('');
  const [editTodoDuration, setEditTodoDuration] = useState<number | null>(null);
  const [editTaskTimeHour, setEditTaskTimeHour] = useState('');
  const [editTaskTimeMinute, setEditTaskTimeMinute] = useState('');
  const [editTaskDuration, setEditTaskDuration] = useState<number | null>(null);
  const [editDurationCustom, setEditDurationCustom] = useState(false);
  const [editCustomMinutes, setEditCustomMinutes] = useState('');
  const [editingTimelineTaskId, setEditingTimelineTaskId] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [draggingEvent, setDraggingEvent] = useState<TimelineItem | null>(null);
  const [dropTimePreview, setDropTimePreview] = useState<string | null>(null);
  const dragAnimX = useRef(new Animated.Value(0)).current;
  const dragAnimY = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);
  const gridContainerRef = useRef<View>(null);
  const gridTopOnScreenRef = useRef(0);
  const dragStartedRef = useRef(false);
  const dragTaskIdRef = useRef<string | null>(null);
  const dragEventItemRef = useRef<TimelineItem | null>(null);
  const dropTimeRef = useRef<string | null>(null);
  const [sleepSettingsLocal, setSleepSettingsLocal] = useState<SleepSettings | null>(null);
  const sleepSettings = sleepSettingsProp !== undefined ? sleepSettingsProp : sleepSettingsLocal;
  const {colors, isDark} = useTheme();
  const [editingTime, setEditingTime] = useState<'wake' | 'sleep' | null>(null);
  const [editingTab, setEditingTab] = useState<'weekday' | 'weekend'>('weekday');
  const scrollViewRef = useRef<ScrollView>(null);
  const hasScrolledRef = useRef(false);
  const [timelineHeight, setTimelineHeight] = useState(0);
  const segmentLayoutsRef = useRef<Array<SegmentLayout | null>>([]);
  const flowTimelineYRef = useRef(0);
  const scrollViewScreenYRef = useRef(0);
  const scrollViewWrapperRef = useRef<View>(null);
  const rightColumnRef = useRef<View>(null);
  const hourlyGridRef = useRef<View>(null);
  const hourlyGridOffsetRef = useRef(0); // offset of hourlyGrid within rightColumnRef
  const rightColumnScrollYRef = useRef(0);
  const rightColumnOffsetYRef = useRef(0);

  // Event creation (long-press + drag)
  const [creatingEvent, setCreatingEvent] = useState<{startMin: number; endMin: number} | null>(null);
  const creatingEventRef = useRef<{startMin: number; endMin: number} | null>(null);
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpTouchYRef = useRef(0);
  const lpTouchXRef = useRef(0);
  const lpLocationYRef = useRef(0); // rightColumnRef内の相対Y
  const lpActiveRef = useRef(false);
  const lpLastPageYRef = useRef(0);
  const lpStartMinRef = useRef(0);
  const lpSnapRef = useRef(15); // snap granularity in minutes
  const lpAutoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Swipe-to-delete
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

  // Bottom sheet
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

  // Load sleep settings (fallback if not passed via prop)
  useEffect(() => {
    if (sleepSettingsProp === undefined) {
      getSleepSettings().then(s => setSleepSettingsLocal(s));
    }
  }, [sleepSettingsProp]);

  // Inline time editor handler
  const handleTimeAdjust = useCallback((type: 'wake' | 'sleep', field: 'hour' | 'minute', delta: number) => {
    if (!sleepSettings || !onSleepSettingsChange) return;
    const tab = editingTab;
    const current = sleepSettings[tab];
    const newDay = {...current};
    if (type === 'wake') {
      if (field === 'hour') {
        newDay.wakeUpHour = (current.wakeUpHour + delta + 24) % 24;
      } else {
        newDay.wakeUpMinute = (current.wakeUpMinute + delta + 60) % 60;
      }
    } else {
      if (field === 'hour') {
        newDay.sleepHour = (current.sleepHour + delta + 25) % 25;
      } else {
        newDay.sleepMinute = (current.sleepMinute + delta + 60) % 60;
      }
    }
    const newSettings = {...sleepSettings, [tab]: newDay};
    onSleepSettingsChange(newSettings);
  }, [sleepSettings, editingTab, onSleepSettingsChange]);

  const formatTimeDisp = (hour: number, minute: number) =>
    `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  // ── Derived dates ──

  const dayStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  const daySetting = useMemo(() => {
    if (!sleepSettings) return null;
    return getSettingsForDate(sleepSettings, dayStart);
  }, [sleepSettings, dayStart]);

  const displayStartHour = useMemo(() => {
    if (!daySetting || daySetting.sleepHour <= daySetting.wakeUpHour) return 0;
    return daySetting.wakeUpHour;
  }, [daySetting]);

  const displayEndHour = useMemo(() => {
    if (!daySetting || daySetting.sleepHour <= daySetting.wakeUpHour) return 24;
    return daySetting.sleepHour;
  }, [daySetting]);

  const dateKey = useMemo(() => getDateKey(dayStart), [dayStart]);

  const isTodayDate = useMemo(() => {
    const today = new Date();
    return (
      dayStart.getDate() === today.getDate() &&
      dayStart.getMonth() === today.getMonth() &&
      dayStart.getFullYear() === today.getFullYear()
    );
  }, [dayStart]);

  // Week strip dates
  const weekDates = useMemo(() => {
    const d = new Date(dayStart);
    const dayOfWeek = d.getDay();
    d.setDate(d.getDate() - dayOfWeek);
    return Array.from({length: 7}, (_, i) => {
      const wd = new Date(d);
      wd.setDate(d.getDate() + i);
      return wd;
    });
  }, [dayStart]);

  // Buffered week strip for horizontal scroll
  const stripScrollRef = useRef<ScrollView>(null);
  const isResettingStripRef = useRef(false);
  const dayStartRef = useRef(dayStart);
  useEffect(() => { dayStartRef.current = dayStart; }, [dayStart]);
  const onDayChangeRef = useRef(onDayChange);
  useEffect(() => { onDayChangeRef.current = onDayChange; }, [onDayChange]);

  const bufferedStripDays = useMemo(() => {
    // Center on the week that contains dayStart (Sun-Sat)
    const d = new Date(dayStart);
    const dayOfWeek = d.getDay();
    d.setDate(d.getDate() - dayOfWeek); // Sunday of this week
    return Array.from({length: STRIP_BUFFER_DAYS + 7 + STRIP_BUFFER_DAYS}, (_, i) => {
      const wd = new Date(d);
      wd.setDate(d.getDate() + (i - STRIP_BUFFER_DAYS));
      return wd;
    });
  }, [dayStart]);

  const handleStripScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isResettingStripRef.current) return;
    const offsetX = e.nativeEvent.contentOffset.x;
    const dayOffset = Math.round((offsetX - STRIP_INITIAL_OFFSET) / STRIP_DAY_WIDTH);
    if (dayOffset !== 0 && onDayChangeRef.current) {
      const newDate = new Date(dayStartRef.current);
      newDate.setDate(newDate.getDate() + dayOffset);
      onDayChangeRef.current(newDate);
    } else {
      stripScrollRef.current?.scrollTo({x: STRIP_INITIAL_OFFSET, animated: false});
    }
  }, []);

  // Reset strip scroll to center when dayStart changes
  useEffect(() => {
    isResettingStripRef.current = true;
    stripScrollRef.current?.scrollTo({x: STRIP_INITIAL_OFFSET, animated: false});
    const timer = setTimeout(() => {
      isResettingStripRef.current = false;
    }, 100);
    return () => clearTimeout(timer);
  }, [dayStart]);

  // ── Data fetching ──

  const fetchTasks = useCallback(async () => {
    const tasks = await getTasksForDateRange([dateKey]);
    setDayTasks(tasks.get(dateKey) || []);
  }, [dateKey]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // taskTypeで分類: 後方互換のためtaskType未設定はtimeの有無で判定
  const todoTasks = useMemo(() =>
    dayTasks.filter(t => t.taskType === 'todo' || (!t.taskType && !t.time))
      .sort((a, b) => Number(a.completed) - Number(b.completed)),
  [dayTasks]);
  const scheduleTasks = useMemo(() =>
    dayTasks.filter(t => t.taskType === 'schedule' || (!t.taskType && t.time)),
  [dayTasks]);
  // タイムラインに表示するタスク: timeを持つ全タスク（todoも含む）
  const timedTasks = useMemo(() => dayTasks.filter(t => t.time), [dayTasks]);
  const untimedTasks = todoTasks; // 後方互換エイリアス

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

  const sheetScheduleItems = useMemo((): ScheduleItem[] => {
    const items: ScheduleItem[] = [];

    // Calendar events
    events.forEach(event => {
      if (event.allDay) {
        items.push({
          id: event.id || `ev-allday-${Math.random()}`,
          title: event.title || '',
          timeLabel: '終日',
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

    // Schedule tasks (予定タイプのみ右カラムに表示)
    scheduleTasks.filter(t => t.time).forEach(task => {
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

    items.sort((a, b) => a.sortMinutes - b.sortMinutes);
    return items;
  }, [events, eventColors, scheduleTasks]);

  const fetchEvents = useCallback(async () => {
    if (!hasPermission) return;
    setIsLoading(true);
    setError(null);
    try {
      const start = dayStart;
      const end = new Date(dayStart);
      end.setDate(end.getDate() + 1);
      const [calendarEvents, allColors] = await Promise.all([
        RNCalendarEvents.fetchAllEvents(start.toISOString(), end.toISOString()),
        getAllEventColors(),
      ]);
      const filtered = calendarEvents.filter(event => {
        const cal = event.calendar;
        if (!cal) return true;
        const title = (cal.title || '').toLowerCase();
        if (title.includes('祝日') || title.includes('holiday') || title.includes('holidays')) return false;
        if (cal.allowsModifications === false && event.allDay) return false;
        return true;
      });
      setEvents(filtered);
      setEventColors(allColors);
    } catch (_err) {
      setError('予定の読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [dayStart, hasPermission]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // ── Strip event counts ──
  const [stripEventCounts, setStripEventCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!hasPermission) return;
    const fetchStripCounts = async () => {
      const weekStart = new Date(dayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      try {
        const allEvents = await RNCalendarEvents.fetchAllEvents(weekStart.toISOString(), weekEnd.toISOString());
        const filtered = allEvents.filter(event => {
          const cal = event.calendar;
          if (!cal) return true;
          const title = (cal.title || '').toLowerCase();
          if (title.includes('祝日') || title.includes('holiday') || title.includes('holidays')) return false;
          if (cal.allowsModifications === false && event.allDay) return false;
          return true;
        });
        const counts: Record<string, number> = {};
        for (const ev of filtered) {
          if (!ev.startDate) continue;
          const d = new Date(ev.startDate);
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          counts[key] = (counts[key] || 0) + 1;
        }
        setStripEventCounts(counts);
      } catch (_e) {}
    };
    fetchStripCounts();
  }, [dayStart, hasPermission]);

  // ── Current time ──

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const nowMinutes = useMemo(() => {
    return currentTime.getHours() * 60 + currentTime.getMinutes();
  }, [currentTime]);

  // ── Compute end time from start + duration ──

  const updateEndTime = useCallback((startH: string, startM: string, durationMin: number | null) => {
    if (!durationMin) return;
    const h = parseInt(startH, 10) || 0;
    const m = parseInt(startM, 10) || 0;
    const totalMin = h * 60 + m + durationMin;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    setTaskEndTimeHour(String(endH).padStart(2, '0'));
    setTaskEndTimeMinute(String(endM).padStart(2, '0'));
  }, []);

  // ── Task handlers ──

  const [taskInputError, setTaskInputError] = useState(false);
  const handleAddTask = useCallback(async () => {
    const trimmed = taskInputText.trim();
    if (!trimmed) { setTaskInputError(true); return; }
    try {
      const duration = taskDuration || undefined;
      const memo = taskMemo.trim() || undefined;
      const deadline = (taskDeadlineHour && taskDeadlineMinute)
        ? `${taskDeadlineHour.padStart(2, '0')}:${taskDeadlineMinute.padStart(2, '0')}`
        : undefined;
      await addTaskForDate(trimmed, dateKey, undefined, duration, 'todo', memo, deadline);
      setTaskInputText('');
      setAddingTask(false);
      setTaskTimeEnabled(false);
      setTaskTimeHour('');
      setTaskTimeMinute('');
      setTaskEndTimeHour('');
      setTaskEndTimeMinute('');
      setTaskDuration(null);
      setTaskDurationCustom(false);
      setTaskCustomMinutes('');
      setTaskMemo('');
      setTaskDeadlineHour('');
      setTaskDeadlineMinute('');
      setTaskInputError(false);
      Keyboard.dismiss();
      fetchTasks();
    } catch (e) {
      console.error('handleAddTask error:', e);
    }
  }, [taskInputText, dateKey, fetchTasks, taskDuration, taskMemo, taskDeadlineHour, taskDeadlineMinute]);

  const handleToggleTask = useCallback(async (taskId: string) => {
    await toggleTask(taskId);
    fetchTasks();
  }, [fetchTasks]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    fetchTasks();
  }, [fetchTasks]);

  const handleStartEditTodo = useCallback((task: Task) => {
    setEditingTodoTaskId(task.id);
    setEditTodoTitle(task.title);
    setEditTodoMemo(task.memo || '');
    setEditTodoDuration(task.duration || null);
    if (task.deadline) {
      const [h, m] = task.deadline.split(':');
      setEditTodoDeadlineHour(h);
      setEditTodoDeadlineMinute(m);
    } else {
      setEditTodoDeadlineHour('');
      setEditTodoDeadlineMinute('');
    }
  }, []);

  const handleSaveEditTodo = useCallback(async () => {
    if (!editingTodoTaskId) return;
    const title = editTodoTitle.trim();
    if (!title) return;
    const deadline = (editTodoDeadlineHour && editTodoDeadlineMinute)
      ? `${editTodoDeadlineHour.padStart(2, '0')}:${editTodoDeadlineMinute.padStart(2, '0')}`
      : undefined;
    await updateTask(editingTodoTaskId, {
      title,
      duration: editTodoDuration || undefined,
      clearDuration: !editTodoDuration,
      memo: editTodoMemo.trim(),
      deadline,
      clearDeadline: !deadline,
    });
    setEditingTodoTaskId(null);
    Keyboard.dismiss();
    fetchTasks();
  }, [editingTodoTaskId, editTodoTitle, editTodoMemo, editTodoDuration, editTodoDeadlineHour, editTodoDeadlineMinute, fetchTasks]);

  const handleCancelEditTodo = useCallback(() => {
    setEditingTodoTaskId(null);
  }, []);

  const handleExpandTask = useCallback((task: Task) => {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(task.id);
    setEditTaskDuration(task.duration || null);
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
    await updateTask(taskId, { time, duration: editTaskDuration || undefined });
    setExpandedTaskId(null);
    fetchTasks();
  }, [editTaskTimeHour, editTaskTimeMinute, editTaskDuration, fetchTasks]);

  const handleSaveDurationOnly = useCallback(async (taskId: string) => {
    await updateTask(taskId, { duration: editTaskDuration || undefined, clearDuration: !editTaskDuration });
    setExpandedTaskId(null);
    fetchTasks();
  }, [editTaskDuration, fetchTasks]);

  const handleEditTimelineTask = useCallback((task: Task) => {
    if (editingTimelineTaskId === task.id) {
      setEditingTimelineTaskId(null);
      return;
    }
    setEditingTimelineTaskId(task.id);
    setEditTaskDuration(task.duration || null);
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
    }
    // Scroll down so the edit panel is visible above the bottom sheet
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: scrollOffsetRef.current + 180,
        animated: true,
      });
    }, 100);
  }, [editingTimelineTaskId]);

  const handleSaveTimelineTask = useCallback(async (taskId: string) => {
    const time = `${editTaskTimeHour.padStart(2, '0')}:${editTaskTimeMinute.padStart(2, '0')}`;
    await updateTask(taskId, { time, duration: editTaskDuration || undefined });
    setEditingTimelineTaskId(null);
    fetchTasks();
  }, [editTaskTimeHour, editTaskTimeMinute, editTaskDuration, fetchTasks]);

  const handleRemoveFromTimeline = useCallback(async (taskId: string) => {
    await updateTask(taskId, { clearTime: true });
    setEditingTimelineTaskId(null);
    fetchTasks();
  }, [fetchTasks]);

  const handleDeleteScheduleItem = useCallback(async (item: ScheduleItem) => {
    if (item.isEvent && item.event?.id) {
      await RNCalendarEvents.removeEvent(item.event.id);
      fetchEvents();
    } else if (item.task) {
      await deleteTask(item.task.id);
      fetchTasks();
    }
  }, [fetchEvents, fetchTasks]);

  // Helper: compute minutes from screen pageY position
  // Uses gridTopOnScreenRef which must point to the top of the hourly grid (not rightColumnRef)
  // pageY → 分 変換（measureInWindow不使用、同期的に正確）
  // scrollViewScreenY(固定) + コンテンツ内位置 - scrollOffset = 画面位置
  // 逆算: コンテンツY = pageY - scrollViewScreenY + scrollOffset
  // hourlyGridコンテンツY = flowTimelineY + rightColumnOffsetY + hourlyGridOffset
  // relY = コンテンツY - hourlyGridコンテンツY
  const pageYToMinutes = useCallback((pageY: number) => {
    const contentY = pageY - scrollViewScreenYRef.current + scrollOffsetRef.current;
    const hourlyGridContentY = flowTimelineYRef.current + rightColumnOffsetYRef.current + hourlyGridOffsetRef.current;
    const relY = contentY - hourlyGridContentY;
    const totalRows = displayEndHour - displayStartHour;
    const totalHeight = totalRows * HOURLY_ROW_HEIGHT;
    if (relY <= 0) return displayStartHour * 60;
    if (relY >= totalHeight) return displayEndHour * 60;
    return displayStartHour * 60 + (relY / totalHeight) * (displayEndHour - displayStartHour) * 60;
  }, [displayStartHour, displayEndHour]);

  // ── Drag & Drop handlers ──

  const dragCallbacksRef = useRef({
    onDragGrant: (_taskId: string, _px: number, _py: number) => {},
    onDragMove: (_px: number, _py: number) => {},
    finalizeDrag: async () => {},
    onDragCancel: () => {},
    onDragTap: (_taskId: string, _pageX?: number) => {},
  });

  // Keep segments/heights in refs so drag callbacks can use them without stale closures
  const segmentsRef = useRef<Segment[]>([]);
  const segmentHeightsRef = useRef<number[]>([]);

  const onDragGrant = useCallback((taskId: string, _pageX: number, _pageY: number) => {
    dragStartedRef.current = false;
    dragTaskIdRef.current = taskId;
    // Pre-measure immediately so value is ready by the time onDragMove fires
    (hourlyGridRef.current || rightColumnRef.current || gridContainerRef.current)?.measureInWindow((_x: number, y: number) => {
      gridTopOnScreenRef.current = y;
    });
  }, []);

  const onDragMove = useCallback((pageX: number, pageY: number) => {
    if (!dragStartedRef.current) {
      dragStartedRef.current = true;
      const task = untimedTasks.find(t => t.id === dragTaskIdRef.current);
      if (!task) return;
      setDraggingTask(task);
      sheetOffset.current = BOTTOM_SHEET_MIN;
      Animated.timing(sheetAnim, {toValue: BOTTOM_SHEET_MIN, duration: 200, useNativeDriver: false}).start();
      // Re-measure (grant's measurement may not have arrived yet)
      (rightColumnRef.current || gridContainerRef.current)?.measureInWindow((_x: number, y: number) => {
        gridTopOnScreenRef.current = y;
      });
      // Skip drop-time calculation on the very first move — measureInWindow is async
      // and gridTopOnScreenRef may still be stale (0). Just show the floating card.
      dragAnimX.setValue(pageX - 48);
      dragAnimY.setValue(pageY - 44);
      return;
    }
    dragAnimX.setValue(pageX - 48);
    dragAnimY.setValue(pageY - 44);

    // Calculate drop time using pageY → minutes
    const wMin = displayStartHour * 60;
    const sMin = displayEndHour * 60;
    const totalMinutes = pageYToMinutes(pageY);
    const roundedMinutes = Math.max(wMin, Math.min(sMin - 1, Math.round(totalMinutes / 15) * 15));
    const h = Math.floor(roundedMinutes / 60);
    const m = roundedMinutes % 60;
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    dropTimeRef.current = timeStr;
    setDropTimePreview(timeStr);
  }, [untimedTasks, sheetAnim, dragAnimX, dragAnimY, displayStartHour, displayEndHour, pageYToMinutes]);

  const finalizeDrag = useCallback(async () => {
    const taskId = dragTaskIdRef.current;
    const currentDropTime = dropTimeRef.current;
    const wasStarted = dragStartedRef.current;
    setDraggingTask(null);
    setDropTimePreview(null);
    dropTimeRef.current = null;
    dragStartedRef.current = false;
    dragTaskIdRef.current = null;
    if (wasStarted && taskId && currentDropTime) {
      const task = untimedTasks.find(t => t.id === taskId);
      const duration = task?.duration || 60;
      await updateTask(taskId, { time: currentDropTime, duration });
      fetchTasks();
    }
  }, [untimedTasks, fetchTasks]);

  const onDragCancel = useCallback(() => {
    finalizeDrag();
  }, [finalizeDrag]);

  const onDragTap = useCallback((taskId: string, pageX?: number) => {
    // If tapped on checkbox area (left ~44px of the row), toggle completion
    if (pageX !== undefined && pageX < 60) {
      handleToggleTask(taskId);
      return;
    }
    const task = untimedTasks.find(t => t.id === taskId);
    if (task) handleStartEditTodo(task);
  }, [untimedTasks, handleStartEditTodo, handleToggleTask]);

  dragCallbacksRef.current = { onDragGrant, onDragMove, finalizeDrag, onDragCancel, onDragTap };

  // ── Event Drag & Drop ──
  const eventLpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventDragActiveRef = useRef(false);

  const onEventDragGrant = useCallback((item: TimelineItem, _pageX: number, _pageY: number) => {
    dragStartedRef.current = false;
    eventDragActiveRef.current = false;
    dragEventItemRef.current = item;
    // Cancel any creation long-press timer
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }
    (hourlyGridRef.current || rightColumnRef.current || gridContainerRef.current)?.measureInWindow((_x: number, y: number) => {
      gridTopOnScreenRef.current = y;
    });
  }, []);

  const onEventDragMove = useCallback((pageX: number, pageY: number) => {
    if (!eventDragActiveRef.current) return;
    if (!dragStartedRef.current) {
      dragStartedRef.current = true;
      const item = dragEventItemRef.current;
      if (!item) return;
      setDraggingEvent(item);
      (rightColumnRef.current || gridContainerRef.current)?.measureInWindow((_x: number, y: number) => {
        gridTopOnScreenRef.current = y;
      });
      dragAnimX.setValue(pageX - 48);
      dragAnimY.setValue(pageY - 44);
      return;
    }
    dragAnimX.setValue(pageX - 48);
    dragAnimY.setValue(pageY - 44);

    // Calculate drop time using pageY → minutes
    const wMin = displayStartHour * 60;
    const sMin = displayEndHour * 60;
    const totalMinutes = pageYToMinutes(pageY);
    const roundedMinutes = Math.max(wMin, Math.min(sMin - 1, Math.round(totalMinutes / 15) * 15));
    const h = Math.floor(roundedMinutes / 60);
    const m = roundedMinutes % 60;
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    dropTimeRef.current = timeStr;
    setDropTimePreview(timeStr);
  }, [dragAnimX, dragAnimY, displayStartHour, displayEndHour, pageYToMinutes]);

  const finalizeEventDrag = useCallback(async () => {
    const item = dragEventItemRef.current;
    const currentDropTime = dropTimeRef.current;
    const wasStarted = dragStartedRef.current;
    setDraggingEvent(null);
    setDropTimePreview(null);
    dropTimeRef.current = null;
    dragStartedRef.current = false;
    dragEventItemRef.current = null;
    eventDragActiveRef.current = false;
    if (wasStarted && item && currentDropTime && item.type === 'event') {
      const event = item.original as CalendarEventReadable;
      const duration = item.endMinutes - item.startMinutes;
      const [dh, dm] = currentDropTime.split(':').map(Number);
      const newStartMin = dh * 60 + dm;
      // Only update if time actually changed
      if (newStartMin === item.startMinutes) return;
      const dayDate = new Date(currentDate);
      const newStart = new Date(dayDate);
      newStart.setHours(dh, dm, 0, 0);
      const newEnd = new Date(newStart.getTime() + duration * 60000);
      try {
        await RNCalendarEvents.saveEvent(event.title || '(タイトルなし)', {
          id: event.id,
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          allDay: false,
        });
        fetchEvents();
      } catch (_e) {
        // silently fail
      }
    }
  }, [currentDate, fetchEvents]);

  const eventPanResponderRefs = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});

  const getEventPanResponder = useCallback((item: TimelineItem) => {
    if (eventPanResponderRefs.current[item.id]) return eventPanResponderRefs.current[item.id];
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 8,
      onPanResponderGrant: (e) => {
        onEventDragGrant(item, e.nativeEvent.pageX, e.nativeEvent.pageY);
        eventLpTimerRef.current = setTimeout(() => {
          eventDragActiveRef.current = true;
          Vibration.vibrate(10);
        }, 400);
      },
      onPanResponderMove: (e, gs) => {
        if (Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8) {
          if (!eventDragActiveRef.current && eventLpTimerRef.current) {
            clearTimeout(eventLpTimerRef.current);
            eventLpTimerRef.current = null;
          }
        }
        if (eventDragActiveRef.current) {
          onEventDragMove(e.nativeEvent.pageX, e.nativeEvent.pageY);
        }
      },
      onPanResponderRelease: (_e, gs) => {
        if (eventLpTimerRef.current) {
          clearTimeout(eventLpTimerRef.current);
          eventLpTimerRef.current = null;
        }
        if (eventDragActiveRef.current) {
          finalizeEventDrag();
        } else {
          // Not dragging - clean up refs
          dragEventItemRef.current = null;
          eventDragActiveRef.current = false;
          if (Math.abs(gs.dx) < 5 && Math.abs(gs.dy) < 5) {
            // Tap - trigger event press
            onEventPress?.(item.original as CalendarEventReadable);
          }
        }
      },
      onPanResponderTerminate: () => {
        if (eventLpTimerRef.current) {
          clearTimeout(eventLpTimerRef.current);
          eventLpTimerRef.current = null;
        }
        if (eventDragActiveRef.current) {
          finalizeEventDrag();
        } else {
          dragEventItemRef.current = null;
          eventDragActiveRef.current = false;
        }
      },
    });
    eventPanResponderRefs.current[item.id] = responder;
    return responder;
  }, [onEventDragGrant, onEventDragMove, finalizeEventDrag, onEventPress]);

  // Clear cached pan responders when events change
  useEffect(() => {
    eventPanResponderRefs.current = {};
  }, [events]);

  const swipeDirRef = useRef<Record<string, 'h' | 'v' | null>>({});
  const taskLpTimerRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const taskDragActiveRef = useRef<Record<string, boolean>>({});
  const taskTouchStartRef = useRef<Record<string, {px: number; py: number}>>({});

  const taskPanResponders = useMemo(() => {
    const responders: Record<string, ReturnType<typeof PanResponder.create>> = {};
    for (const task of untimedTasks) {
      const taskId = task.id;
      responders[taskId] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8,
        onPanResponderTerminationRequest: () => !taskDragActiveRef.current[taskId],
        onPanResponderGrant: (e) => {
          swipeDirRef.current[taskId] = null;
          taskDragActiveRef.current[taskId] = false;
          taskTouchStartRef.current[taskId] = {px: e.nativeEvent.pageX, py: e.nativeEvent.pageY};
          dragCallbacksRef.current.onDragGrant(taskId, e.nativeEvent.pageX, e.nativeEvent.pageY);
          // Start long-press timer for vertical drag
          taskLpTimerRef.current[taskId] = setTimeout(() => {
            taskLpTimerRef.current[taskId] = null;
            taskDragActiveRef.current[taskId] = true;
            swipeDirRef.current[taskId] = 'v';
            Vibration.vibrate(10);
          }, 400);
        },
        onPanResponderMove: (e, gs) => {
          // If moved before long-press timer, cancel it and detect h/v
          if (!taskDragActiveRef.current[taskId] && !swipeDirRef.current[taskId] && (Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8)) {
            if (taskLpTimerRef.current[taskId]) {
              clearTimeout(taskLpTimerRef.current[taskId]!);
              taskLpTimerRef.current[taskId] = null;
            }
            // Only allow horizontal swipe before long-press
            if (Math.abs(gs.dx) > Math.abs(gs.dy)) {
              swipeDirRef.current[taskId] = 'h';
            } else {
              // Vertical movement before long-press = scroll, release responder
              return;
            }
          }
          const dir = swipeDirRef.current[taskId];
          if (dir === 'h') {
            const anim = getSwipeAnim(taskId);
            anim.setValue(Math.min(0, Math.max(-72, gs.dx)));
          } else if (dir === 'v' && taskDragActiveRef.current[taskId]) {
            dragCallbacksRef.current.onDragMove(e.nativeEvent.pageX, e.nativeEvent.pageY);
          }
        },
        onPanResponderRelease: (e, gs) => {
          if (taskLpTimerRef.current[taskId]) {
            clearTimeout(taskLpTimerRef.current[taskId]!);
            taskLpTimerRef.current[taskId] = null;
          }
          const dir = swipeDirRef.current[taskId];
          const wasDragActive = taskDragActiveRef.current[taskId];
          swipeDirRef.current[taskId] = null;
          taskDragActiveRef.current[taskId] = false;
          if (dir === 'h') {
            const anim = getSwipeAnim(taskId);
            if (gs.dx < -36) {
              const prev = swipedItemIdRef.current;
              if (prev && prev !== taskId) resetSwipe(prev);
              swipedItemIdRef.current = taskId;
              Animated.spring(anim, {toValue: -72, useNativeDriver: true}).start();
            } else {
              resetSwipe(taskId);
            }
          } else if (dir === 'v' && wasDragActive) {
            dragCallbacksRef.current.finalizeDrag();
          } else {
            // Tap
            dragStartedRef.current = false;
            dragTaskIdRef.current = null;
            dropTimeRef.current = null;
            if (swipedItemIdRef.current) {
              resetSwipe(swipedItemIdRef.current);
            } else {
              dragCallbacksRef.current.onDragTap(taskId, e.nativeEvent.pageX);
            }
          }
        },
        onPanResponderTerminate: () => {
          if (taskLpTimerRef.current[taskId]) {
            clearTimeout(taskLpTimerRef.current[taskId]!);
            taskLpTimerRef.current[taskId] = null;
          }
          const dir = swipeDirRef.current[taskId];
          const wasDragActive = taskDragActiveRef.current[taskId];
          swipeDirRef.current[taskId] = null;
          taskDragActiveRef.current[taskId] = false;
          if (dir === 'v' && wasDragActive) {
            dragCallbacksRef.current.finalizeDrag();
          } else if (dir === 'h') {
            resetSwipe(taskId);
          }
        },
      });
    }
    return responders;
  }, [untimedTasks, getSwipeAnim, resetSwipe]);

  const schedulePanResponders = useMemo(() => {
    const responders: Record<string, ReturnType<typeof PanResponder.create>> = {};
    for (const item of sheetScheduleItems) {
      const itemId = item.id;
      responders[itemId] = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onMoveShouldSetPanResponderCapture: (_, gs) => Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onPanResponderMove: (_, gs) => {
          const anim = getSwipeAnim(itemId);
          anim.setValue(Math.min(0, Math.max(-72, gs.dx)));
        },
        onPanResponderRelease: (_, gs) => {
          const anim = getSwipeAnim(itemId);
          if (gs.dx < -36) {
            const prev = swipedItemIdRef.current;
            if (prev && prev !== itemId) resetSwipe(prev);
            swipedItemIdRef.current = itemId;
            Animated.spring(anim, {toValue: -72, useNativeDriver: true}).start();
          } else {
            resetSwipe(itemId);
          }
        },
      });
    }
    return responders;
  }, [sheetScheduleItems, getSwipeAnim, resetSwipe]);

  // ── Timeline items ──

  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    events.forEach(event => {
      if (!event.startDate || !event.endDate || event.allDay) return;
      const es = new Date(event.startDate);
      const ee = new Date(event.endDate);
      if (es > dayEnd || ee < dayStart) return;
      const startMin = es < dayStart ? 0 : es.getHours() * 60 + es.getMinutes();
      let endMin: number;
      if (ee > dayEnd) {
        endMin = 24 * 60;
      } else {
        endMin = ee.getHours() * 60 + ee.getMinutes();
        if (endMin === 0 && ee.getDate() !== dayStart.getDate()) endMin = 24 * 60;
      }
      items.push({
        type: 'event',
        id: event.id || `ev-${startMin}`,
        title: event.title || '',
        startMinutes: startMin,
        endMinutes: Math.max(endMin, startMin + 30),
        color: (event.id && eventColors[event.id]) || event.calendar?.color || '#007AFF',
        location: event.location || undefined,
        original: event,
      });
    });
    timedTasks.forEach(task => {
      const [h, m] = task.time!.split(':').map(Number);
      const startMin = h * 60 + m;
      const dur = task.duration || 30;
      const isTodo = task.taskType === 'todo' || (!task.taskType && false);
      items.push({
        type: 'task',
        id: `task-${task.id}`,
        title: task.title,
        startMinutes: startMin,
        endMinutes: startMin + dur,
        completed: task.completed,
        original: task,
        isTodo,
      });
    });
    items.sort((a, b) => a.startMinutes - b.startMinutes);
    return items;
  }, [events, eventColors, timedTasks, dayStart]);

  // ── Segments ──

  const showWake = !!(sleepSettings && daySetting && displayStartHour > 0);
  const showSleep = !!(sleepSettings && daySetting);
  const wakeMin = showWake ? daySetting!.wakeUpHour * 60 + daySetting!.wakeUpMinute : 0;
  const sleepMinVal = (() => {
    if (!daySetting) return 24 * 60;
    const raw = daySetting.sleepHour * 60 + daySetting.sleepMinute;
    // 就寝が起床以前（0時越え）なら24:00として扱う
    return raw <= wakeMin ? 24 * 60 : raw;
  })();

  const segments = useMemo((): Segment[] => {
    const result: Segment[] = [];

    if (showWake) {
      result.push({ type: 'wake', hour: daySetting!.wakeUpHour, minute: daySetting!.wakeUpMinute });
    }

    // Group overlapping items into clusters
    const clusters: { items: TimelineItem[]; startMin: number; endMin: number }[] = [];
    for (const item of timelineItems) {
      const itemStart = Math.max(item.startMinutes, wakeMin);
      const itemEnd = Math.min(item.endMinutes, sleepMinVal);
      if (itemStart >= sleepMinVal || itemEnd <= wakeMin) continue;

      const lastCluster = clusters[clusters.length - 1];
      if (lastCluster && itemStart < lastCluster.endMin) {
        // Overlaps with current cluster
        lastCluster.items.push(item);
        lastCluster.endMin = Math.max(lastCluster.endMin, itemEnd);
      } else {
        clusters.push({ items: [item], startMin: itemStart, endMin: itemEnd });
      }
    }

    let cursor = wakeMin;

    for (const cluster of clusters) {
      if (cursor < cluster.startMin) {
        result.push({
          type: 'gap',
          startMin: cursor,
          endMin: cluster.startMin,
          markers: buildGapMarkers(cursor, cluster.startMin),
        });
      }

      result.push({
        type: 'item',
        items: cluster.items,
        startMin: cluster.startMin,
        endMin: cluster.endMin,
        durationMin: Math.max(cluster.endMin - cluster.startMin, 15),
      });

      cursor = Math.max(cursor, cluster.endMin);
    }

    if (cursor < sleepMinVal) {
      result.push({
        type: 'gap',
        startMin: cursor,
        endMin: sleepMinVal,
        markers: buildGapMarkers(cursor, sleepMinVal),
      });
    }

    if (showSleep) {
      result.push({ type: 'sleep', hour: Math.floor(sleepMinVal / 60), minute: sleepMinVal % 60 });
    }

    return result;
  }, [timelineItems, showWake, showSleep, daySetting, wakeMin, sleepMinVal]);

  // ── Largest gap segment index & total free time ──
  const largestGapIndex = useMemo(() => {
    let maxDur = 0;
    let maxIdx = -1;
    segments.forEach((seg, i) => {
      if (seg.type === 'gap') {
        const dur = seg.endMin - seg.startMin;
        if (dur > maxDur) { maxDur = dur; maxIdx = i; }
      }
    });
    return maxIdx;
  }, [segments]);

  const totalFreeMinutes = useMemo(() =>
    segments.reduce((sum, seg) =>
      seg.type === 'gap' ? sum + (seg.endMin - seg.startMin) : sum, 0),
  [segments]);

  const incompleteTodos = useMemo(() =>
    todoTasks.filter(t => !t.completed),
  [todoTasks]);

  // Keep refs in sync for drag callbacks
  segmentsRef.current = segments;

  // Reset segment layouts when segments change (extra slot for split gap)
  useEffect(() => {
    segmentLayoutsRef.current = new Array(segments.length + 1).fill(null);
  }, [segments.length]);

  // ── Segment heights ──

  const segmentHeights = useMemo(() => {
    const gapMarkerCount = segments.reduce((sum, s) =>
      s.type === 'gap' ? sum + s.markers.length : sum, 0);
    const gapCount = segments.filter(s => s.type === 'gap').length;

    const fixedTotal =
      (showWake ? FLOW_WAKE_HEIGHT : 0) +
      (showSleep ? FLOW_SLEEP_HEIGHT : 0) +
      gapMarkerCount * FLOW_GAP_MARKER_HEIGHT +
      gapCount * FLOW_GAP_PADDING;

    const itemSegments = segments.filter((s): s is Extract<Segment, {type: 'item'}> => s.type === 'item');
    const totalItemMinutes = itemSegments.reduce((sum, s) => sum + s.durationMin, 0);
    const availableHeight = Math.max(0, timelineHeight - BOTTOM_SHEET_MIN - fixedTotal);
    const pxPerMinute = totalItemMinutes > 0 ? availableHeight / totalItemMinutes : 0;

    return segments.map(seg => {
      switch (seg.type) {
        case 'wake': return FLOW_WAKE_HEIGHT;
        case 'sleep': return FLOW_SLEEP_HEIGHT;
        case 'gap': return seg.markers.length * FLOW_GAP_MARKER_HEIGHT + FLOW_GAP_PADDING;
        case 'item': {
          if (seg.durationMin <= 60) return FLOW_MIN_ITEM_HEIGHT;
          if (seg.durationMin >= 180) return FLOW_MAX_ITEM_HEIGHT;
          return Math.max(FLOW_MIN_ITEM_HEIGHT, seg.durationMin * FLOW_ITEM_PX_PER_MIN);
        }
      }
    });
  }, [segments, timelineHeight, showWake, showSleep]);

  // Keep heights ref in sync
  segmentHeightsRef.current = segmentHeights;

  // ── Hourly slots for timeline bar UI ──
  type HourSlot = {
    hour: number;
    items: Array<{
      type: 'event' | 'task';
      item: TimelineItem;
      isFirst: boolean; // first hour of this item
    }>;
  };

  const hourlySlots = useMemo((): HourSlot[] => {
    const startH = displayStartHour;
    const endH = displayEndHour;
    const slots: HourSlot[] = [];
    for (let h = startH; h < endH; h++) {
      const hourStart = h * 60;
      const hourEnd = (h + 1) * 60;
      const overlapping = timelineItems.filter(item => {
        return item.startMinutes < hourEnd && item.endMinutes > hourStart;
      });
      slots.push({
        hour: h,
        items: overlapping.map(item => ({
          type: item.type,
          item,
          isFirst: item.startMinutes >= hourStart && item.startMinutes < hourEnd,
        })),
      });
    }
    return slots;
  }, [timelineItems, displayStartHour, displayEndHour]);

  // ── Current time Y position in flow ──

  const currentTimeYPosition = useMemo(() => {
    if (!isTodayDate) return null;
    const startMin = displayStartHour * 60;
    const endMin = displayEndHour * 60;
    if (nowMinutes < startMin || nowMinutes > endMin) return null;
    const slotIndex = Math.floor((nowMinutes - startMin) / 60);
    const withinSlot = (nowMinutes - startMin - slotIndex * 60) / 60;
    return hourlyGridOffsetRef.current + slotIndex * HOURLY_ROW_HEIGHT + withinSlot * HOURLY_ROW_HEIGHT;
  }, [isTodayDate, nowMinutes, displayStartHour, displayEndHour]);

  // ── Drop indicator Y position ──

  const dropIndicatorY = useMemo(() => {
    if ((!draggingTask && !draggingEvent) || !dropTimePreview) return null;
    const [dh, dm] = dropTimePreview.split(':').map(Number);
    const dropMin = dh * 60 + dm;
    const startMin = displayStartHour * 60;
    const slotIndex = Math.floor((dropMin - startMin) / 60);
    const withinSlot = ((dropMin - startMin) % 60) / 60;
    return hourlyGridOffsetRef.current + slotIndex * HOURLY_ROW_HEIGHT + withinSlot * HOURLY_ROW_HEIGHT;
  }, [draggingTask, draggingEvent, dropTimePreview, displayStartHour]);

  // ── Imperative handle ──

  const scrollToCurrentTime = useCallback(() => {
    if (scrollViewRef.current && currentTimeYPosition != null) {
      const absoluteY = rightColumnScrollYRef.current + currentTimeYPosition;
      scrollViewRef.current.scrollTo({y: Math.max(0, absoluteY - 100), animated: true});
    }
  }, [currentTimeYPosition]);

  useImperativeHandle(ref, () => ({
    refreshEvents: fetchEvents,
    scrollToCurrentTime,
  }), [fetchEvents, scrollToCurrentTime]);

  // ── Navigation helpers ──

  const goToPreviousDay = useCallback(() => {
    const nd = new Date(dayStart);
    nd.setDate(nd.getDate() - 1);
    onDayChange?.(nd);
  }, [dayStart, onDayChange]);

  const goToNextDay = useCallback(() => {
    const nd = new Date(dayStart);
    nd.setDate(nd.getDate() + 1);
    onDayChange?.(nd);
  }, [dayStart, onDayChange]);

  const goToToday = useCallback(() => {
    onDayChange?.(new Date());
  }, [onDayChange]);

  // ── Scroll to current time on first render for today ──
  useEffect(() => {
    if (isTodayDate && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      setTimeout(() => {
        scrollToCurrentTime();
      }, 150);
    }
  }, [isTodayDate, scrollToCurrentTime]);

  useEffect(() => {
    hasScrolledRef.current = false;
    setCreatingEvent(null);
  }, [dateKey]);

  // ── Event creation (long-press + drag) ──

  useEffect(() => {
    creatingEventRef.current = creatingEvent;
  }, [creatingEvent]);

  // (pageYToMinutes moved above drag handlers)

  const stopAutoScroll = useCallback(() => {
    if (lpAutoScrollRef.current) {
      clearInterval(lpAutoScrollRef.current);
      lpAutoScrollRef.current = null;
    }
  }, []);

  const handleCreationTouchStart = useCallback((e: any) => {
    if (editingTimelineTaskId || draggingTask || draggingEvent) return;
    lpActiveRef.current = false;
    lpTouchYRef.current = e.nativeEvent.pageY;
    lpTouchXRef.current = e.nativeEvent.pageX;
    lpSnapRef.current = 15;

    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null;
      if (dragEventItemRef.current || eventDragActiveRef.current) return;
      lpActiveRef.current = true;
      Vibration.vibrate(50);

      // 縦で「時」を判定、横で「分」を判定
      const rawMin = pageYToMinutes(lpTouchYRef.current);
      const tapHour = Math.floor(rawMin / 60); // 縦 → 時
      const barLeft = 42;
      const barRight = SCREEN_WIDTH - 6;
      const barWidth = barRight - barLeft;
      const xRatio = Math.max(0, Math.min(1, (lpTouchXRef.current - barLeft) / barWidth));
      const tapMinute = Math.round(xRatio * 60 / 5) * 5; // 横 → 分（5分刻み）
      const clampedHour = Math.max(displayStartHour, Math.min(displayEndHour - 1, tapHour));
      const clampedMin = clampedHour * 60 + Math.min(55, tapMinute);
      lpStartMinRef.current = clampedMin;
      setCreatingEvent({startMin: clampedMin, endMin: clampedMin + 5});

      // ドラッグ用に gridTopOnScreenRef も更新
      hourlyGridRef.current?.measureInWindow((_x: number, y: number) => {
        gridTopOnScreenRef.current = y;
      });
    }, 300);
  }, [displayStartHour, displayEndHour, editingTimelineTaskId, draggingTask]);

  // Compute endMin from drag
  // 指のY位置で終了「時」、指のX位置で終了「分」を直接決定
  // バーの右端 = 指のX位置になるようにする
  const computeEndFromDrag = useCallback((pageY: number, pageX: number) => {
    const startMin = lpStartMinRef.current;
    const startHour = Math.floor(startMin / 60);

    // 指のY位置から終了時の「時」を決定
    const endRawMin = pageYToMinutes(pageY);
    const endHour = Math.max(startHour, Math.floor(endRawMin / 60));

    // 指のX位置から終了時の「分」を決定（バー右端 = 指の位置）
    const barLeft = 42;
    const barRight = SCREEN_WIDTH - 6;
    const barWidth = barRight - barLeft;
    const xRatio = Math.max(0, Math.min(1, (pageX - barLeft) / barWidth));
    const endMinute = Math.round(xRatio * 60 / 5) * 5;

    const maxEnd = displayEndHour * 60;
    const endMin = endHour * 60 + Math.min(60, endMinute);
    return Math.min(maxEnd, Math.max(startMin + 5, endMin));
  }, [displayEndHour, pageYToMinutes]);

  const handleCreationTouchMove = useCallback((e: any) => {
    const pageY = e.nativeEvent.pageY;
    const pageX = e.nativeEvent.pageX;
    if (!lpActiveRef.current) {
      if (!lpTimerRef.current) return;
      if (Math.abs(pageY - lpTouchYRef.current) > 10 || Math.abs(pageX - lpTouchXRef.current) > 10) {
        clearTimeout(lpTimerRef.current);
        lpTimerRef.current = null;
      }
      return;
    }
    lpLastPageYRef.current = pageY;

    const startMin = lpStartMinRef.current;
    const endMin = computeEndFromDrag(pageY, pageX);
    setCreatingEvent({startMin, endMin});

    // Auto-scroll when near bottom or top of screen
    const screenH = Dimensions.get('window').height;
    stopAutoScroll();
    if (pageY > screenH - 100) {
      lpAutoScrollRef.current = setInterval(() => {
        scrollViewRef.current?.scrollTo({
          y: scrollOffsetRef.current + 30,
          animated: false,
        });
        rightColumnRef.current?.measureInWindow((_x: number, y: number) => {
          gridTopOnScreenRef.current = y;
        });
      }, 50);
    } else if (pageY < 200) {
      lpAutoScrollRef.current = setInterval(() => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, scrollOffsetRef.current - 30),
          animated: false,
        });
        rightColumnRef.current?.measureInWindow((_x: number, y: number) => {
          gridTopOnScreenRef.current = y;
        });
      }, 50);
    }
  }, [computeEndFromDrag, stopAutoScroll]);

  const handleCreationTouchEnd = useCallback(() => {
    stopAutoScroll();
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }
    if (lpActiveRef.current) {
      lpActiveRef.current = false;
      const ce = creatingEventRef.current;
      if (ce && ce.endMin - ce.startMin > 5) {
        const s = new Date(dayStart);
        s.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
        const ed = new Date(dayStart);
        ed.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
        setPendingTimeRange({start: s, end: ed});
        setShowAddTypeSelect(true);
      }
      setCreatingEvent(null);
    }
  }, [dayStart, stopAutoScroll]);

  // ── Segment layout handler ──

  const handleSegmentLayout = useCallback((index: number, startMin: number, endMin: number, e: LayoutChangeEvent) => {
    const {y, height} = e.nativeEvent.layout;
    segmentLayoutsRef.current[index] = {y, height, startMin, endMin};
  }, []);

  // ── Render helper: dot column ──

  const renderDotCol = (isFirst: boolean, isLast: boolean, dotColor: string, dotSize: number = 8) => (
    <View style={styles.flowDotCol}>
      {isFirst ? (
        <View style={{flex: 1}} />
      ) : (
        <View style={[styles.flowLineSegment, {backgroundColor: colors.border}]} />
      )}
      <View style={[
        dotSize === 8 ? styles.flowDot : styles.flowDotSmall,
        {backgroundColor: dotColor},
      ]} />
      {isLast ? (
        <View style={{flex: 1}} />
      ) : (
        <View style={[styles.flowLineSegment, {backgroundColor: colors.border}]} />
      )}
    </View>
  );

  // ── Render helper: inline time editor ──

  const renderTimeEditor = (type: 'wake' | 'sleep') => (
    <View style={[styles.inlineEditor, {backgroundColor: colors.surfaceSecondary}]}>
      <View style={styles.editorTabRow}>
        <TouchableOpacity
          style={[styles.editorTab, editingTab === 'weekday' && {backgroundColor: colors.primary}]}
          onPress={() => setEditingTab('weekday')}>
          <Text style={[styles.editorTabText, {color: editingTab === 'weekday' ? '#fff' : colors.textSecondary}]}>平日</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.editorTab, editingTab === 'weekend' && {backgroundColor: colors.primary}]}
          onPress={() => setEditingTab('weekend')}>
          <Text style={[styles.editorTabText, {color: editingTab === 'weekend' ? '#fff' : colors.textSecondary}]}>休日</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.editorTimeRow}>
        <TouchableOpacity style={[styles.editorTimeBtn, {backgroundColor: colors.today}]} onPress={() => handleTimeAdjust(type, 'hour', -1)}>
          <Text style={[styles.editorTimeBtnText, {color: colors.primary}]}>−</Text>
        </TouchableOpacity>
        <Text style={[styles.editorTimeDisplay, {color: colors.text}]}>
          {type === 'wake'
            ? formatTimeDisp(sleepSettings![editingTab].wakeUpHour, sleepSettings![editingTab].wakeUpMinute)
            : formatTimeDisp(sleepSettings![editingTab].sleepHour, sleepSettings![editingTab].sleepMinute)}
        </Text>
        <TouchableOpacity style={[styles.editorTimeBtn, {backgroundColor: colors.today}]} onPress={() => handleTimeAdjust(type, 'hour', 1)}>
          <Text style={[styles.editorTimeBtnText, {color: colors.primary}]}>+</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.editorMinuteRow}>
        <TouchableOpacity onPress={() => handleTimeAdjust(type, 'minute', -30)}>
          <Text style={[styles.editorMinuteText, {color: colors.primary}]}>-30分</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleTimeAdjust(type, 'minute', 30)}>
          <Text style={[styles.editorMinuteText, {color: colors.primary}]}>+30分</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Main render ──

  return (
    <View style={[styles.container, {backgroundColor: colors.background}]}>
      {/* ── ZONE A: Header ── */}
      <View style={[styles.headerZone, {backgroundColor: colors.surface}]}>
        {/* Row 1: Date + nav */}
        <View style={styles.headerRow1}>
          <View style={styles.headerDateBlock}>
            <Text style={[styles.headerDay, {color: colors.text}]}>{dayStart.getDate()}</Text>
            <View>
              <Text style={[styles.headerMonthYear, {color: colors.textSecondary}]}>
                {dayStart.getMonth() + 1}月 {dayStart.getFullYear()}
              </Text>
              <Text style={[styles.headerWeekday, {color: dayStart.getDay() === 0 ? colors.sunday : dayStart.getDay() === 6 ? colors.saturday : colors.textSecondary}]}>
                {WEEKDAYS_JA[dayStart.getDay()]}曜日
              </Text>
            </View>
          </View>
          <View style={styles.headerNav}>
            <TouchableOpacity onPress={goToPreviousDay} style={styles.navBtn}>
              <Text style={[styles.navBtnText, {color: colors.primary}]}>{'<'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goToToday} style={[styles.todayBtn, {backgroundColor: isTodayDate ? colors.primary : (isDark ? '#2c2c2e' : '#e8f4fd')}]}>
              <Text style={[styles.todayBtnText, {color: isTodayDate ? colors.onPrimary : colors.primary}]}>今日</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goToNextDay} style={styles.navBtn}>
              <Text style={[styles.navBtnText, {color: colors.primary}]}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Row 2: Week strip */}
        <ScrollView
          ref={stripScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={STRIP_DAY_WIDTH}
          decelerationRate="fast"
          contentOffset={{x: STRIP_INITIAL_OFFSET, y: 0}}
          onMomentumScrollEnd={handleStripScrollEnd}
          style={styles.weekStrip}>
          {bufferedStripDays.map((wd, i) => {
            const isSelected = wd.getDate() === dayStart.getDate() &&
              wd.getMonth() === dayStart.getMonth() &&
              wd.getFullYear() === dayStart.getFullYear();
            const isToday = (() => {
              const t = new Date();
              return wd.getDate() === t.getDate() && wd.getMonth() === t.getMonth() && wd.getFullYear() === t.getFullYear();
            })();
            const dow = wd.getDay();
            return (
              <TouchableOpacity
                key={i}
                style={styles.weekStripDay}
                onPress={() => onDayChange?.(wd)}>
                <Text style={[
                  styles.weekStripLabel,
                  {color: dow === 0 ? colors.sunday : dow === 6 ? colors.saturday : colors.textTertiary},
                ]}>
                  {WEEKDAYS_JA[dow]}
                </Text>
                <View style={{position: 'relative'}}>
                  <View style={[
                    styles.weekStripCircle,
                    isSelected && {backgroundColor: isDark ? '#ffffff' : '#000000'},
                    isToday && !isSelected && {backgroundColor: colors.primary},
                  ]}>
                    <Text style={[
                      styles.weekStripDate,
                      {color: colors.text},
                      isSelected && {color: isDark ? '#000000' : '#ffffff'},
                      isToday && !isSelected && {color: colors.onPrimary},
                      !isSelected && !isToday && dow === 0 && {color: colors.sunday},
                      !isSelected && !isToday && dow === 6 && {color: colors.saturday},
                    ]}>
                      {wd.getDate()}
                    </Text>
                  </View>
                  {(() => {
                    const key = `${wd.getFullYear()}-${wd.getMonth()}-${wd.getDate()}`;
                    const count = stripEventCounts[key];
                    if (!count) return null;
                    return (
                      <View style={styles.stripBadge}>
                        <Text style={styles.stripBadgeText}>{count}</Text>
                      </View>
                    );
                  })()}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Loading / error */}
      {isLoading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}
      {error && (
        <TouchableOpacity style={[styles.errorBar, {backgroundColor: colors.errorBackground}]} onPress={fetchEvents}>
          <Text style={[styles.errorText, {color: colors.error}]}>{error}</Text>
        </TouchableOpacity>
      )}

      {/* ── ZONE B: Flow Timeline ── */}
      <View
        ref={scrollViewWrapperRef}
        style={{flex: 1}}
        onLayout={() => {
          scrollViewWrapperRef.current?.measureInWindow((_x: number, y: number) => {
            scrollViewScreenYRef.current = y;
          });
        }}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.timelineScroll}
        contentContainerStyle={{paddingBottom: BOTTOM_SHEET_MIN + 200}}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        scrollEnabled={!draggingTask && !draggingEvent && !creatingEvent}
        onLayout={(e) => setTimelineHeight(e.nativeEvent.layout.height)}>

        {/* All-day events */}
        {events.filter(e => e.allDay).length > 0 && (
          <View style={[styles.allDaySection, {borderBottomColor: colors.borderLight}]}>
            {events.filter(e => e.allDay).map(event => {
              const evColor = (event.id && eventColors[event.id]) || event.calendar?.color || colors.primary;
              return (
                <TouchableOpacity
                  key={event.id}
                  style={[styles.allDayChip, {backgroundColor: evColor + '20', borderColor: evColor}]}
                  onPress={() => onEventPress?.(event)}
                  activeOpacity={0.7}>
                  <Text style={[styles.allDayChipText, {color: evColor}]} numberOfLines={1}>{event.title}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Wake time editor (shown above flow) */}
        {editingTime === 'wake' && sleepSettings && renderTimeEditor('wake')}

        {/* Flow Timeline */}
        <View
          ref={gridContainerRef}
          style={styles.flowTimeline}
          onLayout={(e) => { flowTimelineYRef.current = e.nativeEvent.layout.y; }}>

          {/* ── Wake pill ── */}
          {showWake && (
            <TouchableOpacity
              key="wake"
              activeOpacity={0.7}
              onPress={() => setEditingTime(editingTime === 'wake' ? null : 'wake')}
              style={{paddingHorizontal: 12, paddingVertical: 8}}>
              <View style={{flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.surfaceSecondary, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4}}>
                <Text style={{fontSize: 13}}>☀️</Text>
                <Text style={{fontSize: 13, color: colors.primary, fontWeight: '600', marginLeft: 4}}>起床 {formatMinutes(wakeMin)}</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* ── Hourly timeline bar ── */}
          <View
            ref={rightColumnRef}
            onTouchStart={handleCreationTouchStart}
            onTouchMove={handleCreationTouchMove}
            onTouchEnd={handleCreationTouchEnd}
            onLayout={() => {
              if (rightColumnRef.current && gridContainerRef.current) {
                rightColumnRef.current.measureLayout(
                  gridContainerRef.current as any,
                  (_x: number, y: number) => { rightColumnScrollYRef.current = flowTimelineYRef.current + y; rightColumnOffsetYRef.current = y; },
                  () => {},
                );
              }
            }}>
              {/* Legend */}
              <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6, gap: 10}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
                  <View style={{width: 10, height: 10, borderRadius: 2, backgroundColor: isDark ? colors.surfaceSecondary : '#e8e9ec'}} />
                  <Text style={{fontSize: 11, color: colors.textTertiary}}>空き</Text>
                </View>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
                  <View style={{width: 10, height: 10, borderRadius: 2, backgroundColor: colors.primary}} />
                  <Text style={{fontSize: 11, color: colors.textTertiary}}>確定</Text>
                </View>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
                  <View style={{width: 10, height: 10, borderRadius: 2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: `${colors.primary}15`}} />
                  <Text style={{fontSize: 11, color: colors.textTertiary}}>提案</Text>
                </View>
              </View>

              <View ref={hourlyGridRef} onLayout={(e) => { hourlyGridOffsetRef.current = e.nativeEvent.layout.y; }}>
              {hourlySlots.map((slot, slotIndex) => {
                const hourMin = slot.hour * 60;
                const hourEnd = hourMin + 60;
                const hasItems = slot.items.length > 0;
                const firstItem = hasItems ? slot.items[0] : null;
                const item = firstItem?.item;
                const isFirstHour = firstItem?.isFirst;

                // Event bar width: proportional to duration (1h = ~40%, 2h+ = full width)
                const barWidthRatio = item ? Math.min(1, (item.endMinutes - item.startMinutes) / 120) : 1;
                const barWidthPercent = `${Math.max(30, barWidthRatio * 100)}%` as any;

                return (
                  <View
                    key={`hour-${slot.hour}`}
                    style={{flexDirection: 'row', height: HOURLY_ROW_HEIGHT, alignItems: 'center', paddingVertical: 2}}
                    onLayout={(e) => {
                      const {y, height} = e.nativeEvent.layout;
                      segmentLayoutsRef.current[slotIndex] = {y, height, startMin: hourMin, endMin: hourEnd};
                    }}>
                    <Text style={{width: 36, fontSize: 11, color: colors.textTertiary, fontVariant: ['tabular-nums'], fontWeight: '500', textAlign: 'right', marginRight: 6}} numberOfLines={1}>
                      {`${slot.hour}:00`}
                    </Text>
                    <View style={{flex: 1, height: HOURLY_ROW_HEIGHT - 6, marginRight: 6}}>
                      {!hasItems ? (
                        /* Empty hour - light gray bar */
                        <View style={{flex: 1, backgroundColor: isDark ? colors.surfaceSecondary : '#ecedf0', borderRadius: 8}} />
                      ) : item?.type === 'event' ? (
                        /* Event - solid colored bar, width based on duration */
                        <View
                          {...getEventPanResponder(item).panHandlers}
                          style={{height: '100%', width: barWidthPercent, backgroundColor: item.color || colors.primary, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12}}>
                          {isFirstHour && (
                            <Text style={{color: colors.onEvent, fontSize: 13, fontWeight: '600'}} numberOfLines={1}>
                              {item.title}
                            </Text>
                          )}
                        </View>
                      ) : item?.type === 'task' ? (
                        /* Task - dashed border, light tinted background */
                        <TouchableOpacity
                          activeOpacity={0.6}
                          onPress={() => handleEditTimelineTask(item.original as Task)}
                          style={{flex: 1, height: '100%', backgroundColor: isDark ? `${colors.primary}15` : '#e8edf5', borderWidth: 1.5, borderStyle: 'dashed', borderColor: isDark ? colors.primary : '#9bb0d4', borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12}}>
                          {isFirstHour && (
                            <Text style={{color: isDark ? colors.primary : '#4a6fa5', fontSize: 13, fontWeight: '600'}} numberOfLines={1}>
                              {item.title}
                            </Text>
                          )}
                        </TouchableOpacity>
                      ) : (
                        <View style={{flex: 1, backgroundColor: isDark ? colors.surfaceSecondary : '#ecedf0', borderRadius: 8}} />
                      )}
                    </View>
                  </View>
                );
              })}
              </View>

              {/* Remaining free time summary */}
              {(() => {
                const lastEventEnd = timelineItems.length > 0
                  ? Math.max(...timelineItems.map(i => i.endMinutes))
                  : displayStartHour * 60;
                const sleepM = displayEndHour * 60;
                const remainingHours = Math.floor((sleepM - lastEventEnd) / 60);
                if (remainingHours >= 2 && lastEventEnd < sleepM) {
                  return (
                    <View style={{paddingVertical: 10, paddingLeft: FLOW_LEFT_WIDTH + 4}}>
                      <Text style={{fontSize: 13, color: colors.textTertiary}}>
                        〜 {formatMinutes(sleepM)} まで空き
                      </Text>
                    </View>
                  );
                }
                return null;
              })()}

              {/* Legacy segment rendering (disabled) */}
              {false && segments.map((segment, segIndex) => {
                  if (segment.type === 'wake' || segment.type === 'sleep') return null;

                  if (segment.type === 'gap') {
                    const showCard = segIndex === largestGapIndex && incompleteTodos.length > 0;
                    const cardInsertAfterMarker = showCard ? Math.min(1, segment.markers.length - 1) : -1;
                    return (
                      <React.Fragment key={`gap-${segIndex}`}>
                        <View
                          style={{paddingVertical: FLOW_GAP_PADDING / 2}}
                          onLayout={(e) => {
                            const {y, height} = e.nativeEvent.layout;
                            if (cardInsertAfterMarker >= 0) {
                              const markersBefore = cardInsertAfterMarker + 1;
                              const totalMarkers = segment.markers.length;
                              const fullDur = segment.endMin - segment.startMin;
                              const splitMin = segment.startMin + Math.round(fullDur * markersBefore / totalMarkers);
                              segmentLayoutsRef.current[segIndex] = {y, height, startMin: segment.startMin, endMin: splitMin};
                            } else {
                              segmentLayoutsRef.current[segIndex] = {y, height, startMin: segment.startMin, endMin: segment.endMin};
                            }
                          }}>
                          {segment.markers.slice(0, cardInsertAfterMarker >= 0 ? cardInsertAfterMarker + 1 : undefined).map((marker, mi) => (
                            <View key={mi} style={[styles.flowRow, {height: FLOW_GAP_MARKER_HEIGHT}]}>
                              <View style={styles.flowTimeCol}>
                                <Text style={[styles.flowTimeTextSmall, {color: colors.textTertiary}]}>
                                  {marker.label}
                                </Text>
                              </View>
                              <View style={styles.flowDotCol}>
                                <View style={[styles.flowLineSegment, {backgroundColor: colors.border}]} />
                                <View style={[styles.flowDotSmall, {backgroundColor: colors.textTertiary, opacity: 0.4}]} />
                                <View style={[styles.flowLineSegment, {backgroundColor: colors.border}]} />
                              </View>
                              <View style={{flex: 1}} />
                            </View>
                          ))}
                        </View>
                        {showCard && (() => {
                          const gapH = Math.floor(totalFreeMinutes / 60);
                          const gapM = totalFreeMinutes % 60;
                          return (
                            <View style={{marginLeft: FLOW_LEFT_WIDTH + FLOW_DOT_COL_WIDTH, marginRight: 4, marginVertical: 12}}>
                              <View style={{backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 16}}>
                                <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                                  <Text style={{fontSize: 14, color: colors.textSecondary}}>🕐 空き時間</Text>
                                </View>
                                <View style={{flexDirection: 'row', alignItems: 'baseline', marginBottom: 12}}>
                                  {gapH > 0 && (
                                    <>
                                      <Text style={{fontSize: 24, fontWeight: 'bold', color: colors.text}}>{gapH}</Text>
                                      <Text style={{fontSize: 14, color: colors.textSecondary, marginRight: 4}}>時間</Text>
                                    </>
                                  )}
                                  {gapM > 0 && (
                                    <>
                                      <Text style={{fontSize: 24, fontWeight: 'bold', color: colors.text}}>{gapM}</Text>
                                      <Text style={{fontSize: 14, color: colors.textSecondary}}>分</Text>
                                    </>
                                  )}
                                </View>
                                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                                  {incompleteTodos.map(task => (
                                    <View key={task.id} style={{backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6}}>
                                      <Text style={{fontSize: 13, color: colors.text}} numberOfLines={1}>{task.title}</Text>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            </View>
                          );
                        })()}
                        {cardInsertAfterMarker >= 0 && segment.markers.length > cardInsertAfterMarker + 1 && (
                          <View
                            style={{paddingVertical: FLOW_GAP_PADDING / 2}}
                            onLayout={(e) => {
                              const {y, height} = e.nativeEvent.layout;
                              // Store in extra slot at end for long-press detection
                              const markersBefore = cardInsertAfterMarker + 1;
                              const totalMarkers = segment.markers.length;
                              const fullDur = segment.endMin - segment.startMin;
                              const splitMin = segment.startMin + Math.round(fullDur * markersBefore / totalMarkers);
                              segmentLayoutsRef.current[segments.length] = {y, height, startMin: splitMin, endMin: segment.endMin};
                            }}>
                            {segment.markers.slice(cardInsertAfterMarker + 1).map((marker, mi) => (
                              <View key={mi} style={[styles.flowRow, {height: FLOW_GAP_MARKER_HEIGHT}]}>
                                <View style={styles.flowTimeCol}>
                                  <Text style={[styles.flowTimeTextSmall, {color: colors.textTertiary}]}>
                                    {marker.label}
                                  </Text>
                                </View>
                                <View style={styles.flowDotCol}>
                                  <View style={[styles.flowLineSegment, {backgroundColor: colors.border}]} />
                                  <View style={[styles.flowDotSmall, {backgroundColor: colors.textTertiary, opacity: 0.4}]} />
                                  <View style={[styles.flowLineSegment, {backgroundColor: colors.border}]} />
                                </View>
                                <View style={{flex: 1}} />
                              </View>
                            ))}
                          </View>
                        )}
                      </React.Fragment>
                    );
                  }

                  if (segment.type === 'item') {
                    const height = segmentHeights[segIndex];
                    const items = segment.items;
                    const isMulti = items.length > 1;

                    // Helper to render a single item card
                    const renderItemCard = (item: TimelineItem, cardHeight: number, centerVertical?: boolean) => {
                      if (item.type === 'event') {
                        const evColor = item.color || colors.primary;
                        const panHandlers = getEventPanResponder(item).panHandlers;
                        return (
                          <View
                            key={item.id}
                            style={{flex: 1}}
                            {...panHandlers}>
                            <View style={[styles.flowEventCard, {backgroundColor: evColor, minHeight: cardHeight - 8}, centerVertical && {justifyContent: 'center'}]}>
                              <Text style={[styles.flowEventTitle, {color: colors.onEvent}]} numberOfLines={2}>
                                {item.title}
                              </Text>
                              <Text style={[styles.flowEventTime, {color: colors.onEvent}]}>
                                {formatMinutes(item.startMinutes)}〜{formatMinutes(item.endMinutes)}  {(() => {
                                  const dur = item.endMinutes - item.startMinutes;
                                  const h = Math.floor(dur / 60);
                                  const m = dur % 60;
                                  return h > 0 && m > 0 ? `${h}時間${m}分` : h > 0 ? `${h}時間` : `${m}分`;
                                })()}
                              </Text>
                              {item.location ? (
                                <Text style={[styles.flowEventLocation, {color: colors.onEvent}]} numberOfLines={1}>
                                  {item.location}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      }
                      if (item.type === 'task') {
                        const task = item.original as Task;
                        return (
                          <TouchableOpacity
                            key={item.id}
                            activeOpacity={0.6}
                            onPress={() => handleEditTimelineTask(task)}
                            style={{flex: 1}}>
                            <View style={[styles.flowTaskCard, {
                              borderColor: item.isTodo ? colors.textTertiary : colors.primary,
                              backgroundColor: item.isTodo
                                ? (item.completed ? `${colors.textTertiary}20` : `${colors.textTertiary}08`)
                                : (item.completed ? `${colors.primary}20` : `${colors.primary}10`),
                              borderStyle: 'dashed',
                              minHeight: cardHeight - 8,
                            }]}>
                              {item.isTodo && (
                                <Text style={{fontSize: 9, color: colors.textTertiary, marginBottom: 2}}>あとでやる</Text>
                              )}
                              <View style={styles.flowTaskRow}>
                                <TouchableOpacity onPress={() => handleToggleTask(task.id)} hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                                  <View style={[styles.checkbox, {borderColor: item.isTodo ? colors.textTertiary : colors.primary}, item.completed && {backgroundColor: colors.primary, borderColor: colors.primary}]}>
                                    {item.completed && <Text style={styles.checkmark}>✓</Text>}
                                  </View>
                                </TouchableOpacity>
                                <View style={{flex: 1}}>
                                  <Text style={[styles.flowTaskTitle, {color: colors.text}, item.completed && {textDecorationLine: 'line-through', color: colors.textTertiary}]} numberOfLines={2}>
                                    {item.title}
                                  </Text>
                                  <Text style={[styles.flowTaskTime, {color: colors.textSecondary}]}>
                                    {formatMinutes(item.startMinutes)}〜{formatMinutes(item.endMinutes)}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      }
                      return null;
                    };

                    // Find if any task in this segment is being edited
                    const editingTask = items.find(i => i.type === 'task' && editingTimelineTaskId === (i.original as Task).id);

                    return (
                      <View key={`seg-${segIndex}`}
                        onLayout={(e) => {
                          const {y, height: h} = e.nativeEvent.layout;
                          segmentLayoutsRef.current[segIndex] = {y, height: h, startMin: segment.startMin, endMin: segment.endMin};
                        }}>
                        <View
                          style={[styles.flowRow, {height: height, maxHeight: height, overflow: 'hidden'}]}>
                          <View style={[styles.flowTimeCol, {justifyContent: 'flex-start'}]}>
                            <Text style={[styles.flowTimeText, {color: colors.textTertiary}]}>
                              {formatMinutes(segment.startMin)}
                            </Text>
                            {/* 各アイテムの終了時刻を正しいY位置に表示 */}
                            {(() => {
                              const endTimes = items
                                .map(it => it.endMinutes)
                                .filter((v, i, a) => a.indexOf(v) === i && v !== segment.startMin)
                                .sort((a, b) => a - b);
                              return endTimes.map(endMin => {
                                const topOff = ((endMin - segment.startMin) / segment.durationMin) * height - 14;
                                return (
                                  <Text key={`end-${endMin}`}
                                    style={[styles.flowTimeTextSmall, {
                                      color: colors.textTertiary,
                                      position: 'absolute',
                                      top: Math.max(18, topOff),
                                    }]}>
                                    {formatMinutes(endMin)}
                                  </Text>
                                );
                              });
                            })()}
                          </View>
                          {renderDotCol(false, false, items[0].color || colors.primary)}
                          {isMulti ? (
                            <View style={[styles.flowContent, {flexDirection: 'row', gap: 4, alignItems: 'flex-start'}]}>
                              {items.map(item => {
                                const itemDur = item.endMinutes - item.startMinutes;
                                const cardH = Math.max(20, (itemDur / segment.durationMin) * height);
                                const topOff = ((Math.max(item.startMinutes, segment.startMin) - segment.startMin) / segment.durationMin) * height;
                                return (
                                  <View key={`wrap-${item.id}`} style={{flex: 1, marginTop: topOff, height: cardH}}>
                                    {renderItemCard(item, cardH)}
                                  </View>
                                );
                              })}
                            </View>
                          ) : (
                            <View style={styles.flowContent}>
                              {items.map(item => renderItemCard(item, height, true))}
                            </View>
                          )}
                          <View style={{width: 8}} />
                        </View>
                        {editingTask && (() => {
                          const task = editingTask.original as Task;
                          return (
                            <View style={[styles.flowEditPanel, {backgroundColor: colors.surface, borderColor: colors.border, marginLeft: 0}]}>
                              <Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>所要時間</Text>
                              <View style={styles.durationOptions}>
                                {DURATION_OPTIONS.map(opt => (
                                  <TouchableOpacity key={opt.value} style={[styles.durationChip, {borderColor: colors.border}, editTaskDuration === opt.value && !editDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary}]}
                                    onPress={() => { setEditDurationCustom(false); setEditTaskDuration(editTaskDuration === opt.value ? null : opt.value); }}>
                                    <Text style={[styles.durationChipText, {color: colors.textSecondary}, editTaskDuration === opt.value && !editDurationCustom && {color: colors.onPrimary}]}>{opt.label}</Text>
                                  </TouchableOpacity>
                                ))}
                                <TouchableOpacity style={[styles.durationChip, {borderColor: colors.border}, editDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary}]}
                                  onPress={() => { if (editDurationCustom) { setEditDurationCustom(false); setEditTaskDuration(null); } else { setEditDurationCustom(true); setEditTaskDuration(null); setEditCustomMinutes(''); } }}>
                                  <Text style={[styles.durationChipText, {color: colors.textSecondary}, editDurationCustom && {color: colors.onPrimary}]}>カスタム</Text>
                                </TouchableOpacity>
                              </View>
                              {editDurationCustom && (
                                <View style={styles.customDurationRow}>
                                  <TextInput style={[styles.customDurationInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                                    value={editCustomMinutes} onChangeText={t => { const cleaned = t.replace(/[^0-9]/g, ''); setEditCustomMinutes(cleaned); const num = parseInt(cleaned, 10); setEditTaskDuration(num > 0 ? num : null); }}
                                    keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textTertiary} />
                                  <Text style={[styles.customDurationUnit, {color: colors.textSecondary}]}>分</Text>
                                </View>
                              )}
                              <Text style={[styles.taskEditLabel, {color: colors.textSecondary, marginTop: 8}]}>時間</Text>
                              <View style={styles.taskEditTimeRow}>
                                <View style={styles.addTimeInputs}>
                                  <TextInput style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                                    value={editTaskTimeHour} onChangeText={t => setEditTaskTimeHour(t.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} />
                                  <Text style={{color: colors.text, fontWeight: '600', marginHorizontal: 2}}>:</Text>
                                  <TextInput style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                                    value={editTaskTimeMinute} onChangeText={t => setEditTaskTimeMinute(t.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} />
                                </View>
                                <TouchableOpacity style={[styles.placeBtn, {backgroundColor: colors.primary}]} onPress={() => handleSaveTimelineTask(task.id)}>
                                  <Text style={[styles.placeBtnText, {color: colors.onPrimary}]}>保存</Text>
                                </TouchableOpacity>
                              </View>
                              <TouchableOpacity style={[styles.removeTimeBtn, {borderColor: colors.error}]} onPress={() => handleRemoveFromTimeline(task.id)}>
                                <Text style={[styles.removeTimeBtnText, {color: colors.error}]}>時間を外す</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })()}
                      </View>
                    );
                  }
                  return null;
                })}


              {/* Current time indicator */}
              {isTodayDate && currentTimeYPosition != null && (
                <View style={[styles.flowCurrentTime, {top: currentTimeYPosition}]} pointerEvents="none">
                  <View style={[styles.currentTimeBadge, {backgroundColor: colors.currentTimeIndicator}]}>
                    <Text style={[styles.currentTimeBadgeText, {color: colors.onPrimary}]}>
                      {currentTime.getHours().toString().padStart(2, '0')}:{currentTime.getMinutes().toString().padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={[styles.currentTimeLine, {backgroundColor: colors.currentTimeIndicator}]} />
                </View>
              )}

              {/* Drop indicator */}
              {(draggingTask || draggingEvent) && dropTimePreview && dropIndicatorY != null && (() => {
                const dur = draggingTask ? (draggingTask.duration || 60) : (draggingEvent ? draggingEvent.endMinutes - draggingEvent.startMinutes : 60);
                const [dh, dm] = dropTimePreview.split(':').map(Number);
                const dropMin = dh * 60 + dm;
                const dropHeight = Math.max(HOURLY_ROW_HEIGHT, (dur / 60) * HOURLY_ROW_HEIGHT);
                return (
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <View style={[styles.flowDropLine, {top: dropIndicatorY, backgroundColor: colors.primary}]} />
                    <View style={[styles.flowDropPreview, {top: dropIndicatorY, height: dropHeight, backgroundColor: `${colors.primary}15`, borderColor: colors.primary}]}>
                      <Text style={[styles.flowDropPreviewText, {color: colors.primary}]}>{dropTimePreview} - {formatMinutes(dropMin + dur)}</Text>
                    </View>
                  </View>
                );
              })()}
          </View>

          {/* ── Sleep pill ── */}
          {showSleep && (
            <TouchableOpacity
              key="sleep"
              activeOpacity={0.7}
              onPress={() => setEditingTime(editingTime === 'sleep' ? null : 'sleep')}
              style={{paddingHorizontal: 12, paddingVertical: 8}}>
              <View style={{flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.surfaceSecondary, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4}}>
                <Text style={{fontSize: 13}}>🌙</Text>
                <Text style={{fontSize: 13, color: colors.primary, fontWeight: '600', marginLeft: 4}}>就寝 {formatMinutes(sleepMinVal)}</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Hint text */}
          <View style={{alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 12, color: colors.textTertiary}}>タスクを長押しでドラッグ移動</Text>
          </View>

          {/* Creation preview (long-press drag) */}
          {creatingEvent && (() => {
            const startMin = creatingEvent.startMin;
            const endMin = creatingEvent.endMin;
            const dur = endMin - startMin;
            const barWidth = SCREEN_WIDTH - 42 - 6;

            // 開始行と終了行
            const startHour = Math.floor(startMin / 60);
            const endHour = Math.floor(endMin / 60);
            const startFrac = (startMin % 60) / 60; // 開始行内の開始位置（0=左端、0.5=半分）
            const endFrac = endMin % 60 === 0 ? 1 : (endMin % 60) / 60; // 終了行内の終了位置
            const startSlotIdx = startHour - displayStartHour;

            // topY = gridContainerRef基準: rightColumnOffset + hourlyGridOffset + slot位置
            const topY = rightColumnOffsetYRef.current + hourlyGridOffsetRef.current + startSlotIdx * HOURLY_ROW_HEIGHT;

            const durH = Math.floor(dur / 60);
            const durM = dur % 60;
            const durText = durH > 0 && durM > 0 ? `${durH}時間${durM}分` : durH > 0 ? `${durH}時間` : `${durM}分`;

            // 行数を計算
            const totalSlots = (endMin % 60 === 0 ? endHour : endHour + 1) - startHour;

            return (
              <View pointerEvents="none" style={{
                position: 'absolute', top: topY, left: 42, zIndex: 70,
                width: barWidth,
              }}>
                {Array.from({length: totalSlots}, (_, i) => {
                  const isFirst = i === 0;
                  const isLast = i === totalSlots - 1;
                  // 各行のバー開始・終了位置
                  const rowLeft = isFirst ? startFrac : 0;
                  const rowRight = isLast ? (endMin % 60 === 0 && !isFirst ? 1 : endFrac) : 1;
                  if (isLast && endMin % 60 === 0 && totalSlots > 1) return null; // ちょうど正時で終わる場合、最後の空行は不要

                  const leftPx = rowLeft * barWidth;
                  const widthPx = Math.max(40, (rowRight - rowLeft) * barWidth);

                  return (
                    <View key={i} style={{height: HOURLY_ROW_HEIGHT - (isLast && totalSlots === 1 ? 4 : 2), flexDirection: 'row'}}>
                      <View style={{
                        marginLeft: leftPx,
                        width: widthPx,
                        height: '100%',
                        backgroundColor: isDark ? 'rgba(100,149,237,0.3)' : `${colors.primary}20`,
                        borderColor: colors.primary,
                        borderWidth: 2,
                        borderStyle: 'dashed',
                        borderTopLeftRadius: isFirst ? 8 : 0,
                        borderBottomLeftRadius: isLast ? 8 : 0,
                        borderTopRightRadius: isFirst && rowRight < 1 ? 8 : (isFirst ? 0 : 0),
                        borderBottomRightRadius: isLast ? 8 : 0,
                        borderRadius: totalSlots === 1 ? 8 : undefined,
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                      }}>
                        {isFirst && (
                          <>
                            <Text style={{color: colors.primary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums']}} numberOfLines={1}>
                              {formatMinutes(startMin)} − {formatMinutes(endMin)}
                            </Text>
                            {dur >= 15 && (
                              <Text style={{color: colors.primary, fontSize: 11}}>{durText}</Text>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </View>

        {/* Sleep time editor (shown below flow) */}
        {editingTime === 'sleep' && sleepSettings && renderTimeEditor('sleep')}
      </ScrollView>
      </View>

      {/* ── ZONE C: Bottom Sheet ── */}
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
              <Text style={[styles.sheetTitle, {color: colors.text}]}>あとでやる</Text>
              {todoTasks.length > 0 && (
                <View style={[styles.sheetBadge, {backgroundColor: colors.primary}]}>
                  <Text style={[styles.sheetBadgeText, {color: colors.onPrimary}]}>{todoTasks.length}</Text>
                </View>
              )}
            </View>
            <View style={{width: 1, backgroundColor: colors.textTertiary, height: '100%', opacity: 0.3}} />
            <View style={styles.sheetHeaderCol}>
              <Text style={[styles.sheetTitle, {color: colors.text}]}>予定</Text>
              {sheetScheduleItems.length > 0 && (
                <View style={[styles.sheetBadge, {backgroundColor: colors.primary}]}>
                  <Text style={[styles.sheetBadgeText, {color: colors.onPrimary}]}>{sheetScheduleItems.length}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={styles.sheetColumnsContainer}>
          <ScrollView style={styles.sheetColumnLeft} showsVerticalScrollIndicator={false} scrollEnabled={!draggingTask && !draggingEvent}>
            {todoTasks.length === 0 ? (
              <Text style={[styles.sheetEmpty, {color: colors.textTertiary}]}>タスクなし</Text>
            ) : (
              todoTasks.map(task => (
                <View key={task.id} style={styles.swipeRow}>
                  <TouchableOpacity
                    style={styles.swipeDeleteBtn}
                    onPress={() => { resetSwipe(task.id); handleDeleteTask(task.id); }}>
                    <Text style={styles.swipeDeleteText}>削除</Text>
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
                    <View style={styles.sheetEventInfo}>
                      <Text
                        style={[
                          styles.sheetEventTitle,
                          {color: colors.text},
                          task.completed && {textDecorationLine: 'line-through', color: colors.textTertiary},
                        ]}
                        numberOfLines={1}>{task.title}</Text>
                      <View style={{flexDirection: 'row', gap: 6, flexWrap: 'wrap'}}>
                        {task.duration ? (
                          <Text style={[styles.sheetEventTime, {color: colors.textSecondary}]}>
                            {formatDuration(task.duration)}
                          </Text>
                        ) : null}
                        {task.deadline ? (
                          <Text style={[styles.sheetEventTime, {color: colors.textSecondary}]}>
                            {task.deadline}まで
                          </Text>
                        ) : null}
                      </View>
                      {task.memo ? (
                        <Text style={{fontSize: 11, color: colors.textTertiary, marginTop: 1}} numberOfLines={1}>
                          {task.memo}
                        </Text>
                      ) : null}
                    </View>
                  </Animated.View>
                </View>
              ))
            )}
          {expandedTaskId && (() => {
            const task = todoTasks.find(t => t.id === expandedTaskId);
            if (!task) return null;
            return (
              <View style={[styles.bookmarkEditPanel, {backgroundColor: colors.surfaceSecondary, borderTopColor: colors.borderLight}]}>
                <View style={styles.bookmarkEditHeader}>
                  <TouchableOpacity
                    onPress={() => handleToggleTask(task.id)}
                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                    style={styles.bookmarkEditCheck}>
                    <View style={[
                      styles.checkbox,
                      {borderColor: colors.textTertiary},
                      task.completed && {backgroundColor: colors.primary, borderColor: colors.primary},
                    ]}>
                      {task.completed && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                  <Text style={[styles.bookmarkEditTitle, {color: colors.text}]} numberOfLines={1}>{task.title}</Text>
                  <TouchableOpacity
                    onPress={() => handleDeleteTask(task.id)}
                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                    <Text style={[styles.deleteBtn, {color: colors.error}]}>削除</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.taskEditLabel, {color: colors.textSecondary}]}>所要時間</Text>
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
                      ]}>{opt.label}</Text>
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
                    ]}>カスタム</Text>
                  </TouchableOpacity>
                </View>
                {editDurationCustom && (
                  <View style={styles.customDurationRow}>
                    <TextInput
                      style={[styles.customDurationInput, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                      value={editCustomMinutes}
                      onChangeText={t => {
                        const cleaned = t.replace(/[^0-9]/g, '');
                        setEditCustomMinutes(cleaned);
                        const num = parseInt(cleaned, 10);
                        setEditTaskDuration(num > 0 ? num : null);
                      }}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                    />
                    <Text style={[styles.customDurationUnit, {color: colors.textSecondary}]}>分</Text>
                  </View>
                )}
                <Text style={[styles.taskEditLabel, {color: colors.textSecondary, marginTop: 10}]}>時間帯</Text>
                <View style={styles.taskEditTimeRow}>
                  <View style={styles.addTimeInputs}>
                    <TextInput
                      style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                      value={editTaskTimeHour}
                      onChangeText={t => setEditTaskTimeHour(t.replace(/[^0-9]/g, '').slice(0, 2))}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="HH"
                      placeholderTextColor={colors.textTertiary}
                    />
                    <Text style={{color: colors.text, fontWeight: '600', marginHorizontal: 2}}>:</Text>
                    <TextInput
                      style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                      value={editTaskTimeMinute}
                      onChangeText={t => setEditTaskTimeMinute(t.replace(/[^0-9]/g, '').slice(0, 2))}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="MM"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.placeBtn, {backgroundColor: colors.primary}]}
                    onPress={() => handlePlaceTask(task.id)}>
                    <Text style={[styles.placeBtnText, {color: colors.onPrimary}]}>配置</Text>
                  </TouchableOpacity>
                </View>
                {editTaskDuration !== task.duration && (
                  <TouchableOpacity
                    style={[styles.saveDurationBtn, {borderColor: colors.primary}]}
                    onPress={() => handleSaveDurationOnly(task.id)}>
                    <Text style={[styles.saveDurationBtnText, {color: colors.primary}]}>所要時間だけ保存</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
          </ScrollView>
          <View style={[styles.sheetColumnDivider, {backgroundColor: colors.textTertiary, opacity: 0.3}]} />
          <ScrollView style={styles.sheetColumnRight} showsVerticalScrollIndicator={false}>
            {sheetScheduleItems.length === 0 ? (
              <Text style={[styles.sheetEmpty, {color: colors.textTertiary}]}>予定なし</Text>
            ) : (
              sheetScheduleItems.map(item => (
                <View key={item.id} style={styles.swipeRow}>
                  <TouchableOpacity
                    style={styles.swipeDeleteBtn}
                    onPress={() => { resetSwipe(item.id); handleDeleteScheduleItem(item); }}>
                    <Text style={styles.swipeDeleteText}>削除</Text>
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
                        } else if (item.task) {
                          handleEditTimelineTask(item.task);
                        }
                      }}>
                      <View style={[styles.sheetEventDot, {backgroundColor: item.color}]} />
                      <View style={styles.sheetEventInfo}>
                        <Text
                          style={[
                            styles.sheetEventTitle,
                            {color: colors.text},
                            item.completed && {textDecorationLine: 'line-through', color: colors.textTertiary},
                          ]}
                          numberOfLines={1}>{item.title}</Text>
                        <Text style={[styles.sheetEventTime, {color: colors.textSecondary}]}>
                          {item.timeLabel}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Animated.View>

      {/* ── FAB ── */}
      <TouchableOpacity
        style={[styles.fab, {backgroundColor: isDark ? '#ffffff' : '#000000'}]}
        onPress={() => {
          const now = new Date(dayStart);
          const cur = new Date();
          now.setHours(cur.getHours(), Math.round(cur.getMinutes() / 15) * 15, 0, 0);
          const end = new Date(now);
          end.setHours(end.getHours() + 1);
          setPendingTimeRange({start: now, end});
          setShowAddTypeSelect(true);
        }}
        activeOpacity={0.8}>
        <Text style={[styles.fabText, {color: isDark ? '#000000' : '#ffffff'}]}>+</Text>
      </TouchableOpacity>

      {/* ── Floating drag element ── */}
      {draggingTask && (
        <Animated.View
          style={[
            styles.floatingBookmark,
            {
              transform: [{translateX: dragAnimX}, {translateY: dragAnimY}],
              backgroundColor: isDark ? colors.surfaceSecondary : '#f5f7ff',
              borderColor: colors.primary,
            },
          ]}
          pointerEvents="none">
          <View style={[styles.floatingBookmarkAccent, {backgroundColor: colors.primary}]} />
          <Text style={[styles.floatingBookmarkTitle, {color: colors.text}]} numberOfLines={2}>
            {draggingTask.title}
          </Text>
          {dropTimePreview ? (
            <Text style={[styles.floatingBookmarkTime, {color: colors.primary}]}>
              {dropTimePreview}
            </Text>
          ) : draggingTask.duration ? (
            <Text style={[styles.floatingBookmarkDuration, {color: colors.textTertiary}]}>
              {formatDuration(draggingTask.duration)}
            </Text>
          ) : null}
        </Animated.View>
      )}

      {/* ── Floating drag element for events ── */}
      {draggingEvent && (
        <Animated.View
          style={[
            styles.floatingBookmark,
            {
              transform: [{translateX: dragAnimX}, {translateY: dragAnimY}],
              backgroundColor: draggingEvent.color || colors.primary,
              borderColor: draggingEvent.color || colors.primary,
            },
          ]}
          pointerEvents="none">
          <Text style={[styles.floatingBookmarkTitle, {color: colors.onEvent}]} numberOfLines={2}>
            {draggingEvent.title}
          </Text>
          {dropTimePreview ? (
            <Text style={[styles.floatingBookmarkTime, {color: colors.onEvent, opacity: 0.8}]}>
              {dropTimePreview}
            </Text>
          ) : (
            <Text style={[styles.floatingBookmarkDuration, {color: colors.onEvent, opacity: 0.8}]}>
              {formatDuration(draggingEvent.endMinutes - draggingEvent.startMinutes)}
            </Text>
          )}
        </Animated.View>
      )}

      {/* ── Add Type Selection Overlay ── */}
      {showAddTypeSelect && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => { setShowAddTypeSelect(false); setPendingTimeRange(null); }}
          style={[styles.addOverlay, {backgroundColor: colors.overlay}]}>
          <TouchableOpacity activeOpacity={1} style={[styles.addCard, {backgroundColor: colors.surface, paddingVertical: 28}]}>
            <Text style={[styles.addCardTitle, {color: colors.text}]}>予定を追加</Text>
            {pendingTimeRange && (
              <View style={{marginTop: 8, marginBottom: 4, backgroundColor: colors.inputBackground, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14}}>
                <Text style={{fontSize: 14, color: colors.textSecondary, textAlign: 'center'}}>
                  {`${pendingTimeRange.start.getMonth() + 1}月${pendingTimeRange.start.getDate()}日（${WEEKDAYS_JA[pendingTimeRange.start.getDay()]}）`}
                </Text>
                <Text style={{fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: 2}}>
                  {`${pendingTimeRange.start.getHours().toString().padStart(2, '0')}:${pendingTimeRange.start.getMinutes().toString().padStart(2, '0')} 〜 ${pendingTimeRange.end.getHours().toString().padStart(2, '0')}:${pendingTimeRange.end.getMinutes().toString().padStart(2, '0')}`}
                </Text>
              </View>
            )}
            <View style={{flexDirection: 'row', gap: 12, marginTop: 8}}>
              <TouchableOpacity
                onPress={() => {
                  setShowAddTypeSelect(false);
                  setPendingTimeRange(null);
                  setAddingTask(true);
                }}
                style={{flex: 1, paddingVertical: 16, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center'}}>
                <Text style={{color: colors.onPrimary, fontSize: 15, fontWeight: '700'}}>あとでやる</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setShowAddTypeSelect(false);
                  if (onTimeRangeSelect && pendingTimeRange) {
                    onTimeRangeSelect(pendingTimeRange.start, pendingTimeRange.end);
                  }
                  setPendingTimeRange(null);
                }}
                style={{flex: 1, paddingVertical: 16, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center'}}>
                <Text style={{color: colors.onPrimary, fontSize: 15, fontWeight: '700'}}>予定</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* ── Add Task Overlay ── */}
      {addingTask && (
        <View style={[styles.addOverlay, {backgroundColor: colors.overlay}]}>
          <View style={[styles.addCard, {backgroundColor: colors.surface}]}>
            <Text style={[styles.addCardTitle, {color: colors.text}]}>タスクを追加</Text>
            <TextInput
              style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text}, taskInputError && {borderColor: colors.error, borderWidth: 1}]}
              placeholder="タスクを入力..."
              placeholderTextColor={taskInputError ? colors.error : colors.textTertiary}
              value={taskInputText}
              onChangeText={(t) => { setTaskInputText(t); setTaskInputError(false); }}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddTask}
            />
            <View style={styles.durationRow}>
              <Text style={[styles.durationLabel, {color: colors.textSecondary}]}>所要時間</Text>
              <View style={styles.durationOptions}>
                {DURATION_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.durationChip,
                      {borderColor: colors.border},
                      taskDuration === opt.value && !taskDurationCustom && {backgroundColor: colors.primary, borderColor: colors.primary},
                    ]}
                    onPress={() => {
                      setTaskDurationCustom(false);
                      const newDur = taskDuration === opt.value ? null : opt.value;
                      setTaskDuration(newDur);
                      if (taskTimeHour && taskTimeMinute) { updateEndTime(taskTimeHour, taskTimeMinute, newDur); }
                    }}>
                    <Text style={[
                      styles.durationChipText,
                      {color: colors.textSecondary},
                      taskDuration === opt.value && !taskDurationCustom && {color: colors.onPrimary},
                    ]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {/* 期限 */}
            <View style={{marginTop: 12}}>
              <Text style={[styles.durationLabel, {color: colors.textSecondary}]}>何時までに</Text>
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4}}>
                <TextInput
                  style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text, width: 48, textAlign: 'center', flex: 0}]}
                  placeholder="--"
                  placeholderTextColor={colors.textTertiary}
                  value={taskDeadlineHour}
                  onChangeText={(t) => {
                    const num = t.replace(/[^0-9]/g, '').slice(0, 2);
                    setTaskDeadlineHour(num);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text style={{fontSize: 16, color: colors.textSecondary, fontWeight: '600'}}>:</Text>
                <TextInput
                  style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text, width: 48, textAlign: 'center', flex: 0}]}
                  placeholder="--"
                  placeholderTextColor={colors.textTertiary}
                  value={taskDeadlineMinute}
                  onChangeText={(t) => {
                    const num = t.replace(/[^0-9]/g, '').slice(0, 2);
                    setTaskDeadlineMinute(num);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text style={{fontSize: 13, color: colors.textTertiary, marginLeft: 4}}>（任意）</Text>
              </View>
            </View>
            {/* メモ */}
            <View style={{marginTop: 12}}>
              <Text style={[styles.durationLabel, {color: colors.textSecondary}]}>メモ</Text>
              <TextInput
                style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text, height: 64, textAlignVertical: 'top', paddingTop: 8}]}
                placeholder="メモを入力..."
                placeholderTextColor={colors.textTertiary}
                value={taskMemo}
                onChangeText={setTaskMemo}
                multiline
              />
            </View>
            <View style={styles.addActions}>
              <TouchableOpacity
                onPress={() => { setAddingTask(false); setTaskInputText(''); setTaskTimeEnabled(false); setTaskDuration(null); setTaskDurationCustom(false); setTaskCustomMinutes(''); setTaskMemo(''); setTaskDeadlineHour(''); setTaskDeadlineMinute(''); setTaskInputError(false); Keyboard.dismiss(); }}
                style={[styles.addActionBtn, {backgroundColor: colors.inputBackground}]}>
                <Text style={[styles.addActionText, {color: colors.textSecondary}]}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAddTask}
                style={[styles.addActionBtn, {backgroundColor: colors.primary}]}>
                <Text style={[styles.addActionText, {color: colors.onPrimary}]}>追加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ── Edit Todo Popup ── */}
      {editingTodoTaskId && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleCancelEditTodo}
          style={[styles.addOverlay, {backgroundColor: colors.overlay}]}>
          <TouchableOpacity activeOpacity={1} style={[styles.addCard, {backgroundColor: colors.surface}]}>
            <Text style={[styles.addCardTitle, {color: colors.text}]}>タスクを編集</Text>
            <TextInput
              style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text}]}
              value={editTodoTitle}
              onChangeText={setEditTodoTitle}
              placeholder="タイトル"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <View style={styles.durationRow}>
              <Text style={[styles.durationLabel, {color: colors.textSecondary}]}>所要時間</Text>
              <View style={styles.durationOptions}>
                {DURATION_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.durationChip,
                      {borderColor: colors.border},
                      editTodoDuration === opt.value && {backgroundColor: colors.primary, borderColor: colors.primary},
                    ]}
                    onPress={() => setEditTodoDuration(editTodoDuration === opt.value ? null : opt.value)}>
                    <Text style={[
                      styles.durationChipText,
                      {color: colors.textSecondary},
                      editTodoDuration === opt.value && {color: colors.onPrimary},
                    ]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{marginTop: 12}}>
              <Text style={[styles.durationLabel, {color: colors.textSecondary}]}>何時までに</Text>
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4}}>
                <TextInput
                  style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text, width: 48, textAlign: 'center', flex: 0}]}
                  placeholder="--"
                  placeholderTextColor={colors.textTertiary}
                  value={editTodoDeadlineHour}
                  onChangeText={(t) => setEditTodoDeadlineHour(t.replace(/[^0-9]/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text style={{fontSize: 16, color: colors.textSecondary, fontWeight: '600'}}>:</Text>
                <TextInput
                  style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text, width: 48, textAlign: 'center', flex: 0}]}
                  placeholder="--"
                  placeholderTextColor={colors.textTertiary}
                  value={editTodoDeadlineMinute}
                  onChangeText={(t) => setEditTodoDeadlineMinute(t.replace(/[^0-9]/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text style={{fontSize: 13, color: colors.textTertiary, marginLeft: 4}}>（任意）</Text>
              </View>
            </View>
            <View style={{marginTop: 12}}>
              <Text style={[styles.durationLabel, {color: colors.textSecondary}]}>メモ</Text>
              <TextInput
                style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text, height: 64, textAlignVertical: 'top', paddingTop: 8}]}
                placeholder="メモを入力..."
                placeholderTextColor={colors.textTertiary}
                value={editTodoMemo}
                onChangeText={setEditTodoMemo}
                multiline
              />
            </View>
            <View style={styles.addActions}>
              <TouchableOpacity
                onPress={handleCancelEditTodo}
                style={[styles.addActionBtn, {backgroundColor: colors.inputBackground}]}>
                <Text style={[styles.addActionText, {color: colors.textSecondary}]}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveEditTodo}
                style={[styles.addActionBtn, {backgroundColor: colors.primary}]}>
                <Text style={[styles.addActionText, {color: colors.onPrimary}]}>保存</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </View>
  );
});

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header
  headerZone: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerRow1: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  headerDateBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerDay: {
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
  },
  headerMonthYear: {
    fontSize: 14,
    fontWeight: '500',
  },
  headerWeekday: {
    fontSize: 13,
    marginTop: 1,
  },
  headerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnText: {
    fontSize: 20,
    fontWeight: '600',
  },
  todayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  todayBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Week strip
  weekStrip: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  weekStripDay: {
    alignItems: 'center',
    width: (SCREEN_WIDTH - 16) / 7,
  },
  weekStripLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
  },
  weekStripCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekStripDate: {
    fontSize: 15,
    fontWeight: '500',
  },
  stripBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#FF3B30',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  stripBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },

  // Loading / error
  loadingBar: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  errorBar: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 13,
  },

  // Timeline scroll
  timelineScroll: {
    flex: 1,
  },

  // All-day
  allDaySection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
  },
  allDayChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  allDayChipText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Flow Timeline ──
  flowTimeline: {
    position: 'relative',
    paddingVertical: 4,
  },
  flowRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  flowTimeCol: {
    width: FLOW_LEFT_WIDTH,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  flowTimeText: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  flowTimeTextSmall: {
    fontSize: 10,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  flowDotCol: {
    width: FLOW_DOT_COL_WIDTH,
    alignItems: 'center',
  },
  flowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 2,
  },
  flowDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    zIndex: 2,
  },
  flowLineSegment: {
    flex: 1,
    width: 2,
  },
  flowContent: {
    flex: 1,
    paddingRight: 10,
    paddingVertical: 4,
    justifyContent: 'center',
  },

  // Life cards (wake/sleep)
  lifeCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  lifeCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lifeCardEmoji: {
    fontSize: 16,
  },
  lifeCardText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Flow event card
  flowEventCard: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  flowEventTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  flowEventTime: {
    fontSize: 12,
    opacity: 0.9,
    marginTop: 2,
  },
  flowEventLocation: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 2,
  },

  // Flow task card
  flowTaskCard: {
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 10,
  },
  flowTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flowTaskTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  flowTaskTime: {
    fontSize: 11,
    marginTop: 2,
  },

  // Flow edit panel (inline below task)
  flowEditPanel: {
    marginLeft: FLOW_LEFT_WIDTH + FLOW_DOT_COL_WIDTH,
    marginRight: 16,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
  },

  // Current time indicator (flow)
  flowCurrentTime: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 50,
  },
  currentTimeBadge: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginLeft: 4,
  },
  currentTimeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  currentTimeLine: {
    flex: 1,
    height: 2,
  },

  // Drop indicator (flow)
  flowDropLine: {
    position: 'absolute',
    left: FLOW_LEFT_WIDTH + FLOW_DOT_COL_WIDTH,
    right: 16,
    height: 2,
    zIndex: 30,
  },
  flowDropPreview: {
    position: 'absolute',
    left: FLOW_LEFT_WIDTH + FLOW_DOT_COL_WIDTH,
    right: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    paddingHorizontal: 8,
    zIndex: 29,
  },
  flowDropPreviewText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Checkbox
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

  // Inline time editor
  inlineEditor: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  editorTabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  editorTab: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
  },
  editorTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  editorTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  editorTimeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editorTimeBtnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  editorTimeDisplay: {
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    width: 80,
    textAlign: 'center',
  },
  editorMinuteRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 6,
  },
  editorMinuteText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Bottom sheet
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
  deleteBtn: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Bookmark cards
  bookmarkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  bookmarkCard: {
    width: 88,
    height: 80,
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  bookmarkAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  bookmarkContent: {
    flex: 1,
    paddingLeft: 10,
    paddingRight: 6,
    paddingTop: 8,
    paddingBottom: 6,
    justifyContent: 'space-between',
  },
  bookmarkTitle: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  bookmarkDuration: {
    fontSize: 10,
    fontWeight: '500',
  },
  bookmarkEditPanel: {
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderRadius: 8,
  },
  bookmarkEditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bookmarkEditTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  bookmarkEditCheck: {
    marginRight: 8,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 80,
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 100,
  },
  fabText: {
    fontSize: 28,
    fontWeight: '300',
    marginTop: -1,
  },

  // Add Task overlay
  addOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  addCard: {
    width: SCREEN_WIDTH - 48,
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
  addTypeRow: {
    flexDirection: 'row',
    marginTop: 12,
    borderRadius: 8,
    overflow: 'hidden',
    gap: 4,
  },
  addTypeButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  addTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },
  addTimeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
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

  // Duration selector
  durationRow: {
    marginTop: 12,
  },
  durationLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
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

  // Task edit
  taskEditLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  taskEditTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  removeTimeBtn: {
    marginTop: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  removeTimeBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // Floating bookmark (drag)
  floatingBookmark: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 96,
    height: 88,
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: 'hidden',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 15,
  },
  floatingBookmarkAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  floatingBookmarkTitle: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    paddingLeft: 10,
    paddingRight: 6,
    paddingTop: 8,
  },
  floatingBookmarkTime: {
    fontSize: 16,
    fontWeight: '700',
    paddingLeft: 10,
    marginTop: 4,
  },
  floatingBookmarkDuration: {
    fontSize: 10,
    fontWeight: '500',
    paddingLeft: 10,
    marginTop: 2,
  },

  // Flow 2-column layout
  flowTwoColumnBody: {
    flexDirection: 'row',
  },
  flowColumnLeft: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  flowColumnRight: {
    flex: 1,
  },
  flowUntimedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  flowUntimedTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  flowUntimedDuration: {
    fontSize: 11,
    marginTop: 1,
  },
});

export default DayView;
