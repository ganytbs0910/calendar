-- Fix: owner/admin actions (invite-close, kick, leave, role-set) reject a
-- legitimate actor whose member_secret_hash was never backfilled.
--
-- calendar_share_member_role_set/_set_invite_closed/_kick_member/_leave all
-- check calendar_share_member_auth() directly against whatever is currently
-- in member_secret_hash. That column only ever gets set by
-- calendar_share_member_put() (called from push/pull) — but a member row
-- created before 20260825_shared_collaboration.sql (which added the column
-- and backfilled `role` but NOT the hash) still has member_secret_hash =
-- null. calendar_share_member_auth() treats a null hash as "never
-- authenticate" unconditionally, so that legitimate owner/admin can never
-- pass the check on THESE four RPCs — even though their normal push/pull
-- already self-heals the same column just fine.
--
-- Confirmed live: querying calendar_share_members for role='owner' found a
-- real row with member_secret_hash null.
--
-- Fix: give these four RPCs the same self-healing step push/pull already
-- have, via a minimal helper that only ever fills a null hash (never
-- overwrites an existing one — that stays calendar_share_member_put's job,
-- which also validates secret length; this helper trusts its caller to
-- have already gotten a real secret from local storage).

create or replace function public.calendar_share_ensure_secret(
  p_code text, p_member_id text, p_secret text
) returns void language plpgsql security definer set search_path=public as $$
begin
  if length(coalesce(p_secret, '')) <> 64 then
    return; -- nothing sane to backfill with; let the auth check below fail normally
  end if;
  update calendar_share_members
    set member_secret_hash = md5(p_secret)
    where code = p_code and member_id = p_member_id and member_secret_hash is null;
end $$;
revoke all on function public.calendar_share_ensure_secret(text,text,text) from public,anon;

create or replace function public.calendar_share_member_role_set(
  p_code text, p_actor_id text, p_secret text, p_member_id text, p_role text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_role text;
begin
  perform calendar_share_ensure_secret(p_code, p_actor_id, p_secret);
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

create or replace function public.calendar_share_set_invite_closed(
  p_code text, p_actor_id text, p_secret text, p_closed boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  perform calendar_share_ensure_secret(p_code, p_actor_id, p_secret);
  v_role := calendar_share_member_auth(p_code, p_actor_id, p_secret);
  if v_role <> 'owner' then raise exception 'forbidden'; end if;
  update calendar_shared set invite_closed = p_closed where code = p_code;
end $$;
grant execute on function public.calendar_share_set_invite_closed(text,text,text,boolean) to anon;

create or replace function public.calendar_share_kick_member(
  p_code text, p_actor_id text, p_secret text, p_target_member_id text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  perform calendar_share_ensure_secret(p_code, p_actor_id, p_secret);
  v_role := calendar_share_member_auth(p_code, p_actor_id, p_secret);
  if v_role not in ('owner','admin') then raise exception 'forbidden'; end if;
  if p_target_member_id = p_actor_id then raise exception 'use leave, not kick, on yourself'; end if;
  if exists (select 1 from calendar_share_members
             where code = p_code and member_id = p_target_member_id and role = 'owner') then
    raise exception 'cannot kick the owner';
  end if;
  update calendar_share_members set deleted = true, banned = true, updated_at = now()
    where code = p_code and member_id = p_target_member_id;
  if not found then raise exception 'member not found'; end if;
  insert into calendar_shared_activity(code, member_id, action, detail)
    values (p_code, p_actor_id, 'role_changed', jsonb_build_object('memberId', p_target_member_id, 'kicked', true));
  return coalesce((select jsonb_agg(to_jsonb(m)) from calendar_share_members m
                    where code = p_code and not deleted), '[]'::jsonb);
end $$;
grant execute on function public.calendar_share_kick_member(text,text,text,text) to anon;

create or replace function public.calendar_share_leave(
  p_code text, p_member_id text, p_secret text
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  perform calendar_share_ensure_secret(p_code, p_member_id, p_secret);
  v_role := calendar_share_member_auth(p_code, p_member_id, p_secret);
  if v_role = 'owner' then raise exception 'owner cannot leave; delete the calendar instead'; end if;
  update calendar_share_members set deleted = true, updated_at = now()
    where code = p_code and member_id = p_member_id;
end $$;
grant execute on function public.calendar_share_leave(text,text,text) to anon;
