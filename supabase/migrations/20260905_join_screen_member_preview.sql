-- The join flow was three stacked native Alert.alert popups showing only
-- "<emoji> <name> — N件の予定", with no idea who's actually in the calendar
-- and no chance to pick your own display name/color until after joining
-- (you land as "名前未設定" and have to rename yourself separately in
-- ShareMembersModal). This adds a lightweight member preview to the same
-- pre-join meta call so the new join screen can show "who's already here"
-- before you commit — purely additive to the JSON shape, no new grant
-- needed since calendar_share_meta already has execute granted to anon.

create or replace function public.calendar_share_meta(p_code text)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
           'name', name, 'color', color, 'emoji', emoji,
           'events', (select count(*) from calendar_shared_events e
                      where e.code = c.code and not e.deleted),
           'members', (select count(*) from calendar_share_members m
                       where m.code = c.code and not m.deleted),
           'memberPreview', coalesce((
             select jsonb_agg(jsonb_build_object('name', p.name, 'emoji', p.emoji, 'color', p.color))
             from (
               select name, emoji, color from calendar_share_members m2
               where m2.code = c.code and not m2.deleted
               order by (role = 'owner') desc, last_seen_at desc
               limit 8
             ) p
           ), '[]'::jsonb))
  from calendar_shared c
  where c.code = p_code and not c.deleted and not c.invite_closed;
$$;
