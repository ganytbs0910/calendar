import {Platform} from 'react-native';
import {
  initConnection,
  endConnection,
  getProducts,
  getSubscriptions,
  requestPurchase,
  requestSubscription,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type ProductPurchase,
  type SubscriptionPurchase,
  type PurchaseError,
  type Subscription,
  type Product,
} from 'react-native-iap';

// Product IDs - must match App Store Connect
export const PRODUCT_IDS = {
  monthly: 'com.calendarapp.premium.monthly2',
  yearly: 'com.calendarapp.premium.yearly',
  lifetime: 'com.calendarapp.premium.lifetime',
};

const SUBSCRIPTION_IDS = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly];
const PRODUCT_IDS_LIST = [PRODUCT_IDS.lifetime];

export type IAPProduct = {
  productId: string;
  localizedPrice: string;
  title: string;
  description: string;
};

let purchaseUpdateSubscription: ReturnType<typeof purchaseUpdatedListener> | null = null;
let purchaseErrorSubscription: ReturnType<typeof purchaseErrorListener> | null = null;

export const initIAP = async (): Promise<boolean> => {
  try {
    await initConnection();
    return true;
  } catch {
    return false;
  }
};

export const endIAP = () => {
  if (purchaseUpdateSubscription) {
    purchaseUpdateSubscription.remove();
    purchaseUpdateSubscription = null;
  }
  if (purchaseErrorSubscription) {
    purchaseErrorSubscription.remove();
    purchaseErrorSubscription = null;
  }
  endConnection().catch(() => {});
};

export const fetchProducts = async (): Promise<{
  subscriptions: Subscription[];
  products: Product[];
}> => {
  try {
    const [subs, prods] = await Promise.all([
      getSubscriptions({skus: SUBSCRIPTION_IDS}).catch(() => [] as Subscription[]),
      getProducts({skus: PRODUCT_IDS_LIST}).catch(() => [] as Product[]),
    ]);
    return {subscriptions: subs, products: prods};
  } catch {
    return {subscriptions: [], products: []};
  }
};

export const buySubscription = async (sku: string): Promise<void> => {
  if (Platform.OS === 'ios') {
    await requestSubscription({sku});
  } else {
    await requestSubscription({
      sku,
      subscriptionOffers: [{sku, offerToken: ''}],
    });
  }
};

export const buyProduct = async (sku: string): Promise<void> => {
  await requestPurchase({sku});
};

export const restorePurchases = async (): Promise<boolean> => {
  try {
    const purchases = await getAvailablePurchases();
    const hasPremium = purchases.some(p =>
      Object.values(PRODUCT_IDS).includes(p.productId),
    );
    // Finish all pending transactions
    for (const purchase of purchases) {
      await finishTransaction({purchase, isConsumable: false}).catch(() => {});
    }
    return hasPremium;
  } catch {
    return false;
  }
};

export const setupPurchaseListeners = (
  onPurchaseSuccess: (purchase: ProductPurchase | SubscriptionPurchase) => void,
  onPurchaseError: (error: PurchaseError) => void,
) => {
  // Remove existing listeners
  if (purchaseUpdateSubscription) purchaseUpdateSubscription.remove();
  if (purchaseErrorSubscription) purchaseErrorSubscription.remove();

  purchaseUpdateSubscription = purchaseUpdatedListener(async (purchase) => {
    // Finish the transaction
    await finishTransaction({purchase, isConsumable: false}).catch(() => {});
    onPurchaseSuccess(purchase);
  });

  purchaseErrorSubscription = purchaseErrorListener((error) => {
    onPurchaseError(error);
  });
};
