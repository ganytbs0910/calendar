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
  return JSON.parse(raw) as Task[];
};

const saveTasks = async (tasks: Task[]): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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

export const addTaskForDate = async (title: string, dateKey: string, time?: string, duration?: number, taskType?: 'todo' | 'schedule'): Promise<Task[]> => {
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
  };
  all.push(newTask);
  await saveTasks(all);
  return all.filter(t => t.dateKey === dateKey);
};

export const updateTaskTime = async (taskId: string, time?: string): Promise<void> => {
  const all = await loadTasks();
  const idx = all.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    all[idx].time = time;
    await saveTasks(all);
  }
};

export const updateTask = async (taskId: string, updates: { time?: string; duration?: number; clearTime?: boolean; clearDuration?: boolean; taskType?: 'todo' | 'schedule' }): Promise<void> => {
  const all = await loadTasks();
  const idx = all.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    if (updates.clearTime) {
      all[idx].time = undefined;
    } else if (updates.time !== undefined) {
      all[idx].time = updates.time;
    }
    if (updates.clearDuration) {
      all[idx].duration = undefined;
    } else if (updates.duration !== undefined) {
      all[idx].duration = updates.duration;
    }
    if (updates.taskType !== undefined) {
      all[idx].taskType = updates.taskType;
    }
    await saveTasks(all);
  }
};

/**
 * Get today's tasks with automatic carry-over logic:
 * - Incomplete tasks from previous days → update dateKey to today
 * - Completed tasks from previous days → delete
 */
export const getTodayTasks = async (): Promise<Task[]> => {
  const all = await loadTasks();
  const todayKey = getTodayKey();

  const todayTasks: Task[] = [];
  let changed = false;

  for (const task of all) {
    if (task.dateKey === todayKey) {
      todayTasks.push(task);
    } else if (task.dateKey < todayKey) {
      if (!task.completed) {
        // Carry over incomplete tasks
        todayTasks.push({...task, dateKey: todayKey});
        changed = true;
      }
      // Completed old tasks are dropped (changed = true to trigger save)
      changed = true;
    } else {
      // Future tasks – keep as-is
      todayTasks.push(task);
    }
  }

  if (changed) {
    await saveTasks(todayTasks);
  }

  return todayTasks;
};

export const addTask = async (title: string): Promise<Task[]> => {
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
  return getTodayTasks();
};

export const toggleTask = async (taskId: string): Promise<Task[]> => {
  const all = await loadTasks();
  const idx = all.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    all[idx].completed = !all[idx].completed;
    await saveTasks(all);
  }
  return getTodayTasks();
};

export const deleteTask = async (taskId: string): Promise<Task[]> => {
  const all = await loadTasks();
  const filtered = all.filter(t => t.id !== taskId);
  await saveTasks(filtered);
  return getTodayTasks();
};
