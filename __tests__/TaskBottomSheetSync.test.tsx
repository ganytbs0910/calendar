/**
 * @format
 *
 * Month view (Calendar) and week view (TaskBottomSheet, inside WeekView)
 * each keep their own separate あとでやる task cache, with nothing linking
 * them — a todo added here has no way to tell the other its copy is stale.
 * onTasksChanged is the bridge (App.tsx wires it to refreshTaskViews, which
 * refreshes both). This covers that adding a todo here actually fires it.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {TaskBottomSheet} from '../src/components/TaskBottomSheet';

jest.mock('react-native-calendar-events', () => ({
  removeEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('TaskBottomSheet onTasksChanged', () => {
  const onTasksChanged = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fires onTasksChanged after adding a todo, so a sibling view can refresh its own cache', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <TaskBottomSheet
          date={new Date()}
          events={[]}
          eventColors={{}}
          onTasksChanged={onTasksChanged}
        />
      );
    });

    const addBtn = component!.root.findByProps({testID: 'add-todo-button'});
    ReactTestRenderer.act(() => {
      addBtn.props.onPress();
    });

    const input = component!.root.findByProps({testID: 'todo-input'});
    ReactTestRenderer.act(() => {
      input.props.onChangeText('牛乳を買う');
    });

    const confirmBtn = component!.root.findByProps({testID: 'confirm-add-todo'});
    await ReactTestRenderer.act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(onTasksChanged).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      component!.unmount();
    });
  });

  it('does not blow up when onTasksChanged is omitted (optional prop)', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <TaskBottomSheet date={new Date()} events={[]} eventColors={{}} />
      );
    });

    const addBtn = component!.root.findByProps({testID: 'add-todo-button'});
    ReactTestRenderer.act(() => {
      addBtn.props.onPress();
    });
    const input = component!.root.findByProps({testID: 'todo-input'});
    ReactTestRenderer.act(() => {
      input.props.onChangeText('牛乳を買う');
    });
    const confirmBtn = component!.root.findByProps({testID: 'confirm-add-todo'});
    await ReactTestRenderer.act(async () => {
      await confirmBtn.props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      component!.unmount();
    });
  });
});
