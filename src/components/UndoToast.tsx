import React, {useEffect, useRef, useCallback} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Animated} from 'react-native';
import {useTranslation} from 'react-i18next';

export interface UndoAction {
  message: string;
  onUndo: () => Promise<void>;
  /**
   * Called once the window has closed without an undo — the point of no
   * return. Anything the delete deferred so undo stayed possible (files,
   * settings keyed to the old event) gets cleaned up here.
   */
  onExpire?: () => void;
  /** Override the default window. Longer suits bulk actions. */
  durationMs?: number;
}

interface UndoToastProps {
  action: UndoAction | null;
  onDismiss: () => void;
}

const TOAST_DURATION = 5000;

export const UndoToast: React.FC<UndoToastProps> = ({action, onDismiss}) => {
  const {t} = useTranslation();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(50)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read from callbacks without making them part of the show effect's deps —
  // the effect must run once per action, not once per parent render, or the
  // auto-dismiss timer is restarted forever and the window never closes.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);
  const undoneRef = useRef(false);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 0, duration: 200, useNativeDriver: true}),
      Animated.timing(translateY, {toValue: 50, duration: 200, useNativeDriver: true}),
    ]).start(() => onDismissRef.current());
  }, [opacity, translateY]);

  useEffect(() => {
    if (!action) return;

    undoneRef.current = false;
    Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: 250, useNativeDriver: true}),
      Animated.spring(translateY, {toValue: 0, useNativeDriver: true, tension: 100, friction: 10}),
    ]).start();

    timerRef.current = setTimeout(dismiss, action.durationMs ?? TOAST_DURATION);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Whether the window ran out, the toast was replaced by a newer action,
      // or the screen went away, the chance to undo is gone unless it was
      // actually taken. Commit the deferred cleanup exactly once.
      if (!undoneRef.current) action.onExpire?.();
    };
  }, [action, dismiss, opacity, translateY]);

  const handleUndo = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    undoneRef.current = true;
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
          <Text style={styles.undoText}>{t('undo')}</Text>
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
