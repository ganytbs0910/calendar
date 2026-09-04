/**
 * @format
 *
 * The join screen replaced three stacked native alerts with a real preview
 * (calendar name/color/emoji, who's already in it) and lets the joiner pick
 * their own name/color before the first sync — this covers that the chosen
 * profile actually reaches the server on the very first push, and that
 * fetchShareMeta's new memberPreview field survives the round trip.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {joinSharedCalendar, fetchShareMeta, getMe} from '../src/services/sharedCalendarService';

const CODE = 'a'.repeat(32);

let calls: Array<{fn: string; body: any}>;

const mockFetch = (metaPayload: any, pushPayload: any) => {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    const fn = String(url).split('/rpc/')[1];
    const body = JSON.parse(init.body);
    calls.push({fn, body});
    const payload = fn === 'calendar_share_meta' ? metaPayload : pushPayload;
    return {ok: true, json: async () => payload, text: async () => JSON.stringify(payload)} as any;
  });
};

beforeEach(async () => {
  await AsyncStorage.clear();
  calls = [];
});

describe('joinSharedCalendar with a chosen profile', () => {
  it('sends the chosen name/color on the very first sync, not "名前未設定"', async () => {
    mockFetch(
      {name: 'サークル', color: '#007AFF', emoji: '🍻', events: 2, members: 1, memberPreview: [{name: 'オーナー', emoji: '', color: '#FF0000'}]},
      {calendar: null, events: [], now: '2030-01-01T00:00:00.000Z', members: []},
    );

    const cal = await joinSharedCalendar(CODE, {name: 'わたし', color: '#FF2D55'});

    expect(cal?.name).toBe('サークル');
    const push = calls.find(c => c.fn === 'calendar_share_push');
    expect(push?.body.p_member.name).toBe('わたし');
    expect(push?.body.p_member.color).toBe('#FF2D55');

    const me = await getMe();
    expect(me?.name).toBe('わたし');
    expect(me?.color).toBe('#FF2D55');
    expect(me?.auto).toBe(false);
  });

  it('joining without a profile keeps the previous behavior (no name override)', async () => {
    mockFetch(
      {name: 'サークル', color: '#007AFF', emoji: '🍻', events: 0, members: 1, memberPreview: []},
      {calendar: null, events: [], now: '2030-01-01T00:00:00.000Z', members: []},
    );

    await joinSharedCalendar(CODE);

    const push = calls.find(c => c.fn === 'calendar_share_push');
    // Auto-generated placeholder, not a name the joiner chose.
    expect(push?.body.p_member.name).toBeTruthy();
    const me = await getMe();
    expect(me?.auto).toBe(true);
  });

  it('fetchShareMeta passes memberPreview through', async () => {
    mockFetch(
      {name: 'サークル', color: '#007AFF', emoji: '🍻', events: 3, members: 2, memberPreview: [
        {name: 'オーナー', emoji: '', color: '#FF0000'},
        {name: 'がん', emoji: '', color: '#FF2D55'},
      ]},
      {},
    );

    const meta = await fetchShareMeta(CODE);
    expect(meta?.memberPreview).toHaveLength(2);
    expect(meta?.memberPreview[0].name).toBe('オーナー');
  });

  it('fetchShareMeta defaults memberPreview to an empty array when the server omits it', async () => {
    mockFetch({name: 'サークル', color: '#007AFF', emoji: '🍻', events: 0, members: 0}, {});

    const meta = await fetchShareMeta(CODE);
    expect(meta?.memberPreview).toEqual([]);
  });
});
