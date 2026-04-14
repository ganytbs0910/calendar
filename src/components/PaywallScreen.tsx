import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Dimensions,
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
} from '../services/iapService';
import type {Subscription, Product} from 'react-native-iap';

const SCREEN_WIDTH = Dimensions.get('window').width;

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

export const PaywallScreen: React.FC<PaywallScreenProps> = ({visible, onClose}) => {
  const {colors, isDark} = useTheme();
  const {setPremium} = usePremium();
  const {t} = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('yearly');
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

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

      const {subscriptions: subs, products: prods} = await fetchProducts();
      if (mounted) {
        setSubscriptions(subs);
        setProducts(prods);
        setIsLoading(false);
      }

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

  const getPrice = useCallback((sku: string): string | null => {
    const sub = subscriptions.find(s => s.productId === sku);
    if (sub) return (sub as any).localizedPrice || (sub as any).price;
    const prod = products.find(p => p.productId === sku);
    if (prod) return prod.localizedPrice;
    return null;
  }, [subscriptions, products]);

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

  const plans: {type: PlanType; title: string; fallbackPrice: string; sub: string; badge?: string}[] = [
    {type: 'monthly', title: t('monthlyPlan'), fallbackPrice: '¥400', sub: t('perMonth')},
    {type: 'yearly', title: t('yearlyPlan'), fallbackPrice: '¥2,400', sub: t('perYear'), badge: t('yearlySaving')},
    {type: 'lifetime', title: t('lifetimePlan'), fallbackPrice: '¥8,000', sub: t('oneTime'), badge: t('launchSpecial')},
  ];

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: isDark ? '#000' : '#fff'}]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={{fontSize: 16, color: colors.textSecondary}}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, {color: colors.text}]}>{t('upgradeToPremium')}</Text>
        <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
          {t('premiumSubtitle')}
        </Text>

        <View style={styles.features}>
          {[
            t('featureNoAds'),
            t('featureCustomColors'),
            t('featureThemeSkins'),
            t('featureAppIcon'),
          ].map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={{fontSize: 16, color: colors.primary}}>✓</Text>
              <Text style={[styles.featureText, {color: colors.text}]}>{f}</Text>
            </View>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{marginVertical: 40}} />
        ) : (
          <View style={styles.plans}>
            {plans.map(plan => {
              const realPrice = getPrice(PLAN_TO_SKU[plan.type]);
              return (
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
                  {plan.badge && (
                    <View style={[styles.planBadge, {backgroundColor: colors.primary}]}>
                      <Text style={styles.planBadgeText}>{plan.badge}</Text>
                    </View>
                  )}
                  <Text style={[styles.planTitle, {color: colors.text}]}>{plan.title}</Text>
                  <View style={{flexDirection: 'row', alignItems: 'baseline'}}>
                    <Text style={[styles.planPrice, {color: colors.text}]}>
                      {realPrice || plan.fallbackPrice}
                    </Text>
                    <Text style={[styles.planSub, {color: colors.textSecondary}]}>{plan.sub}</Text>
                  </View>
                  {selectedPlan === plan.type && (
                    <View style={[styles.selectedIndicator, {backgroundColor: colors.primary}]}>
                      <Text style={{color: '#fff', fontSize: 12, fontWeight: '700'}}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

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

        <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} disabled={isPurchasing}>
          <Text style={[styles.restoreText, {color: colors.textTertiary}]}>{t('restorePurchase')}</Text>
        </TouchableOpacity>

        <Text style={[styles.legal, {color: colors.textTertiary}]}>
          {t('subscriptionNote')}
        </Text>
      </View>
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
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
