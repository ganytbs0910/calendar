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
const FLOW_MIN_ITEM_HEIGHT = 56;
const FLOW_LEFT_WIDTH = 50;
const FLOW_DOT_COL_WIDTH = 24;
const CREATION_HOUR_HEIGHT = 56;

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
}

type GapMarker = { hour: number; label: string };

type Segment =
  | { type: 'wake'; hour: number; minute: number }
  | { type: 'sleep'; hour: number; minute: number }
  | { type: 'gap'; startMin: number; endMin: number; markers: GapMarker[] }
  | { type: 'item'; item: TimelineItem; startMin: number; endMin: number; durationMin: number };

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
  const [addingTask, setAddingTask] = useState(false);
  const [taskInputText, setTaskInputText] = useState('');
  const [taskTimeEnabled, setTaskTimeEnabled] = useState(false);
  const [taskTimeHour, setTaskTimeHour] = useState('09');
  const [taskTimeMinute, setTaskTimeMinute] = useState('00');
  const [taskEndTimeHour, setTaskEndTimeHour] = useState('10');
  const [taskEndTimeMinute, setTaskEndTimeMinute] = useState('00');
  const [taskDuration, setTaskDuration] = useState<number | null>(null);
  const [taskDurationCustom, setTaskDurationCustom] = useState(false);
  const [taskCustomMinutes, setTaskCustomMinutes] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editTaskTimeHour, setEditTaskTimeHour] = useState('');
  const [editTaskTimeMinute, setEditTaskTimeMinute] = useState('');
  const [editTaskDuration, setEditTaskDuration] = useState<number | null>(null);
  const [editDurationCustom, setEditDurationCustom] = useState(false);
  const [editCustomMinutes, setEditCustomMinutes] = useState('');
  const [editingTimelineTaskId, setEditingTimelineTaskId] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dropTimePreview, setDropTimePreview] = useState<string | null>(null);
  const dragAnimX = useRef(new Animated.Value(0)).current;
  const dragAnimY = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);
  const gridContainerRef = useRef<View>(null);
  const gridTopOnScreenRef = useRef(0);
  const dragStartedRef = useRef(false);
  const dragTaskIdRef = useRef<string | null>(null);
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

  // Detail mode (tap flow timeline to see hourly grid)
  const [isDetailMode, setIsDetailMode] = useState(false);
  const detailCreatingRef = useRef<{startMin: number; endMin: number; anchorMin: number} | null>(null);
  const detailLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailIsTapRef = useRef(true);
  const detailTouchPageYRef = useRef(0);
  const detailPanActiveRef = useRef(false);
  const detailTargetMinRef = useRef<number | null>(null);

  // Event creation mode (long-press on gap)
  const [isCreating, setIsCreating] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState<{startMin: number; endMin: number} | null>(null);
  const creatingEventRef = useRef<{startMin: number; endMin: number} | null>(null);
  const isCreatingRef = useRef(false);
  const lastCrossedHourRef = useRef<number | null>(null);
  const creationAnchorRef = useRef<number | null>(null);
  const onTimeRangeSelectRef = useRef(onTimeRangeSelect);

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

  const timedTasks = useMemo(() => dayTasks.filter(t => t.time), [dayTasks]);
  const untimedTasks = useMemo(() =>
    dayTasks.filter(t => !t.time).sort((a, b) => Number(a.completed) - Number(b.completed)),
  [dayTasks]);

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

    // Timed tasks
    timedTasks.forEach(task => {
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
  }, [events, eventColors, timedTasks]);

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

  const handleAddTask = useCallback(async () => {
    const trimmed = taskInputText.trim();
    if (!trimmed) return;
    const time = taskTimeEnabled ? `${taskTimeHour.padStart(2, '0')}:${taskTimeMinute.padStart(2, '0')}` : undefined;
    const duration = taskDuration || undefined;
    await addTaskForDate(trimmed, dateKey, time, duration);
    setTaskInputText('');
    setAddingTask(false);
    setTaskTimeEnabled(false);
    setTaskTimeHour('09');
    setTaskTimeMinute('00');
    setTaskEndTimeHour('10');
    setTaskEndTimeMinute('00');
    setTaskDuration(null);
    setTaskDurationCustom(false);
    setTaskCustomMinutes('');
    Keyboard.dismiss();
    fetchTasks();
  }, [taskInputText, dateKey, fetchTasks, taskTimeEnabled, taskTimeHour, taskTimeMinute, taskDuration]);

  const handleToggleTask = useCallback(async (taskId: string) => {
    await toggleTask(taskId);
    fetchTasks();
  }, [fetchTasks]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    fetchTasks();
  }, [fetchTasks]);

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

  // ── Drag & Drop handlers ──

  const dragCallbacksRef = useRef({
    onDragGrant: (_taskId: string, _px: number, _py: number) => {},
    onDragMove: (_px: number, _py: number) => {},
    finalizeDrag: async () => {},
    onDragCancel: () => {},
    onDragTap: (_taskId: string) => {},
  });

  // Keep segments/heights in refs so drag callbacks can use them without stale closures
  const segmentsRef = useRef<Segment[]>([]);
  const segmentHeightsRef = useRef<number[]>([]);

  const onDragGrant = useCallback((taskId: string, _pageX: number, _pageY: number) => {
    dragStartedRef.current = false;
    dragTaskIdRef.current = taskId;
    // Pre-measure immediately so value is ready by the time onDragMove fires
    gridContainerRef.current?.measureInWindow((_x: number, y: number) => {
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
      gridContainerRef.current?.measureInWindow((_x: number, y: number) => {
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

    // Calculate drop time using cumulative segment heights (no reliance on native layout refs)
    const gridY = pageY - gridTopOnScreenRef.current;
    const wMin = displayStartHour * 60;
    const sMin = displayEndHour * 60;
    let totalMinutes = wMin;

    // Primary: use segmentLayoutsRef (native-measured positions)
    const layouts = segmentLayoutsRef.current;
    let found = false;
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i];
      if (!layout) continue;
      if (gridY >= layout.y && gridY < layout.y + layout.height) {
        if (layout.endMin > layout.startMin) {
          const ratio = Math.max(0, Math.min(1, (gridY - layout.y) / layout.height));
          totalMinutes = layout.startMin + ratio * (layout.endMin - layout.startMin);
        } else {
          totalMinutes = layout.startMin;
        }
        found = true;
        break;
      }
    }

    // Fallback: use cumulative segment heights from refs
    if (!found) {
      const segs = segmentsRef.current;
      const heights = segmentHeightsRef.current;
      if (segs.length > 0 && heights.length === segs.length) {
        let cumY = 4; // flowTimeline paddingTop
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          const h = heights[i];
          if (gridY >= cumY && gridY < cumY + h) {
            if (seg.type === 'gap' || seg.type === 'item') {
              const ratio = Math.max(0, Math.min(1, (gridY - cumY) / h));
              totalMinutes = seg.startMin + ratio * (seg.endMin - seg.startMin);
            } else if (seg.type === 'wake') {
              totalMinutes = seg.hour * 60 + seg.minute;
            } else if (seg.type === 'sleep') {
              totalMinutes = seg.hour * 60 + seg.minute;
            }
            found = true;
            break;
          }
          cumY += h;
        }
        // If still not found, clamp to nearest boundary
        if (!found) {
          if (gridY < 4) totalMinutes = wMin;
          else totalMinutes = sMin - 1;
        }
      }
    }

    const roundedMinutes = Math.max(wMin, Math.min(sMin - 1, Math.round(totalMinutes / 15) * 15));
    const h = Math.floor(roundedMinutes / 60);
    const m = roundedMinutes % 60;
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    dropTimeRef.current = timeStr;
    setDropTimePreview(timeStr);
  }, [untimedTasks, sheetAnim, dragAnimX, dragAnimY, displayStartHour, displayEndHour]);

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

  const onDragTap = useCallback((taskId: string) => {
    const task = untimedTasks.find(t => t.id === taskId);
    if (task) handleExpandTask(task);
  }, [untimedTasks, handleExpandTask]);

  dragCallbacksRef.current = { onDragGrant, onDragMove, finalizeDrag, onDragCancel, onDragTap };

  const swipeDirRef = useRef<Record<string, 'h' | 'v' | null>>({});

  const taskPanResponders = useMemo(() => {
    const responders: Record<string, ReturnType<typeof PanResponder.create>> = {};
    for (const task of untimedTasks) {
      const taskId = task.id;
      responders[taskId] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          swipeDirRef.current[taskId] = null;
          dragCallbacksRef.current.onDragGrant(taskId, e.nativeEvent.pageX, e.nativeEvent.pageY);
        },
        onPanResponderMove: (e, gs) => {
          if (!swipeDirRef.current[taskId] && (Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8)) {
            swipeDirRef.current[taskId] = Math.abs(gs.dx) > Math.abs(gs.dy) ? 'h' : 'v';
          }
          const dir = swipeDirRef.current[taskId];
          if (dir === 'h') {
            const anim = getSwipeAnim(taskId);
            anim.setValue(Math.min(0, Math.max(-72, gs.dx)));
          } else if (dir === 'v') {
            dragCallbacksRef.current.onDragMove(e.nativeEvent.pageX, e.nativeEvent.pageY);
          }
        },
        onPanResponderRelease: (_e, gs) => {
          const dir = swipeDirRef.current[taskId];
          swipeDirRef.current[taskId] = null;
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
          } else if (dir === 'v') {
            dragCallbacksRef.current.finalizeDrag();
          } else {
            // Tap
            dragStartedRef.current = false;
            dragTaskIdRef.current = null;
            dropTimeRef.current = null;
            if (swipedItemIdRef.current) {
              resetSwipe(swipedItemIdRef.current);
            } else {
              dragCallbacksRef.current.onDragTap(taskId);
            }
          }
        },
        onPanResponderTerminate: () => {
          const dir = swipeDirRef.current[taskId];
          swipeDirRef.current[taskId] = null;
          if (dir === 'v') {
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
      items.push({
        type: 'task',
        id: `task-${task.id}`,
        title: task.title,
        startMinutes: startMin,
        endMinutes: startMin + dur,
        completed: task.completed,
        original: task,
      });
    });
    items.sort((a, b) => a.startMinutes - b.startMinutes);
    return items;
  }, [events, eventColors, timedTasks, dayStart]);

  // ── Segments ──

  const showWake = !!(sleepSettings && daySetting && displayStartHour > 0);
  const showSleep = !!(sleepSettings && daySetting && displayEndHour < 24);
  const wakeMin = showWake ? daySetting!.wakeUpHour * 60 + daySetting!.wakeUpMinute : 0;
  const sleepMinVal = showSleep ? daySetting!.sleepHour * 60 + daySetting!.sleepMinute : 24 * 60;

  const segments = useMemo((): Segment[] => {
    const result: Segment[] = [];

    if (showWake) {
      result.push({ type: 'wake', hour: daySetting!.wakeUpHour, minute: daySetting!.wakeUpMinute });
    }

    let cursor = wakeMin;

    for (const item of timelineItems) {
      const itemStart = Math.max(item.startMinutes, wakeMin);
      const itemEnd = Math.min(item.endMinutes, sleepMinVal);
      if (itemStart >= sleepMinVal || itemEnd <= wakeMin) continue;

      if (cursor < itemStart) {
        result.push({
          type: 'gap',
          startMin: cursor,
          endMin: itemStart,
          markers: buildGapMarkers(cursor, itemStart),
        });
      }

      result.push({
        type: 'item',
        item,
        startMin: itemStart,
        endMin: itemEnd,
        durationMin: Math.max(itemEnd - itemStart, 15),
      });

      cursor = Math.max(cursor, itemEnd);
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
      result.push({ type: 'sleep', hour: daySetting!.sleepHour, minute: daySetting!.sleepMinute });
    }

    return result;
  }, [timelineItems, showWake, showSleep, daySetting, wakeMin, sleepMinVal]);

  // Keep refs in sync for drag callbacks
  segmentsRef.current = segments;

  // Reset segment layouts when segments change
  useEffect(() => {
    segmentLayoutsRef.current = new Array(segments.length).fill(null);
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
        case 'item': return FLOW_MIN_ITEM_HEIGHT;
      }
    });
  }, [segments, timelineHeight, showWake, showSleep]);

  // Keep heights ref in sync
  segmentHeightsRef.current = segmentHeights;

  // ── Current time Y position in flow ──

  const currentTimeYPosition = useMemo(() => {
    if (!isTodayDate || segments.length === 0) return null;
    if (nowMinutes < wakeMin || nowMinutes > sleepMinVal) return null;

    let y = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const h = segmentHeights[i];

      if (seg.type === 'gap' || seg.type === 'item') {
        if (nowMinutes >= seg.startMin && nowMinutes < seg.endMin) {
          const ratio = (nowMinutes - seg.startMin) / (seg.endMin - seg.startMin);
          return y + ratio * h;
        }
      } else if (seg.type === 'wake') {
        if (nowMinutes === seg.hour * 60 + seg.minute) return y + h / 2;
      } else if (seg.type === 'sleep') {
        if (nowMinutes === seg.hour * 60 + seg.minute) return y + h / 2;
      }

      y += h;
    }
    return null;
  }, [isTodayDate, segments, segmentHeights, nowMinutes, wakeMin, sleepMinVal]);

  // ── Drop indicator Y position ──

  const dropIndicatorY = useMemo(() => {
    if (!draggingTask || !dropTimePreview) return null;
    const [dh, dm] = dropTimePreview.split(':').map(Number);
    const dropMin = dh * 60 + dm;

    let y = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const h = segmentHeights[i];
      if (seg.type === 'gap' || seg.type === 'item') {
        if (dropMin >= seg.startMin && dropMin <= seg.endMin) {
          const ratio = (dropMin - seg.startMin) / Math.max(1, seg.endMin - seg.startMin);
          return y + ratio * h;
        }
      }
      y += h;
    }
    return y;
  }, [draggingTask, dropTimePreview, segments, segmentHeights]);

  // ── Imperative handle ──

  const scrollToCurrentTime = useCallback(() => {
    if (scrollViewRef.current && currentTimeYPosition != null) {
      const absoluteY = flowTimelineYRef.current + currentTimeYPosition;
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
    setIsDetailMode(false);
  }, [dateKey]);

  // Auto-scroll when entering detail mode
  useEffect(() => {
    if (isDetailMode) {
      const targetMin = detailTargetMinRef.current != null
        ? detailTargetMinRef.current
        : isTodayDate ? nowMinutes : (timelineItems.length > 0 ? timelineItems[0].startMinutes : displayStartHour * 60);
      detailTargetMinRef.current = null;
      const targetY = ((targetMin - displayStartHour * 60) / 60) * CREATION_HOUR_HEIGHT;
      const scrollTarget = flowTimelineYRef.current + targetY - 150;
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({y: Math.max(0, scrollTarget), animated: false});
      }, 50);
    }
  }, [isDetailMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup detail creation state when exiting detail mode
  useEffect(() => {
    if (!isDetailMode) {
      if (detailLongPressTimerRef.current) {
        clearTimeout(detailLongPressTimerRef.current);
        detailLongPressTimerRef.current = null;
      }
      if (detailCreatingRef.current) {
        detailCreatingRef.current = null;
        setCreatingEvent(null);
      }
    }
  }, [isDetailMode]);

  // ── Event creation mode (long-press on gap) ──

  useEffect(() => {
    creatingEventRef.current = creatingEvent;
    isCreatingRef.current = isCreating;
  }, [creatingEvent, isCreating]);

  useEffect(() => {
    onTimeRangeSelectRef.current = onTimeRangeSelect;
  }, [onTimeRangeSelect]);

  const creationOverlayPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      gridContainerRef.current?.measureInWindow((_x: number, y: number) => {
        gridTopOnScreenRef.current = y;
      });
    },
    onPanResponderMove: (evt) => {
      if (!creatingEventRef.current) return;
      const anchor = creationAnchorRef.current;
      if (anchor == null) return;
      const {pageY} = evt.nativeEvent;
      const gridY = pageY - gridTopOnScreenRef.current;

      // Hourly grid math: overlay top = 0 corresponds to displayStartHour
      let minutes = displayStartHour * 60 + (gridY / CREATION_HOUR_HEIGHT) * 60;
      minutes = Math.round(minutes / 15) * 15;
      minutes = Math.max(displayStartHour * 60, Math.min(displayEndHour * 60, minutes));

      let newStart: number;
      let newEnd: number;
      if (minutes < anchor) {
        // Dragging above anchor → move start upward
        newStart = minutes;
        newEnd = Math.min(displayEndHour * 60, anchor + 30);
      } else {
        // Dragging below anchor → move end downward
        newStart = anchor;
        newEnd = Math.max(anchor + 15, minutes);
        newEnd = Math.min(displayEndHour * 60, newEnd);
      }

      // Vibrate on hour boundary crossing
      const edgeMin = minutes < anchor ? newStart : newEnd;
      const currentHour = Math.floor(edgeMin / 60);
      if (lastCrossedHourRef.current !== null && currentHour !== lastCrossedHourRef.current) {
        Vibration.vibrate(10);
      }
      lastCrossedHourRef.current = currentHour;

      setCreatingEvent({startMin: newStart, endMin: newEnd});
    },
    onPanResponderRelease: () => {
      const ce = creatingEventRef.current;
      const callback = onTimeRangeSelectRef.current;
      if (ce && callback) {
        const startDate = new Date(dayStart);
        startDate.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
        const endDate = new Date(dayStart);
        endDate.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
        callback(startDate, endDate);
      }
      setIsCreating(false);
      setCreatingEvent(null);
      lastCrossedHourRef.current = null;
      creationAnchorRef.current = null;
    },
    onPanResponderTerminate: () => {
      setIsCreating(false);
      setCreatingEvent(null);
      lastCrossedHourRef.current = null;
      creationAnchorRef.current = null;
    },
  }), [displayStartHour, displayEndHour, dayStart]);

  const cancelCreation = useCallback(() => {
    setIsCreating(false);
    setCreatingEvent(null);
    lastCrossedHourRef.current = null;
    creationAnchorRef.current = null;
  }, []);

  // ── Detail mode layout ──

  const detailModeLayout = useMemo(() => {
    if (!isDetailMode) return null;
    const totalHours = displayEndHour - displayStartHour;
    const overlayHeight = totalHours * CREATION_HOUR_HEIGHT;
    const hours = Array.from({length: totalHours + 1}, (_, i) => displayStartHour + i);

    const items = timelineItems
      .filter(item => {
        const itemStart = Math.max(item.startMinutes, displayStartHour * 60);
        const itemEnd = Math.min(item.endMinutes, displayEndHour * 60);
        return itemStart < displayEndHour * 60 && itemEnd > displayStartHour * 60;
      })
      .map(item => {
        const itemStart = Math.max(item.startMinutes, displayStartHour * 60);
        const itemEnd = Math.min(item.endMinutes, displayEndHour * 60);
        const topY = ((itemStart - displayStartHour * 60) / 60) * CREATION_HOUR_HEIGHT;
        const height = Math.max(
          CREATION_HOUR_HEIGHT / 4,
          ((itemEnd - itemStart) / 60) * CREATION_HOUR_HEIGHT,
        );
        return { ...item, topY, height, clampedStart: itemStart, clampedEnd: itemEnd };
      });

    return { totalHours, overlayHeight, hours, items };
  }, [isDetailMode, displayStartHour, displayEndHour, timelineItems]);

  const detailCurrentTimeY = useMemo(() => {
    if (!isDetailMode || !isTodayDate) return null;
    if (nowMinutes < displayStartHour * 60 || nowMinutes > displayEndHour * 60) return null;
    return ((nowMinutes - displayStartHour * 60) / 60) * CREATION_HOUR_HEIGHT;
  }, [isDetailMode, isTodayDate, nowMinutes, displayStartHour, displayEndHour]);

  // Detail mode: onTouchStart/Move/End for long press detection (doesn't block scrolling)
  // PanResponder only activates AFTER creation starts (for drag)

  const handleDetailTouchStart = useCallback((e: any) => {
    const pageY = e.nativeEvent.pageY;
    detailTouchPageYRef.current = pageY;
    detailIsTapRef.current = true;

    gridContainerRef.current?.measureInWindow((_x: number, y: number) => {
      gridTopOnScreenRef.current = y;
    });

    detailLongPressTimerRef.current = setTimeout(() => {
      detailLongPressTimerRef.current = null;
      detailIsTapRef.current = false;
      Vibration.vibrate(50);

      const gridY = pageY - gridTopOnScreenRef.current;
      let minutes = displayStartHour * 60 + (gridY / CREATION_HOUR_HEIGHT) * 60;
      minutes = Math.round(minutes / 15) * 15;
      minutes = Math.max(displayStartHour * 60, Math.min(displayEndHour * 60 - 15, minutes));
      const endMin = Math.min(displayEndHour * 60, minutes + 30);

      detailCreatingRef.current = {startMin: minutes, endMin, anchorMin: minutes};
      lastCrossedHourRef.current = Math.floor(endMin / 60);
      setCreatingEvent({startMin: minutes, endMin});
    }, 300);
  }, [displayStartHour, displayEndHour]);

  const handleDetailTouchMove = useCallback((e: any) => {
    if (detailCreatingRef.current) return; // Already creating, PanResponder handles drag
    if (!detailLongPressTimerRef.current) return; // No timer to cancel

    const dy = e.nativeEvent.pageY - detailTouchPageYRef.current;
    if (Math.abs(dy) > 10) {
      clearTimeout(detailLongPressTimerRef.current);
      detailLongPressTimerRef.current = null;
      detailIsTapRef.current = false;
    }
  }, []);

  const handleDetailTouchEnd = useCallback(() => {
    if (detailPanActiveRef.current) return; // PanResponder handled this touch

    if (detailLongPressTimerRef.current) {
      clearTimeout(detailLongPressTimerRef.current);
      detailLongPressTimerRef.current = null;
    }

    const dc = detailCreatingRef.current;
    if (dc) {
      // Long press fired but user released without dragging → finalize
      const ce = creatingEventRef.current;
      if (ce) {
        const callback = onTimeRangeSelectRef.current;
        if (callback) {
          const startDate = new Date(dayStart);
          startDate.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
          const endDate = new Date(dayStart);
          endDate.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
          callback(startDate, endDate);
        }
        setIsDetailMode(false);
      }
      detailCreatingRef.current = null;
      setCreatingEvent(null);
      lastCrossedHourRef.current = null;
    } else if (detailIsTapRef.current) {
      setIsDetailMode(false);
    }
  }, [dayStart]);

  const detailPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false, // Don't take initial touch — let ScrollView scroll
    onMoveShouldSetPanResponder: () => !!detailCreatingRef.current,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponderCapture: () => !!detailCreatingRef.current,
    onPanResponderTerminationRequest: () => !detailCreatingRef.current,

    onPanResponderGrant: () => {
      detailPanActiveRef.current = true;
    },

    onPanResponderMove: (evt) => {
      const dc = detailCreatingRef.current;
      if (!dc) return;

      detailIsTapRef.current = false;
      const {pageY} = evt.nativeEvent;
      const gridY = pageY - gridTopOnScreenRef.current;

      let minutes = displayStartHour * 60 + (gridY / CREATION_HOUR_HEIGHT) * 60;
      minutes = Math.round(minutes / 15) * 15;
      minutes = Math.max(displayStartHour * 60, Math.min(displayEndHour * 60, minutes));

      const anchor = dc.anchorMin;

      // If dragged back to anchor position, hide the creation block
      if (minutes === anchor) {
        detailCreatingRef.current = {...dc, startMin: anchor, endMin: anchor + 15};
        setCreatingEvent(null);
        return;
      }

      let newStart: number, newEnd: number;
      if (minutes < anchor) {
        newStart = minutes;
        newEnd = Math.min(displayEndHour * 60, anchor + 15);
      } else {
        newStart = anchor;
        newEnd = Math.max(anchor + 15, minutes);
        newEnd = Math.min(displayEndHour * 60, newEnd);
      }

      const edgeMin = minutes < anchor ? newStart : newEnd;
      const currentHour = Math.floor(edgeMin / 60);
      if (lastCrossedHourRef.current !== null && currentHour !== lastCrossedHourRef.current) {
        Vibration.vibrate(10);
      }
      lastCrossedHourRef.current = currentHour;

      detailCreatingRef.current = {...dc, startMin: newStart, endMin: newEnd};
      setCreatingEvent({startMin: newStart, endMin: newEnd});
    },

    onPanResponderRelease: () => {
      detailPanActiveRef.current = false;

      const dc = detailCreatingRef.current;
      if (dc) {
        const ce = creatingEventRef.current;
        if (ce) {
          const callback = onTimeRangeSelectRef.current;
          if (callback) {
            const startDate = new Date(dayStart);
            startDate.setHours(Math.floor(ce.startMin / 60), ce.startMin % 60, 0, 0);
            const endDate = new Date(dayStart);
            endDate.setHours(Math.floor(ce.endMin / 60), ce.endMin % 60, 0, 0);
            callback(startDate, endDate);
          }
          setIsDetailMode(false);
        }
        detailCreatingRef.current = null;
        setCreatingEvent(null);
        lastCrossedHourRef.current = null;
      }
    },

    onPanResponderTerminate: () => {
      detailPanActiveRef.current = false;
      detailCreatingRef.current = null;
      setCreatingEvent(null);
      lastCrossedHourRef.current = null;
    },
  }), [displayStartHour, displayEndHour, dayStart]);

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
      <ScrollView
        ref={scrollViewRef}
        style={styles.timelineScroll}
        contentContainerStyle={{paddingBottom: BOTTOM_SHEET_MIN + 200}}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        scrollEnabled={!draggingTask && !isCreating && !(isDetailMode && creatingEvent)}
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

          {isDetailMode && detailModeLayout ? (
            <View
              {...detailPanResponder.panHandlers}
              onTouchStart={handleDetailTouchStart}
              onTouchMove={handleDetailTouchMove}
              onTouchEnd={handleDetailTouchEnd}
              style={{height: detailModeLayout.overlayHeight}}>
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {detailModeLayout.hours.map(hour => {
                  const y = (hour - displayStartHour) * CREATION_HOUR_HEIGHT;
                  return (
                    <View key={hour} style={[styles.creationHourRow, {top: y}]}>
                      <View style={styles.creationHourLabelCol}>
                        <Text style={[styles.creationHourLabel, {color: colors.textTertiary}]}>
                          {`${hour.toString().padStart(2, '0')}:00`}
                        </Text>
                      </View>
                      <View style={[styles.creationHourLine, {backgroundColor: colors.borderLight}]} />
                    </View>
                  );
                })}
              </View>
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {detailModeLayout.items.map(item => {
                  if (item.type === 'event') {
                    const evColor = item.color || colors.primary;
                    return (
                      <TouchableOpacity
                        key={`detail-${item.id}`}
                        activeOpacity={0.7}
                        onPress={() => { setIsDetailMode(false); onEventPress?.(item.original as CalendarEventReadable); }}
                        style={[
                          styles.detailEventBlock,
                          {top: item.topY, height: item.height, backgroundColor: evColor},
                        ]}>
                        <Text style={[styles.flowEventTitle, {color: colors.onEvent}]} numberOfLines={1}>
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
                      </TouchableOpacity>
                    );
                  }
                  if (item.type === 'task') {
                    const task = item.original as Task;
                    return (
                      <TouchableOpacity
                        key={`detail-${item.id}`}
                        activeOpacity={0.7}
                        onPress={() => { setIsDetailMode(false); handleEditTimelineTask(task); }}
                        style={[
                          styles.detailTaskBlock,
                          {
                            top: item.topY,
                            height: item.height,
                            backgroundColor: item.completed ? `${colors.primary}20` : `${colors.primary}10`,
                            borderColor: colors.primary,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.flowTaskTitle,
                            {color: colors.text},
                            item.completed && {textDecorationLine: 'line-through', color: colors.textTertiary},
                          ]}
                          numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={[styles.flowTaskTime, {color: colors.textSecondary}]}>
                          {formatMinutes(item.startMinutes)}〜{formatMinutes(item.endMinutes)}  {(() => {
                            const dur = item.endMinutes - item.startMinutes;
                            const h = Math.floor(dur / 60);
                            const m = dur % 60;
                            return h > 0 && m > 0 ? `${h}時間${m}分` : h > 0 ? `${h}時間` : `${m}分`;
                          })()}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                  return null;
                })}
              </View>
              {/* Creation block (drag selection) */}
              {creatingEvent && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.creationEventBlock,
                    {
                      top: ((creatingEvent.startMin - displayStartHour * 60) / 60) * CREATION_HOUR_HEIGHT,
                      height: Math.max(
                        CREATION_HOUR_HEIGHT / 4,
                        ((creatingEvent.endMin - creatingEvent.startMin) / 60) * CREATION_HOUR_HEIGHT,
                      ),
                      backgroundColor: `${colors.primary}30`,
                      borderColor: colors.primary,
                    },
                  ]}>
                  <Text style={[styles.creationEventTime, {color: colors.primary}]}>
                    {formatMinutes(creatingEvent.startMin)} 〜 {formatMinutes(creatingEvent.endMin)}
                  </Text>
                </View>
              )}
              {isTodayDate && detailCurrentTimeY != null && (
                <View
                  style={[styles.flowCurrentTime, {top: detailCurrentTimeY}]}
                  pointerEvents="none">
                  <View style={[styles.currentTimeBadge, {backgroundColor: colors.currentTimeIndicator}]}>
                    <Text style={[styles.currentTimeBadgeText, {color: colors.onPrimary}]}>
                      {currentTime.getHours().toString().padStart(2, '0')}:{currentTime.getMinutes().toString().padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={[styles.currentTimeLine, {backgroundColor: colors.currentTimeIndicator}]} />
                </View>
              )}
            </View>
          ) : segments.map((segment, segIndex) => {
            const isFirst = segIndex === 0;
            const isLast = segIndex === segments.length - 1;

            // ── Wake segment ──
            if (segment.type === 'wake') {
              return (
                <TouchableOpacity
                  key="wake"
                  style={[styles.flowRow, {height: FLOW_WAKE_HEIGHT}]}
                  activeOpacity={0.7}
                  onPress={() => setEditingTime(editingTime === 'wake' ? null : 'wake')}
                  onLayout={(e) => handleSegmentLayout(segIndex, wakeMin, wakeMin, e)}>
                  <View style={styles.flowTimeCol}>
                    <Text style={[styles.flowTimeText, {color: editingTime === 'wake' ? colors.primary : colors.textTertiary}]}>
                      {formatMinutes(segment.hour * 60 + segment.minute)}
                    </Text>
                  </View>
                  {renderDotCol(true, isLast, colors.primary)}
                  <View style={styles.flowContent}>
                    <View style={[styles.lifeCard, {backgroundColor: colors.surfaceSecondary}]}>
                      <View style={styles.lifeCardInner}>
                        <Text style={styles.lifeCardEmoji}>☀️</Text>
                        <Text style={[styles.lifeCardText, {color: colors.text}]}>起床</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }

            // ── Sleep segment ──
            if (segment.type === 'sleep') {
              return (
                <TouchableOpacity
                  key="sleep"
                  style={[styles.flowRow, {height: FLOW_SLEEP_HEIGHT}]}
                  activeOpacity={0.7}
                  onPress={() => setEditingTime(editingTime === 'sleep' ? null : 'sleep')}
                  onLayout={(e) => handleSegmentLayout(segIndex, sleepMinVal, sleepMinVal, e)}>
                  <View style={styles.flowTimeCol}>
                    <Text style={[styles.flowTimeText, {color: editingTime === 'sleep' ? colors.primary : colors.textTertiary}]}>
                      {formatMinutes(segment.hour * 60 + segment.minute)}
                    </Text>
                  </View>
                  {renderDotCol(isFirst, true, colors.primary)}
                  <View style={styles.flowContent}>
                    <View style={[styles.lifeCard, {backgroundColor: colors.surfaceSecondary}]}>
                      <View style={styles.lifeCardInner}>
                        <Text style={styles.lifeCardEmoji}>🌙</Text>
                        <Text style={[styles.lifeCardText, {color: colors.text}]}>就寝</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }

            // ── Gap segment ──
            if (segment.type === 'gap') {
              return (
                <TouchableOpacity
                  key={`gap-${segIndex}`}
                  style={{paddingVertical: FLOW_GAP_PADDING / 2}}
                  onLayout={(e) => handleSegmentLayout(segIndex, segment.startMin, segment.endMin, e)}
                  activeOpacity={0.7}
                  onPress={(e) => {
                    if (!isCreating && !editingTimelineTaskId && !draggingTask) {
                      const pageY = e.nativeEvent.pageY;
                      const layouts = segmentLayoutsRef.current;
                      let tapMin = (segment.startMin + segment.endMin) / 2;
                      gridContainerRef.current?.measureInWindow((_x: number, y: number) => {
                        const gridY = pageY - y;
                        for (let i = 0; i < layouts.length; i++) {
                          const layout = layouts[i];
                          if (!layout) continue;
                          if (gridY >= layout.y && gridY < layout.y + layout.height && layout.endMin > layout.startMin) {
                            const ratio = Math.max(0, Math.min(1, (gridY - layout.y) / layout.height));
                            tapMin = layout.startMin + ratio * (layout.endMin - layout.startMin);
                            break;
                          }
                        }
                        detailTargetMinRef.current = tapMin;
                        setIsDetailMode(true);
                      });
                    }
                  }}>
                  {segment.markers.map((marker, mi) => (
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
                </TouchableOpacity>
              );
            }

            // ── Item segment ──
            if (segment.type === 'item') {
              const height = segmentHeights[segIndex];
              const item = segment.item;

              if (item.type === 'event') {
                const evColor = item.color || colors.primary;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.flowRow, {minHeight: height}]}
                    activeOpacity={0.7}
                    onPress={() => onEventPress?.(item.original as CalendarEventReadable)}
                    onLayout={(e) => handleSegmentLayout(segIndex, segment.startMin, segment.endMin, e)}>
                    <View style={styles.flowTimeCol}>
                      <Text style={[styles.flowTimeText, {color: colors.textTertiary}]}>
                        {formatMinutes(segment.startMin)}
                      </Text>
                    </View>
                    {renderDotCol(isFirst, isLast, evColor)}
                    <View style={styles.flowContent}>
                      <View style={[styles.flowEventCard, {backgroundColor: evColor, minHeight: height - 8}]}>
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
                  </TouchableOpacity>
                );
              }

              if (item.type === 'task') {
                const task = item.original as Task;
                const isEditing = editingTimelineTaskId === task.id;
                return (
                  <View key={item.id}>
                    <View
                      style={[styles.flowRow, {minHeight: height}]}
                      onLayout={(e) => handleSegmentLayout(segIndex, segment.startMin, segment.endMin, e)}>
                      <View style={styles.flowTimeCol}>
                        <Text style={[styles.flowTimeText, {color: colors.textTertiary}]}>
                          {formatMinutes(segment.startMin)}
                        </Text>
                      </View>
                      {renderDotCol(isFirst, isLast, colors.primary)}
                      <View style={styles.flowContent}>
                        <View style={[
                          styles.flowTaskCard,
                          {
                            borderColor: colors.primary,
                            backgroundColor: item.completed ? `${colors.primary}20` : `${colors.primary}10`,
                            borderStyle: isEditing ? 'solid' : 'dashed',
                            minHeight: height - 8,
                          },
                        ]}>
                          <View style={styles.flowTaskRow}>
                            <TouchableOpacity
                              onPress={() => handleToggleTask(task.id)}
                              hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}>
                              <View style={[
                                styles.checkbox,
                                {borderColor: colors.primary},
                                item.completed && {backgroundColor: colors.primary, borderColor: colors.primary},
                              ]}>
                                {item.completed && <Text style={styles.checkmark}>✓</Text>}
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{flex: 1}}
                              activeOpacity={0.6}
                              onPress={() => handleEditTimelineTask(task)}>
                              <Text
                                style={[
                                  styles.flowTaskTitle,
                                  {color: colors.text},
                                  item.completed && {textDecorationLine: 'line-through', color: colors.textTertiary},
                                ]}
                                numberOfLines={2}>
                                {item.title}
                              </Text>
                              <Text style={[styles.flowTaskTime, {color: colors.textSecondary}]}>
                                {formatMinutes(item.startMinutes)}〜{formatMinutes(item.endMinutes)}  {(() => {
                                  const dur = item.endMinutes - item.startMinutes;
                                  const h = Math.floor(dur / 60);
                                  const m = dur % 60;
                                  return h > 0 && m > 0 ? `${h}時間${m}分` : h > 0 ? `${h}時間` : `${m}分`;
                                })()}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </View>
                    {/* Inline edit panel */}
                    {isEditing && (
                      <View style={[styles.flowEditPanel, {backgroundColor: colors.surface, borderColor: colors.border}]}>
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
                        <Text style={[styles.taskEditLabel, {color: colors.textSecondary, marginTop: 8}]}>時間</Text>
                        <View style={styles.taskEditTimeRow}>
                          <View style={styles.addTimeInputs}>
                            <TextInput
                              style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                              value={editTaskTimeHour}
                              onChangeText={t => setEditTaskTimeHour(t.replace(/[^0-9]/g, '').slice(0, 2))}
                              keyboardType="number-pad"
                              maxLength={2}
                            />
                            <Text style={{color: colors.text, fontWeight: '600', marginHorizontal: 2}}>:</Text>
                            <TextInput
                              style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                              value={editTaskTimeMinute}
                              onChangeText={t => setEditTaskTimeMinute(t.replace(/[^0-9]/g, '').slice(0, 2))}
                              keyboardType="number-pad"
                              maxLength={2}
                            />
                          </View>
                          <TouchableOpacity
                            style={[styles.placeBtn, {backgroundColor: colors.primary}]}
                            onPress={() => handleSaveTimelineTask(task.id)}>
                            <Text style={[styles.placeBtnText, {color: colors.onPrimary}]}>保存</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          style={[styles.removeTimeBtn, {borderColor: colors.error}]}
                          onPress={() => handleRemoveFromTimeline(task.id)}>
                          <Text style={[styles.removeTimeBtnText, {color: colors.error}]}>時間を外す</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              }
            }

            return null;
          })}

          {/* ── Creation mode: hourly grid overlay ── */}
          {isCreating && creatingEvent && (() => {
            const totalHours = displayEndHour - displayStartHour;
            const overlayHeight = totalHours * CREATION_HOUR_HEIGHT;
            const hours = Array.from({length: totalHours + 1}, (_, i) => displayStartHour + i);
            const eventTopY = ((creatingEvent.startMin - displayStartHour * 60) / 60) * CREATION_HOUR_HEIGHT;
            const eventHeight = Math.max(
              CREATION_HOUR_HEIGHT / 4,
              ((creatingEvent.endMin - creatingEvent.startMin) / 60) * CREATION_HOUR_HEIGHT,
            );
            return (
              <View
                style={[styles.creationOverlay, {height: overlayHeight, backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)'}]}
                {...creationOverlayPanResponder.panHandlers}>
                {/* Hour grid lines */}
                {hours.map(hour => {
                  const y = (hour - displayStartHour) * CREATION_HOUR_HEIGHT;
                  return (
                    <View key={hour} style={[styles.creationHourRow, {top: y}]}>
                      <View style={styles.creationHourLabelCol}>
                        <Text style={[styles.creationHourLabel, {color: colors.textTertiary}]}>
                          {`${hour.toString().padStart(2, '0')}:00`}
                        </Text>
                      </View>
                      <View style={[styles.creationHourLine, {backgroundColor: colors.borderLight}]} />
                    </View>
                  );
                })}
                {/* New event block */}
                <View style={[
                  styles.creationEventBlock,
                  {
                    top: eventTopY,
                    height: eventHeight,
                    backgroundColor: `${colors.primary}30`,
                    borderColor: colors.primary,
                  },
                ]}>
                  <Text style={[styles.creationEventTime, {color: colors.primary}]}>
                    {formatMinutes(creatingEvent.startMin)} 〜 {formatMinutes(creatingEvent.endMin)}
                  </Text>
                </View>
                {/* Cancel button */}
                <TouchableOpacity
                  style={[styles.creationCancelBtn, {backgroundColor: colors.surfaceSecondary}]}
                  onPress={cancelCreation}>
                  <Text style={[styles.creationCancelText, {color: colors.textSecondary}]}>キャンセル</Text>
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* Current time indicator (flow mode only) */}
          {!isDetailMode && isTodayDate && currentTimeYPosition != null && (
            <View
              style={[styles.flowCurrentTime, {top: currentTimeYPosition}]}
              pointerEvents="none">
              <View style={[styles.currentTimeBadge, {backgroundColor: colors.currentTimeIndicator}]}>
                <Text style={[styles.currentTimeBadgeText, {color: colors.onPrimary}]}>
                  {currentTime.getHours().toString().padStart(2, '0')}:{currentTime.getMinutes().toString().padStart(2, '0')}
                </Text>
              </View>
              <View style={[styles.currentTimeLine, {backgroundColor: colors.currentTimeIndicator}]} />
            </View>
          )}

          {/* Drop indicator during drag (flow mode only) */}
          {!isDetailMode && draggingTask && dropTimePreview && dropIndicatorY != null && (() => {
            const dur = draggingTask.duration || 60;
            const [dh, dm] = dropTimePreview.split(':').map(Number);
            const dropMin = dh * 60 + dm;
            // Compute end Y
            let endY = dropIndicatorY;
            let y = 0;
            for (let i = 0; i < segments.length; i++) {
              const seg = segments[i];
              const h = segmentHeights[i];
              if (seg.type === 'gap' || seg.type === 'item') {
                const endMin = dropMin + dur;
                if (endMin >= seg.startMin && endMin <= seg.endMin) {
                  const ratio = (endMin - seg.startMin) / Math.max(1, seg.endMin - seg.startMin);
                  endY = y + ratio * h;
                  break;
                }
              }
              y += h;
            }
            const dropHeight = Math.max(20, endY - dropIndicatorY);
            return (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[styles.flowDropLine, {top: dropIndicatorY, backgroundColor: colors.primary}]} />
                <View style={[styles.flowDropPreview, {
                  top: dropIndicatorY,
                  height: dropHeight,
                  backgroundColor: `${colors.primary}15`,
                  borderColor: colors.primary,
                }]}>
                  <Text style={[styles.flowDropPreviewText, {color: colors.primary}]}>
                    {dropTimePreview} - {formatMinutes(dropMin + dur)}
                  </Text>
                </View>
              </View>
            );
          })()}
        </View>

        {/* Sleep time editor (shown below flow) */}
        {editingTime === 'sleep' && sleepSettings && renderTimeEditor('sleep')}
      </ScrollView>

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
              {untimedTasks.length > 0 && (
                <View style={[styles.sheetBadge, {backgroundColor: colors.primary}]}>
                  <Text style={[styles.sheetBadgeText, {color: colors.onPrimary}]}>{untimedTasks.length}</Text>
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
          <ScrollView style={styles.sheetColumnLeft} showsVerticalScrollIndicator={false} scrollEnabled={!draggingTask}>
            {untimedTasks.length === 0 ? (
              <Text style={[styles.sheetEmpty, {color: colors.textTertiary}]}>タスクなし</Text>
            ) : (
              untimedTasks.map(task => (
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
                      {task.duration ? (
                        <Text style={[styles.sheetEventTime, {color: colors.textSecondary}]}>
                          {formatDuration(task.duration)}
                        </Text>
                      ) : null}
                    </View>
                  </Animated.View>
                </View>
              ))
            )}
          {expandedTaskId && (() => {
            const task = untimedTasks.find(t => t.id === expandedTaskId);
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
        onPress={() => setAddingTask(true)}
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

      {/* ── Add Task Overlay ── */}
      {addingTask && (
        <View style={[styles.addOverlay, {backgroundColor: colors.overlay}]}>
          <View style={[styles.addCard, {backgroundColor: colors.surface}]}>
            <Text style={[styles.addCardTitle, {color: colors.text}]}>タスクを追加</Text>
            <TextInput
              style={[styles.addInput, {backgroundColor: colors.inputBackground, color: colors.text}]}
              placeholder="タスクを入力..."
              placeholderTextColor={colors.textTertiary}
              value={taskInputText}
              onChangeText={setTaskInputText}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddTask}
            />
            <View style={styles.addTypeRow}>
              <TouchableOpacity
                onPress={() => setTaskTimeEnabled(false)}
                style={[
                  styles.addTypeButton,
                  !taskTimeEnabled && {backgroundColor: colors.primary},
                ]}>
                <Text style={{color: !taskTimeEnabled ? colors.onPrimary : colors.textSecondary, fontSize: 14, fontWeight: !taskTimeEnabled ? '700' : '500'}}>
                  あとでやる
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTaskTimeEnabled(true)}
                style={[
                  styles.addTypeButton,
                  taskTimeEnabled && {backgroundColor: colors.primary},
                ]}>
                <Text style={{color: taskTimeEnabled ? colors.onPrimary : colors.textSecondary, fontSize: 14, fontWeight: taskTimeEnabled ? '700' : '500'}}>
                  予定
                </Text>
              </TouchableOpacity>
            </View>
            {taskTimeEnabled && (
              <View style={styles.addTimeRow}>
                <View style={styles.addTimeInputs}>
                  <TextInput
                    style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                    value={taskTimeHour}
                    onChangeText={t => {
                      const v = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setTaskTimeHour(v);
                      updateEndTime(v, taskTimeMinute, taskDuration);
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="HH"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <Text style={[{color: colors.text, fontWeight: '600', marginHorizontal: 2}]}>:</Text>
                  <TextInput
                    style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                    value={taskTimeMinute}
                    onChangeText={t => {
                      const v = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setTaskTimeMinute(v);
                      updateEndTime(taskTimeHour, v, taskDuration);
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="MM"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
                <Text style={{color: colors.textTertiary, fontSize: 16, marginHorizontal: 6}}>→</Text>
                <View style={styles.addTimeInputs}>
                  <TextInput
                    style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                    value={taskEndTimeHour}
                    onChangeText={t => {
                      const v = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setTaskEndTimeHour(v);
                      // Recalculate duration from start/end
                      const sH = parseInt(taskTimeHour, 10) || 0;
                      const sM = parseInt(taskTimeMinute, 10) || 0;
                      const eH = parseInt(v, 10) || 0;
                      const eM = parseInt(taskEndTimeMinute, 10) || 0;
                      const diff = (eH * 60 + eM) - (sH * 60 + sM);
                      if (diff > 0) { setTaskDuration(diff); setTaskDurationCustom(false); }
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="HH"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <Text style={[{color: colors.text, fontWeight: '600', marginHorizontal: 2}]}>:</Text>
                  <TextInput
                    style={[styles.addTimeField, {color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBackground}]}
                    value={taskEndTimeMinute}
                    onChangeText={t => {
                      const v = t.replace(/[^0-9]/g, '').slice(0, 2);
                      setTaskEndTimeMinute(v);
                      // Recalculate duration from start/end
                      const sH = parseInt(taskTimeHour, 10) || 0;
                      const sM = parseInt(taskTimeMinute, 10) || 0;
                      const eH = parseInt(taskEndTimeHour, 10) || 0;
                      const eM = parseInt(v, 10) || 0;
                      const diff = (eH * 60 + eM) - (sH * 60 + sM);
                      if (diff > 0) { setTaskDuration(diff); setTaskDurationCustom(false); }
                    }}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="MM"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              </View>
            )}
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
                      if (taskTimeEnabled) { updateEndTime(taskTimeHour, taskTimeMinute, newDur); }
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
            <View style={styles.addActions}>
              <TouchableOpacity
                onPress={() => { setAddingTask(false); setTaskInputText(''); setTaskTimeEnabled(false); setTaskDuration(null); setTaskDurationCustom(false); setTaskCustomMinutes(''); Keyboard.dismiss(); }}
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
    paddingRight: 16,
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
    borderRadius: 10,
    padding: 10,
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

  // Detail mode blocks
  detailEventBlock: {
    position: 'absolute',
    left: FLOW_LEFT_WIDTH + 4,
    right: 16,
    borderRadius: 8,
    padding: 8,
    overflow: 'hidden',
  },
  detailTaskBlock: {
    position: 'absolute',
    left: FLOW_LEFT_WIDTH + 4,
    right: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed' as any,
    padding: 8,
    overflow: 'hidden',
  },

  // Creation overlay (hourly grid)
  creationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
  },
  creationHourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: CREATION_HOUR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  creationHourLabelCol: {
    width: FLOW_LEFT_WIDTH,
    paddingRight: 8,
    alignItems: 'flex-end',
  },
  creationHourLabel: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    marginTop: -7,
  },
  creationHourLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  creationEventBlock: {
    position: 'absolute',
    left: FLOW_LEFT_WIDTH + 4,
    right: 16,
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  creationEventTime: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  creationCancelBtn: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    left: FLOW_LEFT_WIDTH + 4,
    right: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  creationCancelText: {
    fontSize: 14,
    fontWeight: '600',
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
});

export default DayView;
