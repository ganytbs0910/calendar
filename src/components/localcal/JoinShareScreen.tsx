// 招待リンクを開いたときに出す「参加する前に確認する」画面。
//
// 以前はネイティブの Alert が3連続で出るだけで、絵文字・名前・予定件数
// しか見せず、参加者のプレビューも無く、名前は「名前未設定」のまま参加して
// 後から別画面(共有メンバー管理)で名乗り直す形だった。ここでは招待の
// 中身(誰がもう参加しているか)を見せた上で、参加する自分の名前と色を
// その場で決めてから参加できるようにする。

import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {LocalCalendar} from '../../services/localCalendarService';
import {
  fetchShareMeta,
  joinSharedCalendar,
  getMe,
  MEMBER_COLORS,
  ShareMetaMember,
} from '../../services/sharedCalendarService';

type TFunc = (key: string, opts?: any) => string;

interface Props {
  /** null のときは非表示。招待コードが分かった時点でこれをセットして開く。 */
  code: string | null;
  onClose: () => void;
  onJoined: (cal: LocalCalendar) => void;
}

type Meta = {name: string; color: string; emoji: string; events: number; members: number; memberPreview: ShareMetaMember[]};

const JoinShareScreen: React.FC<Props> = ({code, onClose, onJoined}) => {
  const {colors} = useTheme();
  const {t}: {t: TFunc} = useTranslation();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(MEMBER_COLORS[0]);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    setLoading(true);
    setGone(false);
    setMeta(null);
    (async () => {
      const [m, me] = await Promise.all([fetchShareMeta(code), getMe()]);
      if (!alive) return;
      if (!m) {
        setGone(true);
        setLoading(false);
        return;
      }
      setMeta(m);
      // 既に他のカレンダーで名乗っていれば、それをそのまま引き継ぐ
      // (secret/idと同じくMeは端末で1つ — ここで空欄のまま参加すると
      // 「名前未設定」になるだけで、他の共有先の名乗りには影響しない)。
      if (me && !me.auto) {
        setName(me.name);
        setColor(me.color);
      } else {
        setName('');
        setColor(MEMBER_COLORS[0]);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [code]);

  const handleJoin = useCallback(async () => {
    if (!code) return;
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('joinScreenNameRequired'));
      return;
    }
    setJoining(true);
    try {
      const cal = await joinSharedCalendar(code, {name: trimmed, color});
      if (!cal) {
        setGone(true);
        return;
      }
      onJoined(cal);
    } catch {
      Alert.alert(t('joinShareGoneTitle'), t('joinShareGoneBody'));
    } finally {
      setJoining(false);
    }
  }, [code, name, color, onJoined, t]);

  return (
    <Modal visible={!!code} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('cancel')}>
              <Text style={styles.close}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{t('joinScreenTitle')}</Text>
            <View style={styles.headerBtn} />
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : gone || !meta ? (
            <View style={styles.center}>
              <Text style={styles.goneTitle}>{t('joinShareGoneTitle')}</Text>
              <Text style={styles.goneBody}>{t('joinShareGoneBody')}</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.calCard}>
                <View style={[styles.calBadge, {backgroundColor: meta.color}]}>
                  <Ionicons name="people" size={20} color="#fff" />
                </View>
                <View style={styles.calMain}>
                  <Text style={styles.calName} numberOfLines={1}>{meta.name}</Text>
                  <Text style={styles.calSub}>{t('joinScreenEventCount', {count: meta.events})}</Text>
                </View>
              </View>

              <Text style={styles.sectionLabel}>{t('joinScreenMembersHeading')}</Text>
              {meta.memberPreview.length === 0 ? (
                <Text style={styles.empty}>{t('shareMembersEmpty')}</Text>
              ) : (
                <View style={styles.memberRow}>
                  {meta.memberPreview.map((m, i) => (
                    <View key={i} style={styles.memberChip}>
                      <View style={[styles.memberDot, {backgroundColor: m.color || colors.primary}]}>
                        <Text style={styles.memberDotText}>{(m.name || '?').slice(0, 1)}</Text>
                      </View>
                      <Text style={styles.memberName} numberOfLines={1}>{m.name}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.sectionLabel}>{t('joinScreenNameLabel')}</Text>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder={t('joinScreenNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                maxLength={24}
                returnKeyType="done"
              />

              <Text style={styles.sectionLabel}>{t('joinScreenColorLabel')}</Text>
              <View style={styles.colorRow}>
                {MEMBER_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setColor(c)}
                    style={[styles.colorSwatch, {backgroundColor: c}, color === c && styles.colorSwatchActive]}
                    accessibilityRole="button"
                    accessibilityState={{selected: color === c}}>
                    {color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.joinBtn, {backgroundColor: colors.primary}, (joining || !name.trim()) && styles.joinBtnDisabled]}
                onPress={handleJoin}
                disabled={joining || !name.trim()}
                accessibilityRole="button"
                accessibilityLabel={t('joinShareAction')}>
                {joining ? <ActivityIndicator color="#fff" /> : <Text style={styles.joinBtnText}>{t('joinShareAction')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          )}
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
      maxHeight: '85%',
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
    center: {paddingVertical: 60, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24},
    goneTitle: {fontSize: 16, fontWeight: '600', color: colors.text},
    goneBody: {fontSize: 13, color: colors.textTertiary, textAlign: 'center'},
    body: {padding: 16, gap: 8},
    calCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
    },
    // A plain colored badge instead of the calendar's own emoji — this
    // screen is always about a shared calendar, so "shared" itself (people
    // icon) is a more useful signal here than whichever emoji its owner
    // happened to pick when creating it.
    calBadge: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
    calMain: {flex: 1},
    calName: {fontSize: 17, fontWeight: '700', color: colors.text},
    calSub: {fontSize: 12, color: colors.textTertiary, marginTop: 2},
    sectionLabel: {fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: 14},
    empty: {fontSize: 13, color: colors.textTertiary},
    memberRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
    memberChip: {alignItems: 'center', width: 60},
    memberDot: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
    memberDotText: {color: '#fff', fontSize: 16, fontWeight: '700'},
    memberName: {fontSize: 11, color: colors.textSecondary, marginTop: 4, textAlign: 'center'},
    nameInput: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    colorRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
    colorSwatch: {width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
    colorSwatchActive: {borderWidth: 2, borderColor: colors.text},
    joinBtn: {
      marginTop: 20,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinBtnDisabled: {opacity: 0.5},
    joinBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  });

export default JoinShareScreen;
