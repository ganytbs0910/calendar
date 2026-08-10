// ── ScreenOverlay — a full-screen destination that doesn't own a tab ────────
//
// Deliberately a plain absolutely-positioned View rather than a Modal: the
// screens hosted here open Modals of their own, and on iOS a modal presented
// from another modal is silently swallowed.
//
// Two things every host has to get right, hence this wrapper:
//  - an absolute child escapes SafeAreaView's padding, so the insets are
//    re-applied here or the content lands under the status bar / home indicator
//  - covering the whole screen means the Android back button has to dismiss it,
//    otherwise back reads as "leave the app" from inside a sub-screen

import React, {useEffect} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {useTheme} from '../theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const ScreenOverlay: React.FC<Props> = ({visible, onClose, children}) => {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}>
      {children}
    </View>
  );
};

export default React.memo(ScreenOverlay);
