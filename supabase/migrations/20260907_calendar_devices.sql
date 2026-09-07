-- ════════════════════════════════════════════════════════════════════════════
-- カレンダー 匿名デバイス起動シグナル (新規/DAU/WAU/MAU)
--
-- 意見ボックスに続く、このアプリ2つ目の外部送信経路。送るのは
-- 「ランダム生成した端末ID一つが今日も起動した」という事実だけで、
-- 予定の中身・件数・カレンダーの利用内容は一切含まない。
-- BrawlStatus の tracked_players (first_seen/last_seen方式。
-- ~/Desktop/Brawl/server/sql/battle_logs.sql) を、アカウントを持たない
-- このアプリ向けに「player_tag → ランダムUUID」に置き換えて移植した。
--
-- ★ 方針転換であることに注意: このアプリはこれまで「端末内で完結。
--   アカウント登録は不要です」という掲載文の通り、意見ボックス以外の
--   一切の利用状況を収集していなかった(20260815_calendar_discord.sql の
--   日次レポート冒頭コメント参照)。この変更は利用者への説明を前提に
--   導入する — 掲載文・プライバシーポリシー・App Store のプライバシー
--   表示ラベルも合わせて更新すること(コード側だけでは完結しない)。
--
-- ★ このファイルも既存オブジェクト(calendar_feedback関連含む)を書き換え
--   ない。send_calendar_daily_digest() だけは「■ ユーザー」セクションを
--   足すために create or replace するが、意見ボックス集計のロジックは
--   20260815b_calendar_notify_timeout.sql の内容をそのまま引き継ぐ。
--
-- 実行方法: Supabase Management API 経由(SQL Editor に貼ってもよい)。
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. テーブル ─────────────────────────────────────────────────────────────
-- player_tag は持たない(このアプリにアカウントは無い)。端末ごとに1行。
create table if not exists public.calendar_devices (
  device_id   uuid primary key,
  first_seen  timestamptz not null default now(),  -- 新規登録相当
  last_seen   timestamptz not null default now(),  -- DAU/WAU/MAU相当
  app_version text,
  platform    text,
  language    text
);

create index if not exists idx_calendar_devices_last_seen on public.calendar_devices (last_seen desc);

alter table public.calendar_devices enable row level security;
-- SELECT/INSERT/UPDATE ポリシーは一切作らない。書き込みは下のRPC経由のみ。
-- calendar_feedback の INSERT ポリシーと違い、こちらは「1件ごとに意味の
-- ある本文が要る」という歯止めが効かない(送る内容が無い ping だけなので)。
-- anon キーに直接 upsert を許すと、同じ device_id を送り続けるだけで
-- DAU を自由に水増しできてしまうため、SECURITY DEFINER 関数の中でしか
-- 書けないようにする(Brawl の map_favorites / brawl_reward_claims と同じ考え方)。


-- ── 2. 書き込みRPC(SECURITY DEFINER)────────────────────────────────────────
create or replace function public.calendar_ping_device(
  p_device_id uuid,
  p_app_version text default null,
  p_platform text default null,
  p_language text default null
)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  insert into public.calendar_devices (device_id, app_version, platform, language)
  values (
    p_device_id,
    left(coalesce(p_app_version,''), 20),
    left(coalesce(p_platform,''), 20),
    left(coalesce(p_language,''), 10)
  )
  on conflict (device_id) do update set
    last_seen   = now(),
    app_version = excluded.app_version,
    platform    = excluded.platform,
    language    = excluded.language;
end;
$$;

revoke all on function public.calendar_ping_device(uuid, text, text, text) from public;
grant execute on function public.calendar_ping_device(uuid, text, text, text) to anon, authenticated;


-- ── 3. 日次レポートに「■ ユーザー」を追加 ───────────────────────────────────
-- 20260815b_calendar_notify_timeout.sql の send_calendar_daily_digest() を
-- 引き継ぎ、ユーザーセクションを先頭に足す。calendar_notify_discord 経由の
-- 呼び出し・タイムアウト対策・届かなかった通知の集計はそのまま変更しない。
create or replace function public.send_calendar_daily_digest()
returns text language plpgsql security definer
set search_path to 'public','extensions','net','pg_temp' as $$
declare
  d0 date := (now() at time zone 'Asia/Tokyo')::date - 1;
  d1 date := (now() at time zone 'Asia/Tokyo')::date - 2;
  s0 timestamptz := (d0::text || ' 00:00:00 Asia/Tokyo')::timestamptz;
  e0 timestamptz := s0 + interval '1 day';
  s1 timestamptz := (d1::text || ' 00:00:00 Asia/Tokyo')::timestamptz;
  e1 timestamptz := s0;
  v_new0 int; v_new1 int;
  v_bug int; v_req int; v_ux int; v_oth int;
  v_week int; v_open int; v_oldest int; v_failed int;
  v_dnew0 int; v_dnew1 int; v_dau int; v_wau int; v_mau int; v_dtotal int;
  v_msg text; fmt_diff text; v_dfmt_diff text; v_oldest_line text; v_failed_line text;
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
  select coalesce(max(extract(day from now() - created_at)::int), 0) into v_oldest
    from public.calendar_feedback where status = 'new';

  begin
    select count(*) into v_failed from net._http_response
     where created >= s0 and created < e0 and status_code is null;
  exception when others then
    v_failed := 0;   -- pg_net の内部テーブルが見えない環境でも落とさない
  end;

  -- ユーザー(匿名端末ID)
  select count(*) into v_dnew0 from public.calendar_devices where first_seen >= s0 and first_seen < e0;
  select count(*) into v_dnew1 from public.calendar_devices where first_seen >= s1 and first_seen < e1;
  select count(*) into v_dau   from public.calendar_devices where last_seen  >= s0 and last_seen  < e0;
  select count(*) into v_wau   from public.calendar_devices where last_seen  > now() - interval '7 days';
  select count(*) into v_mau   from public.calendar_devices where last_seen  > now() - interval '30 days';
  select count(*) into v_dtotal from public.calendar_devices;

  fmt_diff := case when v_new1 = 0 then ''
    else ' (前日比 ' || case when v_new0 >= v_new1 then '+' else '' end
         || (v_new0 - v_new1)::text || ')' end;

  v_dfmt_diff := case when v_dnew1 = 0 then ''
    else ' (前日比 ' || case when v_dnew0 >= v_dnew1 then '+' else '' end
         || (v_dnew0 - v_dnew1)::text || ')' end;

  v_oldest_line := case when v_open = 0 then ''
    else E'\n' || '  最古の未対応  ' || v_oldest || '日前' end;

  v_failed_line := case when v_failed = 0 then ''
    else E'\n' || E'\n' || '■ 要確認' || E'\n' ||
         '  届かなかった通知  ' || v_failed || '件' end;

  v_msg :=
    '📊 **カレンダー 日次レポート ' || to_char(d0, 'YYYY/MM/DD') || '**' || E'\n' ||
    '```' || E'\n' ||
    '■ ユーザー' || E'\n' ||
    '  新規          ' || v_dnew0  || '人' || v_dfmt_diff || E'\n' ||
    '  DAU(利用者)   ' || v_dau    || '人' || E'\n' ||
    '  WAU(7日)      ' || v_wau    || '人' || E'\n' ||
    '  MAU(30日)     ' || v_mau    || '人' || E'\n' ||
    '  累計          ' || v_dtotal || '人' || E'\n' ||
    E'\n' ||
    '■ 意見ボックス' || E'\n' ||
    '  新規          ' || v_new0 || '件' || fmt_diff || E'\n' ||
    '   ├ 不具合     ' || v_bug  || '件' || E'\n' ||
    '   ├ 要望       ' || v_req  || '件' || E'\n' ||
    '   ├ 使いにくい ' || v_ux   || '件' || E'\n' ||
    '   └ その他     ' || v_oth  || '件' || E'\n' ||
    '  直近7日       ' || v_week || '件' || E'\n' ||
    '  未対応        ' || v_open || '件' || v_oldest_line ||
    v_failed_line ||
    E'\n' || '```';

  perform public.calendar_notify_discord('calendar_analytics', 'カレンダー 日次レポート', v_msg);
  return v_msg;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 実行後の確認
-- ════════════════════════════════════════════════════════════════════════════
--
-- -- 1) RPC経由のping(実機を模したテスト)
-- select public.calendar_ping_device(gen_random_uuid(), '2.9.0', 'ios', 'ja');
--
-- -- 2) 入っていること
-- select * from public.calendar_devices order by last_seen desc limit 5;
--
-- -- 3) 同じdevice_idで2回目を送るとlast_seenだけ更新されfirst_seenは動かないこと
-- -- (上の1で使ったdevice_idを控えて再実行し、first_seenが変わらないか確認)
--
-- -- 4) anonキーで直接テーブルに書けないこと(ポリシー無しなのでエラーになるはず)
-- -- 実機やcurlでPostgRESTのcalendar_devicesエンドポイントに直接INSERTを試す
--
-- -- 5) 日次レポート(cronを待たずに)
-- select public.send_calendar_daily_digest();
--
-- -- 6) 後片付け(テストで作ったダミーdevice_idを消す)
-- delete from public.calendar_devices where app_version = '2.9.0' and platform = 'ios';
--
-- そのうえで【アプリの実機から起動】し、calendar_devicesに実際の行が
-- 増えることを確認する。RLSとanonキーの経路はSQL Editor(service_role)
-- では検証できず、ここでしか壊れが出ない。
