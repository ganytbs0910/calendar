// ── intention-parser Worker ──────────────────────────────────────────────
//
// Re-parses ONLY the fragments the on-device rule-based parser
// (src/agent/intentionParser.ts) had zero real signal for — see
// Intention.lowConfidence there for exactly which case that is. Everything
// the local parser is confident about never reaches this Worker at all.
//
// GEMINI_API_KEY lives here as a Worker secret and is never sent to the
// client. FALLBACK_SHARED_TOKEN is NOT a secret — it just keeps a random
// internet stranger who finds the URL from casually hammering it; the real
// backstop against abuse is Gemini's own free-tier rate limit, mirroring
// how the Supabase feedback pipeline treats its anon key as public and
// leans on RLS instead (see docs/discord-setup.md).
//
// Setup: docs/gemini-fallback-setup.md

export interface Env {
  GEMINI_API_KEY: string;
  FALLBACK_SHARED_TOKEN: string;
}

// Verify this against https://ai.google.dev/gemini-api/docs/models at setup
// time — free-tier flash model names/availability change over time.
const GEMINI_MODEL = 'gemini-2.0-flash';

// Mirrors src/agent/types.ts's IntentionKind + Intention shape. Kept as a
// hand-written description (not generated from the TS file) since the
// Worker has no build step that could import from the app — if types.ts
// grows a new field the solver actually uses, update this prompt too.
const SYSTEM_PROMPT = `あなたは日本語（および英語）の自然文で書かれた予定・タスクの宣言を、構造化データに変換するアシスタントです。
入力は「ルールベースのパーサーが解釈できなかった断片」です。1つの断片につき、必ず1つのオブジェクトを返してください（省略・統合は禁止）。

各断片について、以下の形式のJSONオブジェクトを1つ作ってください:

{
  "kind": "focus" | "recurring" | "fixed" | "deadline" | "event" | "monthly" | "preference",
  "title": string,               // 短い日本語のラベル（例: 筋トレ、深い作業、アプリをリリース）
  "priority": number,             // 1(できれば)〜5(絶対) 省略時は3
  "durationMin": number,          // 1回あたりの長さ(分)
  "timesPerWeek": number,         // recurring のみ: 週あたりの回数
  "days": number[],               // 曜日の配列。0=日曜〜6=土曜
  "window": {"startHour": number, "endHour": number}, // 希望の時間帯(24時間表記)
  "deadline": "YYYY-MM-DD",       // deadline のみ: 締切日
  "totalEstimateMin": number,     // deadline のみ: 総作業時間の見積り(分)
  "eventDate": "YYYY-MM-DD",      // event のみ: 単発の日付
  "eventEndDate": "YYYY-MM-DD",   // event のみ: 複数日にまたがる場合の最終日（旅行・出張など）
  "allDay": boolean,               // event のみ: 時刻の指定が無い終日の予定
  "monthDay": number,              // monthly のみ: 毎月の日(1-31)
  "monthWeek": number,             // monthly のみ: 第何週か(1-5)。daysと組み合わせて使う
  "lastDayOfMonth": boolean,       // monthly のみ: 毎月末
  "lastBusinessDayOfMonth": boolean, // monthly のみ: 毎月最終営業日
  "lastWeekdayOfMonth": number,    // monthly のみ: 毎月最終の特定曜日(0=日曜〜6=土曜)
  "monthInterval": number,         // monthly のみ: 何ヶ月ごとか(隔月なら2)
  "crossesMidnight": boolean,      // 深夜0時をまたぐ予定
  "protect": boolean,              // focus のみ: 死守すべきかどうか
  "explicitRecurrence": boolean    // fixed/focus のみ: 「毎週」「ずっと」等、明示的に継続を示す言葉があったか
}

各 kind の意味:
- focus: 死守すべき集中時間の確保（例:「平日午前は深い作業を死守」）
- recurring: 週あたりの頻度で管理する習慣（例:「週3で筋トレ」）
- fixed: 曜日と時間が決まった継続的な予定（例:「金曜夜は夕飯」）
- deadline: 期限のあるタスク（例:「今月末までにリリース」）
- event: 単発の予定（例:「9月10日は誕生日」）
- monthly: 月に1回程度の予定（例:「毎月1日に家賃支払い」「第2土曜日にサークル」）
- preference: スケジュールを組む上でのこだわり（例:「移動はまとめたい」）

該当しない項目は省略して構いません（null不要）。"今日"は与えられた now を基準に解釈してください。
"夜7時"のような曖昧な時刻表現は文脈から24時間表記に正しく変換してください（"夜7時"は19時、"深夜1時"は1時のまま、など）。`;

interface RequestBody {
  fragments: unknown;
  now: unknown;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return jsonResponse({error: 'method not allowed'}, 405);

    if (request.headers.get('X-Fallback-Token') !== env.FALLBACK_SHARED_TOKEN) {
      return jsonResponse({error: 'unauthorized'}, 401);
    }

    let body: RequestBody;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({error: 'invalid json'}, 400);
    }

    const {fragments, now} = body;
    if (!Array.isArray(fragments) || fragments.length === 0 || !fragments.every(f => typeof f === 'string')) {
      return jsonResponse({error: 'fragments must be a non-empty string[]'}, 400);
    }
    if (typeof now !== 'string') {
      return jsonResponse({error: 'now must be an ISO date string'}, 400);
    }
    // A generous but finite cap — this endpoint only ever receives the
    // handful of fragments one declaration produced, never a bulk import.
    if (fragments.length > 20) {
      return jsonResponse({error: 'too many fragments'}, 400);
    }

    const userPrompt =
      `今日の日付(now): ${now}\n\n断片一覧（この順序のまま、同じ数だけJSONオブジェクトを返してください）:\n` +
      fragments.map((f, i) => `${i + 1}. ${f}`).join('\n');

    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

    let geminiRes: Response;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          system_instruction: {parts: [{text: SYSTEM_PROMPT}]},
          contents: [{role: 'user', parts: [{text: userPrompt}]}],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                intentions: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      kind: {type: 'STRING'},
                      title: {type: 'STRING'},
                      priority: {type: 'NUMBER'},
                      durationMin: {type: 'NUMBER'},
                      timesPerWeek: {type: 'NUMBER'},
                      days: {type: 'ARRAY', items: {type: 'NUMBER'}},
                      window: {
                        type: 'OBJECT',
                        properties: {startHour: {type: 'NUMBER'}, endHour: {type: 'NUMBER'}},
                      },
                      deadline: {type: 'STRING'},
                      totalEstimateMin: {type: 'NUMBER'},
                      eventDate: {type: 'STRING'},
                      eventEndDate: {type: 'STRING'},
                      allDay: {type: 'BOOLEAN'},
                      monthDay: {type: 'NUMBER'},
                      monthWeek: {type: 'NUMBER'},
                      lastDayOfMonth: {type: 'BOOLEAN'},
                      lastBusinessDayOfMonth: {type: 'BOOLEAN'},
                      lastWeekdayOfMonth: {type: 'NUMBER'},
                      monthInterval: {type: 'NUMBER'},
                      crossesMidnight: {type: 'BOOLEAN'},
                      protect: {type: 'BOOLEAN'},
                      explicitRecurrence: {type: 'BOOLEAN'},
                    },
                    required: ['kind', 'title'],
                  },
                },
              },
              required: ['intentions'],
            },
          },
        }),
      });
    } catch (e) {
      return jsonResponse({error: 'gemini request failed', detail: String(e)}, 502);
    }

    if (!geminiRes.ok) {
      return jsonResponse({error: 'gemini error', status: geminiRes.status}, 502);
    }

    let geminiBody: {candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>};
    try {
      geminiBody = await geminiRes.json();
    } catch {
      return jsonResponse({error: 'gemini returned non-json'}, 502);
    }

    const text = geminiBody.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return jsonResponse({error: 'empty gemini response'}, 502);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return jsonResponse({error: 'gemini response was not valid json'}, 502);
    }

    // Pass through as-is — the client (checkWithGemini) does its own
    // validation of shape/length before trusting this.
    return jsonResponse(parsed);
  },
};
