// ── analyticsService — 匿名の起動シグナル ───────────────────────────────────
//
// feedbackService.ts に続く、このアプリ2つ目の外部送信経路。送るのは
// 「この端末IDが今日も起動した」という事実だけで、予定の中身・件数・
// カレンダーの利用内容は一切含まない。DAU/WAU/MAUの日次レポートを
// Discordに出すために、意見ボックスと同じSupabaseプロジェクトの
// calendar_devices を calendar_ping_device() 経由でupsertする。
// 詳細は supabase/migrations/20260907_calendar_devices.sql を参照。
//
// feedbackService.ts と同じ理由でSDKを使わずfetchで直接PostgRESTを叩く。
// 起動のたびに送る必要はなく、失敗しても実害のない指標なので、1日1回だけ
// 試し、失敗しても再送のリトライはしない(次の起動でまた1回試すだけで十分)。

import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

import i18n from '../i18n/i18n';
import {getDeviceId} from './deviceIdService';

const SUPABASE_URL = 'https://llxmsbnqtdlqypnwapzz.supabase.co';

// feedbackService.ts と同じ公開anonキー(アプリバイナリに埋まって配布される
// 前提のもの)。書き込みはRLSポリシー無し・SECURITY DEFINER RPC経由のみに
// 絞ってあるので、このキーが漏れても直接テーブルには書けない。
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxseG1zYm5xdGRscXlwbndhcHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4MjA5MjEsImV4cCI6MjA1MzM5NjkyMX0.EkqepILQU0KgOTW1ZaXpe54ERpZbSRodf24r5022VKs';

const ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/calendar_ping_device`;
const LAST_PING_DATE_KEY = '@calendar_last_ping_date';
const TIMEOUT_MS = 10000;

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 起動時に1回だけ呼ぶ。今日すでに送っていれば何もしない。
 * 失敗しても投げない — 呼び出し元(App.tsx起動処理)を止める理由がない。
 */
export const pingDeviceOnce = async (): Promise<void> => {
  try {
    const today = todayKey();
    const lastPing = await AsyncStorage.getItem(LAST_PING_DATE_KEY);
    if (lastPing === today) return;

    const deviceId = await getDeviceId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          p_device_id: deviceId,
          p_app_version: DeviceInfo.getVersion(),
          p_platform: Platform.OS,
          p_language: i18n.language,
        }),
      });
      if (res.ok) await AsyncStorage.setItem(LAST_PING_DATE_KEY, today);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (__DEV__) console.warn('[analytics] ping failed', e);
  }
};
