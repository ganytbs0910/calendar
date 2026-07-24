// Tab root for the TimeTree-style local calendars: a list of the user's
// on-device calendars (private / 推し活 / …), a create+edit sheet, and routing
// into a calendar's month view. All data lives in localCalendarService.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../../theme/ThemeContext';
import {ThemeColors} from '../../theme/colors';
import {
  LocalCalendar,
  getLocalCalendars,
  getLocalEventCounts,
  addLocalCalendar,
  updateLocalCalendar,
  deleteLocalCalendar,
} from '../../services/localCalendarService';
import LocalCalendarDetail from './LocalCalendarDetail';

interface Props {
  visible: boolean;
}

const PALETTE = [
  '#FF2D55', '#FF9500', '#FFCC00', '#34C759', '#30B0C7',
  '#007AFF', '#5856D6', '#AF52DE', '#8E8E93',
];
const EMOJIS = [
  '🗓️', '💖', '🎤', '🎮', '✈️', '🏃', '📚', '🎂',
  '🐾', '🌸', '💼', '⭐', '🍙', '🎬', '⚽', '🎵',
];

const LocalCalendarsScreen: React.FC<Props> = ({visible}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [calendars, setCalendars] = useState<LocalCalendar[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openCal, setOpenCal] = useState<LocalCalendar | null>(null);

  // editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[5]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);

  const reload = useCallback(async () => {
    const [cals, cnt] = await Promise.all([getLocalCalendars(), getLocalEventCounts()]);
    setCalendars(cals);
    setCounts(cnt);
  }, []);

  useEffect(() => {
    if (visible) reload();
  }, [visible, reload]);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setColor(PALETTE[5]);
    setEmoji(EMOJIS[0]);
    setEditorOpen(true);
  };
  const openEditor = (cal: LocalCalendar) => {
    setEditingId(cal.id);
    setName(cal.name);
    setColor(cal.color);
    setEmoji(cal.emoji);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('localCalNeedName'));
      return;
    }
    if (editingId) {
      await updateLocalCalendar(editingId, {name: trimmed, color, emoji});
    } else {
      await addLocalCalendar(trimmed, color, emoji);
    }
    setEditorOpen(false);
    await reload();
  };

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert(t('localCalDeleteTitle'), t('localCalDeleteDesc'), [
      {text: t('cancel'), style: 'cancel'},
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteLocalCalendar(editingId);
          setEditorOpen(false);
          await reload();
        },
      },
    ]);
  };

  // When a calendar is open, show its month view full-screen within the tab.
  if (openCal) {
    // keep the open reference fresh in case it was edited
    const fresh = calendars.find(c => c.id === openCal.id) ?? openCal;
    return (
      <LocalCalendarDetail
        calendar={fresh}
        onBack={() => {
          setOpenCal(null);
          reload();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('tabLocalCal')}</Text>
        <TouchableOpacity onPress={openCreate} style={styles.addHeaderBtn}>
          <Ionicons name="add" size={26} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{paddingVertical: 12}}>
        {calendars.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={56} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{t('localCalEmptyTitle')}</Text>
            <Text style={styles.emptyDesc}>{t('localCalEmptyDesc')}</Text>
          </View>
        ) : (
          calendars.map(cal => (
            <TouchableOpacity
              key={cal.id}
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => setOpenCal(cal)}>
              <View style={[styles.cardBar, {backgroundColor: cal.color}]} />
              <Text style={styles.cardEmoji}>{cal.emoji}</Text>
              <View style={{flex: 1}}>
                <Text style={styles.cardName} numberOfLines={1}>{cal.name}</Text>
                <Text style={styles.cardCount}>{t('localCalEventCount', {count: counts[cal.id] ?? 0})}</Text>
              </View>
              <TouchableOpacity onPress={() => openEditor(cal)} style={styles.cardEditBtn} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity style={styles.createBtn} onPress={openCreate} activeOpacity={0.7}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.createText}>{t('localCalCreate')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Create / edit calendar sheet */}
      <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setEditorOpen(false)} style={{width: 64}}>
              <Text style={styles.cancel}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {editingId ? t('localCalEdit') : t('localCalNew')}
            </Text>
            <TouchableOpacity onPress={handleSave} style={{width: 64}}>
              <Text style={styles.save}>{t('save')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{padding: 16}}>
            <View style={styles.previewRow}>
              <View style={[styles.previewIcon, {backgroundColor: color}]}>
                <Text style={{fontSize: 22}}>{emoji}</Text>
              </View>
              <TextInput
                style={styles.nameInput}
                placeholder={t('localCalNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                value={name}
                onChangeText={setName}
                autoFocus={!editingId}
              />
            </View>

            <Text style={styles.sectionLabel}>{t('localCalColor')}</Text>
            <View style={styles.swatchRow}>
              {PALETTE.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setColor(c)}
                  style={[styles.swatch, {backgroundColor: c}, color === c && styles.swatchActive]}>
                  {color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>{t('localCalIcon')}</Text>
            <View style={styles.emojiRow}>
              {EMOJIS.map(e => (
                <TouchableOpacity
                  key={e}
                  onPress={() => setEmoji(e)}
                  style={[styles.emojiTile, emoji === e && {borderColor: color, backgroundColor: colors.surfaceSecondary}]}>
                  <Text style={{fontSize: 22}}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {editingId && (
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                <Text style={styles.deleteText}>{t('localCalDeleteBtn')}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: colors.background},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: {fontSize: 17, fontWeight: '600', color: colors.text},
    addHeaderBtn: {width: 32, alignItems: 'flex-end'},
    cancel: {fontSize: 16, color: colors.textSecondary},
    save: {fontSize: 16, color: colors.primary, fontWeight: '700', textAlign: 'right'},
    empty: {alignItems: 'center', gap: 10, paddingTop: 64, paddingHorizontal: 32},
    emptyTitle: {fontSize: 16, fontWeight: '600', color: colors.text},
    emptyDesc: {fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19},
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginBottom: 10,
      borderRadius: 14,
      paddingVertical: 14,
      paddingRight: 12,
      overflow: 'hidden',
    },
    cardBar: {width: 6, alignSelf: 'stretch'},
    cardEmoji: {fontSize: 24, marginLeft: 4},
    cardName: {fontSize: 16, fontWeight: '600', color: colors.text},
    cardCount: {fontSize: 12, color: colors.textSecondary, marginTop: 2},
    cardEditBtn: {paddingHorizontal: 4},
    createBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginHorizontal: 16,
      marginTop: 6,
      paddingVertical: 14,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.border,
    },
    createText: {fontSize: 15, color: colors.primary, fontWeight: '600'},
    previewRow: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8},
    previewIcon: {width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
    nameInput: {
      flex: 1,
      fontSize: 17,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    sectionLabel: {fontSize: 13, color: colors.textSecondary, marginTop: 20, marginBottom: 10, fontWeight: '600'},
    swatchRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
    swatch: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent'},
    swatchActive: {borderColor: colors.text},
    emojiRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
    emojiTile: {
      width: 44,
      height: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
    },
    deleteBtn: {
      marginTop: 28,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.errorBackground,
      alignItems: 'center',
    },
    deleteText: {fontSize: 16, color: colors.delete, fontWeight: '600'},
  });

// Memoised: App re-renders on every tab switch, and without this each
// tab's whole subtree would re-render even while hidden.
export default React.memo(LocalCalendarsScreen);
