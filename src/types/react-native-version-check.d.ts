declare module 'react-native-version-check' {
  export interface NeedUpdateResult {
    isNeeded: boolean;
    currentVersion: string;
    latestVersion: string;
    storeUrl: string;
  }

  const VersionCheck: {
    getCountry(): Promise<string>;
    getPackageName(): string;
    getCurrentBuildNumber(): number;
    getCurrentVersion(): string;
    getStoreUrl(options?: {appID?: string; packageName?: string}): Promise<string>;
    getAppStoreUrl(options?: {appID?: string}): Promise<string>;
    getPlayStoreUrl(options?: {packageName?: string}): Promise<string>;
    getLatestVersion(options?: {
      provider?: 'appStore' | 'playStore';
      forceUpdate?: boolean;
      country?: string;
      packageName?: string;
    }): Promise<string>;
    needUpdate(options?: {
      depth?: number;
      currentVersion?: string;
      forceUpdate?: boolean;
      provider?: 'appStore' | 'playStore';
      country?: string;
      packageName?: string;
    }): Promise<NeedUpdateResult>;
  };

  export default VersionCheck;
}
