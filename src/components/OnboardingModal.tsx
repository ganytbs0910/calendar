import React, {useState, useRef, useMemo, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTheme} from '../theme/ThemeContext';
import {ThemeColors} from '../theme/colors';
import {requestNotificationPermission} from '../services/notificationService';
import {SleepSettings, getDefaultSettings} from '../services/sleepSettingsService';

interface OnboardingModalProps {
  visible: boolean;
  /**
   * Called once, when onboarding finishes. `settings` is the rhythm the user
   * committed to on the last page, or null if they skipped past it.
   */
  onClose: (settings: SleepSettings | null) => void;
}

// First-run value demonstration. Leads with the free-time proposition — the
// one thing this calendar does that the others don't, and the axis the rest of
// the app is arranged around. The wage/payroll features follow as what that
// free time is being traded for.
//
// The last page is the sleep-rhythm setup itself rather than another slide.
// It used to be a separate Modal raised at the same time as this one, and iOS
// silently dropped the second presentation: a new user reached the calendar
// having never seen it, so the number this whole app is named for stayed
// unset. Folding it in here means there is only ever one modal, and the user
// leaves onboarding with the headline figure already working.
const OnboardingModal: React.FC<OnboardingModalProps> = ({visible, onClose}) => {
  const {t} = useTranslation();
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  // Paging has to agree with the pager's real width. The window is resizable on
  // iPad, so measure the ScrollView instead of freezing a width at module load;
  // the window width is only the first-paint estimate.
  const {width: windowWidth} = useWindowDimensions();
  const [pagerWidth, setPagerWidth] = useState(windowWidth);

  const slides = [
    {icon: 'cafe-outline', color: '#007AFF', title: t('onbFreeTitle'), body: t('onbFreeBody')},
    {icon: 'color-palette-outline', color: '#34C759', title: t('onbColorTitle'), body: t('onbColorBody')},
    {icon: 'cash-outline', color: '#FF9500', title: t('onbWageTitle'), body: t('onbWageBody')},
    {icon: 'trending-up-outline', color: '#FF2D92', title: t('onbWallTitle'), body: t('onbWallBody')},
    {icon: 'notifications-outline', color: '#5856D6', title: t('onbNotifyTitle'), body: t('onbNotifyBody')},
  ];
  // One past the informational slides: the rhythm setup.
  const setupPage = slides.length;
  const pageCount = slides.length + 1;
  const [rhythm, setRhythm] = useState<SleepSettings>(getDefaultSettings());
  const adjust = (part: 'weekday', field: 'wake' | 'sleep', unit: 'hour' | 'minute', delta: number) => {
    setRhythm(prev => {
      const day = {...prev[part]};
      if (field === 'wake') {
        if (unit === 'hour') day.wakeUpHour = (day.wakeUpHour + delta + 24) % 24;
        else day.wakeUpMinute = (day.wakeUpMinute + delta + 60) % 60;
      } else {
        if (unit === 'hour') day.sleepHour = (day.sleepHour + delta + 25) % 25;
        else day.sleepMinute = (day.sleepMinute + delta + 60) % 60;
      }
      // The weekend row is left at its default; it is editable later in
      // Settings, and asking for two schedules here would undo the point of
      // folding this into onboarding.
      return {...prev, weekday: day};
    });
  };
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pagerWidth <= 0) return;
    const p = Math.round(e.nativeEvent.contentOffset.x / pagerWidth);
    if (p !== page) setPage(p);
  }, [page, pagerWidth]);

  // A resize leaves the offset pointing between slides — snap back to the
  // current one so the pager never rests on a seam.
  useEffect(() => {
    scrollRef.current?.scrollTo({x: page * pagerWidth, animated: false});
    // Only re-snap on width changes; paging itself already scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagerWidth]);

  const isSetup = page >= setupPage;
  const finish = async (settings: SleepSettings | null) => {
    // Finishing onboarding is a natural moment to ask for notifications.
    try { await requestNotificationPermission(); } catch { /* ignore */ }
    onClose(settings);
  };
  const next = async () => {
    if (isSetup) {
      await finish(rhythm);
      return;
    }
    scrollRef.current?.scrollTo({x: (page + 1) * pagerWidth, animated: true});
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => finish(null)}>
      <View style={styles.container}>
        <View style={styles.skipRow}>
          <TouchableOpacity
            onPress={() => finish(null)}
            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <Text style={styles.skip}>{t('onbSkip')}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          onLayout={e => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - pagerWidth) > 1) setPagerWidth(w);
          }}
          scrollEventThrottle={16}>
          {slides.map((s, i) => (
            <View key={i} style={[styles.slide, {width: pagerWidth}]}>
              <View style={[styles.iconCircle, {backgroundColor: s.color + '1A'}]}>
                <Ionicons name={s.icon} size={64} color={s.color} />
              </View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}

          {/* Last page: the rhythm itself, not another slide about it. */}
          <View style={[styles.slide, {width: pagerWidth}]}>
            <View style={[styles.iconCircle, {backgroundColor: '#007AFF1A'}]}>
              <Ionicons name="moon-outline" size={64} color="#007AFF" />
            </View>
            <Text style={styles.title}>{t('onbRhythmTitle')}</Text>
            <Text style={styles.body}>{t('onbRhythmBody')}</Text>

            {([
              {key: 'wake' as const, label: t('wakeUpTime'), h: rhythm.weekday.wakeUpHour, m: rhythm.weekday.wakeUpMinute},
              {key: 'sleep' as const, label: t('bedTime'), h: rhythm.weekday.sleepHour, m: rhythm.weekday.sleepMinute},
            ]).map(row => (
              <View key={row.key} style={styles.rhythmRow}>
                <Text style={styles.rhythmLabel}>{row.label}</Text>
                <View style={styles.rhythmControls}>
                  <TouchableOpacity
                    style={styles.rhythmBtn}
                    onPress={() => adjust('weekday', row.key, 'hour', -1)}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label} -1`}>
                    <Text style={styles.rhythmBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.rhythmValue}>{hhmm(row.h, row.m)}</Text>
                  <TouchableOpacity
                    style={styles.rhythmBtn}
                    onPress={() => adjust('weekday', row.key, 'hour', 1)}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label} +1`}>
                    <Text style={styles.rhythmBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.rhythmMinutes}>
                  <TouchableOpacity
                    onPress={() => adjust('weekday', row.key, 'minute', -30)}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                    <Text style={styles.rhythmMinuteText}>{t('minus30min')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => adjust('weekday', row.key, 'minute', 30)}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                    <Text style={styles.rhythmMinuteText}>{t('plus30min')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={styles.dots}>
          {Array.from({length: pageCount}, (_, i) => (
            <View key={i} style={[styles.dot, {backgroundColor: i === page ? colors.primary : colors.border}]} />
          ))}
        </View>
        <TouchableOpacity style={[styles.cta, {backgroundColor: colors.primary}]} onPress={next}>
          <Text style={styles.ctaText}>{isSetup ? t('onbRhythmCta') : t('onbNext')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background, paddingBottom: 40},
  skipRow: {alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 16, height: 48, justifyContent: 'center'},
  skip: {fontSize: 15, color: colors.textSecondary},
  slide: {alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 24},
  iconCircle: {width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center', marginBottom: 8},
  title: {fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center'},
  body: {fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22},
  dots: {flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 24},
  dot: {width: 8, height: 8, borderRadius: 4},
  cta: {marginHorizontal: 24, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  ctaText: {color: '#fff', fontSize: 17, fontWeight: '700'},
  rhythmRow: {width: '100%', alignItems: 'center', gap: 6},
  rhythmLabel: {fontSize: 14, fontWeight: '600', color: colors.textSecondary},
  rhythmControls: {flexDirection: 'row', alignItems: 'center', gap: 20},
  rhythmBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.today, alignItems: 'center', justifyContent: 'center',
  },
  rhythmBtnText: {fontSize: 22, fontWeight: '700', color: colors.primary},
  rhythmValue: {fontSize: 34, fontWeight: '800', color: colors.text, minWidth: 118, textAlign: 'center'},
  rhythmMinutes: {flexDirection: 'row', gap: 24},
  rhythmMinuteText: {fontSize: 13, color: colors.primary},
});

export default OnboardingModal;
