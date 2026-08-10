import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {useTheme} from '../theme/ThemeContext';
import {usePremium} from '../context/PremiumContext';
import {useTranslation} from 'react-i18next';
import {
  PRODUCT_IDS,
  initIAP,
  endIAP,
  fetchProducts,
  buySubscription,
  buyProduct,
  restorePurchases,
  setupPurchaseListeners,
  SUBSCRIPTIONS_ENABLED,
  type IAPProduct,
} from '../services/iapService';
import {TERMS_URL, PRIVACY_URL, openLegalLink} from '../utils/legalLinks';

interface PaywallScreenProps {
  visible: boolean;
  onClose: () => void;
}

type PlanType = 'monthly' | 'yearly' | 'lifetime';

const PLAN_TO_SKU: Record<PlanType, string> = {
  monthly: PRODUCT_IDS.monthly,
  yearly: PRODUCT_IDS.yearly,
  lifetime: PRODUCT_IDS.lifetime,
};

const ALL_PLANS: {type: PlanType; titleKey: string; subKey: string; badgeKey?: string}[] = [
  {type: 'monthly', titleKey: 'monthlyPlan', subKey: 'perMonth'},
  {type: 'yearly', titleKey: 'yearlyPlan', subKey: 'perYear', badgeKey: 'yearlySaving'},
  {type: 'lifetime', titleKey: 'lifetime', subKey: 'oneTime', badgeKey: 'releaseSale'},
];

// While subscriptions are switched off the lifetime purchase is the whole
// offer — see SUBSCRIPTIONS_ENABLED.
const OFFERED_PLANS = ALL_PLANS.filter(
  plan => SUBSCRIPTIONS_ENABLED || plan.type === 'lifetime',
);

const DEFAULT_PLAN: PlanType = SUBSCRIPTIONS_ENABLED ? 'yearly' : 'lifetime';

// Debug-only placeholders. Keep in sync with App Store Connect pricing so the
// dev layout matches what ships.
const DEV_PREVIEW_PRICES: Record<PlanType, string> = {
  monthly: '¥400',
  yearly: '¥2,400',
  lifetime: '¥8,000',
};

export const PaywallScreen: React.FC<PaywallScreenProps> = ({visible, onClose}) => {
  const {colors} = useTheme();
  const {setPremium} = usePremium();
  const {t} = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState<PlanType>(DEFAULT_PLAN);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storeProducts, setStoreProducts] = useState<IAPProduct[]>([]);

  // Initialize IAP and fetch products
  useEffect(() => {
    if (!visible) return;

    let mounted = true;
    const init = async () => {
      setIsLoading(true);
      const connected = await initIAP();
      if (!connected || !mounted) {
        setIsLoading(false);
        return;
      }

      const fetched = await fetchProducts();
      if (!mounted) return;
      setStoreProducts(fetched);
      setIsLoading(false);

      // Listen for purchase events
      setupPurchaseListeners(
        (_purchase) => {
          if (mounted) {
            setIsPurchasing(false);
            setPremium(true);
            Alert.alert(t('thankYou'), t('premiumActivated'), [
              {text: 'OK', onPress: onClose},
            ]);
          }
        },
        (_error) => {
          if (mounted) {
            setIsPurchasing(false);
          }
        },
      );
    };

    init();

    return () => {
      mounted = false;
      endIAP();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const getPrice = useCallback(
    (sku: string): string | null =>
      storeProducts.find(p => p.id === sku)?.displayPrice ?? null,
    [storeProducts],
  );

  // Only offer plans the store actually returned. A product that is not yet
  // approved (or not submitted) must never be referenced in the UI — App Review
  // rejects the build for it under Guideline 2.1(b).
  //
  // Debug builds fill in placeholder pricing instead, so the full three-plan
  // layout stays reviewable on a simulator with no StoreKit products. __DEV__
  // is false in Release, so App Review only ever sees live products.
  const availablePlans = useMemo(
    () =>
      OFFERED_PLANS.map(plan => ({
        ...plan,
        price: getPrice(PLAN_TO_SKU[plan.type]) ?? (__DEV__ ? DEV_PREVIEW_PRICES[plan.type] : null),
      })).filter(plan => plan.price !== null),
    [getPrice],
  );

  // Keep the selection pointing at a plan that is actually purchasable.
  useEffect(() => {
    if (isLoading || availablePlans.length === 0) return;
    if (!availablePlans.some(p => p.type === selectedPlan)) {
      setSelectedPlan(availablePlans[0].type);
    }
  }, [availablePlans, isLoading, selectedPlan]);

  const handlePurchase = async () => {
    const sku = PLAN_TO_SKU[selectedPlan];
    setIsPurchasing(true);
    try {
      if (selectedPlan === 'lifetime') {
        await buyProduct(sku);
      } else {
        await buySubscription(sku);
      }
      // Purchase result handled by listener
    } catch (_e) {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setIsPurchasing(true);
    try {
      const hasPremium = await restorePurchases();
      setIsPurchasing(false);
      if (hasPremium) {
        setPremium(true);
        Alert.alert(t('thankYou'), t('premiumActivated'), [
          {text: 'OK', onPress: onClose},
        ]);
      } else {
        Alert.alert(t('restore'), t('noPurchaseFound'));
      }
    } catch (_e) {
      setIsPurchasing(false);
      Alert.alert(t('error'), t('restoreFailed'));
    }
  };

  if (!visible) return null;

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: colors.background}]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={{fontSize: 16, color: colors.textSecondary}}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Guideline 4: on iPad the paywall can be laid out in a short container —
          landscape, Split View, an iPadOS 26 resized window, or the pageSheet
          that JobsManagerModal renders it inside. Centering without a scroll
          view clipped the legal links off the bottom, so the content scrolls. */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Text style={[styles.title, {color: colors.text}]}>{t('upgradeToPremium')}</Text>
          <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
            {t('premiumSubtitle')}
          </Text>

          <View style={styles.features}>
            {[
              t('featureMultipleJobs'),
              t('featureShiftPremiums'),
              t('featureIncomeWall'),
              t('featureExportCsv'),
              t('featureNoAds'),
              t('featureCustomColors'),
            ].map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <Text style={{fontSize: 16, color: colors.primary}}>✓</Text>
                <Text style={[styles.featureText, {color: colors.text}]}>{f}</Text>
              </View>
            ))}
          </View>

          {isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{marginVertical: 40}} />
          ) : availablePlans.length === 0 ? (
            <Text style={[styles.unavailable, {color: colors.textSecondary}]}>
              {t('plansUnavailable')}
            </Text>
          ) : (
            <View style={styles.plans}>
              {availablePlans.map(plan => (
                <TouchableOpacity
                  key={plan.type}
                  style={[
                    styles.planCard,
                    {
                      borderColor: selectedPlan === plan.type ? colors.primary : colors.border,
                      backgroundColor: selectedPlan === plan.type ? `${colors.primary}10` : colors.surface,
                    },
                  ]}
                  onPress={() => setSelectedPlan(plan.type)}>
                  {plan.badgeKey && (
                    <View style={[styles.planBadge, {backgroundColor: colors.primary}]}>
                      <Text style={styles.planBadgeText}>{t(plan.badgeKey)}</Text>
                    </View>
                  )}
                  <Text style={[styles.planTitle, {color: colors.text}]}>{t(plan.titleKey)}</Text>
                  <View style={{flexDirection: 'row', alignItems: 'baseline'}}>
                    <Text style={[styles.planPrice, {color: colors.text}]}>{plan.price}</Text>
                    <Text style={[styles.planSub, {color: colors.textSecondary}]}>{t(plan.subKey)}</Text>
                  </View>
                  {selectedPlan === plan.type && (
                    <View style={[styles.selectedIndicator, {backgroundColor: colors.primary}]}>
                      <Text style={{color: '#fff', fontSize: 12, fontWeight: '700'}}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {(isLoading || availablePlans.length > 0) && (
            <TouchableOpacity
              style={[styles.purchaseBtn, {backgroundColor: colors.primary, opacity: isPurchasing || isLoading ? 0.6 : 1}]}
              onPress={handlePurchase}
              disabled={isPurchasing || isLoading}>
              {isPurchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.purchaseBtnText}>{t('startPremium')}</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} disabled={isPurchasing}>
            <Text style={[styles.restoreText, {color: colors.textTertiary}]}>{t('restorePurchase')}</Text>
          </TouchableOpacity>

          {/* Keyed off the selected plan, not SUBSCRIPTIONS_ENABLED: the lifetime
              purchase does not auto-renew, so it must not carry the renewal note. */}
          <Text style={[styles.legal, {color: colors.textTertiary}]}>
            {t(selectedPlan === 'lifetime' ? 'lifetimeNote' : 'subscriptionNote')}
          </Text>

          {/* Guideline 3.1.2 requires functional Terms of Use (EULA) and Privacy
              Policy links on the screen that offers the purchase. */}
          <View style={styles.legalLinks}>
            <TouchableOpacity onPress={() => openLegalLink(TERMS_URL)}>
              <Text style={[styles.legalLink, {color: colors.textTertiary}]}>{t('termsOfUse')}</Text>
            </TouchableOpacity>
            <Text style={[styles.legalLink, {color: colors.textTertiary}]}>·</Text>
            <TouchableOpacity onPress={() => openLegalLink(PRIVACY_URL)}>
              <Text style={[styles.legalLink, {color: colors.textTertiary}]}>{t('privacyPolicy')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Centers the card while it fits and lets it scroll once it does not.
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  content: {
    width: '100%',
    // Keeps the plan cards and buttons a readable width on iPad instead of
    // stretching them across the whole sheet.
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  features: {
    marginBottom: 28,
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 20,
  },
  featureText: {
    fontSize: 15,
  },
  plans: {
    gap: 10,
    marginBottom: 20,
  },
  unavailable: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginVertical: 32,
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  legalLink: {
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  planCard: {
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  planBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderBottomLeftRadius: 10,
  },
  planBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  planTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  planPrice: {
    fontSize: 24,
    fontWeight: '800',
  },
  planSub: {
    fontSize: 13,
    marginLeft: 4,
  },
  selectedIndicator: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  purchaseBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  purchaseBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  restoreBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  restoreText: {
    fontSize: 13,
  },
  legal: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 14,
  },
});
