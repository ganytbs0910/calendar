/**
 * The undo window decides when deleted data is really gone: onExpire is what
 * unlinks photo files, so it must fire exactly once, and never after the user
 * actually took the undo.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Animated, TouchableOpacity} from 'react-native';
import {UndoToast, UndoAction} from '../src/components/UndoToast';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

// Run animations through instantly so the test drives the timer, not the easing.
const runInstantly = () => ({start: (cb?: () => void) => cb && cb()}) as any;
beforeAll(() => {
  jest.spyOn(Animated, 'parallel').mockImplementation(runInstantly);
  jest.spyOn(Animated, 'timing').mockImplementation(runInstantly);
  jest.spyOn(Animated, 'spring').mockImplementation(runInstantly);
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
});
