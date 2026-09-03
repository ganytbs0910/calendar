-- Shared-calendar collaboration: roles, attendance, comments, activity and photos.
-- All tables remain private; clients can only use the guarded RPCs below.

alter table public.calendar_share_members
  add column if not exists role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer'));
alter table public.calendar_share_members add column if not exists member_secret_hash text;

-- The first known member owns an existing calendar. New calendars acquire an
-- owner when their first member syncs (handled by member_put below).
with ranked as (
  select code, member_id, row_number() over (partition by code order by created_at) n
  from public.calendar_share_members where not deleted
)
update public.calendar_share_members m set role = 'owner'
from ranked r where m.code = r.code and m.member_id = r.member_id and r.n = 1;

create table if not exists public.calendar_shared_comments (
  code text not null,
  id text not null,
  event_id text not null,
  member_id text not null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (code, id),
  foreign key (code, event_id) references public.calendar_shared_events(code, id) on delete cascade
);

create table if not exists public.calendar_shared_attendance (
  code text not null, event_id text not null, member_id text not null,
  status text not null check (status in ('going', 'maybe', 'declined')),
  updated_at timestamptz not null default now(),
  primary key (code, event_id, member_id),
  foreign key (code, event_id) references public.calendar_shared_events(code, id) on delete cascade
);

create table if not exists public.calendar_shared_activity (
  seq bigint generated always as identity primary key,
  code text not null, event_id text, member_id text not null,
  action text not null check (action in ('created','updated','deleted','commented','photo_added','photo_deleted','attendance','role_changed')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_shared_event_revisions (
  revision_id bigint generated always as identity primary key,
  code text not null, event_id text not null, editor_id text not null,
  snapshot jsonb not null, created_at timestamptz not null default now()
);

create table if not exists public.calendar_shared_photos (
  code text not null, id text not null, event_id text not null, member_id text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/heic','image/gif')),
  data_base64 text not null check (length(data_base64) <= 2800000),
  created_at timestamptz not null default now(), deleted boolean not null default false,
  primary key (code, id),
  foreign key (code, event_id) references public.calendar_shared_events(code, id) on delete cascade
);

create index if not exists shared_comments_event_idx on public.calendar_shared_comments(code,event_id,created_at);
create index if not exists shared_activity_code_idx on public.calendar_shared_activity(code,created_at desc);
create index if not exists shared_photos_event_idx on public.calendar_shared_photos(code,event_id,created_at);
create index if not exists shared_revisions_event_idx on public.calendar_shared_event_revisions(code,event_id,created_at desc);

alter table public.calendar_shared_comments enable row level security;
alter table public.calendar_shared_attendance enable row level security;
alter table public.calendar_shared_activity enable row level security;
alter table public.calendar_shared_photos enable row level security;
alter table public.calendar_shared_event_revisions enable row level security;
revoke all on public.calendar_shared_comments, public.calendar_shared_attendance,
  public.calendar_shared_activity, public.calendar_shared_photos from anon, authenticated;
revoke all on public.calendar_shared_event_revisions from anon,authenticated;

create or replace function public.calendar_share_member_role(p_code text, p_member_id text)
returns text language sql security definer set search_path=public stable as $$
  select role from calendar_share_members
  where code=p_code and member_id=p_member_id and not deleted
$$;

create or replace function public.calendar_share_member_auth(p_code text,p_member_id text,p_secret text)
returns text language plpgsql security definer set search_path=public stable as $$
declare v_role text; v_hash text;
begin
  select role,member_secret_hash into v_role,v_hash from calendar_share_members where code=p_code and member_id=p_member_id and not deleted;
  if v_hash is null or md5(coalesce(p_secret,''))<>v_hash then raise exception 'unauthorized member'; end if;
  return v_role;
end $$;

create or replace function public.calendar_share_event_context(p_code text, p_event_id text)
returns jsonb language sql security definer set search_path=public stable as $$
  select case when exists(select 1 from calendar_shared where code=p_code and not deleted)
  then jsonb_build_object(
    'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from calendar_shared_comments c where c.code=p_code and c.event_id=p_event_id and not c.deleted),'[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(to_jsonb(a)) from calendar_shared_attendance a where a.code=p_code and a.event_id=p_event_id),'[]'::jsonb),
    'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from calendar_shared_photos p where p.code=p_code and p.event_id=p_event_id and not p.deleted),'[]'::jsonb),
    'activity', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from calendar_shared_activity a where a.code=p_code and (a.event_id=p_event_id or a.event_id is null) order by a.created_at desc limit 100) x),'[]'::jsonb)
    ,'revisions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (select * from calendar_shared_event_revisions v where v.code=p_code and v.event_id=p_event_id order by v.created_at desc limit 30) r),'[]'::jsonb)
  ) else null end
$$;

drop function if exists public.calendar_share_event_action(text,text,text,text,jsonb);
create or replace function public.calendar_share_event_action(
  p_code text, p_event_id text, p_member_id text, p_secret text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text; v_id text; v_target text;
begin
  v_role := calendar_share_member_auth(p_code,p_member_id,p_secret);
  if v_role='viewer' and p_action not in ('attendance') then raise exception 'read only'; end if;
  if not exists(select 1 from calendar_shared_events where code=p_code and id=p_event_id and not deleted) then raise exception 'unknown event'; end if;
  v_id := coalesce(nullif(p_payload->>'id',''), md5(random()::text || clock_timestamp()::text));
  if p_action='comment' then
    insert into calendar_shared_comments(code,id,event_id,member_id,body) values(p_code,v_id,p_event_id,p_member_id,left(trim(p_payload->>'body'),2000));
    insert into calendar_shared_activity(code,event_id,member_id,action,detail) values(p_code,p_event_id,p_member_id,'commented',jsonb_build_object('id',v_id));
  elsif p_action='comment_delete' then
    update calendar_shared_comments set deleted=true,updated_at=now() where code=p_code and id=p_payload->>'id' and (member_id=p_member_id or v_role in ('owner','admin'));
  elsif p_action='attendance' then
    insert into calendar_shared_attendance(code,event_id,member_id,status) values(p_code,p_event_id,p_member_id,p_payload->>'status')
    on conflict(code,event_id,member_id) do update set status=excluded.status,updated_at=now();
    insert into calendar_shared_activity(code,event_id,member_id,action,detail) values(p_code,p_event_id,p_member_id,'attendance',jsonb_build_object('status',p_payload->>'status'));
  elsif p_action='photo' then
    if (select count(*) from calendar_shared_photos where code=p_code and event_id=p_event_id and not deleted)>=30 then raise exception 'too many photos'; end if;
    insert into calendar_shared_photos(code,id,event_id,member_id,mime_type,data_base64) values(p_code,v_id,p_event_id,p_member_id,p_payload->>'mimeType',p_payload->>'base64');
    insert into calendar_shared_activity(code,event_id,member_id,action,detail) values(p_code,p_event_id,p_member_id,'photo_added',jsonb_build_object('id',v_id));
  elsif p_action='photo_delete' then
    update calendar_shared_photos set deleted=true where code=p_code and id=p_payload->>'id' and (member_id=p_member_id or v_role in ('owner','admin'));
    insert into calendar_shared_activity(code,event_id,member_id,action,detail) values(p_code,p_event_id,p_member_id,'photo_deleted',jsonb_build_object('id',p_payload->>'id'));
  elsif p_action='role' then
    if v_role not in ('owner','admin') then raise exception 'forbidden'; end if;
    v_target:=p_payload->>'memberId';
    if (p_payload->>'role')='owner' or v_target=p_member_id then raise exception 'bad role change'; end if;
    update calendar_share_members set role=p_payload->>'role',updated_at=now() where code=p_code and member_id=v_target and role<>'owner';
    insert into calendar_shared_activity(code,member_id,action,detail) values(p_code,p_member_id,'role_changed',jsonb_build_object('memberId',v_target,'role',p_payload->>'role'));
  else raise exception 'unknown action'; end if;
  return calendar_share_event_context(p_code,p_event_id);
end $$;

grant execute on function public.calendar_share_event_context(text,text),
  public.calendar_share_event_action(text,text,text,text,text,jsonb) to anon;
revoke all on function public.calendar_share_member_role(text,text),public.calendar_share_member_auth(text,text,text) from public,anon;

drop function if exists public.calendar_share_member_role_set(text,text,text,text);
create or replace function public.calendar_share_member_role_set(
  p_code text, p_actor_id text, p_secret text, p_member_id text, p_role text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_role text;
begin
  actor_role:=calendar_share_member_auth(p_code,p_actor_id,p_secret);
  if actor_role not in ('owner','admin') then raise exception 'forbidden'; end if;
  if p_role not in ('admin','member','viewer') then raise exception 'bad role'; end if;
  if p_member_id=p_actor_id then raise exception 'cannot change own role'; end if;
  if actor_role='admin' and exists(select 1 from calendar_share_members where code=p_code and member_id=p_member_id and role in ('owner','admin')) then raise exception 'forbidden'; end if;
  update calendar_share_members set role=p_role,updated_at=now()
    where code=p_code and member_id=p_member_id and role<>'owner';
  if not found then raise exception 'member not found'; end if;
  insert into calendar_shared_activity(code,member_id,action,detail)
    values(p_code,p_actor_id,'role_changed',jsonb_build_object('memberId',p_member_id,'role',p_role));
  return coalesce((select jsonb_agg(to_jsonb(m)) from calendar_share_members m where code=p_code and not deleted),'[]'::jsonb);
end $$;
grant execute on function public.calendar_share_member_role_set(text,text,text,text,text) to anon;

-- Preserve the existing member heartbeat behavior, while assigning ownership
-- exactly once for newly-created shares.
create or replace function public.calendar_share_member_put(p_code text,p_member jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_member is null or p_member='null'::jsonb then return; end if;
  perform calendar_share_member_guard(p_code,p_member);
  if length(coalesce(p_member->>'secret',''))<>64 then raise exception 'bad member secret'; end if;
  if exists(select 1 from calendar_share_members where code=p_code and member_id=p_member->>'id' and member_secret_hash is not null and member_secret_hash<>md5(p_member->>'secret')) then raise exception 'unauthorized member'; end if;
  insert into calendar_share_members as m(code,member_id,name,emoji,color,last_seen_at,updated_at,deleted,role,member_secret_hash)
  values(p_code,p_member->>'id',p_member->>'name',coalesce(p_member->>'emoji',''),nullif(p_member->>'color',''),now(),(p_member->>'updatedAt')::timestamptz,coalesce((p_member->>'deleted')::boolean,false),
    case when not exists(select 1 from calendar_share_members where code=p_code and not deleted) then 'owner' else 'member' end,md5(p_member->>'secret'))
  on conflict(code,member_id) do update set last_seen_at=now(),
    name=case when excluded.updated_at>m.updated_at then excluded.name else m.name end,
    emoji=case when excluded.updated_at>m.updated_at then excluded.emoji else m.emoji end,
    color=case when excluded.updated_at>m.updated_at then excluded.color else m.color end,
    deleted=case when excluded.updated_at>m.updated_at then excluded.deleted else m.deleted end,
    member_secret_hash=coalesce(m.member_secret_hash,excluded.member_secret_hash),
    updated_at=greatest(excluded.updated_at,m.updated_at);
end $$;
revoke all on function public.calendar_share_member_put(text,jsonb) from public,anon;

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
  insert into calendar_shared_events as target(code,id,title,start_date,end_date,all_day,start_time,end_time,memo,creator_id,updated_at,deleted)
  select p_code,e->>'id',e->>'title',e->>'startDate',e->>'endDate',(e->>'allDay')::boolean,e->>'startTime',e->>'endTime',e->>'memo',coalesce(e->>'creatorId',p_member->>'id'),now(),coalesce((e->>'deleted')::boolean,false)
  from jsonb_array_elements(p_events) e
  on conflict(code,id) do update set title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,all_day=excluded.all_day,start_time=excluded.start_time,end_time=excluded.end_time,memo=excluded.memo,creator_id=coalesce(target.creator_id,excluded.creator_id),updated_at=greatest(now(),target.updated_at+interval '1 microsecond'),deleted=excluded.deleted;
  return calendar_share_pull(p_code,'-infinity',p_member);
end $$;
grant execute on function public.calendar_share_push(text,jsonb,jsonb,jsonb) to anon;

create or replace function public.calendar_shared_event_audit()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into calendar_shared_activity(code,event_id,member_id,action,detail)
      values(new.code,new.id,coalesce(current_setting('app.shared_member_id',true),new.creator_id,'unknown'),'created',jsonb_build_object('title',new.title));
  elsif old.deleted is distinct from new.deleted and new.deleted then
    insert into calendar_shared_activity(code,event_id,member_id,action,detail)
      values(new.code,new.id,coalesce(current_setting('app.shared_member_id',true),new.creator_id,'unknown'),'deleted',jsonb_build_object('title',new.title));
  elsif row(old.title,old.start_date,old.end_date,old.memo) is distinct from row(new.title,new.start_date,new.end_date,new.memo) then
    insert into calendar_shared_activity(code,event_id,member_id,action,detail)
      values(new.code,new.id,coalesce(current_setting('app.shared_member_id',true),new.creator_id,'unknown'),'updated',jsonb_build_object('title',new.title));
  end if;
  return new;
end $$;
create or replace function public.calendar_shared_event_revision_capture()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if row(old.title,old.start_date,old.end_date,old.all_day,old.start_time,old.end_time,old.memo,old.deleted)
     is distinct from row(new.title,new.start_date,new.end_date,new.all_day,new.start_time,new.end_time,new.memo,new.deleted) then
    insert into calendar_shared_event_revisions(code,event_id,editor_id,snapshot)
    values(old.code,old.id,coalesce(current_setting('app.shared_member_id',true),'unknown'),to_jsonb(old)-'code');
  end if;
  return new;
end $$;
drop trigger if exists calendar_shared_event_revision_trigger on public.calendar_shared_events;
create trigger calendar_shared_event_revision_trigger before update on public.calendar_shared_events
for each row execute function public.calendar_shared_event_revision_capture();

-- Low-latency invalidation only; clients still pull authoritative rows through
-- guarded RPCs. The 128-bit share code is the public-channel capability.
create or replace function public.calendar_share_realtime_notify()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text:=coalesce(new.code,old.code);
begin
  perform realtime.send(jsonb_build_object('at',clock_timestamp()),'changed','calendar:'||v_code,false);
  return coalesce(new,old);
end $$;
drop trigger if exists shared_event_realtime on public.calendar_shared_events;
create trigger shared_event_realtime after insert or update or delete on public.calendar_shared_events for each row execute function public.calendar_share_realtime_notify();
drop trigger if exists shared_comment_realtime on public.calendar_shared_comments;
create trigger shared_comment_realtime after insert or update or delete on public.calendar_shared_comments for each row execute function public.calendar_share_realtime_notify();
drop trigger if exists shared_attendance_realtime on public.calendar_shared_attendance;
create trigger shared_attendance_realtime after insert or update or delete on public.calendar_shared_attendance for each row execute function public.calendar_share_realtime_notify();
drop trigger if exists shared_photo_realtime on public.calendar_shared_photos;
create trigger shared_photo_realtime after insert or update or delete on public.calendar_shared_photos for each row execute function public.calendar_share_realtime_notify();
drop trigger if exists calendar_shared_event_audit_trigger on public.calendar_shared_events;
create trigger calendar_shared_event_audit_trigger after insert or update on public.calendar_shared_events
for each row execute function public.calendar_shared_event_audit();
