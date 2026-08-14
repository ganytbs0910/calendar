// ── feedbackService — 意見ボックスの送信 ─────────────────────────────────────
//
// このアプリが外部にデータを送る唯一の経路。
// 利用者が意見ボックスに本文を書いて送信ボタンを押したときだけ動く。
// 起動・利用状況・予定の中身は一切送らない（掲載説明文の
// 「端末内で完結。アカウント登録は不要です」はこの前提で書かれている）。
//
// 送信先は BrawlStatus と同じ Supabase プロジェクトの calendar_feedback。
// DBのトリガーが Discord へ即通知する。詳細は
// supabase/migrations/20260815_calendar_discord.sql を参照。
//
// ★ @supabase/supabase-js を使わず fetch で直接 PostgREST を叩いている。
//   必要なのは INSERT 1本だけで、そのためにSDKとURLポリフィルを足すと
//   バンドルが100KB以上増える（このアプリはバンドルサイズを継続計測している）。
//   ネイティブモジュールが増えないので pod install も再ビルドも要らない。
//   ワイヤ上の形式はSDK経由と同一。

import {Platform} from 'react-native';
import DeviceInfo from 'react-native-device-info';

import i18n from '../i18n/i18n';

const SUPABASE_URL = 'https://llxmsbnqtdlqypnwapzz.supabase.co';

// anon キーは公開前提のもの。アプリのバイナリに埋まって配布される以上、
// 秘密にはできない。守っているのは RLS 側で、calendar_feedback は
// INSERT のみ許可・SELECT ポリシー無し・WITH CHECK で長さと形式を検証している。
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxseG1zYm5xdGRscXlwbndhcHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4MjA5MjEsImV4cCI6MjA1MzM5NjkyMX0.EkqepILQU0KgOTW1ZaXpe54ERpZbSRodf24r5022VKs';

const ENDPOINT = `${SUPABASE_URL}/rest/v1/calendar_feedback`;

/** DB の `category = any(array[...])` と必ず揃えること。 */
export type FeedbackCategory = 'bug' | 'request' | 'ux' | 'other';

/** DB の WITH CHECK と同じ上限。片方だけ変えると送信が 403 で落ちる。 */
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_CONTACT_LENGTH = 200;

/** ネットワークが死んでいるときに送信中のまま固まらないための上限。 */
const TIMEOUT_MS = 15000;

export type FeedbackResult =
  | {ok: true}
  | {ok: false; reason: 'empty' | 'tooLong' | 'tooFast' | 'rejected' | 'network' | 'failed'};

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  contact?: string;
}

/** 本文に URL が2本以上あると DB 側の WITH CHECK で弾かれる。手前で同じ判定をする。 */
const looksLikeLinkSpam = (message: string): boolean =>
  (message.match(/https?:\/\//gi) ?? []).length >= 2;

/**
 * 意見を1件送る。
 *
 * 投げっぱなしにせず、失敗の理由まで返す。利用者から見ると
 * 「送れなかった」だけでは書いた本文をどうすればいいか分からないため。
 */
export const submitFeedback = async (input: FeedbackInput): Promise<FeedbackResult> => {
  const message = input.message.trim();
  const contact = (input.contact ?? '').trim();

  if (message.length === 0) return {ok: false, reason: 'empty'};
  if (message.length > MAX_MESSAGE_LENGTH) return {ok: false, reason: 'tooLong'};
  if (looksLikeLinkSpam(message)) return {ok: false, reason: 'rejected'};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        // 行を返させない。返させると SELECT 相当の権限が要る。
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        category: input.category,
        message,
        app_version: DeviceInfo.getVersion(),
        platform: Platform.OS,
        language: i18n.language,
        contact: contact || null,
      }),
    });

    if (res.ok) return {ok: true};

    // レート制限は BEFORE INSERT トリガーが check_violation (23514) で返す。
    // WITH CHECK に引っかかった場合は RLS 違反 (42501) になる。
    let code = '';
    try {
      code = ((await res.json()) as {code?: string}).code ?? '';
    } catch {
      // 本文が JSON でないこともある。その場合はコード無しとして扱う。
    }

    if (code === '23514') return {ok: false, reason: 'tooFast'};
    if (code === '42501') return {ok: false, reason: 'rejected'};
    return {ok: false, reason: 'failed'};
  } catch (e) {
    // 中断（タイムアウト）と通信断はどちらも利用者にとっては「今は送れない」。
    // 書いた本文は画面に残すので、時間を置いて再送できる。
    if (__DEV__) console.warn('[feedback] submit failed', e);
    return {ok: false, reason: 'network'};
  } finally {
    clearTimeout(timer);
  }
};
