/**
 * この画面は実機で動かせていない（Discord 側の設定が未了で、送信の一周が
 * 通せない）。せめてテストで押さえられるのは、描画できること・空のまま
 * 送信できないこと・文言が画面に直書きされていないこと・
 * 日本語以外の端末に入口を出さないことの4点。
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text, TouchableOpacity} from 'react-native';

import FeedbackScreen from '../src/components/FeedbackScreen';
import SettingsLauncherScreen from '../src/components/SettingsLauncherScreen';
import {ja as copy} from '../src/components/feedbackCopy';
import i18n from '../src/i18n/i18n';

const noop = () => {};

let mounted: ReactTestRenderer.ReactTestRenderer[] = [];
const render = (element: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  mounted.push(tree);
  return tree;
};

afterEach(() => {
  ReactTestRenderer.act(() => mounted.forEach(t => t.unmount()));
  mounted = [];
});

const textsIn = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

describe('意見ボックスの画面', () => {
  it('描画できる', () => {
    const tree = render(<FeedbackScreen onClose={noop} />);
    expect(textsIn(tree)).toContain(copy.title);
  });

  it('4つの種類をすべて出す（DBの category と同じ4つ）', () => {
    const labels = textsIn(render(<FeedbackScreen onClose={noop} />));
    for (const label of Object.values(copy.categories)) {
      expect(labels).toContain(label);
    }
  });

  it('内容が空のあいだは送信できない', () => {
    const tree = render(<FeedbackScreen onClose={noop} />);
    const submit = tree.root
      .findAllByType(TouchableOpacity)
      .find(b => b.findAllByType(Text).some(t => t.props.children === copy.submit));

    expect(submit).toBeDefined();
    expect(submit!.props.disabled).toBe(true);
  });

  it('何を送るかの注記を必ず出す', () => {
    // 送信項目を隠したまま送るのは、たとえ内容が無害でも筋が悪い。
    expect(textsIn(render(<FeedbackScreen onClose={noop} />))).toContain(copy.note);
  });
});

describe('設定画面の入口', () => {
  const settingsProps = {
    onOpenShareAvail: noop,
    onOpenPoll: noop,
    onOpenSettings: noop,
    onOpenIncomeWall: noop,
    onOpenJobs: noop,
    onOpenLocalCal: noop,
    onOpenPhotos: noop,
    onExportBackup: noop,
    onOpenFeedback: noop,
  };

  const original = i18n.language;
  afterEach(async () => {
    await i18n.changeLanguage(original);
  });

  it('日本語の端末には出す', async () => {
    await i18n.changeLanguage('ja');
    expect(textsIn(render(<SettingsLauncherScreen {...settingsProps} />))).toContain(
      copy.entryLabel,
    );
  });

  it('文言が無い言語には出さない', async () => {
    // 出すと、ドイツ語の利用者に日本語だけのフォームが開く。
    // feedbackCopy.ts に言語を足せば、この判定だけで自動的に出るようになる。
    await i18n.changeLanguage('de');
    expect(textsIn(render(<SettingsLauncherScreen {...settingsProps} />))).not.toContain(
      copy.entryLabel,
    );
  });
});
