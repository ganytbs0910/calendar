/**
 * Guideline 3.1.2(c) rejected build 2.8(16) because the in-app Privacy Policy
 * link pointed at a host that had never been created. The link *rendered* fine —
 * nothing in the app could tell that the other end was a 404 — so these tests
 * guard the two things a unit test actually can: that the URL still carries the
 * shape the support site needs, and that every screen offering the purchase
 * really opens it.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Linking, Text, TouchableOpacity} from 'react-native';

import SettingsLauncherScreen from '../src/components/SettingsLauncherScreen';
import {PRIVACY_URL, TERMS_URL} from '../src/utils/legalLinks';
import i18n from '../src/i18n/i18n';

const noop = () => {};
const props = {
  onOpenShareAvail: noop,
  onOpenPoll: noop,
  onOpenSettings: noop,
  onOpenIncomeWall: noop,
  onOpenJobs: noop,
  onOpenLocalCal: noop,
  onOpenPhotos: noop,
};

/** The row is a TouchableOpacity wrapping a Text with the given label. */
const findRowByLabel = (root: ReactTestRenderer.ReactTestInstance, label: string) =>
  root
    .findAllByType(TouchableOpacity)
    .find(row =>
      row
        .findAllByType(Text)
        .some(text => text.props.children === label),
    );

describe('legal link URLs', () => {
  it('points the privacy policy at the per-app key the support site requires', () => {
    // The site serves one page for every app and picks the copy off ?app=.
    // Dropping the query renders the generic support page — with a 200, so a
    // status check would not notice — and App Review reads that as a link that
    // does not lead to a privacy policy.
    expect(PRIVACY_URL).toMatch(/^https:\/\//);
    // Parsed by hand: React Native's URLSearchParams polyfill has no get().
    const query = PRIVACY_URL.split('?')[1] ?? '';
    expect(query.split('&')).toContain('app=calendar');
  });

  it('uses an https EULA', () => {
    expect(TERMS_URL).toMatch(/^https:\/\//);
  });
});

describe('SettingsLauncherScreen', () => {
  let openURL: jest.SpyInstance;
  let mounted: ReactTestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    // The paywall kicks off an async IAP handshake on open. Left mounted, it
    // resolves after the environment is gone and React re-renders into a torn
    // down module registry.
    ReactTestRenderer.act(() => {
      mounted.forEach(tree => tree.unmount());
    });
    mounted = [];
    openURL.mockRestore();
  });

  const render = () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<SettingsLauncherScreen {...props} />);
    });
    mounted.push(tree);
    return tree;
  };

  it('opens the privacy policy from the legal section', () => {
    const tree = render();
    const row = findRowByLabel(tree.root, i18n.t('privacyPolicy'));
    expect(row).toBeDefined();

    ReactTestRenderer.act(() => {
      row!.props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith(PRIVACY_URL);
  });

  it('opens the terms of use from the legal section', () => {
    const tree = render();
    const row = findRowByLabel(tree.root, i18n.t('termsOfUse'));
    expect(row).toBeDefined();

    ReactTestRenderer.act(() => {
      row!.props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith(TERMS_URL);
  });

  it('reaches the paywall from settings, which carries the same two links', async () => {
    const tree = render();
    const upgrade = findRowByLabel(tree.root, i18n.t('upgradeToPremium'));
    expect(upgrade).toBeDefined();

    const texts = () => tree.root.findAllByType(Text).map(node => node.props.children);

    // The paywall is an absolutely-positioned overlay that renders nothing
    // until opened. Its subtitle is unique to it — the row label above is not,
    // since Settings uses the same string for the entry point.
    expect(texts()).not.toContain(i18n.t('premiumSubtitle'));

    // Async act so the IAP init the paywall fires on open settles here rather
    // than after the test.
    await ReactTestRenderer.act(async () => {
      upgrade!.props.onPress();
    });

    expect(texts()).toContain(i18n.t('premiumSubtitle'));
    expect(texts()).toContain(i18n.t('privacyPolicy'));
    expect(texts()).toContain(i18n.t('termsOfUse'));
  });
});
