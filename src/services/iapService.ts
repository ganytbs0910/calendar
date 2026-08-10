import {
  initConnection,
  endConnection,
  fetchProducts as fetchStoreProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Purchase,
  type PurchaseError,
  type ProductSubscription,
  type AndroidSubscriptionOfferInput,
} from 'react-native-iap';

// Product IDs - must match App Store Connect
export const PRODUCT_IDS = {
  monthly: 'com.calendarapp.premium.monthly2',
  yearly: 'com.calendarapp.premium.yearly',
  lifetime: 'com.calendarapp.premium.lifetime',
};

const SUBSCRIPTION_IDS = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly];
const PRODUCT_IDS_LIST = [PRODUCT_IDS.lifetime];

// The first auto-renewable subscription of an app can only be submitted attached
// to a version, so the non-consumable shipped alone first. Now that the
// subscription group exists, the paywall asks the store for monthly/yearly again.
// This only makes them *eligible* to appear: the paywall still drops any plan the
// store returned no price for, so a subscription that is still "Waiting for
// Review" simply doesn't render. Restore accepts subscription IDs either way.
export const SUBSCRIPTIONS_ENABLED = true;

// What the paywall needs, flattened. Keeping the store's own shapes inside this
// module means a library upgrade doesn't reach into the UI — the last one
// renamed productId/localizedPrice to id/displayPrice.
export type IAPProduct = {
  id: string;
  displayPrice: string;
  title: string;
  description: string;
};

// Android needs an offer token to start a subscription purchase, and it is only
// available on the product the store returned. Hold on to the last fetch.
let cachedSubscriptions: ProductSubscription[] = [];

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

const toIAPProduct = (p: {
  id: string;
  displayPrice: string;
  title: string;
  description: string;
}): IAPProduct => ({
  id: p.id,
  displayPrice: p.displayPrice,
  title: p.title,
  description: p.description,
});

export const fetchProducts = async (): Promise<IAPProduct[]> => {
  try {
    // These two must NOT overlap. The iOS module keeps only the latest
    // SKProductsRequest (LatestPromiseKeeper) and rejects any in-flight one with
    // E_CANCELED, so running them in Promise.all silently dropped whichever
    // started first — the subscriptions — and left only the lifetime product.
    const subs = SUBSCRIPTIONS_ENABLED
      ? ((await fetchStoreProducts({
          skus: SUBSCRIPTION_IDS,
          type: 'subs',
        }).catch(() => [])) as ProductSubscription[] | null) ?? []
      : [];
    cachedSubscriptions = subs;

    const prods =
      (await fetchStoreProducts({skus: PRODUCT_IDS_LIST, type: 'in-app'}).catch(
        () => [],
      )) ?? [];

    return [...subs, ...prods].map(toIAPProduct);
  } catch {
    return [];
  }
};

export const buySubscription = async (sku: string): Promise<void> => {
  try {
    // Every offer of the plan is passed through; Google picks the one the user
    // is eligible for. An empty list means the product was never fetched, which
    // the store rejects rather than silently charging the wrong price.
    const offers: AndroidSubscriptionOfferInput[] = (
      cachedSubscriptions.find(s => s.id === sku)?.subscriptionOffers ?? []
    )
      .filter(offer => offer.offerTokenAndroid)
      .map(offer => ({sku, offerToken: offer.offerTokenAndroid as string}));

    await requestPurchase({
      type: 'subs',
      request: {
        apple: {sku},
        google: {skus: [sku], subscriptionOffers: offers},
      },
    });
  } catch (e) {
    // Surface the error to the caller so the UI can show an alert. The native
    // module sometimes rejects with strings, so normalize to Error.
    if (e instanceof Error) throw e;
    throw new Error(typeof e === 'string' ? e : 'Subscription request failed');
  }
};

export const buyProduct = async (sku: string): Promise<void> => {
  try {
    await requestPurchase({
      type: 'in-app',
      request: {apple: {sku}, google: {skus: [sku]}},
    });
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(typeof e === 'string' ? e : 'Purchase request failed');
  }
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
  onPurchaseSuccess: (purchase: Purchase) => void,
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
