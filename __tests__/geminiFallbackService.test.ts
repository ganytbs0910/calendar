/**
 * lowConfidence な予定宣言だけを Cloudflare Worker 経由で Gemini に再解析させる
 * 経路。実APIは叩かず、fetch をモックして検証する。
 *
 * @format
 */

import {checkWithGemini, mergeLowConfidenceFallback} from '../src/services/geminiFallbackService';
import type {Intention} from '../src/agent/types';

const mockFetch = jest.fn();
(globalThis as {fetch?: unknown}).fetch = mockFetch;

const respond = (status: number, body?: unknown) =>
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
  });

const now = new Date(2026, 7, 31);

const validField = {kind: 'event', title: '歯医者', eventDate: '2026-09-10'};

beforeEach(() => mockFetch.mockReset());

describe('何も送るものが無ければ通信しない', () => {
  it('fragments が空なら fetch を呼ばず ok:true で空配列を返す', async () => {
    await expect(checkWithGemini([], now)).resolves.toEqual({ok: true, parsed: []});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('成功時', () => {
  it('送った件数だけ妥当な結果が返れば ok:true で通す', async () => {
    respond(200, {intentions: [validField]});
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: true,
      parsed: [validField],
    });
  });

  it('本文に断片配列と now を渡している', async () => {
    respond(200, {intentions: [validField]});
    await checkWithGemini(['9/10に歯医者'], now);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fragments).toEqual(['9/10に歯医者']);
    expect(body.now).toBe(now.toISOString());
  });

  it('中断用のシグナルを必ず渡している', async () => {
    respond(200, {intentions: [validField]});
    await checkWithGemini(['9/10に歯医者'], now);
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined();
  });
});

describe('壊れた応答は invalid として弾き、ローカル結果を守る', () => {
  it('件数が送った断片数と一致しなければ invalid', async () => {
    respond(200, {intentions: [validField, validField]});
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('kind が未知の値なら invalid（1件でも壊れていれば全体を invalid とする）', async () => {
    respond(200, {intentions: [{...validField, kind: 'nonsense'}]});
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('title が空文字なら invalid', async () => {
    respond(200, {intentions: [{...validField, title: ''}]});
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('intentions が配列でなければ invalid', async () => {
    respond(200, {intentions: 'not-an-array'});
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('通信できないときはローカル結果に任せる', () => {
  it('HTTPエラーは network として返す', async () => {
    respond(500);
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'network',
    });
  });

  it('通信断は network として返す', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'network',
    });
  });

  it('タイムアウト（AbortError）も network として返る', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abort);
    await expect(checkWithGemini(['9/10に歯医者'], now)).resolves.toEqual({
      ok: false,
      reason: 'network',
    });
  });
});

describe('mergeLowConfidenceFallback', () => {
  const intn = (over: Partial<Intention> = {}): Intention => ({
    id: 'int-1',
    raw: '月1で美容院',
    title: '月1で美容院',
    kind: 'recurring',
    priority: 3,
    durationMin: 60,
    color: '#007AFF',
    createdAt: new Date().toISOString(),
    active: true,
    lowConfidence: true,
    ...over,
  });

  it('置き換えるのは lowConfidence な項目だけ、高確信の項目はそのまま', () => {
    const highConfidence = intn({id: 'int-hc', lowConfidence: false, kind: 'fixed', title: '英会話'});
    const lowConfidenceOne = intn();
    const merged = mergeLowConfidenceFallback(
      [highConfidence, lowConfidenceOne],
      {ok: true, parsed: [{kind: 'monthly', title: '美容院', monthDay: 1}]},
    );

    expect(merged[0]).toEqual(highConfidence); // 参照ごと変わっていない
    expect(merged[1].kind).toBe('monthly');
    expect(merged[1].title).toBe('美容院');
    expect(merged[1].monthDay).toBe(1);
    expect(merged[1].lowConfidence).toBe(false); // 解決済みとしてフラグが下りる
    // id/raw/color/createdAt はローカルの元の値を維持する
    expect(merged[1].id).toBe(lowConfidenceOne.id);
    expect(merged[1].raw).toBe(lowConfidenceOne.raw);
  });

  it('result が ok:false ならローカルの推測結果をそのまま返す', () => {
    const parsed = [intn()];
    const merged = mergeLowConfidenceFallback(parsed, {ok: false, reason: 'network'});
    expect(merged).toBe(parsed); // 同じ配列を返す（コピーすらしない）
  });

  it('件数が合わない（起きないはずだが）場合も安全側でローカル結果を守る', () => {
    const parsed = [intn(), intn({id: 'int-2'})];
    const merged = mergeLowConfidenceFallback(parsed, {
      ok: true,
      parsed: [{kind: 'event', title: 'x'}], // 2件のはずが1件しか無い
    });
    expect(merged).toBe(parsed);
  });

  it('lowConfidence な項目が無ければ何もしない', () => {
    const parsed = [intn({lowConfidence: false})];
    const merged = mergeLowConfidenceFallback(parsed, {ok: true, parsed: []});
    expect(merged[0]).toEqual(parsed[0]);
  });
});
