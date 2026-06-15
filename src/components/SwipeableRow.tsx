// ── SwipeableRow — swipe left to reveal a delete button ────────────────────
//
// Lightweight iOS-style swipe-to-delete built on Animated + PanResponder (the
// project has no gesture-handler/reanimated). Swiping the row left reveals a red
// "削除" action; tapping it fires onDelete. Vertical scrolls and taps pass
// through to the children untouched.

import React, {useRef} from 'react';
import {Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

const ACTION_WIDTH = 80;
const OPEN_THRESHOLD = 40;

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  deleteColor?: string;
}

const SwipeableRow: React.FC<Props> = ({
  children,
  onDelete,
  deleteLabel = '削除',
  deleteColor = '#FF3B30',
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snap = (toOpen: boolean) => {
    openRef.current = toOpen;
    Animated.spring(translateX, {
      toValue: toOpen ? -ACTION_WIDTH : 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // Only claim the gesture for clearly-horizontal drags, so vertical scroll
      // and taps still reach the children.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        const base = openRef.current ? -ACTION_WIDTH : 0;
        let next = base + g.dx;
        if (next > 0) next = 0;
        if (next < -ACTION_WIDTH - 24) next = -ACTION_WIDTH - 24;
        translateX.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const base = openRef.current ? -ACTION_WIDTH : 0;
        snap(base + g.dx < -OPEN_THRESHOLD);
      },
      onPanResponderTerminate: () => snap(openRef.current),
    }),
  ).current;

  return (
    <View style={styles.wrap}>
      <View style={[styles.action, {backgroundColor: deleteColor}]}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => {
            snap(false);
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}>
          <Text style={styles.actionText}>{deleteLabel}</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{transform: [{translateX}]}} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  actionBtn: {
    flex: 1,
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default SwipeableRow;
