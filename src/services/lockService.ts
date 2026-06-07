import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage keys
const PIN_HASH_KEY = '@lock_pin_hash';
const PIN_SALT_KEY = '@lock_pin_salt';
const BIOMETRIC_ENABLED_KEY = '@lock_biometric_enabled';
const LOCK_EXPIRY_KEY = '@lock_expiry_at';

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
// The hash format is versioned ("v2:<iter>:<digest>") so we can upgrade
// parameters later and detect/migrate legacy hashes.
const HASH_VERSION = 'v2';
const HASH_ITERATIONS = 50000;

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

const iteratedHash = (pin: string, salt: string, iterations: number): string => {
  let result = pin + ':' + salt;
  for (let i = 0; i < iterations; i++) {
    result = simpleHash(result + ':' + i + ':' + salt);
  }
  return result;
};

const hashPinV2 = (pin: string, salt: string): string => {
  const digest = iteratedHash(pin, salt, HASH_ITERATIONS);
  return `${HASH_VERSION}:${HASH_ITERATIONS}:${digest}`;
};

// Recompute a stored hash so we can compare regardless of which format
// (legacy or v2) was originally written.
const recomputeStoredHash = (pin: string, salt: string, stored: string): string => {
  if (stored.startsWith(HASH_VERSION + ':')) {
    const parts = stored.split(':');
    const iter = parseInt(parts[1], 10);
    const safeIter = Number.isFinite(iter) && iter > 0 && iter <= 1_000_000 ? iter : HASH_ITERATIONS;
    const digest = iteratedHash(pin, salt, safeIter);
    return `${HASH_VERSION}:${safeIter}:${digest}`;
  }
  // Legacy v1: 5000 iterations, no extra mixing.
  let legacy = pin + ':' + salt;
  for (let i = 0; i < 5000; i++) {
    legacy = simpleHash(legacy + ':' + i);
  }
  return legacy;
};

// Constant-time string equality to defuse timing side-channels.
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

// Try the platform CSPRNG first; fall back to Math.random only as a last resort.
const generateSalt = (): string => {
  const bytes = new Uint8Array(32);
  try {
    const g: any = globalThis as any;
    if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
      g.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
};

// ── PIN management ───────────────────────────────────────────────────────────

export const isPinSet = async (): Promise<boolean> => {
  const hash = await AsyncStorage.getItem(PIN_HASH_KEY);
  if (!hash) return false;
  // Auto-clear when the expiry has passed so the user gets an unlocked app.
  const expiry = await getLockExpiry();
  if (expiry !== null && Date.now() >= expiry) {
    await clearLock();
    return false;
  }
  return true;
};

/** Returns the lock expiry timestamp in ms, or null when the lock never expires. */
export const getLockExpiry = async (): Promise<number | null> => {
  const v = await AsyncStorage.getItem(LOCK_EXPIRY_KEY);
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** Set or clear the lock expiry. Pass null to make the lock permanent. */
export const setLockExpiry = async (expiresAt: number | null): Promise<void> => {
  if (expiresAt === null) {
    await AsyncStorage.removeItem(LOCK_EXPIRY_KEY);
  } else {
    await AsyncStorage.setItem(LOCK_EXPIRY_KEY, String(expiresAt));
  }
};

export const setupPin = async (pin: string): Promise<void> => {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be 4 digits');
  }
  const salt = generateSalt();
  const hash = hashPinV2(pin, salt);
  await AsyncStorage.setItem(PIN_SALT_KEY, salt);
  await AsyncStorage.setItem(PIN_HASH_KEY, hash);
};

export const verifyPin = async (pin: string): Promise<boolean> => {
  const [salt, expected] = await Promise.all([
    AsyncStorage.getItem(PIN_SALT_KEY),
    AsyncStorage.getItem(PIN_HASH_KEY),
  ]);
  if (!salt || !expected) return false;
  const actual = recomputeStoredHash(pin, salt, expected);
  const ok = safeEqual(actual, expected);
  // Transparently migrate legacy hashes (v1) to v2 on a successful login so
  // future verifications use the stronger parameters.
  if (ok && !expected.startsWith(HASH_VERSION + ':')) {
    try {
      const newSalt = generateSalt();
      await AsyncStorage.setItem(PIN_SALT_KEY, newSalt);
      await AsyncStorage.setItem(PIN_HASH_KEY, hashPinV2(pin, newSalt));
    } catch {
      // Migration failure is non-fatal — keep the old hash.
    }
  }
  return ok;
};

export const clearLock = async (): Promise<void> => {
  await AsyncStorage.multiRemove([PIN_HASH_KEY, PIN_SALT_KEY, BIOMETRIC_ENABLED_KEY, LOCK_EXPIRY_KEY]);
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
