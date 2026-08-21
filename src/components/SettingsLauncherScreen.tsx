// ── Settings screen — launcher for app-level actions & settings ─────────────
//
// Hosts what used to live in the header "・・・" overflow menu (share, poll,
// detailed settings) plus display toggles, so the top bar stays clean and this
// screen is the single home for configuration.
//
// It used to be a bottom tab; settings is a low-frequency destination and did
// not earn a permanent slot, so it now opens from the calendar header's gear.
// It is deliberately still a plain View (not a Modal) — every row here opens a
// Modal, and on iOS a modal presented from a modal is silently swallowed.

import React, {useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import DeviceInfo from 'react-native-device-info';

import {useTheme} from '../theme/ThemeContext';
import {useTranslation} from 'react-i18next';
import {usePremium} from '../context/PremiumContext';
import {resetAllHints} from './OneTimeHint';
import {PaywallScreen} from './PaywallScreen';
import {TERMS_URL, PRIVACY_URL, openLegalLink} from '../utils/legalLinks';
import {ja as feedbackCopy, hasFeedbackCopy} from './feedbackCopy';

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
  onOpenIncomeWall: () => void;
  onOpenJobs: () => void;
  onOpenPhotos: () => void;
  onExportBackup: () => void;
  onOpenFeedback: () => void;
  /** Dismisses the screen. Omitted when it is hosted somewhere it can't close. */
  onClose?: () => void;
}

const SettingsLauncherScreen: React.FC<Props> = ({
  onOpenShareAvail,
  onOpenPoll,
  onOpenSettings,
  onOpenIncomeWall,
  onOpenJobs,
  onOpenPhotos,
  onExportBackup,
  onOpenFeedback,
  onClose,
}) => {
  const {colors} = useTheme();
  const {t, i18n} = useTranslation();
  // The feedback screen only has Japanese copy, so the entry point only appears
  // for Japanese devices — showing a Japanese-only form to a German user is
  // worse than not offering it. Drop this check once feedbackCopy.ts has more
  // languages.
  const showFeedback = hasFeedbackCopy(i18n.language);
  const {isPremium} = usePremium();
  const [showPaywall, setShowPaywall] = useState(false);
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
    <View style={styles.root}>
      <ScrollView style={{flex: 1, backgroundColor: colors.background}} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.screenTitle, {color: colors.text}]}>{t('settings')}</Text>
          {onClose && (
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}
              accessibilityRole="button"
              accessibilityLabel={t('close')}>
              <Ionicons name="close" size={26} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Guideline 3.1.2(c): the purchase is reachable from Settings, and the
            two legal links below sit on the same screen that leads to it. */}
        <Section title={t('settingsSectionPremium')}>
          {isPremium ? (
            <Row
              colors={colors}
              icon="checkmark-circle"
              tint="#34C759"
              label={t('premiumActive')}
              sublabel={t('unlimitedFeatures')}
              right={<Ionicons name="checkmark" size={18} color="#34C759" />}
              isLast
            />
          ) : (
            <Row
              colors={colors}
              icon="sparkles"
              tint="#AF52DE"
              label={t('upgradeToPremium')}
              sublabel={t('unlimitedFeatures')}
              onPress={() => setShowPaywall(true)}
              isLast
            />
          )}
        </Section>

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

        {/* Photos used to be a bottom tab. It is a real feature but sits off
            the app's core axis, so it lives here rather than holding a
            permanent slot next to the calendar. (My-calendars moved back out
            to a tab of its own once sharing became a headline feature — it now
            has exactly one entry point, like Stats.) */}
        <Section title={t('settingsSectionContent')}>
          <Row
            colors={colors}
            icon="images-outline"
            tint="#30B0C7"
            label={t('tabPhotos')}
            sublabel={t('setPhotosSub')}
            onPress={onOpenPhotos}
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
          {/* Stats lives on its own tab; a row here would be the third entry
              to the same screen. Only the income wall, which the tab hides,
              still needs a launcher. */}
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
            isLast={!showFeedback}
          />
          {showFeedback && (
            <Row
              colors={colors}
              icon="chatbubble-ellipses-outline"
              tint="#34C759"
              label={feedbackCopy.entryLabel}
              sublabel={feedbackCopy.entrySub}
              onPress={onOpenFeedback}
              isLast
            />
          )}
        </Section>

        <Section title={t('settingsSectionApp')}>
          <Row
            colors={colors}
            icon="archive-outline"
            tint="#5856D6"
            label={t('setBackupLabel')}
            sublabel={t('setBackupSub')}
            onPress={onExportBackup}
          />
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

        <Section title={t('settingsSectionLegal')}>
          <Row
            colors={colors}
            icon="document-text-outline"
            tint={colors.textSecondary}
            label={t('termsOfUse')}
            onPress={() => openLegalLink(TERMS_URL)}
            right={<Ionicons name="open-outline" size={16} color={colors.textTertiary} />}
          />
          <Row
            colors={colors}
            icon="lock-closed-outline"
            tint={colors.textSecondary}
            label={t('privacyPolicy')}
            onPress={() => openLegalLink(PRIVACY_URL)}
            right={<Ionicons name="open-outline" size={16} color={colors.textTertiary} />}
            isLast
          />
        </Section>

        <Text style={[styles.footer, {color: colors.textTertiary}]}>
          {version ? t('setVersion', {v: version}) : ''}
        </Text>
        <View style={{height: 40}} />
      </ScrollView>

      {/* Absolutely-positioned overlay rather than a Modal — the Settings tab
          already lives inside one on iOS, and stacking modals there swallows
          the presentation. Same pattern as StatsScreen. */}
      <PaywallScreen visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  // Positions the paywall overlay, which fills its parent absolutely.
  root: {flex: 1},
  content: {padding: 16},
  titleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
  screenTitle: {fontSize: 24, fontWeight: '800'},
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
