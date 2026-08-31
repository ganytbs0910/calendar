/**
 * The undo window decides when deleted data is really gone: onExpire is what
 * unlinks photo files, so it must fire exactly once, and never after the user
 * actually took the undo.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Animated, PanResponder, TouchableOpacity} from 'react-native';
import {UndoToast, UndoAction} from '../src/components/UndoToast';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

// Run animations through instantly so the test drives the timer, not the easing.
const runInstantly = () => ({start: (cb?: () => void) => cb && cb()}) as any;
// PanResponder.create's returned .panHandlers are remapped to the low-level
// Responder System event names (onResponderMove, etc.) and only invoke the
// original onPanResponderMove/Release/... after computing a real gestureState
// from actual native touch sequences — not something a plain {dy, dx, vy}
// object can drive. Capturing the config object passed into create() gives
// direct access to those original handlers instead.
let capturedPanConfig: any = null;
beforeAll(() => {
  jest.spyOn(Animated, 'parallel').mockImplementation(runInstantly);
  jest.spyOn(Animated, 'timing').mockImplementation(runInstantly);
  jest.spyOn(Animated, 'spring').mockImplementation(runInstantly);
  jest.spyOn(PanResponder, 'create').mockImplementation((config: any) => {
    capturedPanConfig = config;
    return {panHandlers: {}} as any;
  });
});

const makeAction = (over: Partial<UndoAction> = {}): UndoAction => ({
  message: 'deleted',
  onUndo: jest.fn().mockResolvedValue(undefined),
  onExpire: jest.fn(),
  ...over,
});

describe('UndoToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const render = (action: UndoAction | null, onDismiss = jest.fn()) => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<UndoToast action={action} onDismiss={onDismiss} />);
    });
    return {tree, onDismiss};
  };

  it('expires after the default window, without undoing', () => {
    const action = makeAction();
    const {tree, onDismiss} = render(action);

    ReactTestRenderer.act(() => { jest.advanceTimersByTime(4999); });
    expect(onDismiss).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => { jest.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // The parent clears the action in response; that unmount-of-action is what
    // commits the cleanup.
    ReactTestRenderer.act(() => { tree.update(<UndoToast action={null} onDismiss={onDismiss} />); });
    expect(action.onExpire).toHaveBeenCalledTimes(1);
    expect(action.onUndo).not.toHaveBeenCalled();
  });

  it('honours a custom window', () => {
    const action = makeAction({durationMs: 12000});
    const {onDismiss} = render(action);

    ReactTestRenderer.act(() => { jest.advanceTimersByTime(5000); });
    expect(onDismiss).not.toHaveBeenCalled();

    ReactTestRenderer.act(() => { jest.advanceTimersByTime(7000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('never expires once the undo was taken', async () => {
    const action = makeAction();
    const {tree, onDismiss} = render(action);

    const button = tree.root.findByType(TouchableOpacity);
    await ReactTestRenderer.act(async () => { await button.props.onPress(); });

    expect(action.onUndo).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => { tree.update(<UndoToast action={null} onDismiss={onDismiss} />); });
    // Let any stale timer that was not cleared fire.
    ReactTestRenderer.act(() => { jest.advanceTimersByTime(60000); });

    expect(action.onExpire).not.toHaveBeenCalled();
  });

  it('expires the previous action when a new one replaces it', () => {
    const first = makeAction({message: 'first'});
    const second = makeAction({message: 'second'});
    const {tree, onDismiss} = render(first);

    ReactTestRenderer.act(() => { tree.update(<UndoToast action={second} onDismiss={onDismiss} />); });

    expect(first.onExpire).toHaveBeenCalledTimes(1);
    expect(second.onExpire).not.toHaveBeenCalled();
  });

  it('expires only once even if the window runs long', () => {
    const action = makeAction();
    const {tree, onDismiss} = render(action);

    ReactTestRenderer.act(() => { jest.advanceTimersByTime(5000); });
    ReactTestRenderer.act(() => { tree.update(<UndoToast action={null} onDismiss={onDismiss} />); });
    ReactTestRenderer.act(() => { jest.advanceTimersByTime(60000); });

    expect(action.onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not restart the window when the parent re-renders', () => {
    const action = makeAction();
    const {tree, onDismiss} = render(action);

    // Re-render repeatedly with a fresh onDismiss identity, as a parent that
    // passes an inline arrow would. The window must still close on time.
    for (let i = 0; i < 5; i++) {
      ReactTestRenderer.act(() => { jest.advanceTimersByTime(1000); });
      ReactTestRenderer.act(() => { tree.update(<UndoToast action={action} onDismiss={onDismiss} />); });
    }

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // Swipe-to-dismiss: dragging the toast down should close it early without
  // undoing, the same outcome as letting the window run out.
  describe('swipe down to dismiss', () => {
    const findGestureHandlers = (_tree: ReactTestRenderer.ReactTestRenderer) => capturedPanConfig;

    it('dismisses without undoing once dragged past the distance threshold', () => {
      const action = makeAction();
      const {tree, onDismiss} = render(action);
      const gh = findGestureHandlers(tree);

      ReactTestRenderer.act(() => {
        gh.onPanResponderMove({}, {dy: 60, dx: 0, vy: 0});
        gh.onPanResponderRelease({}, {dy: 60, dx: 0, vy: 0});
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
      ReactTestRenderer.act(() => { tree.update(<UndoToast action={null} onDismiss={onDismiss} />); });
      expect(action.onExpire).toHaveBeenCalledTimes(1);
      expect(action.onUndo).not.toHaveBeenCalled();
    });

    it('dismisses on a fast flick even if the drag distance is short', () => {
      const action = makeAction();
      const {tree, onDismiss} = render(action);
      const gh = findGestureHandlers(tree);

      ReactTestRenderer.act(() => {
        gh.onPanResponderMove({}, {dy: 10, dx: 0, vy: 0.8});
        gh.onPanResponderRelease({}, {dy: 10, dx: 0, vy: 0.8});
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('snaps back and keeps counting down when the drag falls short', () => {
      const action = makeAction();
      const {tree, onDismiss} = render(action);
      const gh = findGestureHandlers(tree);

      ReactTestRenderer.act(() => {
        gh.onPanResponderMove({}, {dy: 15, dx: 0, vy: 0.1});
        gh.onPanResponderRelease({}, {dy: 15, dx: 0, vy: 0.1});
      });
      expect(onDismiss).not.toHaveBeenCalled();

      // A short, failed drag restarts the countdown from the full window
      // rather than leaving it stuck — the default 5s must still elapse.
      ReactTestRenderer.act(() => { jest.advanceTimersByTime(4999); });
      expect(onDismiss).not.toHaveBeenCalled();
      ReactTestRenderer.act(() => { jest.advanceTimersByTime(1); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('pauses the auto-dismiss timer while actively dragging', () => {
      const action = makeAction();
      const {tree, onDismiss} = render(action);
      const gh = findGestureHandlers(tree);

      // Drag starts just before the window would have expired on its own.
      ReactTestRenderer.act(() => { jest.advanceTimersByTime(4900); });
      ReactTestRenderer.act(() => { gh.onPanResponderMove({}, {dy: 5, dx: 0, vy: 0}); });
      ReactTestRenderer.act(() => { jest.advanceTimersByTime(1000); }); // would have expired by now
      expect(onDismiss).not.toHaveBeenCalled();

      ReactTestRenderer.act(() => { gh.onPanResponderRelease({}, {dy: 5, dx: 0, vy: 0}); });
      expect(onDismiss).not.toHaveBeenCalled(); // released short of the threshold
    });

    it('only claims the gesture for a clearly-downward drag, not a tap or sideways swipe', () => {
      const action = makeAction();
      const {tree} = render(action);
      const gh = findGestureHandlers(tree);

      expect(gh.onMoveShouldSetPanResponder({}, {dy: 2, dx: 0})).toBe(false); // barely moved
      expect(gh.onMoveShouldSetPanResponder({}, {dy: 10, dx: 20})).toBe(false); // mostly horizontal
      expect(gh.onMoveShouldSetPanResponder({}, {dy: 20, dx: 2})).toBe(true); // clearly downward
    });
  });
});
