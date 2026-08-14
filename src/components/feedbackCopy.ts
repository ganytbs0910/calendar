// ── feedbackCopy — 意見ボックスの文言 ────────────────────────────────────────
//
// 画面に直書きせず、ここに集めてある。後から言語を足すときの差分が
// このファイル1つで済むようにするため（移植元 BrawlStatus と同じ構造）。
//
// ★ 現在は日本語のみ。
//
//   このアプリ自体は11言語で配信しているが、意見ボックスの文言は日本語しか無い。
//   そのため設定画面の入口は端末の表示言語が日本語のときだけ出している
//   （SettingsLauncherScreen.tsx の isJa を参照）。
//   英語などを足すときは、下に `en` を作って FEEDBACK_COPY に並べ、
//   入口の出し分けを外すこと。
//
//   なお他言語の行を「英語を指すだけ」で埋めるのはしないこと。
//   翻訳したように見えて中身が無いものが11言語ぶん増えるだけになる。

import type {FeedbackCategory} from '../services/feedbackService';

export type FeedbackCopy = {
  /** 設定画面の行 */
  entryLabel: string;
  entrySub: string;

  title: string;
  lead: string;
  categoryLabel: string;
  categories: Record<FeedbackCategory, string>;
  messageLabel: string;
  messagePlaceholder: string;
  contactLabel: string;
  contactPlaceholder: string;
  note: string;
  submit: string;
  submitting: string;
  close: string;

  successTitle: string;
  successBody: string;
  errorTitle: string;
  errors: Record<'empty' | 'tooLong' | 'tooFast' | 'rejected' | 'network' | 'failed', string>;
};

export const ja: FeedbackCopy = {
  entryLabel: '意見を送る',
  entrySub: '不具合の報告・要望を開発者へ',

  title: '意見ボックス',
  lead: 'アプリへのご意見・不具合の報告をお送りください。開発者に直接届きます。すべてに返信はできませんが、必ず目を通しています。',

  categoryLabel: '種類',
  categories: {
    bug: '不具合',
    request: '要望',
    ux: '使いにくい',
    other: 'その他',
  },

  messageLabel: '内容',
  messagePlaceholder:
    '例：週表示で終日の予定が初日にしか出ません / バイト先を色で分けたいです',

  contactLabel: '連絡先（任意）',
  contactPlaceholder: 'メールアドレスなど。返信が必要な場合のみ',

  // 何を送るかは正直に、漏れなく書く。ここに書いていないものは送らない。
  note: '送信されるのは、上に入力した内容と、アプリのバージョン・OS・表示言語だけです。予定の内容やお使いのカレンダーが送られることはありません。',

  submit: '送信する',
  submitting: '送信中…',
  close: '閉じる',

  successTitle: '送信しました',
  successBody: 'ありがとうございます。いただいた内容は開発者に届きました。',

  errorTitle: '送信できませんでした',
  errors: {
    empty: '内容が入力されていません。',
    tooLong: '内容が長すぎます。1000文字までに収めてください。',
    tooFast: '送信の間隔が短すぎます。少し時間を置いてからお試しください。',
    rejected:
      '内容を受け付けられませんでした。リンクを2つ以上含む場合は、URLを減らしてお試しください。',
    network:
      '通信できませんでした。電波の良い場所で、時間を置いてお試しください。入力内容はそのまま残しています。',
    failed: '送信に失敗しました。時間を置いてお試しください。入力内容はそのまま残しています。',
  },
};

/** 対応言語が増えたらここに並べる。 */
export const FEEDBACK_COPY = {ja};

/** 意見ボックスの文言が存在する言語か。入口の出し分けに使う。 */
export const hasFeedbackCopy = (language: string): boolean =>
  Object.keys(FEEDBACK_COPY).includes(language.split('-')[0]);

export const feedbackCopyFor = (_language: string): FeedbackCopy => ja;
