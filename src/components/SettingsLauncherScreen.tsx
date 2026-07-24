// ── Settings tab — launcher for app-level actions & settings ────────────────
//
// Hosts what used to live in the header "・・・" overflow menu (share, poll,
// detailed settings) plus display toggles, so the top bar stays clean and the
// bottom Settings tab is the single home for configuration.

import React from 'react';
import {Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import DeviceInfo from 'react-native-device-info';

import {useTheme} from '../theme/ThemeContext';
import {useTranslation} from 'react-i18next';
import {resetAllHints} from './OneTimeHint';

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
  const {t} = useTranslation();
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
      <Text style={[styles.screenTitle, {color: colors.text}]}>{t('settings')}</Text>

      <Section title={t('settingsSectionShare')}>
        <Row
          colors={colors}
          icon="share-social-outline"
          tint="#34C759"
          label={t('setShareLabel')}
          sublabel={t('setShareSub')}
          onPress={onOpenShareAvail}
        />
        <Row
          colors={colors}
          icon="people-outline"
          tint="#FF9500"
          label={t('setPollLabel')}
          sublabel={t('setPollSub')}
          onPress={onOpenPoll}
          isLast
        />
      </Section>

      <Section title={t('settingsSectionWork')}>
        <Row
          colors={colors}
          icon="cash-outline"
          tint="#FF2D92"
          label={t('setJobsLabel')}
          sublabel={t('setJobsSub')}
          onPress={onOpenJobs}
        />
        <Row
          colors={colors}
          icon="stats-chart-outline"
          tint="#007AFF"
          label={t('setStatsLabel')}
          sublabel={t('setStatsSub')}
          onPress={onOpenStats}
        />
        <Row
          colors={colors}
          icon="trending-up-outline"
          tint="#FF3B30"
          label={t('setIncomeWallLabel')}
          sublabel={t('setIncomeWallSub')}
          onPress={onOpenIncomeWall}
          isLast
        />
      </Section>

      <Section title={t('settingsSectionHelp')}>
        <Row
          colors={colors}
          icon="bulb-outline"
          tint="#FFCC00"
          label={t('setGuideLabel')}
          sublabel={t('setGuideSub')}
          onPress={() => {
            Alert.alert(
              t('setGuideAlertTitle'),
              t('setGuideAlertMsg'),
              [
                {text: t('cancel'), style: 'cancel'},
                {
                  text: t('setGuideConfirm'),
                  onPress: async () => {
                    await resetAllHints();
                    Alert.alert(t('setGuideDoneTitle'), t('setGuideDoneMsg'));
                  },
                },
              ],
            );
          }}
          isLast
        />
      </Section>

      <Section title={t('settingsSectionApp')}>
        <Row
          colors={colors}
          icon="settings-outline"
          tint={colors.textSecondary}
          label={t('setDetailLabel')}
          sublabel={t('setDetailSub')}
          onPress={onOpenSettings}
          isLast
        />
      </Section>

      <Text style={[styles.footer, {color: colors.textTertiary}]}>
        {version ? t('setVersion', {v: version}) : ''}
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

// Memoised: App re-renders on every tab switch, and without this each
// tab's whole subtree would re-render even while hidden.
export default React.memo(SettingsLauncherScreen);
