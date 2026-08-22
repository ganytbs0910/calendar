jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import {parseIntentions} from '../src/agent/intentionParser';

// Wednesday, 2026-08-19
const WED = new Date(2026, 7, 19, 12, 0, 0);

describe('parseIntentions — 平日毎日 frequency', () => {
  test('「平日は毎日勉強する」 parses as 5x/week (weekdays), not 7x', () => {
    const r = parseIntentions('平日は毎日勉強する', WED);
    expect(r.length).toBeGreaterThan(0);
    const intent = r[0];
    expect(intent.timesPerWeek).toBe(5);
  });

  test('「平日毎日 筋トレ」 parses as 5x/week', () => {
    const r = parseIntentions('平日毎日 筋トレ', WED);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].timesPerWeek).toBe(5);
  });

  test('plain 「毎日 読書」 still parses as 7x/week', () => {
    const r = parseIntentions('毎日 読書', WED);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].timesPerWeek).toBe(7);
  });
});
