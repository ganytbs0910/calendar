/**
 * reassignEventPhotos moves an event's photos to the new id an undone delete
 * produces. The files must survive the move — losing them is unrecoverable.
 *
 * Uses the shared AsyncStorage and react-native-fs mocks from jest.setup.js.
 *
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {
  getEventPhotos,
  reassignEventPhotos,
  removeAllEventPhotos,
} from '../src/services/eventPhotoService';

const KEY = '@event_photos';
const unlink = RNFS.unlink as unknown as jest.Mock;

const photo = (name: string) => ({
  uri: `file:///tmp/documents/event_photos/${name}`,
  addedAt: '2026-01-01T00:00:00.000Z',
});

const seed = (map: Record<string, ReturnType<typeof photo>[]>) =>
  AsyncStorage.setItem(KEY, JSON.stringify(map));

describe('reassignEventPhotos', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(KEY);
    unlink.mockClear();
  });

  it('moves photos to the new id and deletes no files', async () => {
    await seed({old: [photo('a.jpg'), photo('b.jpg')]});

    await reassignEventPhotos('old', 'new');

    expect(await getEventPhotos('new')).toEqual([photo('a.jpg'), photo('b.jpg')]);
    expect(await getEventPhotos('old')).toEqual([]);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('appends to whatever the destination already had', async () => {
    await seed({old: [photo('a.jpg')], dest: [photo('existing.jpg')]});

    await reassignEventPhotos('old', 'dest');

    expect(await getEventPhotos('dest')).toEqual([photo('existing.jpg'), photo('a.jpg')]);
  });

  it('leaves other events untouched', async () => {
    await seed({old: [photo('a.jpg')], other: [photo('c.jpg')]});

    await reassignEventPhotos('old', 'new');

    expect(await getEventPhotos('other')).toEqual([photo('c.jpg')]);
  });

  it('is a no-op when the source has nothing', async () => {
    await seed({other: [photo('c.jpg')]});

    await reassignEventPhotos('missing', 'new');

    expect(await getEventPhotos('new')).toEqual([]);
    expect(await getEventPhotos('other')).toEqual([photo('c.jpg')]);
  });

  it('survives a delete-then-undo round trip with the files intact', async () => {
    await seed({evt1: [photo('a.jpg')]});

    // Undo re-keys before the window closes, so the later discard finds nothing.
    await reassignEventPhotos('evt1', 'evt1-restored');
    await removeAllEventPhotos('evt1');

    expect(await getEventPhotos('evt1-restored')).toEqual([photo('a.jpg')]);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('still unlinks when the window closes without an undo', async () => {
    await seed({evt1: [photo('a.jpg')]});

    await removeAllEventPhotos('evt1');

    expect(await getEventPhotos('evt1')).toEqual([]);
    expect(unlink).toHaveBeenCalledWith('/tmp/documents/event_photos/a.jpg');
  });
});
