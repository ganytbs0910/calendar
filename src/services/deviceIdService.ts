// ── deviceIdService — 匿名の端末ID ───────────────────────────────────────────
//
// このアプリにアカウントは無いので、利用状況シグナル(analyticsService)を
// 送るための識別子として、ランダム生成したUUIDを1個だけ端末に保存して
// 使い回す。ログイン・メールアドレス・広告IDのいずれとも紐付かない。
//
// crypto.randomUUID() はHermesに無く、react-native-get-random-values等の
// ポリフィルを足すほどのことでもないため、BrawlStatus(同じSupabase
// プロジェクトの別アプリ)の rewardsService.ts と同じ Math.random() ベースの
// 簡易生成にしている。一意性だけが目的で暗号強度は要らない。

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@calendar_device_id';

const generateDeviceId = (): string => {
  const rnd = () => Math.random().toString(16).slice(2, 10);
  return `${rnd()}-${rnd().slice(0, 4)}-4${rnd().slice(0, 3)}-${rnd().slice(0, 4)}-${rnd()}${rnd().slice(0, 4)}`;
};

export const getDeviceId = async (): Promise<string> => {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};
