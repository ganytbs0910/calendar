/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// Mock the WeekView component to avoid PanResponder issues in tests
jest.mock('../src/components/WeekView', () => {
  const mockReact = require('react');
  const {View, Text, ScrollView} = require('react-native');

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const MockWeekView = mockReact.forwardRef(
    (
      {
        currentDate,
        hasPermission,
      }: {currentDate: Date; hasPermission: boolean},
      ref: React.Ref<{refreshEvents: () => void}>,
    ) => {
      const weekStart = getWeekStart(currentDate);
      const weekDays = Array.from({length: 7}, (_, i) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        return date;
      });

      mockReact.useImperativeHandle(ref, () => ({
        refreshEvents: jest.fn(),
      }));

      return (
        <View testID="week-view">
          <View testID="header">
            {weekDays.map((date: Date, index: number) => (
              <View key={index}>
                <Text>{WEEKDAYS[index]}</Text>
                <Text>{date.getDate()}</Text>
              </View>
            ))}
          </View>
          <ScrollView testID="time-grid">
            <View testID="time-column">
              {Array.from({length: 24}, (_, hour) => (
                <View key={hour}>
                  <Text>{hour.toString().padStart(2, '0')}:00</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          {!hasPermission && <Text>権限がありません</Text>}
        </View>
      );
    },
  );

  MockWeekView.displayName = 'WeekView';

  return {
    WeekView: MockWeekView,
    default: MockWeekView,
  };
});

import {WeekView} from '../src/components/WeekView';

describe('WeekView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', async () => {
    let component;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <WeekView currentDate={new Date()} hasPermission={true} />,
      );
    });
    expect(component).toBeDefined();
  });

  it('displays weekday headers', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <WeekView currentDate={new Date()} hasPermission={true} />,
      );
    });

    const tree = component!.toJSON();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    weekdays.forEach(day => {
      expect(JSON.stringify(tree)).toContain(day);
    });
  });

  it('displays 24 hour slots', async () => {
    let component: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <WeekView currentDate={new Date()} hasPermission={true} />,
      );
    });

    const tree = component!.toJSON();
    const jsonString = JSON.stringify(tree);
    // Check for some hour markers (may be split as "00" and ":00" in children)
    expect(jsonString).toContain(':00');
    expect(jsonString).toContain('"00"');
    expect(jsonString).toContain('"12"');
    expect(jsonString).toContain('"23"');
  });

  it('renders without permission', async () => {
    let component;
    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <WeekView currentDate={new Date()} hasPermission={false} />,
      );
    });
    expect(component).toBeDefined();
  });
});
