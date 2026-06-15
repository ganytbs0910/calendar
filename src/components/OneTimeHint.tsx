// ── OneTimeHint — a lightweight "shown once" coach tip ─────────────────────
//
// Drop one of these next to a non-obvious feature. It shows a small dismissible
// card the first time, then never again (a flag is persisted in AsyncStorage
// under `@hint_<hintKey>`). It renders nothing while the flag is being read so
// it never flashes for users who have already dismissed it.

import React, {useEffect, useState} from 'react';
import {StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTheme} from '../theme/ThemeContext';

const PREFIX = '@hint_';

// Clear every "shown once" flag so all coach tips appear again on next visit.
export const resetAllHints = async (): Promise<void> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const hintKeys = keys.filter(k => k.startsWith(PREFIX));
    if (hintKeys.length) await AsyncStorage.multiRemove(hintKeys);
  } catch {
    // ignore
  }
};

interface Props {
  hintKey: string; // unique key; persisted as `@hint_<hintKey>`
  title: string;
  message: string;
  icon?: string; // Ionicons name
  style?: StyleProp<ViewStyle>;
}

const OneTimeHint: React.FC<Props> = ({hintKey, title, message, icon = 'bulb-outline', style}) => {
  const {colors} = useTheme();
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(PREFIX + hintKey)
      .then(seen => {
        if (mounted) {
          setVisible(!seen);
          setChecked(true);
        }
      })
      .catch(() => {
        if (mounted) setChecked(true);
      });
    return () => {
      mounted = false;
    };
  }, [hintKey]);

  const dismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(PREFIX + hintKey, '1').catch(() => {});
  };

  if (!checked || !visible) return null;

  return (
    <View
      style={[
        styles.card,
        {backgroundColor: colors.primary + '14', borderColor: colors.primary + '40'},
        style,
      ]}>
      <Ionicons name={icon as any} size={18} color={colors.primary} style={styles.icon} />
      <View style={styles.body}>
        <Text style={[styles.title, {color: colors.text}]}>{title}</Text>
        <Text style={[styles.message, {color: colors.textSecondary}]}>{message}</Text>
      </View>
      <TouchableOpacity onPress={dismiss} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}} accessibilityLabel="閉じる">
        <Ionicons name="close" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  icon: {marginTop: 1},
  body: {flex: 1},
  title: {fontSize: 13, fontWeight: '700', marginBottom: 2},
  message: {fontSize: 12, lineHeight: 17},
});

export default OneTimeHint;
