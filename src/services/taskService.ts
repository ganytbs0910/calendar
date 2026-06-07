import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  dateKey: string; // "YYYY-MM-DD"
  time?: string; // "HH:MM" e.g. "09:00"
  duration?: number; // minutes
  taskType?: 'todo' | 'schedule'; // 'todo' = あとでやる, 'schedule' = 予定
  memo?: string;
  deadline?: string; // "YYYY-MM-DD" e.g. "2026-04-20"
  pinned?: boolean;
}

const STORAGE_KEY = '@today_tasks';

const getTodayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const getDateKey = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const loadTasks = async (): Promise<Task[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
};

const saveTasks = async (tasks: Task[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
};

// Serialize read-modify-write operations so two concurrent callers can't
// clobber each other's changes (e.g. addTask + toggleTask + getTodayTasks
// firing on the same tick).
let writeChain: Promise<unknown> = Promise.resolve();
const withWriteLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
};

export const getTasksForDate = async (dateKey: string): Promise<Task[]> => {
  const all = await loadTasks();
  return all.filter(t => t.dateKey === dateKey);
};

export const getTasksForDateRange = async (dateKeys: string[]): Promise<Map<string, Task[]>> => {
  const all = await loadTasks();
  const result = new Map<string, Task[]>();
  for (const key of dateKeys) {
    result.set(key, []);
  }
  for (const task of all) {
    if (result.has(task.dateKey)) {
      result.get(task.dateKey)!.push(task);
    }
  }
  return result;
};

export const addTaskForDate = async (title: string, dateKey: string, time?: string, duration?: number, taskType?: 'todo' | 'schedule', memo?: string, deadline?: string): Promise<Task[]> =>
  withWriteLock(async () => {
    const all = await loadTasks();
    const newTask: Task = {
      id: Date.now().toString(),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
      dateKey,
      time,
      duration,
      taskType,
      memo: memo || undefined,
      deadline: deadline || undefined,
    };
    all.push(newTask);
    await saveTasks(all);
    return all.filter(t => t.dateKey === dateKey);
  });

export const updateTaskTime = async (taskId: string, time?: string): Promise<void> =>
  withWriteLock(async () => {
    const all = await loadTasks();
    const idx = all.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      all[idx].time = time;
      await saveTasks(all);
    }
  });

export const updateTask = async (taskId: string, updates: { title?: string; time?: string; duration?: number; clearTime?: boolean; clearDuration?: boolean; taskType?: 'todo' | 'schedule'; memo?: string; deadline?: string; clearDeadline?: boolean; pinned?: boolean }): Promise<void> =>
  withWriteLock(async () => {
    const all = await loadTasks();
    const idx = all.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    if (updates.title !== undefined) all[idx].title = updates.title;
    if (updates.clearTime) all[idx].time = undefined;
    else if (updates.time !== undefined) all[idx].time = updates.time;
    if (updates.clearDuration) all[idx].duration = undefined;
    else if (updates.duration !== undefined) all[idx].duration = updates.duration;
    if (updates.taskType !== undefined) all[idx].taskType = updates.taskType;
    if (updates.memo !== undefined) all[idx].memo = updates.memo;
    if (updates.clearDeadline) all[idx].deadline = undefined;
    else if (updates.deadline !== undefined) all[idx].deadline = updates.deadline;
    if (updates.pinned !== undefined) all[idx].pinned = updates.pinned;
    await saveTasks(all);
  });

/**
 * Get today's tasks with automatic carry-over logic:
 * - Incomplete tasks from previous days → update dateKey to today
 * - Completed tasks from previous days → delete
 */
export const getTodayTasks = async (): Promise<Task[]> =>
  withWriteLock(async () => {
    const all = await loadTasks();
    const todayKey = getTodayKey();

    const todayTasks: Task[] = [];
    let changed = false;

    for (const task of all) {
      if (task.dateKey === todayKey) {
        todayTasks.push(task);
      } else if (task.dateKey < todayKey) {
        // Either drop (completed) or carry forward (incomplete) — both mutate storage.
        changed = true;
        if (!task.completed) {
          todayTasks.push({...task, dateKey: todayKey});
        }
      } else {
        // Future tasks – keep as-is
        todayTasks.push(task);
      }
    }

    if (changed) {
      await saveTasks(todayTasks);
    }

    return todayTasks.filter(t => t.dateKey === todayKey);
  });

export const addTask = async (title: string): Promise<Task[]> => {
  await withWriteLock(async () => {
    const all = await loadTasks();
    const todayKey = getTodayKey();
    const newTask: Task = {
      id: Date.now().toString(),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
      dateKey: todayKey,
    };
    all.push(newTask);
    await saveTasks(all);
  });
  return getTodayTasks();
};

export const toggleTask = async (taskId: string): Promise<void> =>
  withWriteLock(async () => {
    const all = await loadTasks();
    const idx = all.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      all[idx].completed = !all[idx].completed;
      await saveTasks(all);
    }
  });

export const deleteTask = async (taskId: string): Promise<Task[]> => {
  await withWriteLock(async () => {
    const all = await loadTasks();
    const filtered = all.filter(t => t.id !== taskId);
    await saveTasks(filtered);
  });
  return getTodayTasks();
};
