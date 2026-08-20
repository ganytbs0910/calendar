/**
 * @format
 *
 * レビューが全地域で0件だったのは、アプリが一度も聞いていなかったから。
 * かといって無条件に聞くと、OS 側の年3回の枠を無駄に使い切る。
 * ここで固定したいのは「聞かない条件」の方。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import InAppReview from 'react-native-in-app-review';

import {
  maybeAskForReview,
  recordActiveDay,
  resetReviewPromptState,
} from '../src/services/reviewPromptService';

const asked = () => (InAppReview.RequestInAppReview as jest.Mock).mock.calls.length;

const useOnDays = async (...offsets: number[]) => {
  for (const d of offsets) {
    jest.setSystemTime(new Date(2030, 0, 10 + d, 9, 0, 0));
    await recordActiveDay();
  }
};

describe('review prompt', () => {
  beforeAll(() => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
                  'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
      now: new Date(2030, 0, 10, 9, 0, 0),
    });
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await resetReviewPromptState();
    (InAppReview.isAvailable as jest.Mock).mockReturnValue(true);
  });

  it('does not ask someone who has only just arrived', async () => {
    await useOnDays(0);
    await maybeAskForReview('2.11.1');
    expect(asked()).toBe(0);
  });

  it('does not count one busy afternoon as several days', async () => {
    await useOnDays(0, 0, 0, 0);
    await maybeAskForReview('2.11.1');
    expect(asked()).toBe(0);
  });

  it('asks once three separate days have gone by', async () => {
    await useOnDays(0, 1, 2);
    await maybeAskForReview('2.11.1');
    expect(asked()).toBe(1);
  });

  it('does not ask twice on the same version', async () => {
    await useOnDays(0, 1, 2);
    await maybeAskForReview('2.11.1');
    await maybeAskForReview('2.11.1');
    expect(asked()).toBe(1);
  });

  it('still waits out the interval on a new version', async () => {
    await useOnDays(0, 1, 2);
    await maybeAskForReview('2.11.1');
    jest.setSystemTime(new Date(2030, 1, 1, 9, 0, 0));   // 3週間後
    await maybeAskForReview('2.12.0');
    expect(asked()).toBe(1);
  });

  it('asks again on a new version once 60 days have passed', async () => {
    await useOnDays(0, 1, 2);
    await maybeAskForReview('2.11.1');
    jest.setSystemTime(new Date(2030, 3, 1, 9, 0, 0));   // 80日後
    await maybeAskForReview('2.12.0');
    expect(asked()).toBe(2);
  });

  it('stays quiet where the OS has no review sheet', async () => {
    (InAppReview.isAvailable as jest.Mock).mockReturnValue(false);
    await useOnDays(0, 1, 2);
    await maybeAskForReview('2.11.1');
    expect(asked()).toBe(0);
  });
});
