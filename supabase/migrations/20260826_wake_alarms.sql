-- Wake-alarm (call-screen-style) reminders, PR1: data model only.
-- The device-registration / VoIP dispatch tables land in a later migration
-- once the client + native call-screen work is in place.

alter table public.calendar_shared_events
  add column if not exists must_wake boolean not null default false;
alter table public.calendar_shared_events
  add column if not exists must_wake_offset_minutes int;

-- calendar_share_push carries an explicit column list, so it needs to be
-- re-declared to pass the two new fields through (calendar_share_pull already
-- returns whole rows via to_jsonb(e) and needs no change).
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
  select p_code,e->>'id',e->>'title',e->>'startDate',e->>'endDate',(e->>'allDay')::boolean,e->>'startTime',e->>'endTime',e->>'memo',coalesce(e->>'creatorId',p_member->>'id'),now(),coalesce((e->>'deleted')::boolean,false),coalesce((e->>'mustWake')::boolean,false),nullif(e->>'mustWakeOffsetMinutes','')::int
  from jsonb_array_elements(p_events) e
  on conflict(code,id) do update set title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,all_day=excluded.all_day,start_time=excluded.start_time,end_time=excluded.end_time,memo=excluded.memo,creator_id=coalesce(target.creator_id,excluded.creator_id),updated_at=greatest(now(),target.updated_at+interval '1 microsecond'),deleted=excluded.deleted,must_wake=excluded.must_wake,must_wake_offset_minutes=excluded.must_wake_offset_minutes;
  return calendar_share_pull(p_code,'-infinity',p_member);
end $$;
