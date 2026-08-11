import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {useTheme} from '../theme/ThemeContext';
import {useTranslation} from 'react-i18next';
import {Task, getTodayTasks, addTaskForDate, getDateKey, toggleTask, deleteTask} from '../services/taskService';
import {SleepSettings, getSleepSettings} from '../services/sleepSettingsService';
import {getTodayFreeTime} from '../services/freeTimeService';

const TodayTasks: React.FC = () => {
  const {colors} = useTheme();
  const {t} = useTranslation();
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

  // Both figures come from freeTimeService, so this screen and the calendar's
  // free-time bar can never disagree about what "free" means.
  useEffect(() => {
    if (!sleepSettings) {
      setRemainingText('');
      setFreeTimeText('');
      return;
    }

    let cancelled = false;
    const fmt = (min: number): string => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return h > 0 && m > 0
        ? t('hoursMinutesFmt', {h, m})
        : h > 0
        ? t('hoursFmt', {h})
        : t('minutesFmt', {m});
    };

    const calc = async () => {
      const {remainingMin, freeMin} = await getTodayFreeTime(sleepSettings);
      if (cancelled) return;
      setRemainingText(`${t('remaining')} ${fmt(remainingMin)}`);
      setFreeTimeText(`${t('freeTimeLabel')} ${fmt(freeMin)}`);
    };

    calc();
    const interval = setInterval(calc, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sleepSettings, t]);

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
    await toggleTask(id);
    const updated = await getTodayTasks();
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
          <Text style={[styles.headerTitle, {color: colors.text}]}>{t('todoList')}</Text>
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
            placeholder={t('taskPlaceholder')}
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
            <Text style={styles.submitBtnText}>{t('add')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Task list */}
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {tasks.length === 0 && !showInput && (
          <Text style={[styles.emptyText, {color: colors.textTertiary}]}>{t('noTasks')}</Text>
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