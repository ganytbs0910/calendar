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
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RNCalendarEvents from 'react-native-calendar-events';
import Ionicons from 'react-native-vector-icons/Ionicons';

import {useTheme} from '../theme/ThemeContext';
import {parseIntentions, hasLowConfidence} from '../agent/intentionParser';
import {checkWithGemini, mergeLowConfidenceFallback} from '../services/geminiFallbackService';
import {
  addIntentions,
  applyPlanToCalendar,
  clearIntentions,
  clearPlan,
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
  // fixed/focus: whether this repeats for ~3 months (毎週 etc. was said) or
  // only applies to what the current solve horizon actually covers — silent
  // either way used to read as "of course it repeats", which is exactly what
  // surprised a user who wrote a bare weekday+time expecting just this week.
  const span = t(i.explicitRecurrence ? 'agentStandingWeekly' : 'agentThisHorizonOnly');
  switch (i.kind) {
    case 'focus':
      return [t('agentKindFocus'), days, win, dur, span].filter(Boolean).join(' · ');
    case 'recurring':
      return [t('agentPerWeek', {n: i.timesPerWeek ?? 3}), dur, win].filter(Boolean).join(' · ');
    case 'fixed':
      return [days, win, dur, span].filter(Boolean).join(' · ');
    case 'deadline':
      return [
        t('agentDeadline', {date: i.deadline ?? '—'}),
        t('agentApproxH', {h: Math.round((i.totalEstimateMin ?? 0) / 60)}),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'event':
      return [
        i.eventEndDate
          ? t('agentEventDateRange', {start: i.eventDate ?? '—', end: i.eventEndDate})
          : t('agentEventDate', {date: i.eventDate ?? '—'}),
        i.allDay ? t('allDay') : win,
        i.allDay ? '' : dur,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'monthly': {
      const cadence = i.lastBusinessDayOfMonth
        ? t('agentMonthlyLastBizDay')
        : i.lastDayOfMonth
        ? t('agentMonthlyLastDay')
        : i.lastWeekdayOfMonth !== undefined
        ? t('agentMonthlyLastWeekday', {dow: dow[i.lastWeekdayOfMonth]})
        : i.monthDay !== undefined
        ? t('agentMonthlyDay', {day: i.monthDay})
        : t('agentMonthlyWeek', {week: i.monthWeek, dow: i.days?.[0] !== undefined ? dow[i.days[0]] : ''});
      const interval = i.monthInterval && i.monthInterval > 1 ? t('agentMonthlyEveryN', {n: i.monthInterval}) : '';
      return [interval, cadence, win, dur].filter(Boolean).join(' · ');
    }
    default:
      return t('agentKindPreference');
  }
};

interface AgentScreenProps {
  /** Called after applyPlanToCalendar writes real calendar events, so the
   * already-mounted Calendar/WeekView (they don't poll) can refetch. Without
   * this, newly-applied events are invisible until the app relaunches. */
  onApplied?: () => void;
}

const AgentScreen: React.FC<AgentScreenProps> = ({onApplied}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const [text, setText] = useState('');
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);
  // Guard declare()/apply() against a double-tap firing the async handler
  // twice before the button visually reacts — without this, a fast double
  // tap on 決定/適用 parses+adds (or applies) the same declaration twice,
  // silently doubling every calendar event it produces.
  const [declaring, setDeclaring] = useState(false);
  const [applying, setApplying] = useState(false);

  const reload = useCallback(async () => {
    const [ins, pl] = await Promise.all([getIntentions(), getPlan()]);
    setIntentions(ins);
    // A plan with no intentions behind it is always stale (apply() clears
    // intentions but plans are keyed on them existing) — belt-and-suspenders
    // alongside apply()'s own clearPlan(), in case some other path someday
    // empties the intentions list without also clearing the plan.
    if (pl && ins.length === 0) {
      clearPlan().catch(() => {});
      setPlan(null);
    } else {
      setPlan(pl);
    }
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
    if (declaring) return;
    setDeclaring(true);
    try {
      let parsed = parseIntentions(text);
      if (!parsed.length) {
        Alert.alert(t('agentParseFailTitle'), t('agentParseFailMsg'));
        return;
      }
      // Only the fragments the local parser truly had no signal for go out
      // over the network — everything it's confident about stays local and
      // free. A failed/invalid cloud check just leaves those fragments as
      // the local guess; it never blocks declaring.
      if (hasLowConfidence(parsed)) {
        const raws = parsed.filter(i => i.lowConfidence).map(i => i.raw);
        const result = await checkWithGemini(raws, new Date());
        parsed = mergeLowConfidenceFallback(parsed, result);
      }
      await addIntentions(parsed);
      setText('');
      const ins = await getIntentions();
      setIntentions(ins);
      await reSolve();
    } finally {
      setDeclaring(false);
    }
  }, [declaring, text, reSolve, t]);

  // Swipe-to-delete fires this directly (the swipe is already a deliberate
  // action, so no extra confirm).
  const removeIntention = useCallback(async (i: Intention) => {
    const next = await deleteIntention(i.id);
    setIntentions(next);
    await reSolve();
  }, [reSolve]);

  const apply = useCallback(async () => {
    if (!plan || applying) return;
    setApplying(true);
    try {
      // The plan is now written as real calendar events, so it needs the same
      // write permission AddEventModal asks for — without this check notifee's
      // caller-side saveEvent calls would just fail one by one, silently.
      const permissionStatus: string = await RNCalendarEvents.checkPermissions();
      if (permissionStatus !== 'authorized' && permissionStatus !== 'fullAccess') {
        const requested: string = await RNCalendarEvents.requestPermissions();
        if (requested !== 'authorized' && requested !== 'fullAccess') {
          Alert.alert(
            t('calendarAccess'),
            t('calendarFullAccessMessage'),
            [
              {text: t('cancel'), style: 'cancel'},
              {text: t('openSettings'), onPress: () => Linking.openSettings()},
            ],
          );
          return;
        }
      }

      const n = await applyPlanToCalendar(plan);
      if (n === 0) {
        Alert.alert(t('error'), t('noWritableCalendar'));
        return;
      }
      // Generating the calendar clears the input list so the next batch starts
      // from a clean slate — the persisted plan goes with it, or its leftover
      // "入りきらなかった予定" notes resurface next time this tab opens.
      await clearIntentions();
      await clearPlan();
      setIntentions([]);
      setPlan(null);
      setText('');
      onApplied?.();
      Alert.alert(t('agentAppliedTitle'), t('agentAppliedMsg', {count: n}));
    } finally {
      setApplying(false);
    }
  }, [plan, applying, t, onApplied]);

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
            style={[s.declareBtn, {backgroundColor: colors.primary, opacity: text.trim() && !declaring ? 1 : 0.4}]}
            disabled={!text.trim() || declaring}
            onPress={declare}>
            {declaring ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Ionicons name="sparkles" size={16} color={colors.onPrimary} />
            )}
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

      {/* Apply — the creation result goes straight to the calendar.
          Shown whenever there's something to report, not just on success —
          a required (fixed/focus) intention that placed nowhere at all used
          to render nothing here, which looked identical to the feature being
          broken instead of "this slot is already busy". */}
      {plan && (placed > 0 || plan.unplaced.length > 0) && (
        <View style={s.section}>
          {placed > 0 && (
            <View style={s.resultRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={[s.resultText, {color: colors.textSecondary}]}>
                {t('agentPlaced', {count: placed})}{solving ? '…' : ''}
              </Text>
            </View>
          )}

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

          {placed > 0 && (
            <TouchableOpacity
              style={[s.applyBtn, {backgroundColor: colors.primary, opacity: applying ? 0.6 : 1}]}
              disabled={applying}
              onPress={apply}>
              {applying ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Ionicons name="calendar" size={16} color={colors.onPrimary} />
              )}
              <Text style={[s.applyText, {color: colors.onPrimary}]}>{t('agentApplyBtn')}</Text>
            </TouchableOpacity>
          )}
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
