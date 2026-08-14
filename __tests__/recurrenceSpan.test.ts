/**
 * EventKit wants a repeat count, so "about five years" has to be converted.
 * Getting it wrong is invisible at creation and only shows up when the series
 * stops early — or, on undo, when half a century of a yearly event appears.
 *
 * @format
 */

import {occurrencesForYears} from '../src/utils/recurrenceSpan';

const yearsCovered = (freq: string, n: number) =>
  n / ({daily: 365, weekly: 52, monthly: 12, yearly: 1} as Record<string, number>)[freq];

describe('五年ぶんの回数', () => {
  it.each(['daily', 'weekly', 'monthly', 'yearly'])('%s が概ね5年になる', freq => {
    expect(yearsCovered(freq, occurrencesForYears(freq))).toBeCloseTo(5, 1);
  });

  it('毎日が8か月で打ち切られない（作成側の旧値 260 の問題）', () => {
    expect(occurrencesForYears('daily')).toBeGreaterThan(1500);
  });

  it('毎年が半世紀にならない（復元側の旧値 52 の問題）', () => {
    expect(occurrencesForYears('yearly')).toBe(5);
  });
});

describe('端の扱い', () => {
  it('期間を指定できる', () => {
    expect(occurrencesForYears('weekly', 1)).toBe(52);
    expect(occurrencesForYears('monthly', 1)).toBe(12);
  });

  it('1回きりの「繰り返し」を作らない', () => {
    // 端数で 1 に落ちても、繰り返しとして成立する最小の 2 を返す。
    expect(occurrencesForYears('yearly', 0.1)).toBe(2);
  });

  it('知らない頻度は週次として扱う', () => {
    expect(occurrencesForYears('fortnightly')).toBe(occurrencesForYears('weekly'));
  });
});
