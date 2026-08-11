// ── AgentScreen — the "Tasks" tab made into a time-management agent ─────────
//
// You declare intentions in natural language; the on-device solver arranges the
// week to honour them, then writes the result straight into the calendar. This
// screen is purely the *creation* step — viewing and tracking live on the
// calendar, not here. Japanese-first (the beachhead user), zero network.

import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import {useTheme} from '../theme/ThemeContext';
import {parseIntentions} from '../agent/intentionParser';
import {
  addIntentions,
  applyPlanToCalendar,
  clearIntentions,
  deleteIntention,
  getIntentions,
  getPlan,
  resolvePlan,
} from '../agent/intentionService';
import {Intention, KIND_META, SchedulePlan} from '../agent/types';
import {useTranslation} from 'react-i18next';
import OneTimeHint from './OneTimeHint';
import SwipeableRow from './SwipeableRow';

type TFunc = (key: string, opts?: any) => string;

// Build the one-line meta under an intention title, fully localized. `t` and the
// weekday names come from i18n so the units (時/min, 曜, 分, 週N回…) follow locale.
const intentionMeta = (i: Intention, t: TFunc, dow: string[]): string => {
  const daysList =
    i.days && i.days.length && i.days.length < 7 ? i.days.map(d => dow[d]).join('·') : '';
  const days = daysList ? t('agentDaysFmt', {days: daysList}) : '';
  const win = i.window ? t('agentWin', {start: i.window.startHour, end: i.window.endHour}) : '';
  const dur = t('agentDurMin', {n: i.durationMin});
  switch (i.kind) {
    case 'focus':
      return [t('agentKindFocus'), days, win, dur].filter(Boolean).join(' · ');
    case 'recurring':
      return [t('agentPerWeek', {n: i.timesPerWeek ?? 3}), dur, win].filter(Boolean).join(' · ');
    case 'fixed':
      return [days, win, dur].filter(Boolean).join(' · ');
    case 'deadline':
      return [
        t('agentDeadline', {date: i.deadline ?? '—'}),
        t('agentApproxH', {h: Math.round((i.totalEstimateMin ?? 0) / 60)}),
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return t('agentKindPreference');
  }
};

const AgentScreen: React.FC = () => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const [text, setText] = useState('');
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);

  const reload = useCallback(async () => {
    const [ins, pl] = await Promise.all([getIntentions(), getPlan()]);
    setIntentions(ins);
    setPlan(pl);
  }, []);

  useEffect(() => {
    (async () => {
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const reSolve = useCallback(async () => {
    setSolving(true);
    try {
      const pl = await resolvePlan();
      setPlan(pl);
    } catch {
      Alert.alert(t('agentErrTitle'), t('agentErrMsg'));
    } finally {
      setSolving(false);
    }
  }, [t]);

  const declare = useCallback(async () => {
    const parsed = parseIntentions(text);
    if (!parsed.length) {
      Alert.alert(t('agentParseFailTitle'), t('agentParseFailMsg'));
      return;
    }
    await addIntentions(parsed);
    setText('');
    const ins = await getIntentions();
    setIntentions(ins);
    await reSolve();
  }, [text, reSolve, t]);

  // Swipe-to-delete fires this directly (the swipe is already a deliberate
  // action, so no extra confirm).
  const removeIntention = useCallback(async (i: Intention) => {
    const next = await deleteIntention(i.id);
    setIntentions(next);
    await reSolve();
  }, [reSolve]);

  const apply = useCallback(async () => {
    if (!plan) return;
    const n = await applyPlanToCalendar(plan);
    // Generating the calendar clears the input list so the next batch starts
    // from a clean slate.
    await clearIntentions();
    setIntentions([]);
    setPlan(null);
    setText('');
    Alert.alert(t('agentAppliedTitle'), t('agentAppliedMsg', {count: n}));
  }, [plan, t]);

  const s = makeStyles(colors);
  const dow = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];

  if (loading) {
    return (
      <View style={[s.center, {backgroundColor: colors.background}]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const placed = plan?.blocks.length ?? 0;

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={s.content}>
      {/* Hero */}
      <View style={s.hero}>
        <View style={s.heroRow}>
          <Ionicons name="sparkles" size={20} color={colors.primary} />
          <Text style={[s.heroTitle, {color: colors.text}]}>{t('agentTitle')}</Text>
        </View>
        <Text style={[s.heroSub, {color: colors.textSecondary}]}>
          {t('agentSubtitle')}
        </Text>
      </View>

      <OneTimeHint
        hintKey="tasksIntro"
        icon="sparkles-outline"
        title={t('hintAgentTitle')}
        message={t('hintAgentBody')}
        style={{marginBottom: 16}}
      />

      {/* Declaration */}
      <View style={[s.card, {backgroundColor: colors.surface, borderColor: colors.border}]}>
        <Text style={[s.cardLabel, {color: colors.textSecondary}]}>{t('agentInputLabel')}</Text>
        <TextInput
          style={[s.input, {color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border}]}
          value={text}
          onChangeText={setText}
          placeholder={t('agentExample')}
          placeholderTextColor={colors.textTertiary}
          multiline
        />
        <View style={[s.declareRow, {justifyContent: 'flex-end'}]}>
          <TouchableOpacity
            style={[s.declareBtn, {backgroundColor: colors.primary, opacity: text.trim() ? 1 : 0.4}]}
            disabled={!text.trim()}
            onPress={declare}>
            <Ionicons name="sparkles" size={16} color={colors.onPrimary} />
            <Text style={[s.declareBtnText, {color: colors.onPrimary}]}>{t('agentDeclareBtn')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Intentions */}
      {intentions.length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, {color: colors.text}]}>{t('agentIntentionsTitle')}</Text>
          {intentions.map(i => {
            const meta = KIND_META[i.kind];
            return (
              <SwipeableRow key={i.id} onDelete={() => removeIntention(i)}>
                <View style={[s.intRow, {backgroundColor: colors.surface, borderColor: colors.border}]}>
                  <View style={[s.intDot, {backgroundColor: i.color}]}>
                    <Ionicons name={meta.icon as any} size={14} color="#fff" />
                  </View>
                  <View style={{flex: 1}}>
                    <Text style={[s.intTitle, {color: colors.text}]} numberOfLines={1}>{i.title}</Text>
                    <Text style={[s.intMeta, {color: colors.textTertiary}]} numberOfLines={1}>{intentionMeta(i, t, dow)}</Text>
                  </View>
                  <View style={s.prioDots}>
                    {[1, 2, 3, 4, 5].map(p => (
                      <View
                        key={p}
                        style={[s.prioDot, {backgroundColor: p <= i.priority ? i.color : colors.border}]}
                      />
                    ))}
                  </View>
                </View>
              </SwipeableRow>
            );
          })}
          <Text style={[s.hint, {color: colors.textTertiary}]}>{t('agentSwipeHint')}</Text>
        </View>
      )}

      {/* Apply — the creation result goes straight to the calendar */}
      {plan && placed > 0 && (
        <View style={s.section}>
          <View style={s.resultRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Text style={[s.resultText, {color: colors.textSecondary}]}>
              {t('agentPlaced', {count: placed})}{solving ? '…' : ''}
            </Text>
          </View>

          {plan.unplaced.length > 0 && (
            <View style={[s.noteBox, {backgroundColor: colors.surface, borderColor: colors.border}]}>
              <Text style={[s.noteHead, {color: colors.error}]}>{t('agentUnplacedHead')}</Text>
              {plan.unplaced.map(u => (
                <Text key={u.intentionId} style={[s.noteLine, {color: colors.textSecondary}]}>
                  ・{u.title}：{u.reason}
                </Text>
              ))}
            </View>
          )}
          {plan.conflicts.length > 0 && (
            <View style={[s.noteBox, {backgroundColor: colors.surface, borderColor: colors.border}]}>
              <Text style={[s.noteHead, {color: colors.primary}]}>{t('agentConflictsHead')}</Text>
              {plan.conflicts.map((c, i) => (
                <Text key={i} style={[s.noteLine, {color: colors.textSecondary}]}>・{c}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity style={[s.applyBtn, {backgroundColor: colors.primary}]} onPress={apply}>
            <Ionicons name="calendar" size={16} color={colors.onPrimary} />
            <Text style={[s.applyText, {color: colors.onPrimary}]}>{t('agentApplyBtn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{height: 40}} />
    </ScrollView>
  );
};

const makeStyles = (_colors: any) =>
  StyleSheet.create({
    center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    content: {padding: 16},
    hero: {marginBottom: 16},
    heroRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    heroTitle: {fontSize: 22, fontWeight: '800'},
    heroSub: {fontSize: 13, lineHeight: 19, marginTop: 6},
    card: {borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 18},
    cardLabel: {fontSize: 12, fontWeight: '600', marginBottom: 8},
    input: {minHeight: 84, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, textAlignVertical: 'top'},
    declareRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12},
    exampleLink: {fontSize: 13, fontWeight: '600'},
    declareBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10},
    declareBtnText: {fontSize: 14, fontWeight: '700'},
    section: {marginBottom: 22},
    sectionTitle: {fontSize: 16, fontWeight: '700', marginBottom: 10},
    intRow: {flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 12},
    intDot: {width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
    intTitle: {fontSize: 15, fontWeight: '600'},
    intMeta: {fontSize: 12, marginTop: 2},
    prioDots: {flexDirection: 'row', gap: 3},
    prioDot: {width: 5, height: 5, borderRadius: 3},
    hint: {fontSize: 11, marginTop: 2},
    resultRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12},
    resultText: {fontSize: 13, fontWeight: '600', flex: 1},
    noteBox: {borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10},
    noteHead: {fontSize: 13, fontWeight: '700', marginBottom: 6},
    noteLine: {fontSize: 12, lineHeight: 18},
    applyBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: 4},
    applyText: {fontSize: 14, fontWeight: '700'},
  });

// Memoised: App re-renders on every tab switch, and without this each
// tab's whole subtree would re-render even while hidden.
export default React.memo(AgentScreen);
