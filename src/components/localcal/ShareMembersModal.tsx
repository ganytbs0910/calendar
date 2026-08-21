// 「このカレンダーを誰と共有しているか」を出すシート。
//
// 参加者の一覧と、招待リンクを送る導線、自分の表示名の変更をここに集めた。
// カレンダー画面の 👥 ボタンから開く（入口は1つだけ）。
//
// ★ ここに並ぶ名前は本人確認の結果ではない。各自が自分で名乗ったものを
//   そのまま出しているだけで、招待コードを知っていれば誰でも任意の名前で
//   名乗れる。信頼できる相手と共有する前提の機能なので、そう割り切っている。

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {LocalCalendar} from '../../services/localCalendarService';
import {
  ShareMember,
  getMe,
  getMembers,
  setMyName,
  shareLocalCalendar,
  sortMembers,
  syncCalendar,
} from '../../services/sharedCalendarService';

interface Props {
  visible: boolean;
  calendar: LocalCalendar;
  onClose: () => void;
}

/** 「まだ開いていない」が伝わればいいので、粒度は日どまりで足りる。 */
const lastSeenLabel = (iso: string, t: (k: string, o?: any) => string): string => {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  const days = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return t('shareSeenToday');
  if (days === 1) return t('shareSeenYesterday');
  if (days < 30) return t('shareSeenDaysAgo', {days});
  return `${then.getFullYear()}/${then.getMonth() + 1}/${then.getDate()}`;
};

const ShareMembersModal: React.FC<Props> = ({visible, calendar, onClose}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [members, setMembers] = useState<ShareMember[]>([]);
  const [myName, setMyNameState] = useState('');
  // 仮に付けた名前かどうか。招待を送る前に本人に決めてもらいたい。
  const [nameIsAuto, setNameIsAuto] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    const [list, me] = await Promise.all([getMembers(calendar.id), getMe()]);
    setMembers(sortMembers(list));
    setMyNameState(me?.name ?? '');
    setNameIsAuto(!me || !!me.auto);
  }, [calendar.id]);

  // 開いたら手元のぶんをすぐ出し、そのうしろで取りに行く。圏外でも
  // 「誰と共有しているか」は前回ぶんが出る。
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      await reload();
      if (!alive) return;
      setSyncing(true);
      try {
        await syncCalendar(calendar.id);
        if (alive) await reload();
      } catch {
        // 取りに行けなくても手元のぶんは出ている
      } finally {
        if (alive) setSyncing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, calendar.id, reload]);

  const commitName = useCallback(async () => {
    const name = draftName.trim();
    if (!name) {
      Alert.alert(t('shareNameRequired'));
      return;
    }
    await setMyName(name);
    setEditingName(false);
    setNameIsAuto(false);
    await reload();
    // 名乗り直しは次の同期で相手に伝わる。待たせる必要はない。
    syncCalendar(calendar.id).catch(() => {});
  }, [draftName, t, reload, calendar.id]);

  const onInvite = useCallback(async () => {
    // 名前のまま招待すると、相手の一覧に「名前未設定」で並ぶ。送る前に一度だけ聞く。
    if (nameIsAuto) {
      setDraftName(myName && !nameIsAuto ? myName : '');
      setEditingName(true);
      Alert.alert(t('shareNameFirstTitle'), t('shareNameFirstBody'));
      return;
    }
    setBusy(true);
    try {
      const url = await shareLocalCalendar(calendar);
      await Share.share({message: t('shareCalMessage', {name: calendar.name, url})});
      await reload();
    } catch {
      Alert.alert(t('shareCalFailedTitle'), t('shareCalFailedBody'));
    } finally {
      setBusy(false);
    }
  }, [calendar, t, reload, nameIsAuto, myName]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Text style={styles.close}>{t('close')}</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{t('shareMembersTitle')}</Text>
            <View style={styles.headerBtn}>
              {syncing && <ActivityIndicator size="small" color={colors.textTertiary} />}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.sectionLabel}>{t('shareMyNameLabel')}</Text>
            {editingName ? (
              <View style={styles.nameRow}>
                <TextInput
                  style={styles.nameInput}
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder={t('shareNamePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={24}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={commitName}
                />
                <TouchableOpacity onPress={commitName} style={styles.nameSave}>
                  <Text style={styles.nameSaveText}>{t('save')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setDraftName(myName);
                  setEditingName(true);
                }}>
                <Text style={[styles.rowText, nameIsAuto && {color: colors.textTertiary}]}>
                  {myName || t('shareNameUnset')}
                </Text>
                <Ionicons name="pencil" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}

            <Text style={[styles.sectionLabel, styles.sectionGap]}>
              {t('shareMembersCount', {count: members.length})}
            </Text>
            {members.length === 0 ? (
              <Text style={styles.empty}>{t('shareMembersEmpty')}</Text>
            ) : (
              members.map(m => (
                <View key={m.id} style={styles.row}>
                  <View style={[styles.avatar, {backgroundColor: calendar.color + '22'}]}>
                    <Text style={[styles.avatarText, {color: calendar.color}]}>
                      {(m.name || '?').slice(0, 1)}
                    </Text>
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {m.name}
                      {m.isMe ? ` (${t('shareMembersYou')})` : ''}
                    </Text>
                    <Text style={styles.rowSub}>{lastSeenLabel(m.lastSeenAt, t)}</Text>
                  </View>
                </View>
              ))
            )}

            <TouchableOpacity
              style={[styles.invite, {borderColor: colors.primary}]}
              onPress={onInvite}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                  <Text style={[styles.inviteText, {color: colors.primary}]}>
                    {t('shareInviteAction')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.note}>{t('shareMembersNote')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end'},
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: '82%',
      paddingBottom: 28,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerBtn: {width: 60, justifyContent: 'center'},
    close: {fontSize: 16, color: colors.primary},
    title: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.text},
    body: {padding: 16, gap: 8},
    sectionLabel: {fontSize: 13, fontWeight: '600', color: colors.textSecondary},
    sectionGap: {marginTop: 18},
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    rowMain: {flex: 1},
    rowText: {flex: 1, fontSize: 16, color: colors.text},
    rowSub: {fontSize: 12, color: colors.textTertiary, marginTop: 2},
    avatar: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
    avatarText: {fontSize: 16, fontWeight: '700'},
    empty: {fontSize: 14, color: colors.textTertiary, paddingVertical: 12},
    nameRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    nameInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    nameSave: {paddingHorizontal: 12, paddingVertical: 12},
    nameSaveText: {fontSize: 16, fontWeight: '600', color: colors.primary},
    invite: {
      marginTop: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1.5,
      borderRadius: 12,
      paddingVertical: 14,
    },
    inviteText: {fontSize: 16, fontWeight: '600'},
    note: {fontSize: 12, color: colors.textTertiary, marginTop: 12, lineHeight: 18},
  });

export default ShareMembersModal;
