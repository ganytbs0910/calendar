// ── 年収の壁ナビ — the Stats tab's headline card ────────────────────────────
//
// Always-visible "how close am I to the next 年収の壁" view for part-timers.
// Reuses incomeWallService (which reuses the canonical payroll computation), so
// the number matches the detailed Stats screen. Zero network.

import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import {useTheme} from '../theme/ThemeContext';
import {getWallStatus, wallLabel, WallStatus} from '../services/incomeWallService';

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

interface Props {
  onOpenStats: () => void;
}

const IncomeWallScreen: React.FC<Props> = ({onOpenStats}) => {
  const {colors} = useTheme();
  const [status, setStatus] = useState<WallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const st = await getWallStatus();
    setStatus(st);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const s = makeStyles(colors);

  if (loading) {
    return (
      <View style={[s.center, {backgroundColor: colors.background}]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const next = status?.nextWall ?? null;
  const total = status?.yearTotal ?? 0;
  // progress toward the next wall, measured from the previous wall.
  const prevWallAmount =
    next && status
      ? [...status.thresholds].filter(t => t.amount < next.amount).pop()?.amount ?? 0
      : 0;
  const segSpan = next ? next.amount - prevWallAmount : 1;
  const segProg = next ? Math.min(1, Math.max(0, (total - prevWallAmount) / segSpan)) : 1;

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: colors.background}}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <View style={s.heroRow}>
        <Ionicons name="trending-up" size={20} color={colors.primary} />
        <Text style={[s.heroTitle, {color: colors.text}]}>年収の壁</Text>
        <Text style={[s.heroYear, {color: colors.textTertiary}]}>{status?.year}年</Text>
      </View>

      {total <= 0 ? (
        <View style={[s.empty, {backgroundColor: colors.surface, borderColor: colors.border}]}>
          <Ionicons name="cash-outline" size={28} color={colors.textTertiary} />
          <Text style={[s.emptyText, {color: colors.textSecondary}]}>
            バイトの予定に給料（時給かバイト先）を設定すると、ここに今年の収入と「壁」までの残りが表示されます。
          </Text>
        </View>
      ) : (
        <>
          {/* Headline */}
          <View style={[s.card, {backgroundColor: colors.surface, borderColor: colors.border}]}>
            <Text style={[s.cardCaption, {color: colors.textSecondary}]}>今年の収入</Text>
            <Text style={[s.bigNumber, {color: colors.text}]}>{yen(total)}</Text>
            {next ? (
              <>
                <Text style={[s.nextLine, {color: colors.text}]}>
                  <Text style={{color: colors.primary, fontWeight: '800'}}>{wallLabel(next.amount)}円の壁</Text>
                  {' まで あと '}
                  <Text style={{color: colors.error, fontWeight: '800'}}>{yen(next.remaining)}</Text>
                </Text>
                <View style={[s.bigBar, {backgroundColor: colors.border}]}>
                  <View style={[s.bigFill, {width: `${segProg * 100}%`, backgroundColor: segProg > 0.85 ? colors.error : colors.primary}]} />
                </View>
                <Text style={[s.subtle, {color: colors.textTertiary}]}>
                  {wallLabel(prevWallAmount || 0)}{prevWallAmount ? '円' : ''} → {wallLabel(next.amount)}円
                </Text>
              </>
            ) : (
              <Text style={[s.nextLine, {color: colors.textSecondary}]}>すべての壁を超えています</Text>
            )}
          </View>

          {/* All walls */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, {color: colors.text}]}>壁の一覧</Text>
            {status?.thresholds.map(th => {
              const prog = Math.min(1, total / th.amount);
              return (
                <View key={th.amount} style={[s.wallRow, {backgroundColor: colors.surface, borderColor: colors.border}]}>
                  <View style={s.wallHead}>
                    <Text style={[s.wallName, {color: colors.text}]}>
                      {wallLabel(th.amount)}円の壁
                    </Text>
                    {th.reached ? (
                      <View style={s.reachedTag}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.error} />
                        <Text style={[s.reachedText, {color: colors.error}]}>超過</Text>
                      </View>
                    ) : (
                      <Text style={[s.remainText, {color: colors.textSecondary}]}>あと {yen(th.remaining)}</Text>
                    )}
                  </View>
                  <View style={[s.bar, {backgroundColor: colors.border}]}>
                    <View style={[s.fill, {width: `${prog * 100}%`, backgroundColor: th.reached ? colors.error : colors.primary}]} />
                  </View>
                </View>
              );
            })}
            <Text style={[s.note, {color: colors.textTertiary}]}>
              ※壁の金額は統計画面で変更できます（2025/2026の制度変更に対応）
            </Text>
          </View>
        </>
      )}

      <TouchableOpacity style={[s.statsBtn, {borderColor: colors.primary}]} onPress={onOpenStats}>
        <Ionicons name="stats-chart" size={16} color={colors.primary} />
        <Text style={[s.statsBtnText, {color: colors.primary}]}>詳しい統計・給料を見る</Text>
      </TouchableOpacity>

      <View style={{height: 40}} />
    </ScrollView>
  );
};

const makeStyles = (colors: any) =>
  StyleSheet.create({
    center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    content: {padding: 16},
    heroRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16},
    heroTitle: {fontSize: 22, fontWeight: '800'},
    heroYear: {fontSize: 14, marginLeft: 'auto'},
    empty: {borderWidth: 1, borderRadius: 14, padding: 24, alignItems: 'center', gap: 12},
    emptyText: {fontSize: 13, textAlign: 'center', lineHeight: 20},
    card: {borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 22},
    cardCaption: {fontSize: 12, fontWeight: '600'},
    bigNumber: {fontSize: 36, fontWeight: '800', marginTop: 4, marginBottom: 12},
    nextLine: {fontSize: 15, marginBottom: 10},
    bigBar: {height: 12, borderRadius: 6, overflow: 'hidden'},
    bigFill: {height: '100%', borderRadius: 6},
    subtle: {fontSize: 11, marginTop: 6},
    section: {marginBottom: 16},
    sectionTitle: {fontSize: 16, fontWeight: '700', marginBottom: 10},
    wallRow: {borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8},
    wallHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8},
    wallName: {fontSize: 14, fontWeight: '700'},
    reachedTag: {flexDirection: 'row', alignItems: 'center', gap: 3},
    reachedText: {fontSize: 12, fontWeight: '700'},
    remainText: {fontSize: 12, fontWeight: '600'},
    bar: {height: 8, borderRadius: 4, overflow: 'hidden'},
    fill: {height: '100%', borderRadius: 4},
    note: {fontSize: 11, marginTop: 4, lineHeight: 16},
    statsBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13},
    statsBtnText: {fontSize: 14, fontWeight: '700'},
  });

export default IncomeWallScreen;
