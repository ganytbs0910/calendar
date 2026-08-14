/**
 * 意見ボックスの送信。
 *
 * これはこのアプリが外部にデータを送る唯一の経路なので、
 * 「何を送るか」を一番きつく固定してある（下の "送る項目" ブロック）。
 * 送信項目が増えたらこのテストが落ち、掲載説明文とプライバシー方針を
 * 見直す必要があることに気付ける。
 *
 * @format
 */

import {submitFeedback, MAX_MESSAGE_LENGTH} from '../src/services/feedbackService';

jest.mock('../src/i18n/i18n', () => ({__esModule: true, default: {language: 'ja'}}));

const mockFetch = jest.fn();
(globalThis as {fetch?: unknown}).fetch = mockFetch;

/** PostgREST の応答を組み立てる。 */
const respond = (status: number, body?: unknown) =>
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
  });

const bodyOf = (call = 0) => JSON.parse(mockFetch.mock.calls[call][1].body);
const headersOf = (call = 0) => mockFetch.mock.calls[call][1].headers;

const send = (over: Partial<Parameters<typeof submitFeedback>[0]> = {}) =>
  submitFeedback({category: 'bug', message: 'テストです', ...over});

beforeEach(() => mockFetch.mockReset());

describe('送信前の検証（通信しない）', () => {
  it('空の内容は送らない', async () => {
    await expect(send({message: ''})).resolves.toEqual({ok: false, reason: 'empty'});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('空白だけの内容も空として扱う', async () => {
    await expect(send({message: '   \n  '})).resolves.toEqual({ok: false, reason: 'empty'});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('上限を超える内容は送らない', async () => {
    const long = 'あ'.repeat(MAX_MESSAGE_LENGTH + 1);
    await expect(send({message: long})).resolves.toEqual({ok: false, reason: 'tooLong'});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ちょうど上限は通す', async () => {
    respond(201);
    await expect(send({message: 'あ'.repeat(MAX_MESSAGE_LENGTH)})).resolves.toEqual({ok: true});
  });

  it('URLが2本以上あると送らない（DB側のWITH CHECKと同じ判定）', async () => {
    const spam = 'https://a.example と https://b.example を見てください';
    await expect(send({message: spam})).resolves.toEqual({ok: false, reason: 'rejected'});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('URL1本は正当な意見として通す', async () => {
    respond(201);
    await expect(send({message: 'https://example.com と連携してほしいです'})).resolves.toEqual({
      ok: true,
    });
  });
});

describe('送る項目', () => {
  it('宣言した項目だけを送る（予定の内容は含まない）', async () => {
    respond(201);
    await send({message: '週表示が見にくいです', contact: 'a@example.com'});

    // 画面の注記が約束しているのはこの6項目だけ。増えたらここで落ちる。
    expect(Object.keys(bodyOf()).sort()).toEqual(
      ['app_version', 'category', 'contact', 'language', 'message', 'platform'].sort(),
    );
  });

  it('本文の前後の空白を落として送る', async () => {
    respond(201);
    await send({message: '  ずれています  '});
    expect(bodyOf().message).toBe('ずれています');
  });

  it('連絡先が空なら null を送る（空文字にしない）', async () => {
    respond(201);
    await send({contact: '   '});
    expect(bodyOf().contact).toBeNull();
  });

  it('行を返させない — 返させると SELECT 相当の権限が要る', async () => {
    respond(201);
    await send();
    expect(headersOf().Prefer).toBe('return=minimal');
  });
});

describe('失敗の理由を見分ける', () => {
  it('レート制限(23514)は待てば送れると伝える', async () => {
    respond(400, {code: '23514', message: '送信の間隔が短すぎます。'});
    await expect(send()).resolves.toEqual({ok: false, reason: 'tooFast'});
  });

  it('RLS違反(42501)は内容の問題として伝える', async () => {
    // 本番で実測したステータスは 403 ではなく 401（PostgREST の挙動）。
    // 判定を HTTP ステータスではなく本文の code で行っているのはこのため。
    // ステータスに依存していたら、内容の問題を「認証エラー」と誤って扱っていた。
    respond(401, {code: '42501', message: 'violates row-level security policy'});
    await expect(send()).resolves.toEqual({ok: false, reason: 'rejected'});
  });

  it('レート制限も同様に、ステータスではなく code で見分ける', async () => {
    respond(401, {code: '23514', message: '送信の間隔が短すぎます。'});
    await expect(send()).resolves.toEqual({ok: false, reason: 'tooFast'});
  });

  it('その他のエラーは failed', async () => {
    respond(500, {code: 'XX000', message: 'boom'});
    await expect(send()).resolves.toEqual({ok: false, reason: 'failed'});
  });

  it('本文がJSONでない応答でも落ちない', async () => {
    respond(502);
    await expect(send()).resolves.toEqual({ok: false, reason: 'failed'});
  });

  it('通信断は network として返す', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(send()).resolves.toEqual({ok: false, reason: 'network'});
  });

  it('タイムアウトで中断されても network として返る', async () => {
    // 実際の中断は AbortController が起こす。ここでは同じ例外の形を再現する。
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abort);
    await expect(send()).resolves.toEqual({ok: false, reason: 'network'});
  });

  it('中断用のシグナルを必ず渡している（無いと永久に待つ）', async () => {
    respond(201);
    await send();
    expect(mockFetch.mock.calls[0][1].signal).toBeDefined();
  });
});
