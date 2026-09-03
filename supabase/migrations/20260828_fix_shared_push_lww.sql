-- Fix: calendar_share_push wasn't actually doing last-write-wins for events.
--
-- Since 20260825, the per-event upsert used `updated_at =
-- greatest(now(), target.updated_at + interval '1 microsecond')` and had NO
-- guard on the UPDATE — every push unconditionally overwrote the row with
-- whatever the caller sent, timestamped with the SERVER's wall-clock time
-- instead of the client's own `updatedAt`. That means whichever device
-- happened to sync LAST won, regardless of who actually edited more
-- recently — a genuinely older edit could silently clobber a newer one the
-- moment its device got around to syncing (confirmed live: two devices
-- edit/delete the same event, and it comes down to sync order, not edit
-- order).
--
-- calendar_shared (the calendar row itself) never had this bug — its UPDATE
-- already compares against the client's own `updatedAt` correctly. This
-- restores the same real last-write-wins semantics for events, matching the
-- very first design (20260821_calendar_share.sql) before the 20260825
-- collaboration migration accidentally dropped the guard.

create or replace function public.calendar_share_push(p_code text,p_calendar jsonb,p_events jsonb,p_member jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  if not exists(select 1 from calendar_shared where code=p_code) then raise exception 'unknown share'; end if;
  perform calendar_share_member_put(p_code,p_member);
  v_role:=calendar_share_member_auth(p_code,p_member->>'id',p_member->>'secret');
  if v_role='viewer' and jsonb_array_length(p_events)>0 then raise exception 'read only'; end if;
  perform calendar_share_guard(p_events);
  perform set_config('app.shared_member_id',p_member->>'id',true);
  if p_calendar is not null and p_calendar<>'null'::jsonb then
    if v_role in ('owner','admin') then
      update calendar_shared set name=coalesce(p_calendar->>'name',name),color=coalesce(p_calendar->>'color',color),emoji=coalesce(p_calendar->>'emoji',emoji),deleted=coalesce((p_calendar->>'deleted')::boolean,deleted),updated_at=(p_calendar->>'updatedAt')::timestamptz
        where code=p_code and (p_calendar->>'updatedAt')::timestamptz>updated_at;
    end if;
  end if;
  insert into calendar_shared_events as target(code,id,title,start_date,end_date,all_day,start_time,end_time,memo,creator_id,updated_at,deleted,must_wake,must_wake_offset_minutes)
  select p_code,e->>'id',e->>'title',e->>'startDate',e->>'endDate',(e->>'allDay')::boolean,e->>'startTime',e->>'endTime',e->>'memo',coalesce(e->>'creatorId',p_member->>'id'),(e->>'updatedAt')::timestamptz,coalesce((e->>'deleted')::boolean,false),coalesce((e->>'mustWake')::boolean,false),nullif(e->>'mustWakeOffsetMinutes','')::int
  from jsonb_array_elements(p_events) e
  on conflict(code,id) do update set title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,all_day=excluded.all_day,start_time=excluded.start_time,end_time=excluded.end_time,memo=excluded.memo,creator_id=coalesce(target.creator_id,excluded.creator_id),updated_at=excluded.updated_at,deleted=excluded.deleted,must_wake=excluded.must_wake,must_wake_offset_minutes=excluded.must_wake_offset_minutes
  where excluded.updated_at>target.updated_at;
  return calendar_share_pull(p_code,'-infinity',p_member);
end $$;
grant execute on function public.calendar_share_push(text,jsonb,jsonb,jsonb) to anon;
