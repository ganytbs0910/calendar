// ── ③ グループ日程調整（持ち寄り）UI ───────────────────────────────────────
//
// Create a poll ("飲み会いつ?"), pick candidate dates (one tap to seed them from
// your own free days), share the candidates, and tally who can make it — the
// 調整さん flow living inside the calendar. On-device; see pollService for the
// note on remote collection.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import RNCalendarEvents from 'react-native-calendar-events';

import {useTheme} from '../theme/ThemeContext';
import {
  addAttendee,
  createPoll,
  cycleResponse,
  deletePoll,
  getPolls,
  Poll,
  tally,
  updatePoll,
} from '../services/pollService';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const mkKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const keyLabel = (k: string): string => {
  const [y, m, d] = k.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  initialDate: Date;
}

type Mode = 'list' | 'create' | 'detail';

const PollModal: React.FC<Props> = ({visible, onClose, initialDate}) => {
  const {colors} = useTheme();
  const [mode, setMode] = useState<Mode>('list');
  const [polls, setPolls] = useState<Poll[]>([]);
  const [selected, setSelected] = useState<Poll | null>(null);
  // Mirror of `selected` updated synchronously so rapid taps chain off the
  // latest poll instead of the stale value captured at render time.
  const selectedRef = useRef<Poll | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const applySelected = useCallback((next: Poll) => {
    selectedRef.current = next;
    setSelected(next);
    updatePoll(next);
  }, []);

  // create state
  const [title, setTitle] = useState('');
  const [month, setMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => setPolls(await getPolls()), []);

  useEffect(() => {
    if (visible) {
      reload();
      setMode('list');
      setSelected(null);
    }
  }, [visible, reload]);

  const startCreate = useCallback(() => {
    setTitle('');
    setMonth(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
    setPicked(new Set());
    setMode('create');
  }, [initialDate]);

  const seedFreeDays = useCallback(async () => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const start = new Date(y, m, 1, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59);
    const busy = new Set<number>();
    try {
      const events = await RNCalendarEvents.fetchAllEvents(start.toISOString(), end.toISOString());
      for (const ev of events) {
        if (ev.allDay || !ev.startDate) continue;
        const d = new Date(ev.startDate);
        if (d.getFullYear() === y && d.getMonth() === m) busy.add(d.getDate());
      }
    } catch {
      // ignore
    }
    const today = new Date();
    const isCur = today.getFullYear() === y && today.getMonth() === m;
    const days = new Date(y, m + 1, 0).getDate();
    const next = new Set(picked);
    for (let d = 1; d <= days; d++) {
      const isPast = isCur && d < today.getDate();
      const dow = new Date(y, m, d).getDay();
      if (!busy.has(d) && !isPast && (dow === 5 || dow === 6 || dow === 0)) next.add(mkKey(y, m, d)); // weekend-ish suggestions
    }
    setPicked(next);
  }, [month, picked]);

  const saveCreate = useCallback(async () => {
    if (picked.size === 0) {
      Alert.alert('候補日を選んでください', 'カレンダーで日付をタップすると候補になります。');
      return;
    }
    const poll = await createPoll(title, Array.from(picked));
    await reload();
    setSelected(poll);
    setMode('detail');
  }, [title, picked, reload]);

  const onAddAttendee = useCallback(() => {
    if (!selectedRef.current) return;
    Alert.prompt?.('参加者を追加', '名前を入力', name => {
      const cur = selectedRef.current;
      if (name == null || !cur) return;
      applySelected(addAttendee(cur, name));
    });
  }, [applySelected]);

  const onCycle = useCallback(
    (attendeeId: string, dateKey: string) => {
      const cur = selectedRef.current;
      if (!cur) return;
      applySelected(cycleResponse(cur, attendeeId, dateKey));
    },
    [applySelected],
  );

  const onShare = useCallback(async () => {
    if (!selected) return;
    const {tallies, bestKey} = tally(selected);
    const lines = tallies.map(t => `${keyLabel(t.dateKey)}　○${t.yes} △${t.maybe} ✕${t.no}`);
    const best = bestKey ? `\n\n👑 今のところ ${keyLabel(bestKey)} が有力！` : '';
    await Share.share({
      message: `📋 ${selected.title}\n候補日：\n${lines.join('\n')}${best}\n\n空いてる日を教えて！`,
    }).catch(() => {});
  }, [selected]);

  const onDeletePoll = useCallback(
    (p: Poll) => {
      Alert.alert('削除', `「${p.title}」を削除しますか？`, [
        {text: 'キャンセル', style: 'cancel'},
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => setPolls(await deletePoll(p.id)),
        },
      ]);
    },
    [],
  );

  const s = makeStyles(colors);

  // ── create: mini month grid ───────────────────────────────────────────────
  const y = month.getFullYear();
  const m = month.getMonth();
  const grid = useMemo(() => {
    const firstDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    return cells;
  }, [y, m]);

  const renderHeader = (titleText: string, onBack?: () => void, right?: React.ReactNode) => (
    <View style={[s.header, {borderBottomColor: colors.border}]}>
      <TouchableOpacity onPress={onBack ?? onClose} style={s.headerBtn}>
        <Text style={[s.headerBtnText, {color: colors.primary}]}>{onBack ? '戻る' : '閉じる'}</Text>
      </TouchableOpacity>
      <Text style={[s.headerTitle, {color: colors.text}]} numberOfLines={1}>{titleText}</Text>
      <View style={s.headerBtn}>{right}</View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.container, {backgroundColor: colors.background}]}>
        {mode === 'list' && (
          <>
            {renderHeader('日程調整')}
            <ScrollView contentContainerStyle={s.content}>
              <Text style={[s.lead, {color: colors.textSecondary}]}>
                候補日を出して、みんなの「行ける日」をまとめましょう。候補はLINEで共有、回答は手元で集計できます。
              </Text>
              {polls.length === 0 ? (
                <View style={[s.empty, {backgroundColor: colors.surface, borderColor: colors.border}]}>
                  <Ionicons name="people-outline" size={28} color={colors.textTertiary} />
                  <Text style={[s.emptyText, {color: colors.textSecondary}]}>まだ調整はありません</Text>
                </View>
              ) : (
                polls.map(p => {
                  const {bestKey} = tally(p);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[s.pollRow, {backgroundColor: colors.surface, borderColor: colors.border}]}
                      onPress={() => {
                        setSelected(p);
                        setMode('detail');
                      }}
                      onLongPress={() => onDeletePoll(p)}>
                      <View style={{flex: 1}}>
                        <Text style={[s.pollTitle, {color: colors.text}]} numberOfLines={1}>{p.title}</Text>
                        <Text style={[s.pollMeta, {color: colors.textTertiary}]}>
                          候補{p.candidates.length}日・参加{p.attendees.length}人{bestKey ? `・有力 ${keyLabel(bestKey)}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <View style={s.actions}>
              <TouchableOpacity style={[s.primaryBtn, {backgroundColor: colors.primary}]} onPress={startCreate}>
                <Ionicons name="add" size={20} color={colors.onPrimary} />
                <Text style={[s.primaryBtnText, {color: colors.onPrimary}]}>新しい調整を作る</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {mode === 'create' && (
          <>
            {renderHeader('候補日を選ぶ', () => setMode('list'))}
            <ScrollView contentContainerStyle={s.content}>
              <TextInput
                style={[s.input, {color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border}]}
                value={title}
                onChangeText={setTitle}
                placeholder="例：サークルの飲み会"
                placeholderTextColor={colors.textTertiary}
              />
              <View style={s.monthNav}>
                <TouchableOpacity onPress={() => setMonth(new Date(y, m - 1, 1))} style={s.navBtn}>
                  <Ionicons name="chevron-back" size={22} color={colors.primary} />
                </TouchableOpacity>
                <Text style={[s.monthLabel, {color: colors.text}]}>{y}年 {m + 1}月</Text>
                <TouchableOpacity onPress={() => setMonth(new Date(y, m + 1, 1))} style={s.navBtn}>
                  <Ionicons name="chevron-forward" size={22} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <View style={s.weekRow}>
                {WD.map((w, i) => (
                  <Text key={w} style={[s.weekCell, {color: i === 0 ? colors.error : i === 6 ? '#007AFF' : colors.textTertiary}]}>{w}</Text>
                ))}
              </View>
              <View style={s.gridWrap}>
                {grid.map((d, i) => {
                  if (d === null) return <View key={`b${i}`} style={s.dayCell} />;
                  const k = mkKey(y, m, d);
                  const on = picked.has(k);
                  return (
                    <TouchableOpacity
                      key={d}
                      style={s.dayCell}
                      onPress={() => {
                        const n = new Set(picked);
                        if (n.has(k)) n.delete(k); else n.add(k);
                        setPicked(n);
                      }}>
                      <View style={[s.dayInner, on && {backgroundColor: colors.primary}]}>
                        <Text style={[s.dayText, {color: on ? colors.onPrimary : colors.text}]}>{d}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={[s.ghostBtn, {borderColor: colors.primary}]} onPress={seedFreeDays}>
                <Ionicons name="sparkles-outline" size={15} color={colors.primary} />
                <Text style={[s.ghostText, {color: colors.primary}]}>空いてる週末を候補に追加</Text>
              </TouchableOpacity>
              <Text style={[s.pickedNote, {color: colors.textTertiary}]}>選択中：{picked.size}日</Text>
            </ScrollView>
            <View style={s.actions}>
              <TouchableOpacity style={[s.primaryBtn, {backgroundColor: colors.primary}]} onPress={saveCreate}>
                <Text style={[s.primaryBtnText, {color: colors.onPrimary}]}>この候補で作成</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {mode === 'detail' && selected && (
          <>
            {renderHeader(
              selected.title,
              () => {
                setMode('list');
                reload();
              },
              <TouchableOpacity onPress={onShare}>
                <Ionicons name="share-outline" size={22} color={colors.primary} />
              </TouchableOpacity>,
            )}
            <ScrollView contentContainerStyle={s.content}>
              <Text style={[s.lead, {color: colors.textSecondary}]}>
                セルをタップで ○→△→✕。LINEで集めた返事を入れていけば、有力日が分かります。
              </Text>
              <DetailGrid poll={selected} colors={colors} onCycle={onCycle} onAddAttendee={onAddAttendee} />
              <View style={[s.serverNote, {backgroundColor: colors.surface, borderColor: colors.border}]}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
                <Text style={[s.serverNoteText, {color: colors.textTertiary}]}>
                  相手がアプリ不要で回答できる共有リンクは今後対応予定（サーバ連携）。今は候補を共有して手元で集計するスタイルです。
                </Text>
              </View>
            </ScrollView>
            <View style={s.actions}>
              <TouchableOpacity style={[s.primaryBtn, {backgroundColor: colors.primary}]} onPress={onShare}>
                <Ionicons name="share-outline" size={18} color={colors.onPrimary} />
                <Text style={[s.primaryBtnText, {color: colors.onPrimary}]}>候補をLINEで共有</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
};

// Tally grid: candidate rows × attendee columns.
const DetailGrid: React.FC<{
  poll: Poll;
  colors: any;
  onCycle: (attendeeId: string, dateKey: string) => void;
  onAddAttendee: () => void;
}> = ({poll, colors, onCycle, onAddAttendee}) => {
  const s = makeStyles(colors);
  const {tallies, bestKey} = tally(poll);
  const mark = (v?: string) => (v === 'yes' ? '○' : v === 'maybe' ? '△' : v === 'no' ? '✕' : '・');
  const markColor = (v?: string) =>
    v === 'yes' ? '#34C759' : v === 'maybe' ? '#FF9500' : v === 'no' ? '#FF3B30' : colors.textTertiary;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginVertical: 8}}>
      <View>
        {/* header row */}
        <View style={s.gridRow}>
          <View style={[s.dateCol, s.gridHeadCell]}><Text style={[s.gridHead, {color: colors.textSecondary}]}>候補 \ 人</Text></View>
          {poll.attendees.map(a => (
            <View key={a.id} style={[s.attCol, s.gridHeadCell]}>
              <Text style={[s.gridHead, {color: colors.text}]} numberOfLines={1}>{a.name}</Text>
            </View>
          ))}
          <TouchableOpacity style={[s.attCol, s.gridHeadCell]} onPress={onAddAttendee}>
            <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        {/* candidate rows */}
        {poll.candidates.map(k => {
          const t = tallies.find(x => x.dateKey === k)!;
          const best = k === bestKey;
          return (
            <View key={k} style={[s.gridRow, best && {backgroundColor: 'rgba(52,199,89,0.12)'}]}>
              <View style={[s.dateCol, s.gridCell]}>
                <Text style={[s.dateText, {color: colors.text}]}>{keyLabel(k)}</Text>
                <Text style={[s.tallyText, {color: colors.textTertiary}]}>○{t.yes} △{t.maybe} ✕{t.no}{best ? ' 👑' : ''}</Text>
              </View>
              {poll.attendees.map(a => (
                <TouchableOpacity key={a.id} style={[s.attCol, s.gridCell]} onPress={() => onCycle(a.id, k)}>
                  <Text style={[s.markText, {color: markColor(a.responses[k])}]}>{mark(a.responses[k])}</Text>
                </TouchableOpacity>
              ))}
              <View style={[s.attCol, s.gridCell]} />
            </View>
          );
        })}
        {poll.attendees.length === 0 && (
          <Text style={[s.addHint, {color: colors.textTertiary}]}>右上の人＋アイコンで参加者を追加</Text>
        )}
      </View>
    </ScrollView>
  );
};

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {flex: 1},
    header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth},
    headerBtn: {minWidth: 56, justifyContent: 'center'},
    headerBtnText: {fontSize: 16},
    headerTitle: {fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center'},
    content: {padding: 16},
    lead: {fontSize: 13, lineHeight: 19, marginBottom: 14},
    empty: {borderWidth: 1, borderRadius: 12, padding: 24, alignItems: 'center', gap: 10},
    emptyText: {fontSize: 13},
    pollRow: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8},
    pollTitle: {fontSize: 15, fontWeight: '700'},
    pollMeta: {fontSize: 12, marginTop: 3},
    actions: {padding: 16},
    primaryBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12},
    primaryBtnText: {fontSize: 15, fontWeight: '700'},
    input: {borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 12},
    monthNav: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 8},
    navBtn: {padding: 6},
    monthLabel: {fontSize: 17, fontWeight: '700', minWidth: 130, textAlign: 'center'},
    weekRow: {flexDirection: 'row', marginTop: 6},
    weekCell: {flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', paddingBottom: 4},
    gridWrap: {flexDirection: 'row', flexWrap: 'wrap'},
    dayCell: {width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 3},
    dayInner: {width: '90%', aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
    dayText: {fontSize: 15, fontWeight: '600'},
    ghostBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, marginTop: 14},
    ghostText: {fontSize: 13, fontWeight: '600'},
    pickedNote: {fontSize: 12, textAlign: 'center', marginTop: 10},
    // grid
    gridRow: {flexDirection: 'row', alignItems: 'stretch'},
    gridHeadCell: {borderBottomWidth: 1, borderBottomColor: 'rgba(127,127,127,0.2)', paddingVertical: 8},
    gridCell: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.15)', paddingVertical: 10, alignItems: 'center', justifyContent: 'center'},
    dateCol: {width: 116, paddingHorizontal: 8, justifyContent: 'center'},
    attCol: {width: 56, alignItems: 'center', justifyContent: 'center'},
    gridHead: {fontSize: 12, fontWeight: '700'},
    dateText: {fontSize: 13, fontWeight: '700'},
    tallyText: {fontSize: 10, marginTop: 2},
    markText: {fontSize: 18, fontWeight: '700'},
    addHint: {fontSize: 12, paddingVertical: 16, textAlign: 'center'},
    serverNote: {flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 16},
    serverNoteText: {fontSize: 11, lineHeight: 16, flex: 1},
  });

export default PollModal;
