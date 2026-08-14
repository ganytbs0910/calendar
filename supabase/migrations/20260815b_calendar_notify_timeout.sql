-- ════════════════════════════════════════════════════════════════════════════
-- 通知が5秒のタイムアウトで消える問題の修正
--
-- 実機から初めて1件送ったとき、意見は calendar_feedback に保存されたのに
-- Discord には出なかった。net._http_response にこう残っていた:
--
--   Timeout of 5000 ms reached. Total time: 5889.783 ms
--   (DNS time: 4289.316 ms, TCP/SSL handshake time: 1600.467 ms,
--    HTTP Request/Response time: 0.000 ms)
--
-- DNS だけで4.3秒かかり、net.http_post の既定タイムアウト5秒を使い切っていた。
-- リクエストは1バイトも送られていない（HTTP Request/Response time が 0）。
--
-- たちが悪いのは、これが**間欠的で、かつ静かに失敗する**こと。
-- トリガーは正常終了し、利用者には「送信しました」と出て、行も保存される。
-- 失われるのは通知だけで、net._http_response を覗かない限り気付けない。
-- 実際、この直前に同じ経路で送った2通は届いていた。
--
-- ★ notify_discord_to() は BrawlStatus と共有しているので書き換えない。
--   同じ内容の関数をカレンダー専用に作り、タイムアウトだけ伸ばす。
--   （BrawlStatus 側も既定の5秒のままなので同じ穴を持っているが、
--     それは向こうのアプリの判断であり、ここで勝手に直さない。）
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.calendar_notify_discord(
  p_purpose text, p_username text, p_content text)
returns void language plpgsql security definer
set search_path to 'public','extensions','net','vault','pg_temp' as $$
declare
  v_channel text; v_token text; v_url text;
begin
  v_channel := public.discord_channel_for(p_purpose);

  if v_channel is not null then
    select decrypted_secret into v_token
      from vault.decrypted_secrets where name = 'discord_bot_token' limit 1;

    if v_token is not null then
      perform net.http_post(
        url     := 'https://discord.com/api/v10/channels/' || v_channel || '/messages',
        headers := jsonb_build_object(
                     'Content-Type','application/json',
                     'Authorization','Bot ' || v_token),
        body    := jsonb_build_object(
                     'content', '**[' || p_username || ']**' || E'\n' || p_content),
        -- 既定の5秒では DNS が遅い日に届かない。実測 5.9 秒で落ちたので、
        -- 4倍の余裕を取る。通知は非同期なので長くしても利用者は待たされない。
        timeout_milliseconds := 20000
      );
      return;
    end if;
  end if;

  v_url := public.discord_webhook_for(p_purpose);
  if v_url is null then return; end if;

  perform net.http_post(
    url     := v_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('username', p_username, 'content', p_content),
    timeout_milliseconds := 20000
  );
end;
$$;


-- ── 呼び出し元を差し替える ──────────────────────────────────────────────────
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

  perform public.calendar_notify_discord(
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


-- ── 日次レポートに「届かなかった通知」を出す ────────────────────────────────
-- タイムアウトは伸ばしたが、消えるときは静かに消えるという性質は変わらない。
-- 毎朝レポートに出しておけば、気付かないまま何日も落ち続けることはなくなる。
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
  v_msg text; fmt_diff text; v_oldest_line text; v_failed_line text;
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

  -- 昨日ぶんの失敗した送信。pg_net の応答は全アプリ共通のテーブルに入るので
  -- Discord 宛だけを見る（BrawlStatus の失敗も混ざるが、落ちていること自体は
  -- 知っておいたほうがよいのでそのまま数える）。
  begin
    select count(*) into v_failed from net._http_response
     where created >= s0 and created < e0 and status_code is null;
  exception when others then
    v_failed := 0;   -- pg_net の内部テーブルが見えない環境でも落とさない
  end;

  fmt_diff := case when v_new1 = 0 then ''
    else ' (前日比 ' || case when v_new0 >= v_new1 then '+' else '' end
         || (v_new0 - v_new1)::text || ')' end;

  v_oldest_line := case when v_open = 0 then ''
    else E'\n' || '  最古の未対応  ' || v_oldest || '日前' end;

  v_failed_line := case when v_failed = 0 then ''
    else E'\n' || E'\n' || '■ 要確認' || E'\n' ||
         '  届かなかった通知  ' || v_failed || '件' end;

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
    v_failed_line ||
    E'\n' || '```';

  perform public.calendar_notify_discord('calendar_analytics', 'カレンダー 日次レポート', v_msg);
  return v_msg;
end;
$$;
