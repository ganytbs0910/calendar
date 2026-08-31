// ── geminiFallbackService — 低確信な予定宣言だけをクラウドで再解析 ──────────────
//
// intentionParser.ts のルールベース解析が「本当に何の手がかりも掴めなかった」
// 場合（Intention.lowConfidence、詳細はそちらのコメント参照）だけ、この経路で
// Cloudflare Worker 経由の Gemini（無料枠）に投げて再解釈する。
// 確信が持てているものは一切ネットワークに出ない — 意見ボックスと同じく、
// この経路が動くのは「ローカル解析だけでは判断できなかったとき」に限られる。
//
// セットアップ手順（Workerのデプロイ・Geminiキーの発行）は
// docs/gemini-fallback-setup.md を参照。キーが未発行の間は常に
// {ok:false, reason:'network'} 相当で失敗し、呼び出し側はローカルの
// 推測結果をそのまま使う（動作は壊れない、精度が上がらないだけ）。
//
// fetchの形（AbortController + タイムアウト、単発でリトライなし、
// 失敗理由を判別語unionで返す）は feedbackService.ts と揃えてある。

import type {DayOfWeek, Intention, IntentionKind, TimeWindow} from '../agent/types';

// Worker 未デプロイの間はこの定数を書き換えるだけで有効化できる。
// .env等は使わず、feedbackService.ts と同じく直書きの定数にしている
// （このアプリに環境変数の仕組みが無いため）。
const WORKER_URL = 'https://intention-parser.YOUR-SUBDOMAIN.workers.dev/parse';

// 意見ボックスとは違い秘密の鍵ではない — 本当の秘密（Gemini APIキー）は
// Worker側にのみ置く。これは「無関係な第三者がURLだけ見つけて直叩きする」
// のを防ぐ簡易ヘッダーで、Workerが同じ値を要求する。
const SHARED_HEADER_TOKEN = 'calendar-intention-fallback-v1';

const TIMEOUT_MS = 15000;

/** Gemini が返す、1件ぶんの再解析結果。Intention のうち解析対象になりうる項目のみ。 */
export interface GeminiParsedFields {
  kind: IntentionKind;
  title: string;
  priority?: number;
  durationMin?: number;
  timesPerWeek?: number;
  days?: DayOfWeek[];
  window?: TimeWindow;
  deadline?: string;
  totalEstimateMin?: number;
  eventDate?: string;
  eventEndDate?: string;
  allDay?: boolean;
  monthDay?: number;
  monthWeek?: number;
  lastDayOfMonth?: boolean;
  lastBusinessDayOfMonth?: boolean;
  lastWeekdayOfMonth?: DayOfWeek;
  monthInterval?: number;
  crossesMidnight?: boolean;
  protect?: boolean;
  explicitRecurrence?: boolean;
}

export type GeminiFallbackResult =
  | {ok: true; parsed: GeminiParsedFields[]}
  | {ok: false; reason: 'network' | 'invalid'};

const VALID_KINDS: readonly IntentionKind[] =
  ['focus', 'recurring', 'fixed', 'deadline', 'event', 'monthly', 'preference'];

/**
 * Geminiの応答は構造化出力とはいえ外部由来のJSON — アプリの状態を壊さないよう
 * 最低限（kind が既知の値・title が空でない文字列）だけ検証する。それ以外の
 * 項目は多少形が崩れていてもそのまま通す（呼び出し側がIntentionへマージする
 * 際、既存の値を上書きするのはGeminiが返した項目だけなので、実害は小さい）。
 */
const isValidParsedFields = (v: unknown): v is GeminiParsedFields => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.kind === 'string' && VALID_KINDS.includes(o.kind as IntentionKind)
    && typeof o.title === 'string' && o.title.trim().length > 0;
};

/**
 * lowConfidence な断片の原文（`Intention.raw`）を、送った順序のまま
 * `GeminiParsedFields[]` で受け取る。1件でも壊れていれば全体を invalid として
 * 扱う — 部分的に信頼できないリストをそのままIntentionへマージするより、
 * ローカルの推測結果を使い続ける方が安全なため。
 */
export const checkWithGemini = async (
  fragments: string[],
  now: Date,
): Promise<GeminiFallbackResult> => {
  if (fragments.length === 0) return {ok: true, parsed: []};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Fallback-Token': SHARED_HEADER_TOKEN,
      },
      body: JSON.stringify({
        fragments,
        now: now.toISOString(),
      }),
    });

    if (!res.ok) return {ok: false, reason: 'network'};

    const body = (await res.json()) as {intentions?: unknown};
    const list = body.intentions;
    if (!Array.isArray(list) || list.length !== fragments.length || !list.every(isValidParsedFields)) {
      return {ok: false, reason: 'invalid'};
    }

    return {ok: true, parsed: list};
  } catch (e) {
    // 中断（タイムアウト）と通信断はどちらも「今は再確認できない」。
    // 呼び出し側はローカルの推測結果をそのまま使い、処理を止めない。
    if (__DEV__) console.warn('[geminiFallback] check failed', e);
    return {ok: false, reason: 'network'};
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Splices a `checkWithGemini` result back into the full parsed list, in
 * place of the low-confidence entries it was computed from (order-matched —
 * the caller must have sent `parsed.filter(i => i.lowConfidence).map(i =>
 * i.raw)` to get `result`). High-confidence entries are returned untouched.
 * A failed/invalid result — or a parsed-count mismatch that should never
 * happen but is checked defensively anyway — just returns `parsed` as-is,
 * so a broken cloud round-trip never corrupts the local guess.
 *
 * Pulled out as a pure function (no React, no fetch) so the merge logic can
 * be unit-tested without rendering AgentScreen.
 */
export const mergeLowConfidenceFallback = (
  parsed: Intention[],
  result: GeminiFallbackResult,
): Intention[] => {
  if (!result.ok) return parsed;
  const lowIndexes = parsed.reduce<number[]>((acc, i, idx) => {
    if (i.lowConfidence) acc.push(idx);
    return acc;
  }, []);
  if (lowIndexes.length !== result.parsed.length) return parsed;

  const merged = [...parsed];
  lowIndexes.forEach((idx, j) => {
    merged[idx] = {...merged[idx], ...result.parsed[j], lowConfidence: false};
  });
  return merged;
};
