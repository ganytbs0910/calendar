// ── ① 空き日シェアカード ────────────────────────────────────────────────────
//
// Turns "my open days this month" into a clean, shareable image (or text) you
// can drop into LINE. The recipient needs no app — that is the viral hook: your
// glanceable month *is* the share asset. Fully on-device (view capture + the OS
// share sheet); no backend.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {captureRef} from 'react-native-view-shot';
import RNCalendarEvents from 'react-native-calendar-events';

import {useTheme} from '../theme/ThemeContext';
import OneTimeHint from './OneTimeHint';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  visible: boolean;
  onClose: () => void;
  initialDate: Date;
}

const ShareAvailabilityModal: React.FC<Props> = ({visible, onClose, initialDate}) => {
  const {colors, isDark} = useTheme();
  const cardRef = useRef<View>(null);
  const [month, setMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) setMonth(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  }, [visible, initialDate]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const y = month.getFullYear();
      const m = month.getMonth();
      const start = new Date(y, m, 1, 0, 0, 0);
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      const set = new Set<number>();
      try {
        const events = await RNCalendarEvents.fetchAllEvents(start.toISOString(), end.toISOString());
        for (const ev of events) {
          if (ev.allDay || !ev.startDate) continue;
          const calTitle = (ev.calendar?.title || '').toLowerCase();
          if (calTitle.includes('祝日') || calTitle.includes('holiday')) continue;
          const d = new Date(ev.startDate);
          if (d.getFullYear() === y && d.getMonth() === m) set.add(d.getDate());
        }
      } catch {
        // no permission — everything shows as free
      }
      if (!cancelled) {
        setBusy(set);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, month]);

  const y = month.getFullYear();
  const m = month.getMonth();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() === m;
  const todayDate = today.getDate();

  const {cells, freeDays} = useMemo(() => {
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    const free: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const isPast = isCurrentMonth && d < todayDate;
      if (!busy.has(d) && !isPast) free.push(d);
    }
    return {cells: arr, freeDays: free};
  }, [y, m, busy, isCurrentMonth, todayDate]);

  const shareText = useMemo(() => {
    const list = freeDays.join('・');
    return `📅 ${m + 1}月の空いてる日\n${list ? list + '日' : '（空きなし）'}\n\nこの中で都合いい日ある？`;
  }, [freeDays, m]);

  const onShareImage = useCallback(async () => {
    try {
      const uri = await captureRef(cardRef, {format: 'png', quality: 1, result: 'tmpfile'});
      await Share.share(Platform.OS === 'ios' ? {url: uri} : {url: uri, message: shareText});
    } catch {
      try {
        await Share.share({message: shareText});
      } catch {
        // user cancelled
      }
    }
  }, [shareText]);

  const onShareTextOnly = useCallback(async () => {
    try {
      await Share.share({message: shareText});
    } catch {
      // cancelled
    }
  }, [shareText]);

  const s = makeStyles(colors);
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF';
  const freeBg = '#34C759';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.container, {backgroundColor: colors.background}]}>
        <View style={[s.header, {borderBottomColor: colors.border}]}>
          <TouchableOpacity onPress={onClose} style={s.headerBtn}>
            <Text style={[s.headerBtnText, {color: colors.primary}]}>閉じる</Text>
          </TouchableOpacity>
          <Text style={[s.headerTitle, {color: colors.text}]}>空き日を共有</Text>
          <View style={s.headerBtn} />
        </View>

        <View style={s.monthNav}>
          <TouchableOpacity onPress={() => setMonth(new Date(y, m - 1, 1))} style={s.navBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[s.monthLabel, {color: colors.text}]}>{y}年 {m + 1}月</Text>
          <TouchableOpacity onPress={() => setMonth(new Date(y, m + 1, 1))} style={s.navBtn}>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <OneTimeHint
          hintKey="shareAvailIntro"
          icon="share-social-outline"
          title="空き日を画像で共有"
          message="予定が入っていない日をまとめたカードを画像にして共有できます。受け取った相手はアプリ不要で見られます。"
          style={{marginHorizontal: 16, marginBottom: 4}}
        />

        <View style={s.cardWrap}>
          {/* The capture target — a clean standalone card */}
          <View ref={cardRef} collapsable={false} style={[s.card, {backgroundColor: cardBg}]}>
            <View style={s.cardTitleRow}>
              <Text style={s.cardEmoji}>📅</Text>
              <View>
                <Text style={[s.cardTitle, {color: isDark ? '#fff' : '#111'}]}>{m + 1}月の空いてる日</Text>
                <Text style={[s.cardSub, {color: freeBg}]}>空き {freeDays.length} 日</Text>
              </View>
            </View>

            <View style={s.weekRow}>
              {WD.map((w, i) => (
                <Text key={w} style={[s.weekCell, {color: i === 0 ? '#FF3B30' : i === 6 ? '#007AFF' : isDark ? '#999' : '#888'}]}>
                  {w}
                </Text>
              ))}
            </View>

            {loading ? (
              <View style={s.cardLoading}><ActivityIndicator color={colors.primary} /></View>
            ) : (
              <View style={s.gridWrap}>
                {cells.map((d, i) => {
                  if (d === null) return <View key={`b${i}`} style={s.dayCell} />;
                  const isPast = isCurrentMonth && d < todayDate;
                  const isFree = !busy.has(d) && !isPast;
                  const dow = (new Date(y, m, 1).getDay() + d - 1) % 7;
                  return (
                    <View key={d} style={s.dayCell}>
                      <View style={[s.dayInner, isFree && {backgroundColor: freeBg}]}>
                        <Text
                          style={[
                            s.dayText,
                            {color: isFree ? '#fff' : isPast ? (isDark ? '#555' : '#ccc') : dow === 0 ? '#FF3B30' : dow === 6 ? '#007AFF' : isDark ? '#ddd' : '#333'},
                          ]}>
                          {d}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={s.cardFooter}>
              <View style={[s.legendDot, {backgroundColor: freeBg}]} />
              <Text style={[s.legendText, {color: isDark ? '#aaa' : '#999'}]}>= 空いてる日　・　この中で都合いい日ある？</Text>
            </View>
          </View>
        </View>

        <View style={s.actions}>
          <TouchableOpacity style={[s.primaryBtn, {backgroundColor: colors.primary}]} onPress={onShareImage}>
            <Ionicons name="share-outline" size={18} color={colors.onPrimary} />
            <Text style={[s.primaryBtnText, {color: colors.onPrimary}]}>画像で共有</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.secondaryBtn, {borderColor: colors.border}]} onPress={onShareTextOnly}>
            <Text style={[s.secondaryBtnText, {color: colors.text}]}>テキストで共有</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {flex: 1},
    header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth},
    headerBtn: {minWidth: 56},
    headerBtnText: {fontSize: 16},
    headerTitle: {fontSize: 17, fontWeight: '700'},
    monthNav: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 14},
    navBtn: {padding: 6},
    monthLabel: {fontSize: 18, fontWeight: '700', minWidth: 130, textAlign: 'center'},
    cardWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
    card: {width: '100%', maxWidth: 360, borderRadius: 20, padding: 20, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: {width: 0, height: 4}, elevation: 3},
    cardTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16},
    cardEmoji: {fontSize: 30},
    cardTitle: {fontSize: 22, fontWeight: '800'},
    cardSub: {fontSize: 14, fontWeight: '700', marginTop: 2},
    weekRow: {flexDirection: 'row'},
    weekCell: {flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', paddingBottom: 6},
    gridWrap: {flexDirection: 'row', flexWrap: 'wrap'},
    cardLoading: {height: 200, alignItems: 'center', justifyContent: 'center'},
    dayCell: {width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2},
    dayInner: {width: '92%', aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
    dayText: {fontSize: 14, fontWeight: '700'},
    cardFooter: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16},
    legendDot: {width: 12, height: 12, borderRadius: 3},
    legendText: {fontSize: 11},
    actions: {flexDirection: 'row', gap: 12, padding: 16},
    primaryBtn: {flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12},
    primaryBtnText: {fontSize: 15, fontWeight: '700'},
    secondaryBtn: {flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingVertical: 14},
    secondaryBtnText: {fontSize: 14, fontWeight: '600'},
  });

export default ShareAvailabilityModal;
