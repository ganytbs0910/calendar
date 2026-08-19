// Native modules that components pull in transitively. Mocking them here rather
// than in each test file keeps a suite from failing merely because something
// three imports down touched storage or an icon font.
//
// Individual tests can still override any of these with their own jest.mock.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-vector-icons/Ionicons', () => 'Ionicons');

// useSafeAreaInsets throws outright without a provider above it ("No safe area
// value available"), so any component that respects the notch would be
// untestable unless every test remembered to wrap itself. The numbers are a
// notched iPhone's, which is the case worth rendering against — a zero inset
// would let a regression under the status bar pass.
jest.mock('react-native-safe-area-context', () => {
  const insets = {top: 59, right: 0, bottom: 34, left: 0};
  const frame = {x: 0, y: 0, width: 440, height: 956};
  return {
    __esModule: true,
    SafeAreaProvider: ({children}) => children,
    SafeAreaView: ({children}) => children,
    SafeAreaInsetsContext: {Consumer: ({children}) => children(insets)},
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: {insets, frame},
  };
});

// Load the real translations. Components read structured values out of i18n
// (t('weekdaysSingle', {returnObjects: true}) must come back as an array), so a
// stub t that echoes its key makes them fail in ways the app never would.
require('./src/i18n/i18n');

// react-native-fs builds a NativeEventEmitter as soon as it is imported, which
// throws without the native side. eventPhotoService imports it, and that reaches
// most of the calendar UI.
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/documents',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  stat: jest.fn().mockResolvedValue({size: 0}),
}));

// Same NativeEventEmitter-at-import problem as react-native-fs.
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getVersion: jest.fn(() => '2.8.0'),
    getBuildNumber: jest.fn(() => '14'),
    getBundleId: jest.fn(() => 'org.reactjs.native.example.CalendarAppGan'),
  },
  getVersion: jest.fn(() => '2.8.0'),
  getBuildNumber: jest.fn(() => '14'),
}));

// The ads SDK resolves a TurboModule at import time.
jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({initialize: jest.fn().mockResolvedValue([])}),
  BannerAd: 'BannerAd',
  BannerAdSize: {ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER'},
  TestIds: {BANNER: 'test-banner'},
  MaxAdContentRating: {G: 'G'},
}));

// Notifee throws at import when its native module is absent.
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    requestPermission: jest.fn().mockResolvedValue({authorizationStatus: 1}),
    // Reminder delivery is now permission-aware — the app falls back to the
    // calendar's own alarm when the OS has not authorised us — so the settings
    // read has to exist here or that branch is untestable.
    getNotificationSettings: jest.fn().mockResolvedValue({authorizationStatus: 1}),
    createChannel: jest.fn().mockResolvedValue('default'),
    createTriggerNotification: jest.fn().mockResolvedValue('id'),
    displayNotification: jest.fn().mockResolvedValue('id'),
    cancelNotification: jest.fn().mockResolvedValue(undefined),
    cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
    cancelTriggerNotification: jest.fn().mockResolvedValue(undefined),
    cancelTriggerNotifications: jest.fn().mockResolvedValue(undefined),
    getTriggerNotifications: jest.fn().mockResolvedValue([]),
    getTriggerNotificationIds: jest.fn().mockResolvedValue([]),
    onForegroundEvent: jest.fn(() => jest.fn()),
  },
  AndroidImportance: {HIGH: 4, DEFAULT: 3},
  TriggerType: {TIMESTAMP: 0},
  EventType: {PRESS: 1},
  AuthorizationStatus: {AUTHORIZED: 1, DENIED: 0},
}));

// react-native-iap reaches for a Nitro TurboModule at import time, so merely
// rendering a screen that links to the paywall blew up. Only iapService talks
// to it, and no test drives a purchase — a quiet stub is enough.
jest.mock('react-native-iap', () => ({
  initConnection: jest.fn().mockResolvedValue(true),
  endConnection: jest.fn().mockResolvedValue(undefined),
  fetchProducts: jest.fn().mockResolvedValue([]),
  requestPurchase: jest.fn().mockResolvedValue(undefined),
  finishTransaction: jest.fn().mockResolvedValue(undefined),
  getAvailablePurchases: jest.fn().mockResolvedValue([]),
  purchaseUpdatedListener: jest.fn(() => ({remove: jest.fn()})),
  purchaseErrorListener: jest.fn(() => ({remove: jest.fn()})),
}));
