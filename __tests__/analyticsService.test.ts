/**
 * 匿名の起動シグナル(analyticsService)。
 *
 * feedbackService.ts に続く、このアプリ2つ目の外部送信経路。ここでは
 * 「1日1回しか送らない」「失敗しても投げない」「送る項目は増えていない
 * (端末IDと最低限の環境情報だけ)」ことを固定する。
 *
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {pingDeviceOnce} from '../src/services/analyticsService';

jest.mock('../src/i18n/i18n', () => ({__esModule: true, default: {language: 'ja'}}));
jest.mock('react-native-device-info', () => ({getVersion: () => '9.9.9'}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

/**
 * 「前回送った日付」「端末ID」の読み書きを1テスト内で完結する素朴な
 * key-valueに繋ぎ直す。モジュール共有のMapをまたいで持たせようとすると
 * jest.mock()のホイスティング順序でモックのクロージャと参照がずれる
 * ことがあるため、状態はテストごとにローカルへ閉じ込める。
 */
const useMockStorage = () => {
  const data: Record<string, string> = {};
  mockGetItem.mockImplementation((key: string) => Promise.resolve(data[key] ?? null));
  mockSetItem.mockImplementation((key: string, value: string) => {
    data[key] = value;
    return Promise.resolve();
  });
  return data;
};

const mockFetch = jest.fn();
(globalThis as {fetch?: unknown}).fetch = mockFetch;

const respond = (ok: boolean) => mockFetch.mockResolvedValueOnce({ok});

beforeEach(() => {
  mockFetch.mockReset();
  mockGetItem.mockReset();
  mockSetItem.mockReset();
});

describe('送る項目', () => {
  it('端末IDと最低限の環境情報だけを送る(予定の内容や利用状況は含まない)', async () => {
    useMockStorage();
    respond(true);
    await pingDeviceOnce();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/rest/v1/rpc/calendar_ping_device');

    const body = JSON.parse(opts.body);
    expect(Object.keys(body).sort()).toEqual(
      ['p_app_version', 'p_device_id', 'p_language', 'p_platform'].sort(),
    );
    expect(typeof body.p_device_id).toBe('string');
    expect(body.p_device_id.length).toBeGreaterThan(0);
  });

  it('同じ端末IDを使い回す(呼ぶたびに新しいIDを作らない)', async () => {
    const storage = useMockStorage();
    respond(true);
    await pingDeviceOnce();
    const firstId = JSON.parse(mockFetch.mock.calls[0][1].body).p_device_id;

    // 2回目は同日中の抑制に引っかかるので、抑制の記録を消してから呼び直す。
    delete storage['@calendar_last_ping_date'];
    respond(true);
    await pingDeviceOnce();
    const secondId = JSON.parse(mockFetch.mock.calls[1][1].body).p_device_id;

    expect(secondId).toBe(firstId);
  });
});

describe('1日1回だけ送る', () => {
  it('同じ日に2回呼んでも通信は1回だけ', async () => {
    useMockStorage();
    respond(true);
    await pingDeviceOnce();
    await pingDeviceOnce();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('送信に失敗したら「送った」記録を残さない(次回また試せる)', async () => {
    useMockStorage();
    respond(false);
    await pingDeviceOnce();
    respond(true);
    await pingDeviceOnce();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('失敗しても投げない', () => {
  it('通信断でも例外を投げない', async () => {
    useMockStorage();
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(pingDeviceOnce()).resolves.toBeUndefined();
  });

  it('タイムアウト(AbortError)でも例外を投げない', async () => {
    useMockStorage();
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abort);
    await expect(pingDeviceOnce()).resolves.toBeUndefined();
  });

  it('中断用のシグナルを必ず渡している(無いと永久に待つ)', async () => {
    useMockStorage();
    respond(true);
    await pingDeviceOnce();
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined();
  });
});
