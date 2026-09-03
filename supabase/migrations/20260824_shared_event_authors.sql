-- 共有予定を「誰が作ったか」で色分けする。
-- creator_id は作成時にだけ端末が入れ、別メンバーが編集しても維持する。
-- 既存予定は null のままにして、UI はカレンダー色へフォールバックする。

alter table public.calendar_share_members
  add column if not exists color text;

alter table public.calendar_shared_events
  add column if not exists creator_id text;

create or replace function public.calendar_share_member_put(
  p_code text, p_member jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_member is null or p_member = 'null'::jsonb then return; end if;
  perform calendar_share_member_guard(p_code, p_member);
  insert into calendar_share_members as m
    (code, member_id, name, emoji, color, last_seen_at, updated_at, deleted)
  values (
    p_code, p_member->>'id', p_member->>'name', coalesce(p_member->>'emoji', ''),
    nullif(p_member->>'color', ''), now(), (p_member->>'updatedAt')::timestamptz,
    coalesce((p_member->>'deleted')::boolean, false)
  )
  on conflict (code, member_id) do update set
    last_seen_at = now(),
    name = case when excluded.updated_at > m.updated_at then excluded.name else m.name end,
    emoji = case when excluded.updated_at > m.updated_at then excluded.emoji else m.emoji end,
    color = case when excluded.updated_at > m.updated_at then excluded.color else m.color end,
    deleted = case when excluded.updated_at > m.updated_at then excluded.deleted else m.deleted end,
    updated_at = greatest(excluded.updated_at, m.updated_at);
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
      name = coalesce(p_calendar->>'name', name),
      color = coalesce(p_calendar->>'color', color),
      emoji = coalesce(p_calendar->>'emoji', emoji),
      deleted = coalesce((p_calendar->>'deleted')::boolean, deleted),
      updated_at = (p_calendar->>'updatedAt')::timestamptz
    where code = p_code and (p_calendar->>'updatedAt')::timestamptz > updated_at;
  end if;

  insert into calendar_shared_events as target
    (code, id, title, start_date, end_date, all_day, start_time, end_time,
     memo, creator_id, updated_at, deleted)
  select p_code, event->>'id', event->>'title', event->>'startDate', event->>'endDate',
         (event->>'allDay')::boolean, event->>'startTime', event->>'endTime',
         event->>'memo', event->>'creatorId', (event->>'updatedAt')::timestamptz,
         coalesce((event->>'deleted')::boolean, false)
  from jsonb_array_elements(p_events) event
  on conflict (code, id) do update set
    title = excluded.title, start_date = excluded.start_date,
    end_date = excluded.end_date, all_day = excluded.all_day,
    start_time = excluded.start_time, end_time = excluded.end_time,
    memo = excluded.memo,
    -- 古いクライアントが null を送っても、既知の作成者を消さない。
    creator_id = coalesce(target.creator_id, excluded.creator_id),
    updated_at = excluded.updated_at, deleted = excluded.deleted
  where excluded.updated_at > target.updated_at;

  perform calendar_share_member_put(p_code, p_member);
  return calendar_share_pull(p_code, '-infinity', p_member);
end $$;

grant execute on function
  public.calendar_share_push(text, jsonb, jsonb, jsonb)
to anon;

