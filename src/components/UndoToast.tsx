import React, {useEffect, useRef, useCallback} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Animated} from 'react-native';

export interface UndoAction {
  message: string;
  onUndo: () => Promise<void>;
}

interface UndoToastProps {
  action: UndoAction | null;
  onDismiss: () => void;
}

const TOAST_DURATION = 5000;

export const UndoToast: React.FC<UndoToastProps> = ({action, onDismiss}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(50)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 0, duration: 200, useNativeDriver: true}),
      Animated.timing(translateY, {toValue: 50, duration: 200, useNativeDriver: true}),
    ]).start(() => onDismiss());
  }, [opacity, translateY, onDismiss]);

  useEffect(() => {
    if (action) {
      // Show
      Animated.parallel([
        Animated.timing(opacity, {toValue: 1, duration: 250, useNativeDriver: true}),
        Animated.spring(translateY, {toValue: 0, useNativeDriver: true, tension: 100, friction: 10}),
      ]).start();

      // Auto-dismiss
      timerRef.current = setTimeout(dismiss, TOAST_DURATION);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [action, dismiss, opacity, translateY]);

  const handleUndo = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (action?.onUndo) {
      await action.onUndo();
    }
    dismiss();
  }, [action, dismiss]);

  if (!action) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {opacity, transform: [{translateY}]},
      ]}>
      <View style={styles.toast}>
        <Text style={styles.message} numberOfLines={1}>{action.message}</Text>
        <TouchableOpacity onPress={handleUndo} style={styles.undoButton}>
          <Text style={styles.undoText}>元に戻す</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#333',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  message: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
    marginRight: 12,
  },
  undoButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  undoText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4FC3F7',
  },
});

export default UndoToast;
