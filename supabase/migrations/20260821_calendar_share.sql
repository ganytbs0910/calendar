-- ════════════════════════════════════════════════════════════════════════════
-- 共有カレンダー（TimeTree相当）
--
-- BrawlStatus と同じ Supabase プロジェクト (llxmsbnqtdlqypnwapzz) に相乗りする。
-- 20260815_calendar_discord.sql と同じ約束で、既存オブジェクトには一切触らない。
--   追加する  calendar_shared / calendar_shared_events
--             calendar_share_create / _meta / _pull / _push
--
-- ── 認証を持たない理由 ──────────────────────────────────────────────────────
--
-- 参加者は全員が対等に編集する（管理者という役割を作らない）と決めたので、
-- 「誰であるか」を区別する必要が無い。区別が要らないならログインも要らない。
--
-- 代わりに **招待コードそのものを鍵として扱う**（capability方式）。コードを
-- 知っている＝その共有に参加している、とみなす。UUIDv4 のハイフンを抜いた32桁で
-- 122ビットあるので、総当たりで当てられる量ではない。
--
-- gen_random_bytes(16) の方が素直だが、あれは pgcrypto のもので extensions
-- スキーマに入っている。security definer 関数は search_path を固定するのが
-- 定石で、そこに extensions を足すと拡張側の関数名に乗っ取られる余地を作る。
-- gen_random_uuid() は Postgres 本体（pg_catalog）にあるので、その心配が無い。
--
-- これで得たもの:
--   * 掲載説明文の「アカウント登録は不要です」を維持できる
--   * アカウントが無いので App Store のアカウント削除要件が発生しない
--     (Guideline 5.1.1(v))
--   * 端末側にトークン更新もログイン状態も持たなくていい
--
-- 引き換えに失うもの:
--   * リンクが漏れたら、それを持つ誰でも読み書きできる
--   * 特定の1人だけを追い出せない。追い出すにはコードを作り直して
--     残りの全員に配り直すことになる
--
-- 信頼できる相手（家族・恋人・友人・バイト先）と共有する前提なので、この
-- 交換は妥当と判断した。権限が必要になったら、そのとき匿名認証を足して
-- members テーブルを作る。テーブル定義はそのまま使える。
--
-- ── アクセス制御 ────────────────────────────────────────────────────────────
--
-- 表そのものは anon から一切触らせない（RLS 有効・ポリシー無し＝全拒否）。
-- 出入口は security definer の関数4本だけで、いずれも第1引数にコードを取る。
-- コードを知らなければ何も引けないし、書けない。
--
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼って実行。
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.calendar_shared (
  code        text primary key,
  name        text not null,
  color       text not null,
  emoji       text not null,
  updated_at  timestamptz not null,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.calendar_shared_events (
  code        text not null references public.calendar_shared(code) on delete cascade,
  -- 端末が振った id をそのまま主キーに使う。サーバ側で採番すると、
  -- オフラインで作った予定に一時IDを持たせて後で貼り替える処理が要る。
  id          text not null,
  title       text not null,
  start_date  text not null,
  end_date    text not null,
  all_day     boolean not null,
  start_time  text,
  end_time    text,
  memo        text,
  updated_at  timestamptz not null,
  deleted     boolean not null default false,
  primary key (code, id)
);

-- 差分取得はここを必ず通る。
create index if not exists calendar_shared_events_updated_idx
  on public.calendar_shared_events (code, updated_at);

alter table public.calendar_shared        enable row level security;
alter table public.calendar_shared_events enable row level security;
-- ポリシーを一つも作らない = anon からの直接アクセスは全拒否。
revoke all on public.calendar_shared        from anon, authenticated;
revoke all on public.calendar_shared_events from anon, authenticated;

-- ── 上限 ────────────────────────────────────────────────────────────────────
-- 相乗り先の本番DBなので、1回の書き込みと1カレンダーの容量に蓋をしておく。
-- 端末側の定数と必ず揃えること（片方だけ変えると push が例外で落ちる）。
create or replace function public.calendar_share_guard(p_events jsonb)
returns void language plpgsql as $$
begin
  if jsonb_array_length(p_events) > 200 then
    raise exception 'too many events in one push';
  end if;
end $$;

-- ── 作成 ────────────────────────────────────────────────────────────────────
create or replace function public.calendar_share_create(
  p_name text, p_color text, p_emoji text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(length(p_name), 0) = 0 or length(p_name) > 60 then
    raise exception 'bad name';
  end if;
  v_code := replace(gen_random_uuid()::text, '-', '');
  insert into calendar_shared (code, name, color, emoji, updated_at)
  values (v_code, p_name, p_color, p_emoji, now());
  return v_code;
end $$;

-- ── 参加前のプレビュー ──────────────────────────────────────────────────────
-- 招待リンクを開いた人に「何に参加しようとしているか」を出すためだけのもの。
-- 予定の中身は返さない。
create or replace function public.calendar_share_meta(p_code text)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
           'name', name, 'color', color, 'emoji', emoji,
           'events', (select count(*) from calendar_shared_events e
                      where e.code = c.code and not e.deleted))
  from calendar_shared c
  where c.code = p_code and not c.deleted;
$$;

-- ── 取得 ────────────────────────────────────────────────────────────────────
-- p_since より後に変わったものだけ返す。削除ぶんも含める（含めないと
-- 相手が消した予定がこちらで生き残る）。
create or replace function public.calendar_share_pull(
  p_code text, p_since timestamptz default '-infinity'
) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'calendar', (select to_jsonb(c) from calendar_shared c
                 where c.code = p_code and c.updated_at > p_since),
    'events',   coalesce((select jsonb_agg(to_jsonb(e))
                          from calendar_shared_events e
                          where e.code = p_code and e.updated_at > p_since),
                         '[]'::jsonb),
    'now',      to_jsonb(now())
  )
  where exists (select 1 from calendar_shared where code = p_code);
$$;

-- ── 送信 ────────────────────────────────────────────────────────────────────
-- last-write-wins。updated_at が新しい方だけが勝つ。同着は既存を残す
-- （送り直しで無駄に更新時刻が進むのを避ける）。
create or replace function public.calendar_share_push(
  p_code text, p_calendar jsonb, p_events jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from calendar_shared where code = p_code) then
    raise exception 'unknown share';
  end if;
  perform calendar_share_guard(p_events);

  if p_calendar is not null and p_calendar <> 'null'::jsonb then
    update calendar_shared set
      name       = coalesce(p_calendar->>'name', name),
      color      = coalesce(p_calendar->>'color', color),
      emoji      = coalesce(p_calendar->>'emoji', emoji),
      deleted    = coalesce((p_calendar->>'deleted')::boolean, deleted),
      updated_at = (p_calendar->>'updatedAt')::timestamptz
    where code = p_code
      and (p_calendar->>'updatedAt')::timestamptz > updated_at;
  end if;

  insert into calendar_shared_events as t
    (code, id, title, start_date, end_date, all_day, start_time, end_time,
     memo, updated_at, deleted)
  select p_code,
         e->>'id', e->>'title', e->>'startDate', e->>'endDate',
         (e->>'allDay')::boolean, e->>'startTime', e->>'endTime', e->>'memo',
         (e->>'updatedAt')::timestamptz,
         coalesce((e->>'deleted')::boolean, false)
  from jsonb_array_elements(p_events) e
  on conflict (code, id) do update set
    title = excluded.title, start_date = excluded.start_date,
    end_date = excluded.end_date, all_day = excluded.all_day,
    start_time = excluded.start_time, end_time = excluded.end_time,
    memo = excluded.memo, updated_at = excluded.updated_at,
    deleted = excluded.deleted
  where excluded.updated_at > t.updated_at;

  return calendar_share_pull(p_code, '-infinity');
end $$;

grant execute on function
  public.calendar_share_create(text, text, text),
  public.calendar_share_meta(text),
  public.calendar_share_pull(text, timestamptz),
  public.calendar_share_push(text, jsonb, jsonb)
to anon;
