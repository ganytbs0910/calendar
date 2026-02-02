/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {EventDetailModal} from '../src/components/EventDetailModal';

// Mock react-native-calendar-events
jest.mock('react-native-calendar-events', () => ({
  removeEvent: jest.fn().mockResolvedValue(true),
}));

describe('EventDetailModal', () => {
  const mockOnClose = jest.fn();
  const mockOnEdit = jest.fn();
  const mockOnDeleted = jest.fn();

  const mockEvent = {
    id: '1',
    title: 'Test Event',
    startDate: '2024-01-15T10:00:00.000Z',
    endDate: '2024-01-15T11:00:00.000Z',
    allDay: false,
    calendar: {
      id: 'cal-1',
      title: 'Default Calendar',
      color: '#007AFF',
    },
    location: 'Test Location',
    notes: 'Test notes',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly when visible with event', async () => {
    let component;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={mockEvent as any}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });
    expect(component).toBeDefined();
  });

  it('returns null when event is null', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={null}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });

    expect(component!.toJSON()).toBeNull();
  });

  it('displays event title', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={mockEvent as any}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('Test Event');
  });

  it('displays event location', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={mockEvent as any}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('Test Location');
  });

  it('displays event notes', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={mockEvent as any}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('Test notes');
  });

  it('displays calendar name', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={mockEvent as any}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('Default Calendar');
  });

  it('displays delete button', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <EventDetailModal
          visible={true}
          event={mockEvent as any}
          onClose={mockOnClose}
          onEdit={mockOnEdit}
          onDeleted={mockOnDeleted}
        />
      );
    });

    const tree = component!.toJSON();
    expect(JSON.stringify(tree)).toContain('予定を削除');
  });
});
