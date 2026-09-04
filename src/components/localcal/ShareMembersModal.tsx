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
  Switch,
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
  setMyColor,
  MEMBER_COLORS,
  shareLocalCalendar,
  sortMembers,
  syncCalendar,
  setSharedMemberRole,
  kickMember,
  leaveSharedCalendar,
  isInviteClosed,
  setInviteClosed,
  isSharedCalendarMuted,
  setSharedCalendarMuted,
} from '../../services/sharedCalendarService';

interface Props {
  visible: boolean;
  calendar: LocalCalendar;
  onClose: () => void;
  /** Called after this device successfully leaves a shared calendar it doesn't own — the calendar is gone locally, so the caller should navigate away from it. */
  onLeft?: () => void;
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

const ShareMembersModal: React.FC<Props> = ({visible, calendar, onClose, onLeft}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [members, setMembers] = useState<ShareMember[]>([]);
  const [myName, setMyNameState] = useState('');
  const [myColor, setMyColorState] = useState(MEMBER_COLORS[0]);
  // 仮に付けた名前かどうか。招待を送る前に本人に決めてもらいたい。
  const [nameIsAuto, setNameIsAuto] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [inviteClosed, setInviteClosedState] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const reload = useCallback(async () => {
    const [list, me, closed, isMuted] = await Promise.all([
      getMembers(calendar.id), getMe(), isInviteClosed(calendar.id), isSharedCalendarMuted(calendar.id),
    ]);
    setMembers(sortMembers(list));
    setMyNameState(me?.name ?? '');
    setMyColorState(me?.color ?? MEMBER_COLORS[0]);
    setNameIsAuto(!me || !!me.auto);
    setInviteClosedState(closed);
    setMutedState(isMuted);
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

  // 保存ボタンを押させる意味が無い(1行のテキストを直すだけの画面で、
  // 押し忘れて閉じると変更が消えるほうが事故になる)ので、入力が止まったら
  // 自動保存し、フィールドを離れたら確定して編集モードを抜ける。
  const commitName = useCallback(async (opts: {silent?: boolean} = {}) => {
    const name = draftName.trim();
    if (!name) {
      if (!opts.silent) Alert.alert(t('shareNameRequired'));
      return;
    }
    await setMyName(name);
    setNameIsAuto(false);
    await reload();
    // 名乗り直しは次の同期で相手に伝わる。待たせる必要はない。
    syncCalendar(calendar.id).catch(() => {});
  }, [draftName, t, reload, calendar.id]);

  // 入力中、一呼吸止まったら黙って保存する(編集モードはそのまま)。
  useEffect(() => {
    if (!editingName || !draftName.trim()) return;
    const timer = setTimeout(() => { commitName({silent: true}); }, 700);
    return () => clearTimeout(timer);
  }, [draftName, editingName, commitName]);

  // フィールドを離れる(タップアウト/キーボードのdone)ときに最終確定して
  // 編集モードを抜ける。空のまま離れた場合は何も保存せず静かに戻る。
  const finishEditingName = useCallback(() => {
    if (draftName.trim()) commitName({silent: true});
    setEditingName(false);
  }, [draftName, commitName]);

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

  const commitColor = useCallback(async (color: string) => {
    setMyColorState(color);
    await setMyColor(color);
    await reload();
    syncCalendar(calendar.id).catch(() => {});
  }, [calendar.id, reload]);

  const myRole = members.find(member => member.isMe)?.role ?? 'member';
  const canManage = myRole === 'owner' || myRole === 'admin';

  const doKick = useCallback((member: ShareMember) => {
    Alert.alert(
      t('shareKickConfirmTitle', {name: member.name}),
      t('shareKickConfirmBody'),
      [
        {
          text: t('shareKickAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await kickMember(calendar.id, member.id);
              await reload();
            } catch {
              Alert.alert(t('shareKickErrorTitle'), t('shareKickErrorBody'));
            }
          },
        },
        {text: t('cancel'), style: 'cancel'},
      ],
    );
  }, [calendar.id, reload, t]);

  const manageMember = useCallback((member: ShareMember) => {
    if (!canManage || member.isMe || member.role === 'owner') return;
    const options: Array<{label: string; role: 'admin' | 'member' | 'viewer'}> = [
      {label: t('shareRoleAdmin'), role: 'admin'},
      {label: t('shareRoleMember'), role: 'member'},
      {label: t('shareRoleViewer'), role: 'viewer'},
    ];
    Alert.alert(t('shareRoleChangeTitle'), member.name, [
      ...options.map(o => ({
        text: o.label,
        onPress: async () => {
          try {
            await setSharedMemberRole(calendar.id, member.id, o.role);
            await reload();
          } catch {
            Alert.alert(t('shareRoleErrorTitle'), t('shareRoleErrorBody'));
          }
        },
      })),
      {text: t('shareKickAction'), style: 'destructive', onPress: () => doKick(member)},
      {text: t('cancel'), style: 'cancel'},
    ]);
  }, [calendar.id, canManage, reload, t, doKick]);

  const toggleInviteClosed = useCallback(async (value: boolean) => {
    // value here is "allow new joins", inverse of the closed flag.
    const closed = !value;
    setInviteClosedState(closed);
    try {
      await setInviteClosed(calendar.id, closed);
    } catch {
      setInviteClosedState(!closed);
      Alert.alert(t('shareInviteClosedErrorTitle'), t('shareInviteClosedErrorBody'));
    }
  }, [calendar.id, t]);

  const toggleMute = useCallback(async (value: boolean) => {
    // value here is "notify me", inverse of the muted flag.
    const nextMuted = !value;
    setMutedState(nextMuted);
    await setSharedCalendarMuted(calendar.id, nextMuted);
  }, [calendar.id]);

  const onLeave = useCallback(() => {
    Alert.alert(t('shareLeaveConfirmTitle'), t('shareLeaveConfirmBody'), [
      {
        text: t('shareLeaveAction'),
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          try {
            await leaveSharedCalendar(calendar.id);
            onClose();
            onLeft?.();
          } catch {
            Alert.alert(t('shareLeaveErrorTitle'), t('shareLeaveErrorBody'));
          } finally {
            setLeaving(false);
          }
        },
      },
      {text: t('cancel'), style: 'cancel'},
    ]);
  }, [calendar.id, onClose, onLeft, t]);

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
                  onSubmitEditing={finishEditingName}
                  onBlur={finishEditingName}
                />
              </View>
            ) : (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  // myName is the literal auto-generated placeholder string
                  // (see ensureMe()/autoName() in sharedCalendarService.ts)
                  // when nameIsAuto — pre-filling it just forces the user to
                  // delete it before typing their real name.
                  setDraftName(nameIsAuto ? '' : myName);
                  setEditingName(true);
                }}>
                <Text style={[styles.rowText, nameIsAuto && {color: colors.textTertiary}]}>
                  {myName || t('shareNameUnset')}
                </Text>
                <Ionicons name="pencil" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}

            <Text style={styles.colorHelp}>{t('shareMemberColorHelp', {defaultValue: 'この色で、あなたが作成した予定を表示します'})}</Text>
            <View style={styles.colorRow}>
              {MEMBER_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => commitColor(c)}
                  style={[styles.colorSwatch, {backgroundColor: c}, myColor === c && styles.colorSwatchActive]}>
                  {myColor === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, styles.sectionGap]}>
              {t('shareMembersCount', {count: members.length})}
            </Text>
            {members.length === 0 ? (
              <Text style={styles.empty}>{t('shareMembersEmpty')}</Text>
            ) : (
              members.map(m => {
                const roleLabel = m.role === 'owner' ? t('shareRoleOwner')
                  : m.role === 'admin' ? t('shareRoleAdmin')
                  : m.role === 'viewer' ? t('shareRoleViewer')
                  : t('shareRoleMember');
                return (
                  <TouchableOpacity key={m.id} style={styles.row} onPress={() => manageMember(m)} disabled={!canManage || m.isMe || m.role === 'owner'}>
                    <View style={[styles.avatar, {backgroundColor: (m.color || calendar.color) + '22'}]}>
                      <Text style={[styles.avatarText, {color: m.color || calendar.color}]}>
                        {(m.name || '?').slice(0, 1)}
                      </Text>
                    </View>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowText} numberOfLines={1}>
                        {m.name}
                        {m.isMe ? ` (${t('shareMembersYou')})` : ''}
                      </Text>
                      <Text style={styles.rowSub}>{lastSeenLabel(m.lastSeenAt, t)}</Text>
                      <Text style={styles.roleText}>{roleLabel}</Text>
                    </View>
                    {canManage && !m.isMe && m.role !== 'owner' && (
                      <Ionicons name="chevron-forward" size={15} color={colors.textTertiary}/>
                    )}
                  </TouchableOpacity>
                );
              })
            )}

            {myRole === 'owner' && (
              <View style={[styles.row, styles.sectionGap]}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowText}>{t('shareInviteClosedLabel')}</Text>
                  <Text style={styles.rowSub}>{t('shareInviteClosedHelp')}</Text>
                </View>
                <Switch
                  value={!inviteClosed}
                  onValueChange={toggleInviteClosed}
                  trackColor={{false: colors.inputBackground, true: colors.primary}}
                />
              </View>
            )}

            <View style={[styles.row, myRole !== 'owner' && styles.sectionGap]}>
              <View style={styles.rowMain}>
                <Text style={styles.rowText}>{t('shareMuteLabel')}</Text>
                <Text style={styles.rowSub}>{t('shareMuteHelp')}</Text>
              </View>
              <Switch
                value={!muted}
                onValueChange={toggleMute}
                trackColor={{false: colors.inputBackground, true: colors.primary}}
              />
            </View>

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

            {myRole !== 'owner' && (
              <TouchableOpacity
                style={[styles.invite, styles.leaveBtn, {borderColor: colors.error}]}
                onPress={onLeave}
                disabled={leaving}>
                {leaving ? (
                  <ActivityIndicator color={colors.error} />
                ) : (
                  <>
                    <Ionicons name="exit-outline" size={18} color={colors.error} />
                    <Text style={[styles.inviteText, {color: colors.error}]}>
                      {t('shareLeaveAction')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
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
    roleText: {fontSize: 11, color: colors.primary, marginTop: 2},
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
    colorHelp: {fontSize: 12, color: colors.textTertiary, marginTop: 4},
    colorRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 6},
    colorSwatch: {width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center'},
    colorSwatchActive: {borderWidth: 3, borderColor: colors.text},
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
    leaveBtn: {marginTop: 10},
    note: {fontSize: 12, color: colors.textTertiary, marginTop: 12, lineHeight: 18},
  });

export default ShareMembersModal;
