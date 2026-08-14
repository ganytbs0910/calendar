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

  it('写真の対応表は含めない（画像ファイル本体を運べないため）', () => {
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
