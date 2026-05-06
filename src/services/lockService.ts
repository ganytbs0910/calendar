import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage keys
const PIN_HASH_KEY = '@lock_pin_hash';
const PIN_SALT_KEY = '@lock_pin_salt';
const BIOMETRIC_ENABLED_KEY = '@lock_biometric_enabled';

// Lazy-load react-native-biometrics so the rest of the app still loads
// when the native module isn't installed yet (e.g. before pod install).
type BiometricsModule = any;
let biometricsInstance: BiometricsModule | null = null;
let biometricsLoadAttempted = false;

const getBiometrics = (): BiometricsModule | null => {
  if (biometricsLoadAttempted) return biometricsInstance;
  biometricsLoadAttempted = true;
  try {
    const ReactNativeBiometrics = require('react-native-biometrics').default;
    biometricsInstance = new ReactNativeBiometrics();
  } catch {
    biometricsInstance = null;
  }
  return biometricsInstance;
};

// ── PIN hashing ──────────────────────────────────────────────────────────────
// Pure-JS iterated hash. Not cryptographic-grade, but raises the cost of
// brute-forcing a 4-digit PIN well past what casual physical access permits.
const simpleHash = (input: string): string => {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

const hashPin = (pin: string, salt: string): string => {
  let result = pin + ':' + salt;
  for (let i = 0; i < 5000; i++) {
    result = simpleHash(result + ':' + i);
  }
  return result;
};

const generateSalt = (): string => {
  const a = Math.random().toString(36).slice(2);
  const b = Date.now().toString(36);
  return a + b;
};

// ── PIN management ───────────────────────────────────────────────────────────

export const isPinSet = async (): Promise<boolean> => {
  const hash = await AsyncStorage.getItem(PIN_HASH_KEY);
  return !!hash;
};

export const setupPin = async (pin: string): Promise<void> => {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be 4 digits');
  }
  const salt = generateSalt();
  const hash = hashPin(pin, salt);
  await AsyncStorage.setItem(PIN_SALT_KEY, salt);
  await AsyncStorage.setItem(PIN_HASH_KEY, hash);
};

export const verifyPin = async (pin: string): Promise<boolean> => {
  const [salt, expected] = await Promise.all([
    AsyncStorage.getItem(PIN_SALT_KEY),
    AsyncStorage.getItem(PIN_HASH_KEY),
  ]);
  if (!salt || !expected) return false;
  return hashPin(pin, salt) === expected;
};

export const clearLock = async (): Promise<void> => {
  await AsyncStorage.multiRemove([PIN_HASH_KEY, PIN_SALT_KEY, BIOMETRIC_ENABLED_KEY]);
};

// ── Biometric ────────────────────────────────────────────────────────────────

export interface BiometricCapability {
  available: boolean;
  type: 'FaceID' | 'TouchID' | 'Biometrics' | null;
}

export const getBiometricCapability = async (): Promise<BiometricCapability> => {
  const bio = getBiometrics();
  if (!bio) return {available: false, type: null};
  try {
    const {available, biometryType} = await bio.isSensorAvailable();
    if (!available) return {available: false, type: null};
    return {available: true, type: biometryType ?? 'Biometrics'};
  } catch {
    return {available: false, type: null};
  }
};

export const isBiometricEnabled = async (): Promise<boolean> => {
  const v = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
  return v === '1';
};

export const setBiometricEnabled = async (enabled: boolean): Promise<void> => {
  if (enabled) {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, '1');
  } else {
    await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
  }
};

export const authenticateBiometric = async (promptMessage: string): Promise<boolean> => {
  const bio = getBiometrics();
  if (!bio) return false;
  try {
    const {success} = await bio.simplePrompt({promptMessage, cancelButtonText: 'Cancel'});
    return success === true;
  } catch {
    return false;
  }
};
