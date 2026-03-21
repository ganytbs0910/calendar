import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Dimensions,
} from 'react-native';
import {useTheme} from '../theme/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface PaywallScreenProps {
  visible: boolean;
  onClose: () => void;
}

type PlanType = 'monthly' | 'yearly' | 'lifetime';

export const PaywallScreen: React.FC<PaywallScreenProps> = ({visible, onClose}) => {
  const {colors, isDark} = useTheme();
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('yearly');
  const [isPurchasing, setIsPurchasing] = useState(false);

  if (!visible) return null;

  const plans: {type: PlanType; title: string; price: string; sub: string; badge?: string}[] = [
    {type: 'monthly', title: '月額プラン', price: '¥400', sub: '/月'},
    {type: 'yearly', title: '年間プラン', price: '¥2,400', sub: '/年', badge: '¥2,400お得'},
    {type: 'lifetime', title: '買い切り', price: '¥8,000', sub: '一度きり', badge: 'リリース記念'},
  ];

  const handlePurchase = async () => {
    setIsPurchasing(true);
    // TODO: react-native-purchases (RevenueCat) or react-native-iap integration
    setTimeout(() => {
      setIsPurchasing(false);
      Alert.alert('ありがとうございます', 'プレミアムプランが有効になりました！', [
        {text: 'OK', onPress: onClose},
      ]);
    }, 1500);
  };

  const handleRestore = async () => {
    Alert.alert('復元', '以前の購入を復元しています...', [
      {text: 'OK'},
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: isDark ? '#000' : '#fff'}]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={{fontSize: 16, color: colors.textSecondary}}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, {color: colors.text}]}>プレミアムにアップグレード</Text>
        <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
          すべての機能を制限なくお使いいただけます
        </Text>

        <View style={styles.features}>
          {['予定の無制限作成', 'カスタムカラー', '繰り返し予定', 'ウィジェット対応', '広告なし'].map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={{fontSize: 16, color: colors.primary}}>✓</Text>
              <Text style={[styles.featureText, {color: colors.text}]}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plans}>
          {plans.map(plan => (
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
                <Text style={[styles.planPrice, {color: colors.text}]}>{plan.price}</Text>
                <Text style={[styles.planSub, {color: colors.textSecondary}]}>{plan.sub}</Text>
              </View>
              {selectedPlan === plan.type && (
                <View style={[styles.selectedIndicator, {backgroundColor: colors.primary}]}>
                  <Text style={{color: '#fff', fontSize: 12, fontWeight: '700'}}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.purchaseBtn, {backgroundColor: colors.primary, opacity: isPurchasing ? 0.6 : 1}]}
          onPress={handlePurchase}
          disabled={isPurchasing}>
          <Text style={styles.purchaseBtnText}>
            {isPurchasing ? '処理中...' : 'プレミアムを開始'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn}>
          <Text style={[styles.restoreText, {color: colors.textTertiary}]}>購入を復元</Text>
        </TouchableOpacity>

        <Text style={[styles.legal, {color: colors.textTertiary}]}>
          サブスクリプションは自動更新されます。いつでもキャンセル可能です。
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
