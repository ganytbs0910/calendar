/**
 * 完了条件①「初回起動から残り自由時間が数字で出るまで3タップ以内」を固定する。
 *
 * この条件は4周ぶん未達だった。オンボーディングが6ページあり、
 * 看板の数字にたどり着くまで6タップかかっていたため。
 * 2ページに削って達成したので、戻ったらここで気付けるようにしておく。
 *
 * ページ数は各ページ先頭の64pxアイコンの数で測っている。ページを増やせば
 * 必ず1つ増え、文言を書き換えただけでは動かない値だから。
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';

import OnboardingModal from '../src/components/OnboardingModal';
import i18n from '../src/i18n/i18n';

/** 数字に届くまでに押す回数の上限。完了条件①そのもの。 */
const MAX_TAPS = 3;

const render = () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<OnboardingModal visible onClose={() => {}} />);
  });
  return tree;
};

const textsIn = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map(n => n.props.children)
    .filter((c): c is string => typeof c === 'string');

describe('オンボーディングの長さ', () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  let texts: string[];

  beforeAll(async () => {
    await i18n.changeLanguage('ja');
    tree = render();
    texts = textsIn(tree);
  });

  afterAll(() => {
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('ページ数は3以下（＝数字まで3タップ以内）', () => {
    // 各ページの先頭に1つだけ置かれる64pxのアイコンを数える。
    const heroIcons = tree.root
      .findAllByType('Ionicons' as any)
      .filter(n => n.props.size === 64);

    expect(heroIcons.length).toBe(2);
    expect(heroIcons.length).toBeLessThanOrEqual(MAX_TAPS);
  });

  it('1枚目に軸そのものを出す', () => {
    // ここが「何のアプリか」を伝える唯一の面。他の説明を前に置かないこと。
    expect(texts).toContain(i18n.t('onbFreeTitle'));
  });

  it('最後は設定そのもので、数字が出せる状態で終わる', () => {
    expect(texts).toContain(i18n.t('onbRhythmTitle'));
    // 起床・就寝を実際に動かせること。説明だけのページで終わらせない。
    expect(texts).toContain(i18n.t('wakeUpTime'));
    expect(texts).toContain(i18n.t('bedTime'));
  });

  it('通知ダイアログが出ることを先に伝える', () => {
    // 専用ページを畳んだぶん、ここが唯一の予告になる。
    expect(texts).toContain(i18n.t('onbRhythmNotifyNote'));
  });

  it('文脈ヒントと重複する説明を並べない', () => {
    // 色・時給・年収の壁は、機能そのものの上に OneTimeHint がある
    // （AddEventModal の colorChipActions / workColorWage、
    //   IncomeWallScreen の incomeWallIntro）。
    // 見る前に読ませるスライドを足すと、また6ページに戻る。
    for (const gone of ['色で分類', 'バイトの給料を自動計算', '年収の壁を管理']) {
      expect(texts).not.toContain(gone);
    }
  });
});
