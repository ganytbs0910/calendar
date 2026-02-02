/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {AddEventModal} from '../src/components/AddEventModal';

// Mock react-native-calendar-events
jest.mock('react-native-calendar-events', () => ({
  findCalendars: jest.fn().mockResolvedValue([
    {id: '1', title: 'Default', isPrimary: true, allowsModifications: true},
  ]),
  saveEvent: jest.fn().mockResolvedValue('event-id'),
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

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('+5分');
    expect(JSON.stringify(tree)).toContain('+1時間');
  });

});
