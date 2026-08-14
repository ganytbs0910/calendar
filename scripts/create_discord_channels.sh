#!/usr/bin/env bash
#
# カレンダー用の Discord カテゴリとチャンネルを作る（初回のみ）。
#
# BrawlStatus と同じ Bot・同じサーバーを使い、チャンネルだけ増やす。
# 移植元: ~/Desktop/Brawl/docs/discord-ops-kit.md STEP 1-2
#
# 使い方:
#   export DISCORD_BOT_TOKEN='...'      # Supabase の vault にある discord_bot_token
#   ./scripts/create_discord_channels.sh
#
# トークンの取り出し方（Supabase ダッシュボード → SQL Editor）:
#   select decrypted_secret from vault.decrypted_secrets where name = 'discord_bot_token';
#
# 出力されたチャンネルIDを supabase/migrations/20260815_calendar_discord.sql の
# <FEEDBACK_ID> / <ANALYTICS_ID> に貼る。

set -euo pipefail

GUILD_ID='1451992089503072443'
CATEGORY_NAME='カレンダー'
CHANNELS=(feedback analytics)
PREFIX='calendar'

if [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then
  echo "DISCORD_BOT_TOKEN が未設定です。" >&2
  echo "  export DISCORD_BOT_TOKEN='...'" >&2
  exit 1
fi

api() {
  # $1=method $2=path $3=body(任意)
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "https://discord.com/api/v10${path}" \
      -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "https://discord.com/api/v10${path}" \
      -H "Authorization: Bot ${DISCORD_BOT_TOKEN}"
  fi
}

# ── 0. トークンとサーバー参加の確認 ─────────────────────────────────────────
# ここで落としておかないと、後続が中途半端に作られる。
echo "▸ Bot とサーバーを確認中..."
guilds="$(api GET /users/@me/guilds)"
if ! echo "$guilds" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "サーバー一覧を取得できませんでした。トークンを確認してください:" >&2
  echo "$guilds" | jq -r '.message // .' >&2
  exit 1
fi
if ! echo "$guilds" | jq -e --arg g "$GUILD_ID" '.[] | select(.id == $g)' >/dev/null; then
  echo "Bot がサーバー ${GUILD_ID} に参加していません。" >&2
  echo "参加中のサーバー:" >&2
  echo "$guilds" | jq -r '.[] | "  \(.id)  \(.name)"' >&2
  exit 1
fi
echo "  OK: $(echo "$guilds" | jq -r --arg g "$GUILD_ID" '.[] | select(.id==$g) | .name')"

# ── 1. カテゴリ（既にあれば作り直さない）────────────────────────────────────
# 二度流しても増殖しないよう、名前で既存を探してから作る。
existing="$(api GET "/guilds/${GUILD_ID}/channels")"
cat_id="$(echo "$existing" | jq -r --arg n "$CATEGORY_NAME" \
  'map(select(.type == 4 and .name == $n)) | .[0].id // empty')"

if [[ -n "$cat_id" ]]; then
  echo "▸ カテゴリ「${CATEGORY_NAME}」は既にあります (${cat_id})"
else
  echo "▸ カテゴリ「${CATEGORY_NAME}」を作成中..."
  res="$(api POST "/guilds/${GUILD_ID}/channels" \
    "$(jq -nc --arg n "$CATEGORY_NAME" '{name:$n, type:4}')")"
  cat_id="$(echo "$res" | jq -r '.id // empty')"
  if [[ -z "$cat_id" ]]; then
    echo "作成に失敗しました:" >&2
    echo "$res" | jq -r '.message // .' >&2
    echo "（Bot に Manage Channels 権限があるか確認してください）" >&2
    exit 1
  fi
  echo "  作成: ${cat_id}"
fi

# ── 2. チャンネル ───────────────────────────────────────────────────────────
echo ""
echo "▸ チャンネル:"
declare -a ids=()
for ch in "${CHANNELS[@]}"; do
  name="${PREFIX}-${ch}"
  id="$(echo "$existing" | jq -r --arg n "$name" \
    'map(select(.type == 0 and .name == $n)) | .[0].id // empty')"

  if [[ -z "$id" ]]; then
    res="$(api POST "/guilds/${GUILD_ID}/channels" \
      "$(jq -nc --arg n "$name" --arg p "$cat_id" '{name:$n, type:0, parent_id:$p}')")"
    id="$(echo "$res" | jq -r '.id // empty')"
    if [[ -z "$id" ]]; then
      echo "  ${name}: 作成失敗 — $(echo "$res" | jq -r '.message // .')" >&2
      exit 1
    fi
    echo "  ${name}  ${id}  (作成)"
  else
    echo "  ${name}  ${id}  (既存)"
  fi
  ids+=("$id")
done

# ── 3. 貼り付け用に出す ─────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────
次の2行を supabase/migrations/20260815_calendar_discord.sql の
「1. 宛先チャンネル」に反映してください:

  ('discord_channel_calendar_feedback',  '${ids[0]}'),
  ('discord_channel_calendar_analytics', '${ids[1]}')
────────────────────────────────────────────────────────────
EOF
