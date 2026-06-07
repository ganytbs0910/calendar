import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Switch,
  Alert,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTheme} from '../theme/ThemeContext';
import {ThemeColors} from '../theme/colors';
import {usePremium} from '../context/PremiumContext';
import {PaywallScreen} from './PaywallScreen';
import {
  Job,
  getJobs,
  addJob,
  updateJob,
  deleteJob,
  DEFAULT_NIGHT_RATE,
  DEFAULT_NIGHT_START,
  DEFAULT_NIGHT_END,
  DEFAULT_OVERTIME_THRESHOLD_MIN,
  DEFAULT_OVERTIME_RATE,
  DEFAULT_HOLIDAY_RATE,
  DEFAULT_HOLIDAY_WEEKDAYS,
} from '../services/jobService';

const JOB_COLORS = ['#007AFF', '#FF3B30', '#34C759', '#FFCC00', '#FF9500', '#AF52DE', '#FF2D92'];

interface JobsManagerModalProps {
  visible: boolean;
  onClose: () => void;
  onChange?: () => void; // notify parent so it can reload jobs
}

type Draft = {
  name: string;
  color: string;
  hourlyWage: string;
  transportPerShift: string;
  unpaidBreakMin: string;
  monthlyTarget: string;
  nightEnabled: boolean;
  nightRate: string;
  nightStart: string;
  nightEnd: string;
  overtimeEnabled: boolean;
  overtimeThresholdMin: string;
  overtimeRate: string;
  holidayEnabled: boolean;
  holidayRate: string;
  holidayWeekdays: number[];
};

const emptyDraft = (): Draft => ({
  name: '',
  color: JOB_COLORS[0],
  hourlyWage: '',
  transportPerShift: '',
  unpaidBreakMin: '',
  monthlyTarget: '',
  nightEnabled: false,
  nightRate: String(DEFAULT_NIGHT_RATE),
  nightStart: DEFAULT_NIGHT_START,
  nightEnd: DEFAULT_NIGHT_END,
  overtimeEnabled: false,
  overtimeThresholdMin: String(DEFAULT_OVERTIME_THRESHOLD_MIN),
  overtimeRate: String(DEFAULT_OVERTIME_RATE),
  holidayEnabled: false,
  holidayRate: String(DEFAULT_HOLIDAY_RATE),
  holidayWeekdays: [...DEFAULT_HOLIDAY_WEEKDAYS],
});

const draftFromJob = (j: Job): Draft => ({
  name: j.name,
  color: j.color || JOB_COLORS[0],
  hourlyWage: j.hourlyWage ? String(j.hourlyWage) : '',
  transportPerShift: j.transportPerShift ? String(j.transportPerShift) : '',
  unpaidBreakMin: j.unpaidBreakMin ? String(j.unpaidBreakMin) : '',
  monthlyTarget: j.monthlyTarget ? String(j.monthlyTarget) : '',
  nightEnabled: !!j.nightEnabled,
  nightRate: String(j.nightRate || DEFAULT_NIGHT_RATE),
  nightStart: j.nightStart || DEFAULT_NIGHT_START,
  nightEnd: j.nightEnd || DEFAULT_NIGHT_END,
  overtimeEnabled: !!j.overtimeEnabled,
  overtimeThresholdMin: String(j.overtimeThresholdMin || DEFAULT_OVERTIME_THRESHOLD_MIN),
  overtimeRate: String(j.overtimeRate || DEFAULT_OVERTIME_RATE),
  holidayEnabled: !!j.holidayEnabled,
  holidayRate: String(j.holidayRate || DEFAULT_HOLIDAY_RATE),
  holidayWeekdays: j.holidayWeekdays && j.holidayWeekdays.length > 0 ? [...j.holidayWeekdays] : [...DEFAULT_HOLIDAY_WEEKDAYS],
});

const JobsManagerModal: React.FC<JobsManagerModalProps> = ({visible, onClose, onChange}) => {
  const {t} = useTranslation();
  const {colors} = useTheme();
  const {isPremium} = usePremium();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currency = t('currencySymbol');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null); // null = list, '' = new, id = edit
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showPaywall, setShowPaywall] = useState(false);

  // Free tier: 1 job, basic wage. Premium: multiple jobs + night/OT/holiday premiums.
  const requirePremium = useCallback((): boolean => {
    if (isPremium) return true;
    setShowPaywall(true);
    return false;
  }, [isPremium]);

  const reload = useCallback(async () => {
    setJobs(await getJobs());
  }, []);

  useEffect(() => {
    if (visible) {
      reload();
      setEditingId(null);
    }
  }, [visible, reload]);

  const startNew = () => {
    if (jobs.length >= 1 && !requirePremium()) return; // free tier = 1 job
    setDraft(emptyDraft());
    setEditingId('');
  };
  const startEdit = (j: Job) => { setDraft(draftFromJob(j)); setEditingId(j.id); };

  const num = (s: string): number => {
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) { Alert.alert(t('error'), t('jobNameRequired')); return; }
    if (num(draft.hourlyWage) <= 0) { Alert.alert(t('error'), t('jobWageRequired')); return; }
    const payload = {
      name: draft.name.trim(),
      color: draft.color,
      hourlyWage: num(draft.hourlyWage),
      transportPerShift: num(draft.transportPerShift) || undefined,
      unpaidBreakMin: num(draft.unpaidBreakMin) || undefined,
      monthlyTarget: num(draft.monthlyTarget) || undefined,
      nightEnabled: draft.nightEnabled,
      nightRate: num(draft.nightRate) || DEFAULT_NIGHT_RATE,
      nightStart: draft.nightStart,
      nightEnd: draft.nightEnd,
      overtimeEnabled: draft.overtimeEnabled,
      overtimeThresholdMin: num(draft.overtimeThresholdMin) || DEFAULT_OVERTIME_THRESHOLD_MIN,
      overtimeRate: num(draft.overtimeRate) || DEFAULT_OVERTIME_RATE,
      holidayEnabled: draft.holidayEnabled,
      holidayRate: num(draft.holidayRate) || DEFAULT_HOLIDAY_RATE,
      holidayWeekdays: draft.holidayWeekdays,
    };
    if (editingId) {
      await updateJob(editingId, payload);
    } else {
      await addJob(payload);
    }
    await reload();
    setEditingId(null);
    onChange?.();
  }, [draft, editingId, reload, onChange, t]);

  const handleDelete = useCallback((j: Job) => {
    Alert.alert(t('deleteJob'), t('deleteJobConfirm', {name: j.name}), [
      {text: t('cancel'), style: 'cancel'},
      {text: t('delete'), style: 'destructive', onPress: async () => {
        await deleteJob(j.id);
        await reload();
        onChange?.();
      }},
    ]);
  }, [reload, onChange, t]);

  const weekdayLabels = [t('weekdaySun'), t('weekdayMon'), t('weekdayTue'), t('weekdayWed'), t('weekdayThu'), t('weekdayFri'), t('weekdaySat')];

  const renderField = (label: string, value: string, onChangeText: (s: string) => void, opts?: {suffix?: string; placeholder?: string; numeric?: boolean}) => (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={(txt) => onChangeText(opts?.numeric === false ? txt : txt.replace(/[^0-9.:]/g, ''))}
          keyboardType={opts?.numeric === false ? 'default' : 'numeric'}
          placeholder={opts?.placeholder}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
        />
        {opts?.suffix ? <Text style={styles.fieldSuffix}>{opts.suffix}</Text> : null}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={editingId === null ? onClose : () => setEditingId(null)}>
      <View style={styles.container}>
        <View style={styles.header}>
          {editingId === null ? (
            <>
              <TouchableOpacity onPress={onClose}><Text style={styles.headerBtn}>{t('done')}</Text></TouchableOpacity>
              <Text style={styles.headerTitle}>{t('jobsTitle')}</Text>
              <TouchableOpacity onPress={startNew}><Ionicons name="add" size={26} color={colors.primary} /></TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={() => setEditingId(null)}><Text style={styles.headerBtn}>{t('cancel')}</Text></TouchableOpacity>
              <Text style={styles.headerTitle}>{editingId ? t('editJob') : t('addJob')}</Text>
              <TouchableOpacity onPress={handleSave}><Text style={[styles.headerBtn, {fontWeight: '700'}]}>{t('save')}</Text></TouchableOpacity>
            </>
          )}
        </View>

        {editingId === null ? (
          <ScrollView contentContainerStyle={{padding: 16}}>
            {jobs.length === 0 && (
              <View style={styles.emptyBox}>
                <Ionicons name="briefcase-outline" size={36} color={colors.textTertiary} />
                <Text style={styles.emptyText}>{t('noJobs')}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={startNew}>
                  <Text style={styles.primaryBtnText}>{t('addJob')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {jobs.map(j => (
              <TouchableOpacity key={j.id} style={styles.jobRow} onPress={() => startEdit(j)} onLongPress={() => handleDelete(j)}>
                <View style={[styles.jobDot, {backgroundColor: j.color}]} />
                <View style={{flex: 1}}>
                  <Text style={styles.jobName} numberOfLines={1}>{j.name}</Text>
                  <Text style={styles.jobSub}>
                    {currency}{j.hourlyWage.toLocaleString()}/h
                    {j.nightEnabled ? ` ・${t('nightPremiumShort')}` : ''}
                    {j.overtimeEnabled ? ` ・${t('overtimeShort')}` : ''}
                    {j.holidayEnabled ? ` ・${t('holidayShort')}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
            {jobs.length > 0 && <Text style={styles.hint}>{t('jobsLongPressHint')}</Text>}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{padding: 16}} keyboardShouldPersistTaps="handled">
            {/* Name */}
            <View style={styles.card}>
              {renderField(t('jobName'), draft.name, (s) => setDraft(d => ({...d, name: s})), {numeric: false, placeholder: t('jobNamePlaceholder')})}
              <View style={styles.colorRow}>
                {JOB_COLORS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setDraft(d => ({...d, color: c}))}
                    style={[styles.colorDot, {backgroundColor: c}, draft.color === c && styles.colorDotSelected]}>
                    {draft.color === c && <Text style={styles.colorCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Base pay */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('basePay')}</Text>
              {renderField(t('hourlyWage'), draft.hourlyWage, (s) => setDraft(d => ({...d, hourlyWage: s})), {suffix: `${currency}/h`, placeholder: '1000'})}
              {renderField(t('transportPerShift'), draft.transportPerShift, (s) => setDraft(d => ({...d, transportPerShift: s})), {suffix: currency, placeholder: '0'})}
              {renderField(t('unpaidBreak'), draft.unpaidBreakMin, (s) => setDraft(d => ({...d, unpaidBreakMin: s})), {suffix: t('minutesUnit'), placeholder: '0'})}
              {renderField(t('monthlyTarget'), draft.monthlyTarget, (s) => setDraft(d => ({...d, monthlyTarget: s})), {suffix: currency, placeholder: '0'})}
            </View>

            {/* Night premium */}
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <Text style={styles.cardTitle}>{t('nightPremium')}</Text>
                <Switch value={draft.nightEnabled} onValueChange={(v) => { if (v && !requirePremium()) return; setDraft(d => ({...d, nightEnabled: v})); }} />
              </View>
              {draft.nightEnabled && (
                <>
                  {renderField(t('rate'), draft.nightRate, (s) => setDraft(d => ({...d, nightRate: s})), {suffix: '×', placeholder: '1.25'})}
                  {renderField(t('startTime'), draft.nightStart, (s) => setDraft(d => ({...d, nightStart: s})), {placeholder: '22:00'})}
                  {renderField(t('endTime'), draft.nightEnd, (s) => setDraft(d => ({...d, nightEnd: s})), {placeholder: '05:00'})}
                </>
              )}
            </View>

            {/* Overtime */}
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <Text style={styles.cardTitle}>{t('overtimePremium')}</Text>
                <Switch value={draft.overtimeEnabled} onValueChange={(v) => { if (v && !requirePremium()) return; setDraft(d => ({...d, overtimeEnabled: v})); }} />
              </View>
              {draft.overtimeEnabled && (
                <>
                  {renderField(t('overtimeThreshold'), draft.overtimeThresholdMin, (s) => setDraft(d => ({...d, overtimeThresholdMin: s})), {suffix: t('minutesUnit'), placeholder: '480'})}
                  {renderField(t('rate'), draft.overtimeRate, (s) => setDraft(d => ({...d, overtimeRate: s})), {suffix: '×', placeholder: '1.25'})}
                </>
              )}
            </View>

            {/* Holiday */}
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <Text style={styles.cardTitle}>{t('holidayPremium')}</Text>
                <Switch value={draft.holidayEnabled} onValueChange={(v) => { if (v && !requirePremium()) return; setDraft(d => ({...d, holidayEnabled: v})); }} />
              </View>
              {draft.holidayEnabled && (
                <>
                  {renderField(t('rate'), draft.holidayRate, (s) => setDraft(d => ({...d, holidayRate: s})), {suffix: '×', placeholder: '1.35'})}
                  <View style={styles.weekdayRow}>
                    {weekdayLabels.map((wl, idx) => {
                      const on = draft.holidayWeekdays.includes(idx);
                      return (
                        <TouchableOpacity key={idx}
                          style={[styles.weekdayChip, {backgroundColor: on ? colors.primary : colors.inputBackground}]}
                          onPress={() => setDraft(d => ({...d, holidayWeekdays: on ? d.holidayWeekdays.filter(x => x !== idx) : [...d.holidayWeekdays, idx]}))}>
                          <Text style={[styles.weekdayChipText, {color: on ? '#fff' : colors.textSecondary}]}>{wl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {editingId ? (
              <TouchableOpacity style={styles.deleteBtn} onPress={() => { const j = jobs.find(x => x.id === editingId); if (j) handleDelete(j); }}>
                <Text style={styles.deleteBtnText}>{t('deleteJob')}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
      </View>
      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </Modal>
  );
};

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border},
  headerTitle: {fontSize: 16, fontWeight: '700', color: colors.text},
  headerBtn: {fontSize: 16, color: colors.primary},
  emptyBox: {alignItems: 'center', paddingVertical: 48, gap: 12},
  emptyText: {color: colors.textSecondary, fontSize: 14},
  primaryBtn: {backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4},
  primaryBtnText: {color: '#fff', fontWeight: '700'},
  jobRow: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10},
  jobDot: {width: 14, height: 14, borderRadius: 7},
  jobName: {fontSize: 15, fontWeight: '600', color: colors.text},
  jobSub: {fontSize: 12, color: colors.textSecondary, marginTop: 2},
  hint: {fontSize: 12, color: colors.textTertiary, textAlign: 'center', marginTop: 8},
  card: {backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 12},
  cardTitle: {fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4},
  fieldRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8},
  fieldLabel: {fontSize: 14, color: colors.textSecondary, flex: 1},
  fieldInputWrap: {flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end'},
  fieldInput: {minWidth: 90, maxWidth: 150, height: 38, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, fontSize: 15, color: colors.text, textAlign: 'right', backgroundColor: colors.inputBackground},
  fieldSuffix: {fontSize: 13, color: colors.textSecondary, minWidth: 28},
  colorRow: {flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap'},
  colorDot: {width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
  colorDotSelected: {borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: {width: 0, height: 1}, elevation: 2},
  colorCheck: {color: '#fff', fontWeight: '900', fontSize: 14},
  toggleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  weekdayRow: {flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap'},
  weekdayChip: {width: 38, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  weekdayChipText: {fontSize: 13, fontWeight: '600'},
  deleteBtn: {alignItems: 'center', paddingVertical: 14, marginTop: 4},
  deleteBtnText: {color: '#FF3B30', fontSize: 15, fontWeight: '600'},
});

export default JobsManagerModal;
