/**
 * Checks whether the app on this device is older than what's published on the
 * App Store / Google Play. Used to surface an optional "update available"
 * prompt at app launch.
 *
 * We intentionally never throw to callers — network errors, unpublished apps,
 * or store API hiccups simply yield `{ updateAvailable: false }` so the prompt
 * is suppressed rather than masking a real launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import VersionCheck from 'react-native-version-check';

const DISMISSED_KEY = '@update_prompt_dismissed_version';
const LAST_CHECK_KEY = '@update_prompt_last_check_at';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

export type UpdateCheckResult = {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
  storeUrl?: string;
};

export const checkForUpdate = async (
  options: { force?: boolean } = {},
): Promise<UpdateCheckResult> => {
  try {
    if (!options.force) {
      const lastRaw = await AsyncStorage.getItem(LAST_CHECK_KEY);
      const last = lastRaw ? parseInt(lastRaw, 10) : 0;
      if (Number.isFinite(last) && Date.now() - last < CHECK_INTERVAL_MS) {
        return { updateAvailable: false };
      }
    }

    const result = await VersionCheck.needUpdate();
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    if (!result || !result.isNeeded) {
      return {
        updateAvailable: false,
        currentVersion: result?.currentVersion,
        latestVersion: result?.latestVersion,
      };
    }

    const dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
    if (dismissed && dismissed === result.latestVersion) {
      return {
        updateAvailable: false,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
      };
    }

    return {
      updateAvailable: true,
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      storeUrl: result.storeUrl,
    };
  } catch {
    return { updateAvailable: false };
  }
};

export const dismissUpdatePrompt = async (latestVersion?: string): Promise<void> => {
  if (!latestVersion) return;
  await AsyncStorage.setItem(DISMISSED_KEY, latestVersion);
};

export const openStore = async (storeUrl?: string): Promise<void> => {
  try {
    let url = storeUrl;
    if (!url) {
      url = await VersionCheck.getStoreUrl();
    }
    if (!url) return;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    }
  } catch {
    // Swallow — worst case the user closes the modal and updates manually.
  }
};

export const getPlatformLabel = (): string =>
  Platform.OS === 'ios' ? 'App Store' : 'Google Play';
