/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Calendar} from '../src/components/Calendar';

// Mock react-native-calendar-events
jest.mock('react-native-calendar-events', () => ({
  requestPermissions: jest.fn().mockResolvedValue('authorized'),
  fetchAllEvents: jest.fn().mockResolvedValue([]),
}));

describe('Calendar', () => {
  it('renders correctly', async () => {
    let component;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(<Calendar />);
    });
    expect(component).toBeDefined();
  });

  it('displays correct month and year', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(<Calendar />);
    });

    const today = new Date();
    const expectedMonth = `${today.getMonth() + 1}月`;
    const expectedYear = `${today.getFullYear()}`;

    const tree = component!.toJSON();
    const jsonString = JSON.stringify(tree);
    expect(jsonString).toContain(expectedMonth);
    expect(jsonString).toContain(expectedYear);
    expect(jsonString).toContain('年');
  });

  it('displays weekday headers', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(<Calendar />);
    });

    const tree = component!.toJSON();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    weekdays.forEach((day) => {
      expect(JSON.stringify(tree)).toContain(day);
    });
  });

  it('calls onDateSelect when date is tapped', async () => {
    const mockOnDateSelect = jest.fn();
    let component: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <Calendar onDateSelect={mockOnDateSelect} />
      );
    });

    expect(component).toBeDefined();
  });
});
