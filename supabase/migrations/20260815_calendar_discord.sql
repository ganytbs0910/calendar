-- ════════════════════════════════════════════════════════════════════════════
-- カレンダー 意見ボックス + 日次レポート
--
-- BrawlStatus と同じ Supabase プロジェクト (llxmsbnqtdlqypnwapzz) に相乗りする。
-- 移植元: ~/Desktop/Brawl/docs/discord-ops-kit.md
--
-- ★ このファイルは既存オブジェクトを一切変更しない。
--
--   BrawlStatus の本番が動いているプロジェクトなので、共有オブジェクトを
--   create or replace すると、こちらのバグが向こうの通知を止める。
--   したがって:
--
--     触らない  app_feedback / app_feedback_* / send_daily_digest()
--               notify_discord_to() / discord_channel_for() / discord_webhook_for()
--               cron job 'daily-discord-digest'
--
--     追加する  calendar_feedback とその2つのトリガー関数
--               send_calendar_daily_digest()
--               cron job 'calendar-daily-digest'
--               monitoring_config に新しいキーを2行
--
--   notify_discord_to(purpose, ...) は purpose から
--   'discord_channel_' || purpose を引く作りなので、purpose に
--   'calendar_feedback' / 'calendar_analytics' を渡すだけで
--   関数本体を書き換えずに宛先を分けられる。これが相乗りできる理由。
--
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼って実行。
--          先に scripts/create_discord_channels.sh でチャンネルIDを取得しておく。
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. 前提の確認 ───────────────────────────────────────────────────────────
-- BrawlStatus 側で有効化済みのはずだが、無ければここで止める（黙って進むと
-- トリガーは通るのに通知だけ飛ばない状態になり、原因が分かりにくい）。
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net が無効です。create extension pg_net with schema extensions; を先に実行してください';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron が無効です。create extension pg_cron; を先に実行してください';
  end if;
  if not exists (select 1 from pg_proc where proname = 'notify_discord_to') then
    raise exception 'notify_discord_to() がありません。discord-ops-kit.md の STEP 2-3 を先に実行してください';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'discord_bot_token') then
    raise warning 'vault に discord_bot_token がありません。Webhook フォールバックに落ちます';
  end if;
end $$;


-- ── 1. 宛先チャンネル ───────────────────────────────────────────────────────
-- create_discord_channels.sh が 2026-08-15 に作成したチャンネル。
-- サーバー「アプリ管理」(1451992089503072443) の「カレンダー」カテゴリ配下。
--
-- ここを設定し忘れると discord_webhook_for() のフォールバックが働き、
-- カレンダーの意見が BrawlStatus 共通の Webhook チャンネルに流れ込む。
-- 実行後に必ず下の確認クエリで2行入っていることを見ること。
--
-- チャンネルIDは秘密ではない（Botトークンが無ければ投稿できない）。
-- トークンは vault にのみ置き、このファイルにも設定テーブルにも書かない。
insert into public.monitoring_config (key, value) values
  ('discord_channel_calendar_feedback',  '1537885368693555280'),
  ('discord_channel_calendar_analytics', '1537885370253840515')
on conflict (key) do update set value = excluded.value;


-- ── 2. テーブル ─────────────────────────────────────────────────────────────
-- BrawlStatus の app_feedback から player_tag / player_name を落としてある。
-- このアプリはアカウントを持たず、端末に利用者の識別子が存在しないため
-- （移植手順書 3-4 の「無いアプリは丸ごと削る」に従った）。
create table if not exists public.calendar_feedback (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'other',
  message     text not null,
  app_version text,
  platform    text,
  language    text,
  contact     text,
  status      text not null default 'new',   -- 運営用: new/read/done
  client_iph  text,                          -- IPのmd5。生IPは保存しない
  created_at  timestamptz not null default now()
);

create index if not exists idx_calendar_feedback_created on public.calendar_feedback (created_at desc);
create index if not exists idx_calendar_feedback_status  on public.calendar_feedback (status) where status = 'new';

alter table public.calendar_feedback enable row level security;


-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- INSERT だけ許可し、SELECT ポリシーは作らない。
-- anon キーはアプリのバイナリに埋まって配布される（＝公開情報）ので、
-- SELECT を開けた瞬間に全利用者の意見と連絡先が誰でも読める。
-- アプリ側にも送信履歴の表示を持たせていないのは同じ理由。
--
-- 検証はすべてここに書く。クライアントを迂回して curl で直接叩かれる前提。
drop policy if exists calendar_feedback_insert on public.calendar_feedback;
create policy calendar_feedback_insert on public.calendar_feedback
  for insert to anon, authenticated
  with check (
    char_length(message) between 1 and 1000
    and category = any (array['bug','request','ux','other'])
    and char_length(coalesce(contact,''))     <= 200
    and char_length(coalesce(app_version,'')) <= 20
    and char_length(coalesce(platform,''))    <= 20
    and char_length(coalesce(language,''))    <= 10
    -- NGワードのリストは意図的に置いていない。
    -- BrawlStatus の '(代行|チート|販売|RMT|垢売)' はゲームの文脈に固有のもので、
    -- カレンダーアプリでは「販売」「課金」等が課金画面への正当な意見に普通に出る。
    -- 語で弾くと本物の意見が黙って消えるため、実際の攻撃面である
    -- リンクの連投だけを止める（URL 2本以上を拒否）。
    and coalesce(message,'') !~* '(https?://[^[:space:]]*[[:space:]]*){2,}'
  );


-- ── 4. レート制限（BEFORE INSERT）───────────────────────────────────────────
-- 利用者の識別子が無いので、BrawlStatus の「同一タグ 1分3件」に相当する制限は
-- 掛けられない。DB側に残る歯止めは IP ハッシュのみ。
-- アプリ側の二重送信防止は送信中のボタン無効化だけで、迂回できる以上
-- 防御としては数えない。ここが唯一の歯止めである。
create or replace function public.calendar_feedback_rate_limit()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  v_headers json; v_ip text; v_iph text; v_cnt int;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    if v_headers is not null then
      v_ip := nullif(btrim(split_part(
                coalesce(v_headers->>'x-forwarded-for', v_headers->>'cf-connecting-ip',''), ',', 1)), '');
      if v_ip is not null then
        -- 生IPは保存しない。md5 で十分レート制限になる。
        v_iph := md5('calfb1:' || v_ip);

        -- 1時間に20件まで。学校や職場の共有回線で複数人が同時に送る場合を
        -- 考えて BrawlStatus と同じ緩めの値にしてある。
        select count(*) into v_cnt from public.calendar_feedback
         where client_iph = v_iph and created_at > now() - interval '1 hour';
        if v_cnt >= 20 then
          raise exception '送信が多すぎます。しばらく待ってからお試しください。'
            using errcode = 'check_violation';
        end if;

        -- 1分に3件まで（連打・誤操作の抑止）
        select count(*) into v_cnt from public.calendar_feedback
         where client_iph = v_iph and created_at > now() - interval '1 minute';
        if v_cnt >= 3 then
          raise exception '送信の間隔が短すぎます。少し待ってから再度お試しください。'
            using errcode = 'check_violation';
        end if;

        new.client_iph := v_iph;
      end if;
    end if;
  exception
    when check_violation then raise;
    when others then null;      -- ヘッダが取れない環境でも投稿自体は通す
  end;

  new.created_at := now();      -- クライアント指定の日時は信用しない
  new.status     := 'new';      -- 同上
  return new;
end;
$$;

drop trigger if exists trg_calendar_feedback_rate_limit on public.calendar_feedback;
create trigger trg_calendar_feedback_rate_limit
  before insert on public.calendar_feedback
  for each row execute function public.calendar_feedback_rate_limit();


-- ── 5. Discord 通知（AFTER INSERT）──────────────────────────────────────────
create or replace function public.calendar_feedback_notify()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_label text;
begin
  v_label := case new.category
    when 'bug'     then '🐛 不具合'
    when 'request' then '💡 要望'
    when 'ux'      then '🧭 使いにくい'
    else '💬 その他'
  end;

  -- Discord の本文は2000文字上限。超えると 400 で無言で落ちるので
  -- 可変長の message は 900 文字で刈る（全文は DB に残る）。
  perform public.notify_discord_to(
    'calendar_feedback',
    'カレンダー 意見ボックス',
    v_label || E'\n' ||
    '```' || E'\n' || left(new.message, 900) || E'\n' || '```' ||
    coalesce(new.platform,'?') || ' v' || coalesce(new.app_version,'?') ||
    '  |  ' || coalesce(new.language,'?') ||
    coalesce('  |  連絡先: ' || nullif(new.contact,''), '  |  連絡先なし')
  );
  return new;
end;
$$;

drop trigger if exists trg_calendar_feedback_notify on public.calendar_feedback;
create trigger trg_calendar_feedback_notify
  after insert on public.calendar_feedback
  for each row execute function public.calendar_feedback_notify();


-- ── 6. 日次レポート ─────────────────────────────────────────────────────────
-- 集計対象は意見ボックスのみ。
--
-- このアプリは完全にオンデバイスで動いており、サーバーに送っているのは
-- 「利用者が意見ボックスの送信ボタンを押したとき」の本文だけ。
-- 掲載説明文が「端末内で完結。アカウント登録は不要です」と明言しているため、
-- DAU / 新規インストール等の利用状況は収集していない。集計できないのではなく、
-- 集めないと決めてある。ここに利用状況の項目を足すときは、
-- ストア掲載文・プライバシー方針・App Store のプライバシー表示の3つを同時に直すこと。
create or replace function public.send_calendar_daily_digest()
returns text language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  d0 date := (now() at time zone 'Asia/Tokyo')::date - 1;   -- 集計対象（昨日）
  d1 date := (now() at time zone 'Asia/Tokyo')::date - 2;   -- 前日比の相手
  s0 timestamptz := (d0::text || ' 00:00:00 Asia/Tokyo')::timestamptz;
  e0 timestamptz := s0 + interval '1 day';
  s1 timestamptz := (d1::text || ' 00:00:00 Asia/Tokyo')::timestamptz;
  e1 timestamptz := s0;
  v_new0 int; v_new1 int;
  v_bug int; v_req int; v_ux int; v_oth int;
  v_week int; v_open int; v_oldest int;
  v_msg text; fmt_diff text; v_oldest_line text;
begin
  select count(*) into v_new0 from public.calendar_feedback where created_at >= s0 and created_at < e0;
  select count(*) into v_new1 from public.calendar_feedback where created_at >= s1 and created_at < e1;

  select
    count(*) filter (where category = 'bug'),
    count(*) filter (where category = 'request'),
    count(*) filter (where category = 'ux'),
    count(*) filter (where category = 'other')
  into v_bug, v_req, v_ux, v_oth
  from public.calendar_feedback where created_at >= s0 and created_at < e0;

  select count(*) into v_week from public.calendar_feedback where created_at > now() - interval '7 days';
  select count(*) into v_open from public.calendar_feedback where status = 'new';

  -- 未対応の最古が何日放置されているか。件数だけだと滞留に気づけない。
  select coalesce(max(extract(day from now() - created_at)::int), 0) into v_oldest
    from public.calendar_feedback where status = 'new';

  -- 前日比は分母0のとき出さない（「(前日比 +0)」はノイズ）
  fmt_diff := case when v_new1 = 0 then ''
    else ' (前日比 ' || case when v_new0 >= v_new1 then '+' else '' end
         || (v_new0 - v_new1)::text || ')' end;

  v_oldest_line := case when v_open = 0 then ''
    else E'\n' || '  最古の未対応  ' || v_oldest || '日前' end;

  -- 全角の見出し + 半角スペースで桁を揃え ``` で囲む。
  -- Discord のプロポーショナルフォントでも崩れない。
  v_msg :=
    '📊 **カレンダー 日次レポート ' || to_char(d0, 'YYYY/MM/DD') || '**' || E'\n' ||
    '```' || E'\n' ||
    '■ 意見ボックス' || E'\n' ||
    '  新規          ' || v_new0 || '件' || fmt_diff || E'\n' ||
    '   ├ 不具合     ' || v_bug  || '件' || E'\n' ||
    '   ├ 要望       ' || v_req  || '件' || E'\n' ||
    '   ├ 使いにくい ' || v_ux   || '件' || E'\n' ||
    '   └ その他     ' || v_oth  || '件' || E'\n' ||
    '  直近7日       ' || v_week || '件' || E'\n' ||
    '  未対応        ' || v_open || '件' || v_oldest_line ||
    E'\n' || '```';

  perform public.notify_discord_to('calendar_analytics', 'カレンダー 日次レポート', v_msg);
  return v_msg;
end;
$$;


-- ── 7. cron ─────────────────────────────────────────────────────────────────
-- pg_cron は UTC。JST 9:00 は 0 0 * * *。
-- BrawlStatus の 'daily-discord-digest' とは別名にしてある（同名だと上書きされる）。
--
-- 0件の日も投稿する。BrawlStatus では収集が38日間止まっていたのに
-- 気づけなかったことがあり、毎朝必ず何か出ること自体が生存確認になる。
-- 「0件」と「レポートが来ない」は別の意味を持つ。
select cron.unschedule('calendar-daily-digest')
  where exists (select 1 from cron.job where jobname = 'calendar-daily-digest');

select cron.schedule('calendar-daily-digest', '0 0 * * *',
                     $$select public.send_calendar_daily_digest()$$);


-- ════════════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════════════
--
-- -- 1) 宛先が2行入っていて、プレースホルダのままでないこと
-- select key, value from public.monitoring_config where key like 'discord_channel_calendar%';
--
-- -- 2) BrawlStatus 側を壊していないこと（3行そのまま + cron 2本）
-- select key from public.monitoring_config where key like 'discord_channel_%' order by key;
-- select jobname, schedule from cron.job order by jobname;
--
-- -- 3) 送信経路そのもの
-- select public.notify_discord_to('calendar_feedback', 'カレンダー テスト', 'テスト送信');
--
-- -- 4) HTTPの結果（非同期なので数秒待ってから）
-- --    401=トークン / 403=チャンネル権限 / 404=チャンネルID
-- select id, status_code, left(content,200) from net._http_response order by created desc limit 3;
--
-- -- 5) トリガー経由
-- insert into public.calendar_feedback (category, message, platform, app_version, language)
-- values ('bug', 'テスト投稿', 'ios', '2.9.0', 'ja');
--
-- -- 6) 日次レポート（cronを待たずに）
-- select public.send_calendar_daily_digest();
--
-- -- 7) 後片付け
-- delete from public.calendar_feedback where message = 'テスト投稿';
--
-- そのうえで【アプリの実機から1件送る】。RLS と anon キーの経路は
-- SQL エディタ（service_role）では検証できず、ここでしか壊れが出ない。
