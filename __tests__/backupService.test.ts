/**
 * Restoring overwrites everything the user currently has, so the failure modes
 * matter more than the happy path: a foreign file, a truncated file, or a
 * hand-edited one must be refused *before* anything is written.
 *
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BACKUP_MAGIC,
  createBackup,
  isBackedUp,
  parseBackup,
  restoreBackup,
  serializeBackup,
  backupFileName,
  PHOTO_BUDGET_BYTES,
} from '../src/services/backupService';

beforeEach(async () => {
  await AsyncStorage.clear();
});

const seed = async (pairs: Record<string, string>) => {
  await AsyncStorage.multiSet(Object.entries(pairs));
};

describe('何を持ち出すか', () => {
  it('通常のキーは含める', () => {
    expect(isBackedUp('@jobs')).toBe(true);
    expect(isBackedUp('@sleep_settings')).toBe(true);
    expect(isBackedUp('@today_tasks')).toBe(true);
  });

  it('購入状態・ロックの秘密・開発用の印は含めない', () => {
    expect(isBackedUp('@is_premium')).toBe(false);
    expect(isBackedUp('@lock_pin_hash')).toBe(false);
    expect(isBackedUp('@lock_pin_salt')).toBe(false);
    expect(isBackedUp('@dev_seeded_2026_summer')).toBe(false);
  });

  it('写真の対応表は汎用コピーの対象外（画像と対にして別途運ぶため）', () => {
    expect(isBackedUp('@event_photos')).toBe(false);
  });

  it('書き出しから除外キーが落ちている', async () => {
    await seed({
      '@jobs': '[{"id":"j1"}]',
      '@is_premium': 'true',
      '@lock_pin_hash': 'deadbeef',
      '@dev_seeded_2026_summer': '1',
    });

    const backup = await createBackup(new Date('2026-08-14T00:00:00Z'));

    expect(Object.keys(backup.data)).toEqual(['@jobs']);
    expect(backup.magic).toBe(BACKUP_MAGIC);
    expect(backup.createdAt).toBe('2026-08-14T00:00:00.000Z');
  });
});

describe('読み込みの拒否', () => {
  it('JSONとして壊れていれば拒否', () => {
    expect(parseBackup('{')).toEqual({ok: false, reason: 'unreadable'});
  });

  it('他所のJSONは拒否', () => {
    expect(parseBackup('{"hello":"world"}')).toEqual({ok: false, reason: 'foreign'});
  });

  it('将来のバージョンは拒否（このビルドが誤解釈しうるため）', () => {
    const raw = JSON.stringify({magic: BACKUP_MAGIC, version: 99, data: {'@jobs': '[]'}});
    expect(parseBackup(raw)).toEqual({ok: false, reason: 'tooNew'});
  });

  it('中身が空なら拒否（全消しを「復元」と呼ばない）', () => {
    const raw = JSON.stringify({magic: BACKUP_MAGIC, version: 1, data: {}});
    expect(parseBackup(raw)).toEqual({ok: false, reason: 'empty'});
  });

  it('手で足された除外キーは読み込み時にも落とす', () => {
    const raw = JSON.stringify({
      magic: BACKUP_MAGIC,
      version: 1,
      data: {'@jobs': '[]', '@is_premium': 'true', '@lock_pin_hash': 'x'},
    });

    const result = parseBackup(raw);

    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.backup.data)).toEqual(['@jobs']);
  });
});

describe('往復', () => {
  it('書き出して読み戻すと同じ中身になる', async () => {
    await seed({'@jobs': '[{"id":"j1"}]', '@sleep_settings': '{"weekday":{}}'});

    const raw = serializeBackup(await createBackup());
    const result = parseBackup(raw);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.data).toEqual({
        '@jobs': '[{"id":"j1"}]',
        '@sleep_settings': '{"weekday":{}}',
      });
    }
  });

  it('復元後の状態は、合成ではなくバックアップそのものになる', async () => {
    await seed({'@jobs': '[{"id":"old"}]', '@today_tasks': '[{"id":"t1"}]'});
    const result = parseBackup(
      JSON.stringify({magic: BACKUP_MAGIC, version: 1, data: {'@jobs': '[{"id":"new"}]'}}),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await restoreBackup(result.backup);

    expect(await AsyncStorage.getItem('@jobs')).toBe('[{"id":"new"}]');
    // バックアップに無かったキーは残さない。残すと、書き出し前に消したはずの
    // データが復元後に生き返る。
    expect(await AsyncStorage.getItem('@today_tasks')).toBeNull();
  });

  it('この端末の購入状態とロックは復元で触らない', async () => {
    await seed({'@is_premium': 'true', '@lock_pin_hash': 'keepme', '@jobs': '[]'});
    const result = parseBackup(
      JSON.stringify({magic: BACKUP_MAGIC, version: 1, data: {'@jobs': '[{"id":"new"}]'}}),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await restoreBackup(result.backup);

    expect(await AsyncStorage.getItem('@is_premium')).toBe('true');
    expect(await AsyncStorage.getItem('@lock_pin_hash')).toBe('keepme');
  });
});

it('ファイル名に日付が入る', () => {
  expect(backupFileName(new Date(2026, 7, 14))).toBe('ideal-calendar-backup-2026-08-14.json');
});

describe('写真', () => {
  const RNFS = require('react-native-fs');
  const photoMap = JSON.stringify({
    'ev-1': [{uri: 'file:///tmp/documents/event_photos/a.jpg', addedAt: '2026-08-01T00:00:00Z'}],
    'ev-2': [{uri: 'file:///tmp/documents/event_photos/b.jpg', addedAt: '2026-08-02T00:00:00Z'}],
  });

  beforeEach(() => {
    RNFS.stat.mockResolvedValue({size: 1000});
    RNFS.readFile.mockResolvedValue('BASE64');
    RNFS.writeFile.mockClear();
  });

  it('画像を base64 で同梱し、対応表も一緒に運ぶ', async () => {
    await seed({'@event_photos': photoMap});

    const backup = await createBackup();

    expect(Object.keys(backup.photos ?? {}).sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(backup.data['@event_photos']).toBe(photoMap);
    expect(backup.photosOmitted).toBeUndefined();
  });

  it('容量を超えた分は落とし、落としたことを申告する', async () => {
    RNFS.stat.mockResolvedValue({size: PHOTO_BUDGET_BYTES});
    await seed({'@event_photos': photoMap});

    const backup = await createBackup();

    // 1枚で予算いっぱい。新しい方（b, 8/02）が残る。
    expect(Object.keys(backup.photos ?? {})).toEqual(['b.jpg']);
    expect(backup.photosOmitted).toBe(true);
  });

  it('画像が1枚も運べないなら対応表も入れない（壊れた参照を作らない）', async () => {
    RNFS.stat.mockRejectedValue(new Error('gone'));
    await seed({'@event_photos': photoMap});

    const backup = await createBackup();

    expect(backup.photos).toBeUndefined();
    expect(backup.data['@event_photos']).toBeUndefined();
  });

  it('復元時、対応表のパスをこの端末のサンドボックスに書き換える', async () => {
    const raw = JSON.stringify({
      magic: BACKUP_MAGIC,
      version: 2,
      data: {
        '@event_photos': JSON.stringify({
          'ev-1': [{uri: 'file:///OLD/PHONE/event_photos/a.jpg', addedAt: '2026-08-01T00:00:00Z'}],
        }),
      },
      photos: {'a.jpg': 'BASE64'},
    });
    const result = parseBackup(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await restoreBackup(result.backup);

    // 画像が書かれ、対応表は新しい絶対パスを指す。
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      '/tmp/documents/event_photos/a.jpg', 'BASE64', 'base64',
    );
    const map = JSON.parse((await AsyncStorage.getItem('@event_photos'))!);
    expect(map['ev-1'][0].uri).toBe('file:///tmp/documents/event_photos/a.jpg');
  });

  it('ファイル名に区切りを含む細工は復元しない', () => {
    const raw = JSON.stringify({
      magic: BACKUP_MAGIC,
      version: 2,
      data: {'@jobs': '[]'},
      photos: {'../../evil.js': 'BASE64', 'ok.jpg': 'BASE64'},
    });

    const result = parseBackup(raw);

    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.backup.photos ?? {})).toEqual(['ok.jpg']);
  });
});

it('写真だけは復元で消さない（置き換え規則の唯一の例外）', async () => {
  const existing = JSON.stringify({
    'ev-old': [{uri: 'file:///tmp/documents/event_photos/old.jpg', addedAt: '2026-07-01T00:00:00Z'}],
  });
  await AsyncStorage.multiSet([['@event_photos', existing], ['@jobs', '[]']]);
  // 写真を含まないバックアップ（例: 容量超過で落ちた場合）
  const result = parseBackup(
    JSON.stringify({magic: BACKUP_MAGIC, version: 2, data: {'@jobs': '[{"id":"new"}]'}}),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  await restoreBackup(result.backup);

  expect(await AsyncStorage.getItem('@jobs')).toBe('[{"id":"new"}]');
  // 手元の写真は残る。バックアップに無かったことを理由に画像を消さない。
  expect(await AsyncStorage.getItem('@event_photos')).toBe(existing);
});
