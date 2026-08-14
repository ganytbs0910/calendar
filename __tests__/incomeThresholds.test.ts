/**
 * 年収の壁の既定値は、利用者に見せる税制上の目安そのもの。制度改正で意味を
 * 失った値（103万・106万）が残っていたのを2026-08に入れ替えたので、次に
 * 誰かが触ったときに黙って戻らないよう固定しておく。
 *
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_INCOME_THRESHOLDS,
  getIncomeThresholds,
} from '../src/services/statisticsService';

const getItem = AsyncStorage.getItem as unknown as jest.Mock;

beforeEach(() => {
  getItem.mockReset();
});

it('学生向けの4本を既定値として持つ', () => {
  expect(DEFAULT_INCOME_THRESHOLDS).toEqual([
    1_300_000, // 親の社会保険の扶養から外れる
    1_500_000, // 特定親族特別控除が減り始める（学生の主要な壁）
    1_600_000, // 本人に所得税がかかり始める（2025年改正で103万から移動）
    1_880_000, // 同控除が消える
  ]);
});

it('制度改正で意味を失った 103万 / 106万 を既定値に含まない', () => {
  expect(DEFAULT_INCOME_THRESHOLDS).not.toContain(1_030_000);
  expect(DEFAULT_INCOME_THRESHOLDS).not.toContain(1_060_000);
});

it('保存された値が無ければ既定値を返す（＝既存利用者も新しい目安を受け取る）', async () => {
  getItem.mockResolvedValue(null);

  await expect(getIncomeThresholds()).resolves.toEqual(DEFAULT_INCOME_THRESHOLDS);
});

it('利用者が自分で編集した値は既定値で上書きしない', async () => {
  getItem.mockResolvedValue(JSON.stringify([1_030_000, 1_230_000]));

  await expect(getIncomeThresholds()).resolves.toEqual([1_030_000, 1_230_000]);
});

it('保存値が壊れていても既定値に落ちる', async () => {
  getItem.mockResolvedValue('{"not":"an array"}');

  await expect(getIncomeThresholds()).resolves.toEqual(DEFAULT_INCOME_THRESHOLDS);
});
