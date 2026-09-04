/**
 * @format
 *
 * The per-event collaboration layer (attendance/comments/photos/activity/
 * revisions — src/components/localcal/SharedEventCollaboration.tsx) had zero
 * test coverage despite being live in production. This covers the service
 * functions it depends on: that the snake_case→camelCase mapping is right
 * (a typo here silently drops a field in the UI, it wouldn't throw), that
 * actions send the right RPC params, and the "not shared" fallbacks.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setShareCode, setMyName, getSharedEventContext, sharedEventAction,
} from '../src/services/sharedCalendarService';

let calls: Array<{fn: string; body: any}>;
const reply = (payload: any) => {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({fn: String(url).split('/rpc/')[1], body: JSON.parse(init.body)});
    return {ok: true, json: async () => payload, text: async () => JSON.stringify(payload)} as any;
  });
};

const rawContext = {
  comments: [{id: 'c1', event_id: 'e1', member_id: 'm1', body: 'いいね', created_at: '2030-01-01T00:00:00Z'}],
  attendance: [{member_id: 'm1', status: 'going', updated_at: '2030-01-01T00:00:00Z'}],
  photos: [{id: 'p1', event_id: 'e1', member_id: 'm1', mime_type: 'image/jpeg', data_base64: 'AAAA', created_at: '2030-01-01T00:00:00Z'}],
  activity: [{seq: 1, event_id: 'e1', member_id: 'm1', action: 'created', detail: {foo: 'bar'}, created_at: '2030-01-01T00:00:00Z'}],
  revisions: [{revision_id: 'r1', editor_id: 'm1', snapshot: {title: '飲み会'}, created_at: '2030-01-01T00:00:00Z'}],
};

beforeEach(async () => {
  await AsyncStorage.clear();
  calls = [];
});

describe('getSharedEventContext', () => {
  it('maps every snake_case field to the camelCase shape the UI reads', async () => {
    await setShareCode('lc-1', 'a'.repeat(32));
    reply(rawContext);

    const ctx = await getSharedEventContext('lc-1', 'e1');

    expect(ctx.comments).toEqual([{id: 'c1', eventId: 'e1', memberId: 'm1', body: 'いいね', createdAt: '2030-01-01T00:00:00Z'}]);
    expect(ctx.attendance).toEqual([{memberId: 'm1', status: 'going', updatedAt: '2030-01-01T00:00:00Z'}]);
    expect(ctx.photos).toEqual([{id: 'p1', eventId: 'e1', memberId: 'm1', mimeType: 'image/jpeg', base64: 'AAAA', createdAt: '2030-01-01T00:00:00Z'}]);
    expect(ctx.activity).toEqual([{seq: 1, eventId: 'e1', memberId: 'm1', action: 'created', detail: {foo: 'bar'}, createdAt: '2030-01-01T00:00:00Z'}]);
    expect(ctx.revisions).toEqual([{revisionId: 'r1', editorId: 'm1', snapshot: {title: '飲み会'}, createdAt: '2030-01-01T00:00:00Z'}]);

    expect(calls[0].fn).toBe('calendar_share_event_context');
    expect(calls[0].body).toEqual({p_code: 'a'.repeat(32), p_event_id: 'e1'});
  });

  it('returns an all-empty context without calling the server when the calendar is not shared', async () => {
    reply(rawContext);
    const ctx = await getSharedEventContext('lc-not-shared', 'e1');
    expect(ctx).toEqual({comments: [], attendance: [], photos: [], activity: [], revisions: []});
    expect(calls.length).toBe(0);
  });
});

describe('sharedEventAction', () => {
  it('sends the actor id/secret and payload, and maps the returned context', async () => {
    await setShareCode('lc-1', 'b'.repeat(32));
    await setMyName('わたし');
    reply(rawContext);

    const ctx = await sharedEventAction('lc-1', 'e1', 'comment', {body: 'いいね'});

    expect(calls[0].fn).toBe('calendar_share_event_action');
    expect(calls[0].body.p_code).toBe('b'.repeat(32));
    expect(calls[0].body.p_event_id).toBe('e1');
    expect(calls[0].body.p_action).toBe('comment');
    expect(calls[0].body.p_payload).toEqual({body: 'いいね'});
    expect(typeof calls[0].body.p_member_id).toBe('string');
    expect(typeof calls[0].body.p_secret).toBe('string');
    expect(ctx.comments[0].body).toBe('いいね');
  });

  it('rejects instead of silently no-op-ing when the calendar is not shared', async () => {
    await expect(sharedEventAction('lc-not-shared', 'e1', 'attendance', {status: 'going'}))
      .rejects.toThrow('calendar is not shared');
  });
});
