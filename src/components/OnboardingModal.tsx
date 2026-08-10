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

interface OnboardingModalProps {
  visible: boolean;
  onClose: () => void;
}

// First-run value demonstration. Leads with the wage/payroll differentiator
// (the "aha" moment research says drives trial conversion & retention).
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
    {icon: 'calendar-outline', color: '#007AFF', title: t('onbWelcomeTitle'), body: t('onbWelcomeBody')},
    {icon: 'color-palette-outline', color: '#34C759', title: t('onbColorTitle'), body: t('onbColorBody')},
    {icon: 'cash-outline', color: '#FF9500', title: t('onbWageTitle'), body: t('onbWageBody')},
    {icon: 'trending-up-outline', color: '#FF2D92', title: t('onbWallTitle'), body: t('onbWallBody')},
    {icon: 'notifications-outline', color: '#5856D6', title: t('onbNotifyTitle'), body: t('onbNotifyBody')},
  ];

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

  const isLast = page >= slides.length - 1;
  const next = async () => {
    if (isLast) {
      // Finishing onboarding is a natural moment to ask for notifications.
      try { await requestNotificationPermission(); } catch { /* ignore */ }
      onClose();
      return;
    }
    scrollRef.current?.scrollTo({x: (page + 1) * pagerWidth, animated: true});
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.skipRow}>
          <TouchableOpacity onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
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
        </ScrollView>
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, {backgroundColor: i === page ? colors.primary : colors.border}]} />
          ))}
        </View>
        <TouchableOpacity style={[styles.cta, {backgroundColor: colors.primary}]} onPress={next}>
          <Text style={styles.ctaText}>{isLast ? t('onbStart') : t('onbNext')}</Text>
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
});

export default OnboardingModal;
