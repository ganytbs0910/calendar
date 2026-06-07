import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Share,
  TextInput,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTheme} from '../theme/ThemeContext';
import {ThemeColors} from '../theme/colors';
import {usePremium} from '../context/PremiumContext';
import {PaywallScreen} from './PaywallScreen';
import {fetchStats, getMonthRange, StatsBundle, getIncomeThresholds, setIncomeThresholds} from '../services/statisticsService';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface StatsScreenProps {
  visible: boolean;
  onClose: () => void;
  initialDate?: Date;
}

const monthOffsetFromDate = (date: Date): number => {
  const today = new Date();
  return (date.getFullYear() - today.getFullYear()) * 12 + (date.getMonth() - today.getMonth());
};

const formatDuration = (
  minutes: number,
  t: (k: string, opts?: any) => string,
): string => {
  if (minutes <= 0) return t('hoursFmt', {h: 0});
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return t('hoursMinutesFmt', {h, m});
  if (h > 0) return t('hoursFmt', {h});
  return t('minutesFmt', {m});
};

const StatsScreen: React.FC<StatsScreenProps> = ({visible, onClose, initialDate}) => {
  const {t} = useTranslation();
  const {colors, isDark} = useTheme();
  const {isPremium} = usePremium();
  const [showPaywall, setShowPaywall] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(false);
  const [bundle, setBundle] = useState<StatsBundle | null>(null);
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current month, -1 previous
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [thresholdDrafts, setThresholdDrafts] = useState<string[]>([]);

  // Each time the modal opens, sync to the caller-provided month so the user
  // sees stats for the month they were viewing on the calendar.
  useEffect(() => {
    if (visible) {
      setMonthOffset(initialDate ? monthOffsetFromDate(initialDate) : 0);
    }
  }, [visible, initialDate]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    const base = new Date();
    base.setMonth(base.getMonth() + offset);
    const {start, end} = getMonthRange(base);
    try {
      const data = await fetchStats(start, end);
      setBundle(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      load(monthOffset);
    }
  }, [visible, monthOffset, load]);

  const weekdayLabels = useMemo(() => {
    const arr = t('weekdaysSingle', {returnObjects: true}) as unknown;
    return Array.isArray(arr) ? (arr as string[]) : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  }, [t]);

  const monthLabel = useMemo(() => {
    if (!bundle) return '';
    const d = bundle.rangeStart;
    return t('yearMonthFormat', {year: d.getFullYear(), month: t('monthFormat', {month: d.getMonth() + 1})});
  }, [bundle, t]);

  const handleExportCsv = useCallback(async () => {
    if (!bundle) return;
    if (!isPremium) { setShowPaywall(true); return; }
    const cur = t('currencySymbol');
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; };
    const fmtTime = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    // Per-shift detail rows (what payroll users actually want to verify).
    const header = [t('csvDate'), t('jobName'), t('startTime'), t('endTime'), t('csvHours'), t('csvTotal')].join(',');
    const rows = bundle.payroll.shifts.map(s => [
      fmtDate(s.startISO),
      (s.jobId === null ? t('manualWage') : s.jobName).replace(/,/g, ' '),
      fmtTime(s.startISO),
      fmtTime(s.endISO),
      (s.minutes / 60).toFixed(2),
      Math.round(s.total),
    ].join(','));
    const totalRow = ['', t('csvTotal'), '', '', (bundle.payroll.totalMinutes / 60).toFixed(2), Math.round(bundle.payroll.total)].join(',');
    const csv = [`${monthLabel} (${cur})`, header, ...rows, totalRow].join('\n');
    try {
      await Share.share({message: csv});
    } catch {
      /* user cancelled */
    }
  }, [bundle, monthLabel, t, isPremium]);

  const openThresholdEditor = useCallback(async () => {
    const list = await getIncomeThresholds();
    setThresholdDrafts(list.map(String));
    setShowThresholdEditor(true);
  }, []);

  const saveThresholds = useCallback(async () => {
    const nums = thresholdDrafts
      .map(s => parseInt(s.replace(/[^0-9]/g, ''), 10))
      .filter(n => !isNaN(n) && n > 0);
    await setIncomeThresholds(nums);
    setShowThresholdEditor(false);
    load(monthOffset);
  }, [thresholdDrafts, load, monthOffset]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={{width: 80}} />
          <Text style={styles.headerTitle}>{t('statsTitle')}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.headerDone}>{t('done')}</Text>
          </TouchableOpacity>
        </View>

        {/* Month selector */}
        <View style={styles.monthSelector}>
          <TouchableOpacity
            style={styles.monthArrowBtn}
            onPress={() => setMonthOffset(o => o - 1)}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity
            style={styles.monthArrowBtn}
            disabled={monthOffset >= 0}
            onPress={() => setMonthOffset(o => Math.min(0, o + 1))}>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={monthOffset >= 0 ? colors.disabled : colors.primary}
            />
          </TouchableOpacity>
        </View>

        {loading || !bundle ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>{t('statsLoading')}</Text>
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={{paddingBottom: 40}}>
            {/* Summary card */}
            <View style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="stats-chart-outline" size={16} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t('statsMonthlySummary')}</Text>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryNumber}>{bundle.monthly.totalEvents}</Text>
                  <Text style={styles.summaryLabel}>{t('statsTotalEvents')}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryNumber}>
                    {Math.round(bundle.monthly.totalMinutes / 60)}
                  </Text>
                  <Text style={styles.summaryLabel}>{t('statsTotalHours')}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryNumber}>
                    {formatDuration(bundle.monthly.averageMinutesPerEvent, t)}
                  </Text>
                  <Text style={styles.summaryLabel}>{t('statsAvgPerEvent')}</Text>
                </View>
              </View>

              {bundle.monthly.totalMinutes > 0 && (
                <View style={styles.chronoTypeRow}>
                  <Text style={styles.chronoText}>
                    {bundle.monthly.morningRatio >= bundle.monthly.nightRatio
                      ? t('statsMorningType', {pct: Math.round(bundle.monthly.morningRatio * 100)})
                      : t('statsNightType', {pct: Math.round(bundle.monthly.nightRatio * 100)})}
                  </Text>
                </View>
              )}
            </View>

            {/* Monthly revenue / payroll (per job, with premiums & targets) */}
            {bundle.payroll.byJob.length > 0 && (
              <View style={styles.card}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="cash-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('statsMonthlyRevenue')}</Text>
                  <TouchableOpacity onPress={handleExportCsv} style={styles.csvBtn} accessibilityLabel={t('exportCsv')}>
                    <Ionicons name="share-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.earningsTotalRow}>
                  <Text style={styles.earningsTotal}>
                    {t('currencySymbol')}{Math.round(bundle.payroll.total).toLocaleString()}
                  </Text>
                </View>
                <Text style={[styles.cardSub, {marginBottom: 8, textAlign: 'center'}]}>
                  {formatDuration(bundle.payroll.totalMinutes, t)}
                </Text>

                {/* Premium breakdown (only nonzero) */}
                {(bundle.payroll.nightPremium > 0 || bundle.payroll.overtimePremium > 0 || bundle.payroll.holidayPremium > 0 || bundle.payroll.transport > 0) && (
                  <View style={styles.premiumLine}>
                    {bundle.payroll.nightPremium > 0 && (
                      <Text style={[styles.premiumChip, {color: colors.textSecondary}]}>{t('nightPremiumShort')} +{t('currencySymbol')}{Math.round(bundle.payroll.nightPremium).toLocaleString()}</Text>
                    )}
                    {bundle.payroll.overtimePremium > 0 && (
                      <Text style={[styles.premiumChip, {color: colors.textSecondary}]}>{t('overtimeShort')} +{t('currencySymbol')}{Math.round(bundle.payroll.overtimePremium).toLocaleString()}</Text>
                    )}
                    {bundle.payroll.holidayPremium > 0 && (
                      <Text style={[styles.premiumChip, {color: colors.textSecondary}]}>{t('holidayShort')} +{t('currencySymbol')}{Math.round(bundle.payroll.holidayPremium).toLocaleString()}</Text>
                    )}
                    {bundle.payroll.transport > 0 && (
                      <Text style={[styles.premiumChip, {color: colors.textSecondary}]}>{t('transportShort')} +{t('currencySymbol')}{Math.round(bundle.payroll.transport).toLocaleString()}</Text>
                    )}
                  </View>
                )}

                {bundle.payroll.byJob.map((entry, i) => {
                  const pct = entry.monthlyTarget && entry.monthlyTarget > 0
                    ? Math.min(1, entry.total / entry.monthlyTarget)
                    : null;
                  return (
                    <View key={`job-${i}`} style={styles.jobEarnBlock}>
                      <View style={styles.earningsRow}>
                        <View style={[styles.legendDot, {backgroundColor: entry.color}]} />
                        <Text style={[styles.earningsLabel, {color: colors.text}]} numberOfLines={1}>
                          {entry.jobId === null ? t('manualWage') : entry.name}
                        </Text>
                        <Text style={[styles.earningsTime, {color: colors.textSecondary}]}>
                          {formatDuration(entry.minutes, t)}
                        </Text>
                        <Text style={[styles.earningsAmount, {color: colors.text}]}>
                          {t('currencySymbol')}{Math.round(entry.total).toLocaleString()}
                        </Text>
                      </View>
                      {pct !== null && (
                        <View style={styles.targetWrap}>
                          <View style={styles.targetBarBg}>
                            <View style={[styles.targetBarFill, {width: `${pct * 100}%`, backgroundColor: entry.color}]} />
                          </View>
                          <Text style={[styles.targetText, {color: colors.textTertiary}]}>
                            {t('targetProgress', {pct: Math.round(pct * 100), target: `${t('currencySymbol')}${entry.monthlyTarget!.toLocaleString()}`})}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* 年収の壁 (income thresholds) */}
            {bundle.incomeWall.yearTotal > 0 && (
              <View style={styles.card}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="trending-up-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('statsIncomeWall', {year: bundle.incomeWall.year})}</Text>
                  <TouchableOpacity onPress={openThresholdEditor} style={styles.csvBtn} accessibilityLabel={t('editThresholds')}>
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.earningsTotalRow}>
                  <Text style={styles.earningsTotal}>
                    {t('currencySymbol')}{Math.round(bundle.incomeWall.yearTotal).toLocaleString()}
                  </Text>
                </View>
                <Text style={[styles.cardSub, {marginBottom: 10, textAlign: 'center'}]}>
                  {t('incomeWallYearTotal')}
                </Text>
                {bundle.incomeWall.nextWall && (
                  <Text style={[styles.cardSub, {marginBottom: 10, textAlign: 'center', color: colors.primary}]}>
                    {t('incomeWallNext', {amount: `${t('currencySymbol')}${bundle.incomeWall.nextWall.amount.toLocaleString()}`, remaining: `${t('currencySymbol')}${Math.round(bundle.incomeWall.nextWall.remaining).toLocaleString()}`})}
                  </Text>
                )}
                {bundle.incomeWall.thresholds.map((th, i) => {
                  const pct = Math.min(1, bundle.incomeWall.yearTotal / th.amount);
                  return (
                    <View key={`wall-${i}`} style={styles.wallRow}>
                      <Text style={[styles.wallLabel, {color: colors.text}]}>
                        {th.reached ? '⚠️ ' : ''}{t('currencySymbol')}{th.amount.toLocaleString()}
                      </Text>
                      <View style={styles.wallBarBg}>
                        <View style={[styles.wallBarFill, {width: `${pct * 100}%`, backgroundColor: th.reached ? '#FF3B30' : colors.primary}]} />
                      </View>
                      <Text style={[styles.wallPct, {color: colors.textSecondary}]}>{Math.round(pct * 100)}%</Text>
                    </View>
                  );
                })}
                <Text style={[styles.wallNote, {color: colors.textTertiary}]}>{t('incomeWallNote')}</Text>
              </View>
            )}

            {/* Category pie/bar */}
            {bundle.monthly.byCategory.length > 0 && (
              <View style={styles.card}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="pie-chart-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('statsCategoryBreakdown')}</Text>
                </View>
                <View style={styles.stackBar}>
                  {bundle.monthly.byCategory.map((c, i) => {
                    const ratio = bundle.monthly.totalMinutes > 0
                      ? c.minutes / bundle.monthly.totalMinutes
                      : 0;
                    if (ratio <= 0) return null;
                    return (
                      <View
                        key={`bar-${i}`}
                        style={{
                          flex: ratio,
                          backgroundColor: c.color,
                        }}
                      />
                    );
                  })}
                </View>
                <View style={styles.legendList}>
                  {bundle.monthly.byCategory.map((c, i) => {
                    const pct = bundle.monthly.totalMinutes > 0
                      ? Math.round((c.minutes / bundle.monthly.totalMinutes) * 100)
                      : 0;
                    return (
                      <View key={`legend-${i}`} style={styles.legendRow}>
                        <View style={[styles.legendDot, {backgroundColor: c.color}]} />
                        <Text style={styles.legendLabel}>{t(c.labelKey)}</Text>
                        <Text style={styles.legendValue}>
                          {formatDuration(c.minutes, t)} ({pct}%)
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Task stats */}
            <View style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="checkmark-done-outline" size={16} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t('statsTaskTitle')}</Text>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryNumber}>
                    {Math.round(bundle.tasks.completionRate * 100)}%
                  </Text>
                  <Text style={styles.summaryLabel}>{t('statsCompletionRate')}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryNumber}>
                    {bundle.tasks.completed}/{bundle.tasks.total}
                  </Text>
                  <Text style={styles.summaryLabel}>{t('statsTaskCount')}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryNumber}>
                    {bundle.tasks.streakDays}
                  </Text>
                  <Text style={styles.summaryLabel}>🔥 {t('statsStreak')}</Text>
                </View>
              </View>

              {bundle.tasks.total > 0 && (
                <>
                  <Text style={[styles.cardSub, {marginTop: 12}]}>
                    {t('statsCompletionByWeekday')}
                  </Text>
                  <View style={styles.weekdayRow}>
                    {bundle.tasks.byWeekday.map(w => (
                      <View key={`twd-${w.weekday}`} style={styles.weekdayCell}>
                        <View style={styles.weekdayBarBg}>
                          <View
                            style={[
                              styles.weekdayBarFill,
                              {
                                height: `${Math.max(2, w.rate * 100)}%`,
                                backgroundColor: colors.primary,
                                opacity: w.total > 0 ? 1 : 0.2,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.weekdayLabel}>{weekdayLabels[w.weekday]}</Text>
                        <Text style={styles.weekdayPct}>
                          {w.total > 0 ? `${Math.round(w.rate * 100)}%` : '–'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>

            {/* Top titles */}
            {bundle.monthly.topTitles.length > 0 && (
              <View style={styles.card}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="trophy-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('statsTopTitles')}</Text>
                </View>
                {bundle.monthly.topTitles.map((it, i) => (
                  <View key={`tt-${i}`} style={styles.rankRow}>
                    <Text style={styles.rankBadge}>{i + 1}</Text>
                    <View style={[styles.legendDot, {backgroundColor: it.color, marginRight: 8}]} />
                    <Text style={[styles.rankLabel, {flex: 1}]} numberOfLines={1}>
                      {it.title}
                    </Text>
                    <Text style={styles.rankValue}>
                      ×{it.count} · {formatDuration(it.totalMinutes, t)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Busiest weekdays */}
            {bundle.monthly.busiestWeekdays.length > 0 && (
              <View style={styles.card}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="flame-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('statsBusiestDays')}</Text>
                </View>
                {bundle.monthly.busiestWeekdays.map((w, i) => {
                  const max = bundle.monthly.busiestWeekdays[0].minutes || 1;
                  const ratio = w.minutes / max;
                  return (
                    <View key={`bw-${i}`} style={styles.rankRow}>
                      <Text style={styles.rankBadge}>{i + 1}</Text>
                      <Text style={styles.rankLabel}>{weekdayLabels[w.weekday]}</Text>
                      <View style={styles.rankBarTrack}>
                        <View
                          style={[
                            styles.rankBarFill,
                            {width: `${ratio * 100}%`, backgroundColor: colors.primary},
                          ]}
                        />
                      </View>
                      <Text style={styles.rankValue}>{formatDuration(w.minutes, t)}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Heatmap */}
            {bundle.monthly.totalMinutes > 0 && (
              <View style={styles.card}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="grid-outline" size={16} color={colors.primary} />
                  <Text style={styles.sectionTitle}>{t('statsHeatmap')}</Text>
                </View>
                <Text style={styles.cardSub}>{t('statsHeatmapHint')}</Text>
                <Heatmap
                  matrix={bundle.monthly.heatmap}
                  weekdayLabels={weekdayLabels}
                  isDark={isDark}
                  primary={colors.primary}
                  textTertiary={colors.textTertiary}
                />
              </View>
            )}

            {bundle.monthly.totalEvents === 0 && bundle.tasks.total === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>{t('statsEmpty')}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} />

      {/* 年収の壁 threshold editor */}
      <Modal visible={showThresholdEditor} animationType="fade" transparent onRequestClose={() => setShowThresholdEditor(false)}>
        <View style={styles.editorOverlay}>
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>{t('editThresholds')}</Text>
            <Text style={styles.editorNote}>{t('incomeWallNote')}</Text>
            <ScrollView style={{maxHeight: 280}}>
              {thresholdDrafts.map((v, i) => (
                <View key={`th-${i}`} style={styles.editorRow}>
                  <Text style={styles.editorCurrency}>{t('currencySymbol')}</Text>
                  <TextInput
                    style={styles.editorInput}
                    value={v}
                    onChangeText={(txt) => setThresholdDrafts(prev => prev.map((x, idx) => idx === i ? txt.replace(/[^0-9]/g, '') : x))}
                    keyboardType="numeric"
                    placeholder="1030000"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                  />
                  <TouchableOpacity onPress={() => setThresholdDrafts(prev => prev.filter((_, idx) => idx !== i))}>
                    <Ionicons name="remove-circle-outline" size={22} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.editorAddRow} onPress={() => setThresholdDrafts(prev => [...prev, ''])}>
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={{color: colors.primary, fontSize: 14}}>{t('addThreshold')}</Text>
            </TouchableOpacity>
            <View style={styles.editorBtnRow}>
              <TouchableOpacity style={styles.editorBtn} onPress={() => setShowThresholdEditor(false)}>
                <Text style={{color: colors.textSecondary, fontSize: 15}}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editorBtn, {backgroundColor: colors.primary, borderRadius: 8}]} onPress={saveThresholds}>
                <Text style={{color: '#fff', fontSize: 15, fontWeight: '700'}}>{t('save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

interface HeatmapProps {
  matrix: number[][];
  weekdayLabels: string[];
  isDark: boolean;
  primary: string;
  textTertiary: string;
}

const Heatmap: React.FC<HeatmapProps> = ({matrix, weekdayLabels, isDark, primary, textTertiary}) => {
  let max = 0;
  for (const row of matrix) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  const cellW = (SCREEN_WIDTH - 32 - 24 - 24) / 24;
  const cellH = 14;

  const intensityColor = (v: number) => {
    if (v <= 0) return isDark ? '#2c2c2e' : '#f0f0f0';
    const ratio = max > 0 ? v / max : 0;
    const opacity = 0.15 + ratio * 0.85;
    // Use rgba based on primary tint
    const tint = primary;
    if (tint.startsWith('#') && tint.length === 7) {
      const r = parseInt(tint.slice(1, 3), 16);
      const g = parseInt(tint.slice(3, 5), 16);
      const b = parseInt(tint.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(2)})`;
    }
    return primary;
  };

  return (
    <View style={{marginTop: 12}}>
      {/* Hour markers */}
      <View style={{flexDirection: 'row', marginLeft: 24, marginBottom: 4}}>
        {[0, 6, 12, 18].map(h => (
          <Text
            key={`hm-${h}`}
            style={{
              width: cellW * 6,
              fontSize: 9,
              color: textTertiary,
            }}>
            {h.toString().padStart(2, '0')}
          </Text>
        ))}
      </View>
      {matrix.map((row, dayIdx) => (
        <View key={`hr-${dayIdx}`} style={{flexDirection: 'row', alignItems: 'center', marginBottom: 2}}>
          <Text style={{width: 24, fontSize: 10, color: textTertiary}}>
            {weekdayLabels[dayIdx]}
          </Text>
          {row.map((v, hourIdx) => (
            <View
              key={`c-${dayIdx}-${hourIdx}`}
              style={{
                width: cellW - 1,
                height: cellH,
                marginRight: 1,
                borderRadius: 2,
                backgroundColor: intensityColor(v),
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    headerDone: {
      fontSize: 17,
      color: colors.primary,
      fontWeight: '600',
      width: 80,
      textAlign: 'right',
    },
    monthSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    monthArrowBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    monthLabel: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
      minWidth: 140,
      textAlign: 'center',
    },
    loadingBox: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    loadingText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    scroll: {
      flex: 1,
    },
    card: {
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginTop: 16,
      borderRadius: 14,
      padding: 16,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    cardSub: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    summaryCell: {
      alignItems: 'center',
      flex: 1,
    },
    summaryNumber: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.primary,
    },
    summaryLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 4,
      textAlign: 'center',
    },
    chronoTypeRow: {
      marginTop: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
      alignItems: 'center',
    },
    chronoText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    earningsTotalRow: {
      alignItems: 'center',
      marginTop: 4,
    },
    earningsTotal: {
      fontSize: 32,
      fontWeight: '700',
      color: colors.primary,
    },
    earningsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      gap: 8,
    },
    earningsLabel: {
      fontSize: 13,
      flex: 1,
    },
    earningsTime: {
      fontSize: 11,
    },
    earningsAmount: {
      fontSize: 14,
      fontWeight: '600',
      minWidth: 70,
      textAlign: 'right',
    },
    csvBtn: {
      marginLeft: 'auto',
      padding: 4,
    },
    premiumLine: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
      marginBottom: 8,
    },
    premiumChip: {
      fontSize: 11,
      fontWeight: '600',
    },
    jobEarnBlock: {
      marginBottom: 2,
    },
    targetWrap: {
      paddingLeft: 16,
      paddingBottom: 6,
    },
    targetBarBg: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.inputBackground,
      overflow: 'hidden',
    },
    targetBarFill: {
      height: 6,
      borderRadius: 3,
    },
    targetText: {
      fontSize: 10,
      marginTop: 3,
    },
    wallRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 5,
    },
    wallLabel: {
      fontSize: 12,
      fontWeight: '600',
      width: 90,
    },
    wallBarBg: {
      flex: 1,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.inputBackground,
      overflow: 'hidden',
    },
    wallBarFill: {
      height: 8,
      borderRadius: 4,
    },
    wallPct: {
      fontSize: 11,
      width: 38,
      textAlign: 'right',
    },
    wallNote: {
      fontSize: 10,
      marginTop: 8,
      textAlign: 'center',
    },
    editorOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: 24,
    },
    editorCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
    },
    editorTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    editorNote: {
      fontSize: 11,
      color: colors.textTertiary,
      marginBottom: 12,
    },
    editorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    editorCurrency: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    editorInput: {
      flex: 1,
      height: 42,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.inputBackground,
      fontVariant: ['tabular-nums'],
    },
    editorAddRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 8,
    },
    editorBtnRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 8,
    },
    editorBtn: {
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    stackBar: {
      flexDirection: 'row',
      height: 22,
      borderRadius: 6,
      overflow: 'hidden',
      backgroundColor: colors.borderLight,
    },
    legendList: {
      marginTop: 12,
      gap: 8,
    },
    legendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    legendDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    legendLabel: {
      fontSize: 13,
      color: colors.text,
      flex: 1,
    },
    legendValue: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    rankRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 10,
    },
    rankBadge: {
      width: 22,
      textAlign: 'center',
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    rankLabel: {
      fontSize: 14,
      color: colors.text,
      width: 36,
    },
    rankBarTrack: {
      flex: 1,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.borderLight,
      overflow: 'hidden',
    },
    rankBarFill: {
      height: '100%',
      borderRadius: 4,
    },
    rankValue: {
      fontSize: 12,
      color: colors.textSecondary,
      minWidth: 70,
      textAlign: 'right',
    },
    weekdayRow: {
      flexDirection: 'row',
      marginTop: 10,
      height: 80,
      alignItems: 'flex-end',
      justifyContent: 'space-around',
    },
    weekdayCell: {
      flex: 1,
      alignItems: 'center',
      height: '100%',
      justifyContent: 'flex-end',
    },
    weekdayBarBg: {
      width: 16,
      flex: 1,
      backgroundColor: colors.borderLight,
      borderRadius: 4,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    weekdayBarFill: {
      width: '100%',
      borderRadius: 4,
    },
    weekdayLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 4,
    },
    weekdayPct: {
      fontSize: 10,
      color: colors.textTertiary,
    },
    emptyBox: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
    },
  });

export default StatsScreen;
