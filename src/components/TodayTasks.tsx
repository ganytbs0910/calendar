import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import RNCalendarEvents from 'react-native-calendar-events';
import {useTheme} from '../theme/ThemeContext';
import {Task, getTodayTasks, addTaskForDate, getDateKey, toggleTask, deleteTask} from '../services/taskService';
import {
  SleepSettings,
  getSleepSettings,
  getRemainingActiveMinutes,
  getTodaySettings,
} from '../services/sleepSettingsService';

const TodayTasks: React.FC = () => {
  const {colors} = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sleepSettings, setSleepSettings] = useState<SleepSettings | null>(null);
  const [remainingText, setRemainingText] = useState('');
  const [freeTimeText, setFreeTimeText] = useState('');

  // Load sleep settings
  useEffect(() => {
    getSleepSettings().then(s => setSleepSettings(s));
  }, []);

  // Calculate remaining active time and free time
  useEffect(() => {
    if (!sleepSettings) {
      setRemainingText('');
      setFreeTimeText('');
      return;
    }

    const calc = async () => {
      // Get today's specific settings (weekday/weekend)
      const todayDay = getTodaySettings(sleepSettings!);
      // Remaining active minutes
      const remainingMin = getRemainingActiveMinutes(todayDay);
      const rH = Math.floor(remainingMin / 60);
      const rM = remainingMin % 60;
      setRemainingText(`残り ${rH}時間${rM}分`);

      // Calculate today's remaining event minutes
      try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const events = await RNCalendarEvents.fetchAllEvents(
          todayStart.toISOString(),
          todayEnd.toISOString(),
        );

        // Filter to non-allday, non-holiday events that haven't ended yet
        const sleepMinOfDay = todayDay.sleepHour * 60 + todayDay.sleepMinute;
        let busyMinutes = 0;

        for (const event of events) {
          if (event.allDay) continue;
          if (!event.startDate || !event.endDate) continue;
          // Skip holiday calendars
          const calTitle = (event.calendar?.title || '').toLowerCase();
          if (calTitle.includes('祝日') || calTitle.includes('holiday')) continue;

          const start = new Date(event.startDate);
          const end = new Date(event.endDate);

          // Only count future portion of events
          const effectiveStart = start < now ? now : start;
          if (effectiveStart >= end) continue;

          // Clamp end to sleep time
          const sleepToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), todayDay.sleepHour, todayDay.sleepMinute);
          const effectiveEnd = end > sleepToday ? sleepToday : end;
          if (effectiveStart >= effectiveEnd) continue;

          const eventMin = Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60));
          busyMinutes += eventMin;
        }

        const freeMin = Math.max(0, remainingMin - busyMinutes);
        const fH = Math.floor(freeMin / 60);
        const fM = freeMin % 60;
        setFreeTimeText(`余白 ${fH}時間${fM}分`);
      } catch {
        setFreeTimeText('');
      }
    };

    calc();
    const interval = setInterval(calc, 60000);
    return () => clearInterval(interval);
  }, [sleepSettings]);

  const loadTasks = useCallback(async () => {
    const loaded = await getTodayTasks();
    setTasks(loaded);
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleAdd = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    await addTaskForDate(trimmed, getDateKey(new Date()));
    const updated = await getTodayTasks();
    setTasks(updated);
    setInputText('');
    setShowInput(false);
  }, [inputText]);

  const handleToggle = useCallback(async (id: string) => {
    const updated = await toggleTask(id);
    setTasks(updated);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const updated = await deleteTask(id);
    setTasks(updated);
  }, []);

  return (
    <View style={[styles.container, {backgroundColor: colors.surface}]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, {color: colors.text}]}>やることリスト</Text>
          {sleepSettings && (
            <View style={styles.timeInfo}>
              {remainingText ? (
                <Text style={[styles.remainingTime, {color: colors.textSecondary}]}>{remainingText}</Text>
              ) : null}
              {freeTimeText ? (
                <Text style={[styles.freeTime, {color: colors.primary}]}>{freeTimeText}</Text>
              ) : null}
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setShowInput(prev => !prev)}
          style={[styles.addBtn, {backgroundColor: colors.primary}]}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Input row */}
      {showInput && (
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, {backgroundColor: colors.inputBackground, color: colors.text}]}
            placeholder="タスクを入力..."
            placeholderTextColor={colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleAdd}
            autoFocus
            returnKeyType="done"
          />
          <TouchableOpacity
            onPress={handleAdd}
            style={[styles.submitBtn, {backgroundColor: colors.primary}]}>
            <Text style={styles.submitBtnText}>追加</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Task list */}
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {tasks.length === 0 && !showInput && (
          <Text style={[styles.emptyText, {color: colors.textTertiary}]}>タスクなし</Text>
        )}
        {tasks.map(task => (
          <View key={task.id} style={styles.taskRow}>
            <TouchableOpacity onPress={() => handleToggle(task.id)} style={styles.checkbox}>
              <View
                style={[
                  styles.checkboxBox,
                  {borderColor: colors.textTertiary},
                  task.completed && {backgroundColor: colors.primary, borderColor: colors.primary},
                ]}>
                {task.completed && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
            <Text
              style={[
                styles.taskTitle,
                {color: colors.text},
                task.completed && {
                  textDecorationLine: 'line-through',
                  color: colors.textTertiary,
                },
              ]}
              numberOfLines={1}>
              {task.title}
            </Text>
            <TouchableOpacity onPress={() => handleDelete(task.id)} style={styles.deleteBtn}>
              <Text style={[styles.deleteBtnText, {color: colors.textTertiary}]}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  timeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  remainingTime: {
    fontSize: 11,
    fontWeight: '500',
  },
  freeTime: {
    fontSize: 11,
    fontWeight: '600',
  },
  addBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '400',
    marginTop: -1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  submitBtn: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    paddingTop: 16,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  checkbox: {
    marginRight: 8,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: -1,
  },
  taskTitle: {
    flex: 1,
    fontSize: 14,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: {
    fontSize: 18,
    fontWeight: '300',
  },
});

export default TodayTasks;
