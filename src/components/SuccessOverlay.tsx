// ── SuccessOverlay — a quick, satisfying checkmark burst ───────────────────
//
// Drop this in (conditionally) after a successful action; it plays a spring
// checkmark + expanding ring, then calls onDone (~0.5s). Pure built-in Animated,
// no deps. pointerEvents=none so it never blocks the UI underneath.

import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTheme} from '../theme/ThemeContext';

interface Props {
  onDone: () => void;
  color?: string;
}

const SuccessOverlay: React.FC<Props> = ({onDone, color}) => {
  const {colors} = useTheme();
  const tint = color ?? colors.primary;
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: 120, useNativeDriver: true}),
      Animated.spring(scale, {toValue: 1, friction: 5, tension: 150, useNativeDriver: true}),
      Animated.timing(ring, {toValue: 1, duration: 480, easing: Easing.out(Easing.ease), useNativeDriver: true}),
    ]).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, {toValue: 0, duration: 180, useNativeDriver: true}).start(() => onDone());
    }, 520);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringScale = ring.interpolate({inputRange: [0, 1], outputRange: [0.6, 2]});
  const ringOpacity = ring.interpolate({inputRange: [0, 1], outputRange: [0.5, 0]});

  return (
    <Animated.View style={[styles.overlay, {opacity}]} pointerEvents="none">
      <View style={styles.center}>
        <Animated.View
          style={[styles.ring, {borderColor: tint, transform: [{scale: ringScale}], opacity: ringOpacity}]}
        />
        <Animated.View style={[styles.circle, {backgroundColor: tint, transform: [{scale}]}]}>
          <Ionicons name="checkmark" size={46} color="#fff" />
        </Animated.View>
      </View>
    </Animated.View>
  );
};

const SIZE = 88;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
    zIndex: 1000,
  },
  center: {alignItems: 'center', justifyContent: 'center'},
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 3,
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 4},
    elevation: 6,
  },
});

export default SuccessOverlay;
