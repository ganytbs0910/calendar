/**
 * DayTimeStrip is a pure presentational 24h mini-timeline — no state, no
 * logic beyond minutes -> percentage. Verify the position/width math and the
 * allDay branch render correctly.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import DayTimeStrip from '../src/components/DayTimeStrip';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const render = (el: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(el);
  });
  return tree.toJSON();
};

test('places the colored segment at the correct left/width percentage', () => {
  // 9:00-11:00 -> 540/1440 = 37.5%, width 120/1440 = 8.33%
  const json = render(<DayTimeStrip startMin={9 * 60} endMin={11 * 60} color="#007AFF" />);
  const str = JSON.stringify(json);
  expect(str).toContain('37.5%');
  expect(str).toContain('8.333333333333332%');
});

test('floors a near-zero-duration event to a visible hairline width', () => {
  const json = render(<DayTimeStrip startMin={600} endMin={600} color="#007AFF" />);
  expect(JSON.stringify(json)).toContain('"width":"1%"');
});

test('clamps out-of-range minutes into the 0-1440 track', () => {
  const json = render(<DayTimeStrip startMin={-30} endMin={1500} color="#007AFF" />);
  const str = JSON.stringify(json);
  expect(str).toContain('"left":"0%"');
  expect(str).toContain('"width":"100%"');
});

test('renders the allDay variant instead of a positioned segment', () => {
  const json = render(<DayTimeStrip startMin={0} endMin={0} color="#007AFF" allDay />);
  expect(JSON.stringify(json)).not.toContain('"left"');
});
