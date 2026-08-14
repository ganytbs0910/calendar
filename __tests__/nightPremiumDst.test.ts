/**
 * The night-premium window is built from wall-clock hours, and on the two days
 * a year a region moves its clocks, a day is 23 or 25 hours long. Adding
 * milliseconds to midnight therefore landed an hour off, and the pay for a
 * shift on those days came out wrong.
 *
 * Japan has no DST, so this is invisible where most of the users are — which is
 * exactly why it needs a test.
 *
 * Needs a timezone that actually observes DST:
 *
 *     TZ=Europe/Berlin npx jest nightPremiumDst      (npm run test:dst)
 *
 * Setting process.env.TZ from inside the file is too late — the runtime has
 * already resolved the zone — so these skip rather than pass without testing
 * anything, which is what they did when it was written that way.
 *
 * @format
 */

import {computeShiftPay} from '../src/services/statisticsService';

/** 2026-03-29 is the spring transition in Europe/Berlin (02:00 → 03:00). */
const observesDst =
  new Date(2026, 2, 29, 0, 0).getTimezoneOffset() !==
  new Date(2026, 2, 29, 12, 0).getTimezoneOffset();

const itDst = observesDst ? it : it.skip;

const job = {
  id: 'j1',
  name: 'cafe',
  hourlyWage: 1000,
  unpaidBreakMin: 0,
  nightEnabled: true,
  nightStart: '22:00',
  nightEnd: '05:00',
  nightRate: 1.25,
  overtimeEnabled: false,
  holidayEnabled: false,
  transportPerShift: 0,
} as any;

itDst('春の切替日でも22時から深夜割増が始まる', () => {
  // 20:00–23:00。深夜は22:00からなので1時間。
  const pay = computeShiftPay(new Date(2026, 2, 29, 20, 0), new Date(2026, 2, 29, 23, 0), job);

  expect(pay.nightMinutes).toBe(60);
});

itDst('秋の切替日でも22時から深夜割増が始まる', () => {
  // 2026-10-25 は戻す日（03:00 → 02:00）。
  const pay = computeShiftPay(new Date(2026, 9, 25, 20, 0), new Date(2026, 9, 25, 23, 0), job);

  expect(pay.nightMinutes).toBe(60);
});

itDst('通常日は変わらない', () => {
  const pay = computeShiftPay(new Date(2026, 2, 20, 20, 0), new Date(2026, 2, 20, 23, 0), job);

  expect(pay.nightMinutes).toBe(60);
});
