-- Shared-calendar membership management: closing an invite, kicking a
-- member, leaving as a non-owner, and a narrowly-scoped cleanup hook for the
-- load-test script.
--
-- ── Why "close the invite" instead of rotating the code ────────────────────
--
-- Every child table (calendar_shared_events, calendar_share_members,
-- calendar_shared_comments, ...) is keyed by `code` directly, with none of
-- their foreign keys declared ON UPDATE CASCADE. Rewriting calendar_shared's
-- primary key in place would need every one of those constraints retrofitted
-- first — too invasive to do safely in one pass. Closing the invite achieves
-- the actual goal (a leaked link can no longer onboard a NEW person) without
-- touching row identity at all, and — unlike a one-way rotation — the owner
-- can reopen it just as easily if it turns out to have been closed by
-- mistake.
--
-- Kicking an already-joined bad actor is the separate, real defense for that
-- case: it doesn't need code rotation either, since members already carry
-- their own secret (20260825_shared_collaboration.sql). A kicked member's
-- id+secret stop being accepted; they can still rejoin under a *new* id if
-- they still hold the link, which is the same capability-model tradeoff the
-- original design already accepted ("追い出すにはコードを作り直す" in
-- 20260821_calendar_share.sql) — this migration just raises the bar instead
-- of leaving literally no way to remove one person.

alter table public.calendar_shared add column if not exists invite_closed boolean not null default false;
alter table public.calendar_share_members add column if not exists banned boolean not null default false;

-- ── Close / reopen the invite ───────────────────────────────────────────────
-- Owner only — this changes whether ANYONE new can join, not just the
-- caller's own access.
create or replace function public.calendar_share_set_invite_closed(
  p_code text, p_actor_id text, p_secret text, p_closed boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  v_role := calendar_share_member_auth(p_code, p_actor_id, p_secret);
  if v_role <> 'owner' then raise exception 'forbidden'; end if;
  update calendar_shared set invite_closed = p_closed where code = p_code;
end $$;
grant execute on function public.calendar_share_set_invite_closed(text,text,text,boolean) to anon;

-- The join-preview screen must stop revealing anything once the invite is
-- closed, so a leaked link can't even be previewed, let alone joined.
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
  where c.code = p_code and not c.deleted and not c.invite_closed;
$$;

-- ── Kick a member ────────────────────────────────────────────────────────
-- Owner/admin only. Marks the target deleted+banned so their device's own
-- heartbeat (calendar_share_member_put, called on every pull/push) starts
-- rejecting them instead of silently reviving their row.
create or replace function public.calendar_share_kick_member(
  p_code text, p_actor_id text, p_secret text, p_target_member_id text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
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

-- ── Leave (self-removal) ────────────────────────────────────────────────────
-- Any non-owner member can always remove themself — no elevated role needed
-- to walk away from something you're already legitimately part of. The
-- owner can't leave this way; they delete the calendar instead (existing
-- flow), since a shared calendar with no owner has no one left who can
-- manage it.
create or replace function public.calendar_share_leave(
  p_code text, p_member_id text, p_secret text
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  v_role := calendar_share_member_auth(p_code, p_member_id, p_secret);
  if v_role = 'owner' then raise exception 'owner cannot leave; delete the calendar instead'; end if;
  update calendar_share_members set deleted = true, updated_at = now()
    where code = p_code and member_id = p_member_id;
end $$;
grant execute on function public.calendar_share_leave(text,text,text) to anon;

-- ── Enforce the ban at the one choke point every pull/push already goes
--    through, instead of teaching every RPC about it individually.
create or replace function public.calendar_share_member_put(p_code text,p_member jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_member is null or p_member='null'::jsonb then return; end if;
  perform calendar_share_member_guard(p_code,p_member);
  if length(coalesce(p_member->>'secret',''))<>64 then raise exception 'bad member secret'; end if;
  if exists(select 1 from calendar_share_members where code=p_code and member_id=p_member->>'id' and member_secret_hash is not null and member_secret_hash<>md5(p_member->>'secret')) then raise exception 'unauthorized member'; end if;
  if exists(select 1 from calendar_share_members where code=p_code and member_id=p_member->>'id' and banned) then raise exception 'member banned'; end if;
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

-- ── Load-test cleanup ────────────────────────────────────────────────────
-- Every load-test run creates a real share directly in this shared prod
-- project and, until now, had no way to remove it afterwards. Scoped to
-- rows the load test itself creates (name always starts with 'Load ') so
-- this can't be used to wipe an arbitrary real shared calendar.
create or replace function public.calendar_share_purge_load_test(p_code text)
returns void language plpgsql security definer set search_path=public as $$
begin
  delete from public.calendar_shared
    where code = p_code and name like 'Load %';
end $$;
grant execute on function public.calendar_share_purge_load_test(text) to anon;
