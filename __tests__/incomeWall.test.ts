import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
    __reset: () => {
      store = {};
    },
  };
});

jest.mock('react-native-calendar-events', () => ({
  __esModule: true,
  default: {
    fetchAllEvents: jest.fn(async () => []),
  },
}));

import RNCalendarEvents from 'react-native-calendar-events';
import {getYearWorkTotal} from '../src/services/incomeWallService';
import {setEventBreak} from '../src/services/eventWageService';
import {addJob} from '../src/services/jobService';

describe('incomeWallService.getYearWorkTotal — per-event break overrides', () => {
  beforeEach(async () => {
    for (const k of ['@jobs', '@event_jobs', '@event_breaks', '@event_wages']) {
      await AsyncStorage.removeItem(k);
    }
    (RNCalendarEvents.fetchAllEvents as jest.Mock).mockResolvedValue([
      {
        id: 'evt-1',
        allDay: false,
        // Monday 2026-03-02 09:00–17:00 local → 8h shift
        startDate: new Date(2026, 2, 2, 9, 0, 0).toISOString(),
        endDate: new Date(2026, 2, 2, 17, 0, 0).toISOString(),
      },
    ]);
    const job = await addJob({name: 'Café', color: '#3478F6', hourlyWage: 1000});
    await AsyncStorage.setItem('@event_jobs', JSON.stringify({['evt-1']: job.id}));
  });

  test('break override of 0 ("no break") must not be replaced by the legal 60-min deduction', async () => {
    await setEventBreak('evt-1', 0); // explicit "no break"
    const total = await getYearWorkTotal(2026);
    // 8h × ¥1000 with no break = ¥8000; the bug deducted a 60-min legal break → ¥7000.
    expect(total).toBe(8000);
  });

  test('without an override, the legal 45-min break applies to an exactly-8h shift', async () => {
    const total = await getYearWorkTotal(2026);
    // legalBreakMinutes(480) = 45 (strictly-over rule) → 435 paid min × ¥1000/h
    expect(total).toBe(7250);
  });
});
