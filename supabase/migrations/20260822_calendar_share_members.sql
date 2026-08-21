-- ════════════════════════════════════════════════════════════════════════════
-- 共有カレンダーの参加者
--
-- 20260821_calendar_share.sql の続き。あちらは「コードを知っている＝参加者」
-- という capability 方式で、誰であるかを一切持たない設計にした。その判断は
-- 変えない（ログインは足さない）。ただし **画面に「誰と共有しているか」を
-- 出したい** ので、名乗りだけを置ける場所を作る。
--
-- 認証ではなく自己申告である点に注意。member_id は端末が自分で振る乱数で、
-- 名前も端末が自由に書ける。つまりこの表は「同じカレンダーを開いている人が
-- 自分で名乗った名前の一覧」であって、本人確認ではない。コードを知っている
-- 人なら誰でも任意の名前で名乗れる。信頼できる相手と共有する前提なので
-- それで足りる、という元の判断の延長にある。
--
--   追加する  calendar_share_members
--   作り直す  calendar_share_pull / _push  (p_member を受けるようにする)
--             calendar_share_meta         (参加人数を返す)
--
-- pull / push の両方で名乗りを受け取るのは、同期が「変更があれば push、
-- 無ければ pull」に分岐するから。片方にしか付けないと、しばらく予定を
-- 編集していない人が一覧から古びていく。
--
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼って実行。
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.calendar_share_members (
  code         text not null references public.calendar_shared(code) on delete cascade,
  -- 端末が振る32桁。誰であるかの証明ではなく、同じ端末の名乗りを
  -- 上書きするための鍵でしかない。
  member_id    text not null,
  name         text not null,
  emoji        text not null default '',
  -- 最後に同期した時刻。「この人はまだ開いていない」が分かると、
  -- 予定を入れたのに伝わっていない、が拾える。
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null,
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (code, member_id)
);

create index if not exists calendar_share_members_code_idx
  on public.calendar_share_members (code);

alter table public.calendar_share_members enable row level security;

-- ── 名乗りの検証 ────────────────────────────────────────────────────────────
--
-- 1つの共有に無限に名乗りを積まれると一覧が読めなくなるので、新規だけ
-- 頭を打つ。既存の member_id は何度でも名前を変えられる（上限に達した後で
-- 改名できなくなると、正当な参加者が困る）。
create or replace function public.calendar_share_member_guard(
  p_code text, p_member jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id text := p_member->>'id';
  v_name text := p_member->>'name';
begin
  if v_id is null or length(v_id) not between 8 and 64 then
    raise exception 'bad member id';
  end if;
  if v_name is null or length(v_name) = 0 or length(v_name) > 24 then
    raise exception 'bad member name';
  end if;
  if length(coalesce(p_member->>'emoji', '')) > 8 then
    raise exception 'bad member emoji';
  end if;
  if not exists (select 1 from calendar_share_members
                 where code = p_code and member_id = v_id)
     and (select count(*) from calendar_share_members where code = p_code) >= 50 then
    raise exception 'too many members';
  end if;
end $$;

create or replace function public.calendar_share_member_put(
  p_code text, p_member jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_member is null or p_member = 'null'::jsonb then
    return;
  end if;
  perform calendar_share_member_guard(p_code, p_member);
  insert into calendar_share_members as m
    (code, member_id, name, emoji, last_seen_at, updated_at, deleted)
  values (p_code, p_member->>'id', p_member->>'name',
          coalesce(p_member->>'emoji', ''), now(),
          (p_member->>'updatedAt')::timestamptz,
          coalesce((p_member->>'deleted')::boolean, false))
  on conflict (code, member_id) do update set
    -- last_seen_at は常に進める。名前は自分が名乗り直したときだけ。
    last_seen_at = now(),
    name       = case when excluded.updated_at > m.updated_at
                      then excluded.name else m.name end,
    emoji      = case when excluded.updated_at > m.updated_at
                      then excluded.emoji else m.emoji end,
    deleted    = case when excluded.updated_at > m.updated_at
                      then excluded.deleted else m.deleted end,
    updated_at = greatest(excluded.updated_at, m.updated_at);
end $$;

-- ── 取得 / 反映 ─────────────────────────────────────────────────────────────
--
-- 参加者は差分ではなく毎回全部返す。数人しかいない前提で、UI 側は常に
-- 全員を並べたいので、since で削るとかえって面倒になる。

drop function if exists public.calendar_share_pull(text, timestamptz);
drop function if exists public.calendar_share_push(text, jsonb, jsonb);

create or replace function public.calendar_share_pull(
  p_code text, p_since timestamptz default '-infinity', p_member jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from calendar_shared where code = p_code) then
    return null;
  end if;
  perform calendar_share_member_put(p_code, p_member);
  return jsonb_build_object(
    'calendar', (select to_jsonb(c) from calendar_shared c
                 where c.code = p_code and c.updated_at > p_since),
    'events',   coalesce((select jsonb_agg(to_jsonb(e))
                          from calendar_shared_events e
                          where e.code = p_code and e.updated_at > p_since),
                         '[]'::jsonb),
    'members',  coalesce((select jsonb_agg(to_jsonb(m))
                          from calendar_share_members m
                          where m.code = p_code and not m.deleted),
                         '[]'::jsonb),
    'now',      to_jsonb(now())
  );
end $$;

create or replace function public.calendar_share_push(
  p_code text, p_calendar jsonb, p_events jsonb, p_member jsonb default null
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

  return calendar_share_pull(p_code, '-infinity', p_member);
end $$;

-- 参加前のプレビューでは人数だけ見せる。名前まで出すと、コードを拾った
-- だけの相手に参加者名簿が渡ってしまう。
create or replace function public.calendar_share_meta(p_code text)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
           'name', name, 'color', color, 'emoji', emoji,
           'events', (select count(*) from calendar_shared_events e
                      where e.code = c.code and not e.deleted),
           'members', (select count(*) from calendar_share_members m
                       where m.code = c.code and not m.deleted))
  from calendar_shared c
  where c.code = p_code and not c.deleted;
$$;

grant execute on function
  public.calendar_share_meta(text),
  public.calendar_share_pull(text, timestamptz, jsonb),
  public.calendar_share_push(text, jsonb, jsonb, jsonb)
to anon;

-- 内部用。anon からは直接叩かせない。
revoke all on function public.calendar_share_member_guard(text, jsonb) from public, anon;
revoke all on function public.calendar_share_member_put(text, jsonb) from public, anon;
