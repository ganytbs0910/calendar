/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import RNCalendarEvents from 'react-native-calendar-events';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AddEventModal} from '../src/components/AddEventModal';
import {getDateKey} from '../src/services/taskService';

// Mock react-native-calendar-events
jest.mock('react-native-calendar-events', () => ({
  checkPermissions: jest.fn().mockResolvedValue('authorized'),
  requestPermissions: jest.fn().mockResolvedValue('authorized'),
  findCalendars: jest.fn().mockResolvedValue([
    {id: '1', title: 'Default', isPrimary: true, allowsModifications: true},
  ]),
  saveEvent: jest.fn().mockResolvedValue('event-id'),
  // The modal looks up the day's existing events to suggest a slot.
  fetchAllEvents: jest.fn().mockResolvedValue([]),
}));

// Mock DateTimePicker
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('AddEventModal', () => {
  const mockOnClose = jest.fn();
  const mockOnEventAdded = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly when visible', async () => {
    let component;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={true}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
        />
      );
    });
    expect(component).toBeDefined();
  });

  it('renders correctly when not visible', async () => {
    let component;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={false}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
        />
      );
    });
    expect(component).toBeDefined();
  });

  it('displays add mode title when not editing', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={true}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('予定を追加');
  });

  it('displays edit mode title when editing', async () => {
    const editingEvent = {
      id: '1',
      title: 'Test Event',
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 3600000).toISOString(),
    };

    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={true}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
          editingEvent={editingEvent as any}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('予定を編集');
  });

  it('displays duration options', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={true}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
        />
      );
    });

    // Duration is picked from presets (DURATION_OPTIONS), not the "+5分"
    // nudge buttons this test was originally written against.
    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('30分');
    expect(JSON.stringify(tree)).toContain('1時間');
  });

  it('タップ連打しても予定は1件しか作られない(ヘッダーと下部の保存ボタン)', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={true}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
        />
      );
    });

    const headerSave = component!.root.findByProps({testID: 'save-event'});
    const bottomSave = component!.root.findByProps({testID: 'save-event-bottom'});

    // どちらも同じ保存処理につながっているので、片方が完了する前に
    // もう片方(あるいは同じボタンの連打)が発火すると2件保存されてしまう
    // 不具合の再現 — ここでは両方をawaitを挟まず立て続けに押す。
    await ReactTestRenderer.act(async () => {
      headerSave.props.onPress();
      bottomSave.props.onPress();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(RNCalendarEvents.saveEvent as jest.Mock).toHaveBeenCalledTimes(1);

    // The successful save starts SuccessOverlay's own timer — unmount so it
    // doesn't fire after Jest tears the environment down.
    await ReactTestRenderer.act(async () => {
      component!.unmount();
    });
  });

  it('「あとでやる」は予定を作らず、時間なしのタスクとして追加して閉じる', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AddEventModal
          visible={true}
          onClose={mockOnClose}
          onEventAdded={mockOnEventAdded}
        />
      );
    });

    const titleInput = component!.root.findByProps({testID: 'event-title-input'});
    ReactTestRenderer.act(() => {
      titleInput.props.onChangeText('資料を読む');
    });

    const laterBtn = component!.root.findByProps({testID: 'save-as-later'});
    await ReactTestRenderer.act(async () => {
      await laterBtn.props.onPress();
    });

    expect(RNCalendarEvents.saveEvent as jest.Mock).not.toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();

    const setItemMock = AsyncStorage.setItem as jest.Mock;
    const [, lastPayload] = setItemMock.mock.calls[setItemMock.mock.calls.length - 1];
    const savedTasks = JSON.parse(lastPayload);
    expect(savedTasks).toHaveLength(1);
    expect(savedTasks[0].title).toBe('資料を読む');
    expect(savedTasks[0].taskType).toBe('todo');
    expect(savedTasks[0].time).toBeUndefined();
    expect(savedTasks[0].dateKey).toBe(getDateKey(new Date()));
  });

});
