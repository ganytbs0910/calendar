// ── ストアレビューの依頼 ────────────────────────────────────────────────────
//
// 2.11.0 時点でレビューが全地域で 0 件だった。悪い評価が付いていたのではなく、
// アプリが一度も聞いていなかった。件数ゼロのページは、どれだけ流入させても
// インストールされない。
//
// 聞く相手と回数は OS 側でも絞られる（iOS は年3回まで、それを超えた分は黙って
// 無視される）。無駄撃ちすると「聞ける枠」を失うだけなので、こちら側でも
// 条件を絞る:
//   - 別々の日に3日以上使っている（1日で3回開いた人は含めない）
//   - 何かがうまくいった直後にだけ聞く。エラーの後や起動直後には聞かない
//   - 同じバージョンでは一度きり
//   - 前回から60日は空ける

import AsyncStorage from '@react-native-async-storage/async-storage';
import InAppReview from 'react-native-in-app-review';

const DAYS_KEY = '@review_active_days';
const LAST_ASKED_KEY = '@review_last_asked_at';
const ASKED_VERSION_KEY = '@review_asked_version';

const MIN_ACTIVE_DAYS = 3;
const MIN_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000;

const todayKey = (d = new Date()): string =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** 起動ごとに呼ぶ。同じ日に何度呼んでも1日ぶんにしかならない。 */
export const recordActiveDay = async (): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(DAYS_KEY);
    const days: string[] = raw ? JSON.parse(raw) : [];
    const t = todayKey();
    if (days.includes(t)) return;
    // 直近ぶんだけ残せば十分。判定に使うのは件数だけ。
    await AsyncStorage.setItem(DAYS_KEY, JSON.stringify([...days, t].slice(-10)));
  } catch {
    // 記録できなくても本題ではない
  }
};

const eligible = async (version: string): Promise<boolean> => {
  const [raw, last, askedVersion] = await Promise.all([
    AsyncStorage.getItem(DAYS_KEY),
    AsyncStorage.getItem(LAST_ASKED_KEY),
    AsyncStorage.getItem(ASKED_VERSION_KEY),
  ]);
  if (askedVersion === version) return false;
  const days: string[] = raw ? JSON.parse(raw) : [];
  if (days.length < MIN_ACTIVE_DAYS) return false;
  if (last && Date.now() - Number(last) < MIN_INTERVAL_MS) return false;
  return true;
};

/**
 * 「うまくいった」瞬間に呼ぶ。条件を満たさなければ黙って何もしない。
 * 依頼したかどうかは OS が教えてくれないので、出そうとした時点で記録する
 * （そうしないと OS に無視された回を延々と数え直すことになる）。
 */
export const maybeAskForReview = async (version: string): Promise<void> => {
  try {
    if (!InAppReview.isAvailable()) return;
    if (!(await eligible(version))) return;
    await AsyncStorage.multiSet([
      [LAST_ASKED_KEY, String(Date.now())],
      [ASKED_VERSION_KEY, version],
    ]);
    await InAppReview.RequestInAppReview();
  } catch {
    // 依頼できなくてもユーザーの操作を止めない
  }
};

/** テスト・設定画面から状態を戻すため。 */
export const resetReviewPromptState = async (): Promise<void> => {
  await AsyncStorage.multiRemove([DAYS_KEY, LAST_ASKED_KEY, ASKED_VERSION_KEY]);
};
