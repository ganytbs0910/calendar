// ── Settings tab — launcher for app-level actions & settings ────────────────
//
// Hosts what used to live in the header "・・・" overflow menu (share, poll,
// detailed settings) plus display toggles, so the top bar stays clean and the
// bottom Settings tab is the single home for configuration.

import React from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import DeviceInfo from 'react-native-device-info';

import {useTheme} from '../theme/ThemeContext';

interface RowProps {
  icon: string;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  colors: any;
  tint?: string;
  isLast?: boolean;
}

const Row: React.FC<RowProps> = ({icon, label, sublabel, onPress, right, colors, tint, isLast}) => (
  <TouchableOpacity
    activeOpacity={onPress ? 0.6 : 1}
    onPress={onPress}
    style={[styles.row, {borderBottomColor: colors.borderLight, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth}]}>
    <View style={[styles.rowIcon, {backgroundColor: (tint ?? colors.primary) + '1A'}]}>
      <Ionicons name={icon as any} size={18} color={tint ?? colors.primary} />
    </View>
    <View style={{flex: 1}}>
      <Text style={[styles.rowLabel, {color: colors.text}]}>{label}</Text>
      {sublabel ? <Text style={[styles.rowSub, {color: colors.textTertiary}]}>{sublabel}</Text> : null}
    </View>
    {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null)}
  </TouchableOpacity>
);

interface Props {
  onOpenShareAvail: () => void;
  onOpenPoll: () => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  onOpenIncomeWall: () => void;
  onOpenJobs: () => void;
}

const SettingsLauncherScreen: React.FC<Props> = ({
  onOpenShareAvail,
  onOpenPoll,
  onOpenSettings,
  onOpenStats,
  onOpenIncomeWall,
  onOpenJobs,
}) => {
  const {colors} = useTheme();
  let version = '';
  try {
    version = DeviceInfo.getVersion();
  } catch {
    version = '';
  }

  const Section: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>{title}</Text>
      <View style={[styles.card, {backgroundColor: colors.surface, borderColor: colors.border}]}>{children}</View>
    </View>
  );

  return (
    <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={styles.content}>
      <Text style={[styles.screenTitle, {color: colors.text}]}>設定</Text>

      <Section title="共有・調整">
        <Row
          colors={colors}
          icon="share-social-outline"
          tint="#34C759"
          label="空き日を共有"
          sublabel="今月の空いてる日を画像でLINEに送る"
          onPress={onOpenShareAvail}
        />
        <Row
          colors={colors}
          icon="people-outline"
          tint="#FF9500"
          label="日程調整（みんなで決める）"
          sublabel="候補日を出して行ける日をまとめる"
          onPress={onOpenPoll}
          isLast
        />
      </Section>

      <Section title="バイト・給料">
        <Row
          colors={colors}
          icon="cash-outline"
          tint="#FF2D92"
          label="バイト先・時給の設定"
          sublabel="シフトの自動給料計算に使います"
          onPress={onOpenJobs}
        />
        <Row
          colors={colors}
          icon="stats-chart-outline"
          tint="#007AFF"
          label="統計"
          sublabel="月の労働時間・給料・活動サマリー"
          onPress={onOpenStats}
        />
        <Row
          colors={colors}
          icon="trending-up-outline"
          tint="#FF3B30"
          label="年収の壁"
          sublabel="今年の収入と壁までの残りを確認"
          onPress={onOpenIncomeWall}
          isLast
        />
      </Section>

      <Section title="アプリ設定">
        <Row
          colors={colors}
          icon="settings-outline"
          tint={colors.textSecondary}
          label="詳細設定"
          sublabel="テーマ・ロック・通知・睡眠・データ管理など"
          onPress={onOpenSettings}
          isLast
        />
      </Section>

      <Text style={[styles.footer, {color: colors.textTertiary}]}>
        {version ? `バージョン ${version}` : ''}
      </Text>
      <View style={{height: 40}} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {padding: 16},
  screenTitle: {fontSize: 24, fontWeight: '800', marginBottom: 16},
  section: {marginBottom: 22},
  sectionTitle: {fontSize: 12, fontWeight: '700', marginBottom: 8, marginLeft: 4},
  card: {borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13},
  rowIcon: {width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  rowLabel: {fontSize: 15, fontWeight: '600'},
  rowSub: {fontSize: 11, marginTop: 2},
  footer: {fontSize: 12, textAlign: 'center', marginTop: 4},
});

export default SettingsLauncherScreen;
