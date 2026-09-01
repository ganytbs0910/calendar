import React, {useEffect, useRef, useCallback} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder} from 'react-native';
import {useTranslation} from 'react-i18next';

// Swipe-down-to-dismiss threshold/velocity — mirrors SwipeableRow's
// clearly-directional gesture claim so a mostly-vertical scroll behind the
// toast (there isn't one today, but taps on 元に戻す must stay untouched
// either way) never gets mistaken for a dismiss swipe.
const DISMISS_DISTANCE = 40;
const DISMISS_VELOCITY = 0.5;

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
  /** Optional visual (e.g. a DayTimeStrip) rendered above the message row. */
  preview?: React.ReactNode;
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
  // The swipe-to-dismiss PanResponder below is created once (useRef) and its
  // handlers close over whatever `action` was in scope at that render — a
  // ref keeps them reading the *current* action's durationMs instead of a
  // stale one from mount time.
  const actionRef = useRef(action);
  useEffect(() => { actionRef.current = action; }, [action]);

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

  // Swiping the toast down dismisses it early — same outcome as letting the
  // window run out (onExpire still fires, nothing is undone), just faster
  // for someone who already knows they don't want to undo.
  const swipeDown = useRef(
    PanResponder.create({
      // Only claim clearly-downward drags (SwipeableRow's same trick) so a
      // tap on 元に戻す is never swallowed by the gesture.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        translateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          dismiss();
          return;
        }
        Animated.spring(translateY, {toValue: 0, useNativeDriver: true, tension: 100, friction: 10}).start();
        timerRef.current = setTimeout(dismiss, actionRef.current?.durationMs ?? TOAST_DURATION);
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {toValue: 0, useNativeDriver: true, tension: 100, friction: 10}).start();
        timerRef.current = setTimeout(dismiss, actionRef.current?.durationMs ?? TOAST_DURATION);
      },
    }),
  ).current;

  if (!action) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {opacity, transform: [{translateY}]},
      ]}
      {...swipeDown.panHandlers}>
      <View style={[styles.toast, action.preview ? styles.toastWithPreview : null]}>
        {action.preview && <View style={styles.previewSlot}>{action.preview}</View>}
        <View style={styles.messageRow}>
          <Text style={styles.message} numberOfLines={1}>{action.message}</Text>
          <TouchableOpacity onPress={handleUndo} style={styles.undoButton}>
            <Text style={styles.undoText}>{t('undo')}</Text>
          </TouchableOpacity>
        </View>
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
  toastWithPreview: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  previewSlot: {
    marginBottom: 10,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
