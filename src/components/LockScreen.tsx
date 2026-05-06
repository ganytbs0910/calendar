import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../theme/ThemeContext';
import {ThemeColors} from '../theme/colors';
import {
  verifyPin,
  authenticateBiometric,
  isBiometricEnabled,
  getBiometricCapability,
} from '../services/lockService';

const PIN_LENGTH = 4;

interface LockScreenProps {
  visible: boolean;
  onUnlocked: () => void;
}

/**
 * Full-screen modal shown when the app is locked. Prompts for a PIN and,
 * when enabled, can use biometric (FaceID / TouchID) instead.
 */
const LockScreen: React.FC<LockScreenProps> = ({visible, onUnlocked}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [biometricType, setBiometricType] = useState<'FaceID' | 'TouchID' | 'Biometrics' | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const biometricTriedRef = useRef(false);

  const tryBiometric = useCallback(async () => {
    const enabled = await isBiometricEnabled();
    if (!enabled) return;
    const cap = await getBiometricCapability();
    if (!cap.available) return;
    setBiometricType(cap.type);
    const ok = await authenticateBiometric(t('lockBiometricPrompt'));
    if (ok) onUnlocked();
  }, [onUnlocked, t]);

  useEffect(() => {
    if (!visible) {
      setPin('');
      setError(false);
      biometricTriedRef.current = false;
      return;
    }
    // Auto-attempt biometric once when the lock screen first appears.
    if (!biometricTriedRef.current) {
      biometricTriedRef.current = true;
      tryBiometric();
    }
    // Always pre-fetch the capability so we can render the icon button.
    getBiometricCapability().then(cap => {
      isBiometricEnabled().then(en => setBiometricType(en && cap.available ? cap.type : null));
    });
  }, [visible, tryBiometric]);

  const handleDigit = useCallback((d: string) => {
    setError(false);
    setPin(prev => (prev.length >= PIN_LENGTH ? prev : prev + d));
  }, []);

  const handleBackspace = useCallback(() => {
    setError(false);
    setPin(prev => prev.slice(0, -1));
  }, []);

  // Auto-verify when 4 digits entered.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    let cancelled = false;
    verifyPin(pin).then(ok => {
      if (cancelled) return;
      if (ok) {
        onUnlocked();
      } else {
        setError(true);
        Animated.sequence([
          Animated.timing(shakeAnim, {toValue: 10, duration: 60, useNativeDriver: true}),
          Animated.timing(shakeAnim, {toValue: -10, duration: 60, useNativeDriver: true}),
          Animated.timing(shakeAnim, {toValue: 6, duration: 60, useNativeDriver: true}),
          Animated.timing(shakeAnim, {toValue: -6, duration: 60, useNativeDriver: true}),
          Animated.timing(shakeAnim, {toValue: 0, duration: 60, useNativeDriver: true}),
        ]).start(() => setPin(''));
      }
    });
    return () => { cancelled = true; };
  }, [pin, onUnlocked, shakeAnim]);

  const biometricIconName = biometricType === 'FaceID' ? 'scan-outline' : biometricType ? 'finger-print-outline' : null;

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={() => {}}>
      <View style={styles.container}>
        <View style={styles.lockIconBox}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('lockUnlockTitle')}</Text>
        <Text style={styles.subtitle}>
          {error ? t('lockWrongPin') : t('lockEnterPinPrompt')}
        </Text>

        <Animated.View style={[styles.dotsRow, {transform: [{translateX: shakeAnim}]}]}>
          {Array.from({length: PIN_LENGTH}).map((_, i) => (
            <View
              key={`dot-${i}`}
              style={[
                styles.dot,
                {borderColor: error ? colors.error : colors.textTertiary},
                i < pin.length && {
                  backgroundColor: error ? colors.error : colors.primary,
                  borderColor: error ? colors.error : colors.primary,
                },
              ]}
            />
          ))}
        </Animated.View>

        <NumberPad
          colors={colors}
          biometricIconName={biometricIconName}
          onDigit={handleDigit}
          onBackspace={handleBackspace}
          onBiometric={tryBiometric}
        />
      </View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PIN setup modal — used for first-time setup and changing the PIN.
// ─────────────────────────────────────────────────────────────────────────────

interface PinSetupModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete: (pin: string) => void;
  /** When changing PIN, prompt for the current PIN first. */
  requireCurrent?: boolean;
}

export const PinSetupModal: React.FC<PinSetupModalProps> = ({visible, onClose, onComplete, requireCurrent}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  type Step = 'current' | 'enter' | 'confirm';
  const [step, setStep] = useState<Step>(requireCurrent ? 'current' : 'enter');
  const [firstPin, setFirstPin] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      setStep(requireCurrent ? 'current' : 'enter');
      setFirstPin('');
      setPin('');
      setError(null);
    }
  }, [visible, requireCurrent]);

  const shakeAndReset = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, {toValue: 10, duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: -10, duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: 6, duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: -6, duration: 60, useNativeDriver: true}),
      Animated.timing(shakeAnim, {toValue: 0, duration: 60, useNativeDriver: true}),
    ]).start(() => setPin(''));
  }, [shakeAnim]);

  // Auto-advance when 4 digits entered.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    if (step === 'current') {
      verifyPin(pin).then(ok => {
        if (ok) {
          setError(null);
          setPin('');
          setStep('enter');
        } else {
          setError(t('lockWrongPin'));
          shakeAndReset();
        }
      });
    } else if (step === 'enter') {
      setFirstPin(pin);
      setError(null);
      setPin('');
      setStep('confirm');
    } else if (step === 'confirm') {
      if (pin === firstPin) {
        onComplete(pin);
      } else {
        setError(t('lockPinMismatch'));
        shakeAndReset();
        setFirstPin('');
        setStep('enter');
      }
    }
  }, [pin, step, firstPin, t, onComplete, shakeAndReset]);

  const handleDigit = useCallback((d: string) => {
    setError(null);
    setPin(prev => (prev.length >= PIN_LENGTH ? prev : prev + d));
  }, []);

  const handleBackspace = useCallback(() => {
    setError(null);
    setPin(prev => prev.slice(0, -1));
  }, []);

  const headerText =
    step === 'current' ? t('lockEnterCurrentPin')
    : step === 'enter' ? t('lockSetNewPin')
    : t('lockConfirmPin');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.setupHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
            <Text style={[styles.headerCancelText, {color: colors.primary}]}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>{headerText}</Text>
        {error ? (
          <Text style={[styles.subtitle, {color: colors.error}]}>{error}</Text>
        ) : (
          <Text style={styles.subtitle}>{t('lockSetupHint')}</Text>
        )}

        <Animated.View style={[styles.dotsRow, {transform: [{translateX: shakeAnim}]}]}>
          {Array.from({length: PIN_LENGTH}).map((_, i) => (
            <View
              key={`sdot-${i}`}
              style={[
                styles.dot,
                {borderColor: colors.textTertiary},
                i < pin.length && {backgroundColor: colors.primary, borderColor: colors.primary},
              ]}
            />
          ))}
        </Animated.View>

        <NumberPad
          colors={colors}
          biometricIconName={null}
          onDigit={handleDigit}
          onBackspace={handleBackspace}
          onBiometric={() => {}}
        />
      </View>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Reusable PIN keypad
// ─────────────────────────────────────────────────────────────────────────────

interface NumberPadProps {
  colors: ThemeColors;
  biometricIconName: string | null;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onBiometric: () => void;
}

const NumberPad: React.FC<NumberPadProps> = ({colors, biometricIconName, onDigit, onBackspace, onBiometric}) => {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];
  return (
    <View style={styles.pad}>
      {rows.map((row, ri) => (
        <View key={`row-${ri}`} style={styles.padRow}>
          {row.map(d => (
            <TouchableOpacity
              key={`d-${d}`}
              style={[styles.padBtn, {backgroundColor: colors.surfaceSecondary}]}
              onPress={() => onDigit(d)}
              activeOpacity={0.7}>
              <Text style={[styles.padBtnText, {color: colors.text}]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
      <View style={styles.padRow}>
        {biometricIconName ? (
          <TouchableOpacity style={styles.padBtnAux} onPress={onBiometric} activeOpacity={0.7}>
            <Ionicons name={biometricIconName} size={28} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.padBtnAux} />
        )}
        <TouchableOpacity
          style={[styles.padBtn, {backgroundColor: colors.surfaceSecondary}]}
          onPress={() => onDigit('0')}
          activeOpacity={0.7}>
          <Text style={[styles.padBtnText, {color: colors.text}]}>0</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.padBtnAux} onPress={onBackspace} activeOpacity={0.7}>
          <Ionicons name="backspace-outline" size={26} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingBottom: 40,
    },
    setupHeader: {
      position: 'absolute',
      top: 12,
      left: 16,
      right: 16,
      flexDirection: 'row',
      justifyContent: 'flex-start',
    },
    headerCancelText: {
      fontSize: 16,
      fontWeight: '500',
    },
    lockIconBox: {
      width: 72,
      height: 72,
      borderRadius: 18,
      backgroundColor: colors.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 32,
      textAlign: 'center',
    },
    dotsRow: {
      flexDirection: 'row',
      gap: 18,
      marginBottom: 48,
    },
    dot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
    },
    pad: {
      width: '100%',
      maxWidth: 320,
      gap: 16,
    },
    padRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 16,
    },
    padBtn: {
      flex: 1,
      aspectRatio: 1,
      maxWidth: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    padBtnText: {
      fontSize: 28,
      fontWeight: '500',
    },
    padBtnAux: {
      flex: 1,
      aspectRatio: 1,
      maxWidth: 80,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export default LockScreen;
