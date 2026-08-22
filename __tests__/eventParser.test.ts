import {parseEventText} from '../src/utils/eventParser';

// Wednesday, 2026-08-19
const WED = new Date(2026, 7, 19, 12, 0, 0);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('parseEventText — 来週/再来週 weekday resolution', () => {
  test.each`
    text                     | expected      | label
    ${'来週月曜 10時 会議'}   | ${'2026-08-24'} | ${'Wed → Mon of next week'}
    ${'来週火曜 10時 会議'}   | ${'2026-08-25'} | ${'Wed → Tue of next week'}
    ${'来週金曜 10時 会議'}   | ${'2026-08-28'} | ${'Wed → Fri of next week'}
    ${'来週日曜 10時 会議'}   | ${'2026-08-23'} | ${'Wed → Sun of next week'}
    ${'再来週月曜 10時 会議'} | ${'2026-08-31'} | ${'Wed → Mon two weeks ahead'}
    ${'再来週土曜 10時 会議'} | ${'2026-09-05'} | ${'Wed → Sat two weeks ahead'}
  `('$text ($label)', ({text, expected}) => {
    const r = parseEventText(text, WED);
    expect(r).not.toBeNull();
    expect(iso(r!.startDate)).toBe(expected);
  });

  test('Saturday base: 来週月曜 is Monday of the following week', () => {
    const sat = new Date(2026, 7, 22, 12, 0, 0);
    const r = parseEventText('来週月曜 10時 会議', sat);
    expect(iso(r!.startDate)).toBe('2026-08-24');
  });

  test('Sunday base: 来週月曜 is the Monday after next', () => {
    const sun = new Date(2026, 7, 23, 12, 0, 0);
    const r = parseEventText('来週月曜 10時 会議', sun);
    expect(iso(r!.startDate)).toBe('2026-08-31');
  });
});
