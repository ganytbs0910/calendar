// ── ⑦ 写真ライフログ：イベント詳細の写真セクション ─────────────────────────
//
// Drop-in section for EventDetailModal: shows photos attached to an event, lets
// you add (library or camera), view full-screen, and delete. On-device.

import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';

import {useTheme} from '../theme/ThemeContext';
import {addEventPhoto, EventPhoto, getEventPhotos, removeEventPhoto} from '../services/eventPhotoService';

interface Props {
  eventId?: string;
  onCountChange?: (count: number) => void;
}

const EventPhotoSection: React.FC<Props> = ({eventId, onCountChange}) => {
  const {colors} = useTheme();
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!eventId) return;
    const list = await getEventPhotos(eventId);
    setPhotos(list);
    onCountChange?.(list.length);
  }, [eventId, onCountChange]);

  useEffect(() => {
    reload();
  }, [reload]);

  const ingest = useCallback(
    async (uris: string[]) => {
      if (!eventId) return;
      // addEventPhoto returns the full authoritative list from storage, so use
      // its latest return value rather than seeding from the (possibly stale)
      // `photos` state — which could drop just-added photos on overlapping adds.
      let latest: EventPhoto[] | null = null;
      for (const u of uris) {
        try {
          latest = await addEventPhoto(eventId, u);
        } catch {
          // skip a failed copy
        }
      }
      if (latest) {
        setPhotos(latest);
        onCountChange?.(latest.length);
      }
    },
    [eventId, onCountChange],
  );

  const pickFromLibrary = useCallback(async () => {
    const res = await launchImageLibrary({mediaType: 'photo', selectionLimit: 0, quality: 0.8});
    const uris = (res.assets ?? []).map(a => a.uri).filter((u): u is string => !!u);
    if (uris.length) await ingest(uris);
  }, [ingest]);

  const takePhoto = useCallback(async () => {
    const res = await launchCamera({mediaType: 'photo', quality: 0.8, saveToPhotos: false});
    const uris = (res.assets ?? []).map(a => a.uri).filter((u): u is string => !!u);
    if (uris.length) await ingest(uris);
  }, [ingest]);

  const onAdd = useCallback(() => {
    Alert.alert('写真を追加', undefined, [
      {text: 'ライブラリから選ぶ', onPress: pickFromLibrary},
      {text: 'カメラで撮る', onPress: takePhoto},
      {text: 'キャンセル', style: 'cancel'},
    ]);
  }, [pickFromLibrary, takePhoto]);

  const onDelete = useCallback(
    (uri: string) => {
      if (!eventId) return;
      Alert.alert('写真を削除', 'この写真を削除しますか？', [
        {text: 'キャンセル', style: 'cancel'},
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            const next = await removeEventPhoto(eventId, uri);
            setPhotos(next);
            onCountChange?.(next.length);
            setViewer(null);
          },
        },
      ]);
    },
    [eventId, onCountChange],
  );

  if (!eventId) return null;
  const s = makeStyles(colors);

  return (
    <View style={[s.section, {backgroundColor: colors.surface}]}>
      <View style={s.headRow}>
        <Ionicons name="images-outline" size={16} color={colors.textSecondary} />
        <Text style={[s.headText, {color: colors.textSecondary}]}>
          思い出 {photos.length > 0 ? `(${photos.length})` : ''}
        </Text>
      </View>
      <View style={s.grid}>
        {photos.map(p => (
          <TouchableOpacity
            key={p.uri}
            onPress={() => setViewer(p.uri)}
            onLongPress={() => onDelete(p.uri)}
            delayLongPress={300}>
            <Image source={{uri: p.uri}} style={s.thumb} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[s.addTile, {borderColor: colors.border}]} onPress={onAdd}>
          <Ionicons name="camera-outline" size={24} color={colors.primary} />
          <Text style={[s.addText, {color: colors.primary}]}>追加</Text>
        </TouchableOpacity>
      </View>
      {photos.length === 0 && (
        <Text style={[s.hint, {color: colors.textTertiary}]}>
          写真を追加すると、月表示にも📷が付き、後から見返せます。
        </Text>
      )}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={s.viewerBg}>
          <TouchableOpacity style={s.viewerClose} onPress={() => setViewer(null)}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          {viewer && <Image source={{uri: viewer}} style={s.viewerImg} resizeMode="contain" />}
          {viewer && (
            <TouchableOpacity style={s.viewerDelete} onPress={() => onDelete(viewer)}>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={s.viewerDeleteText}>削除</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </View>
  );
};

const makeStyles = (colors: any) =>
  StyleSheet.create({
    section: {marginTop: 12, marginHorizontal: 16, borderRadius: 12, padding: 14},
    headRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10},
    headText: {fontSize: 13, fontWeight: '600'},
    grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    thumb: {width: 72, height: 72, borderRadius: 10, backgroundColor: '#0001'},
    addTile: {width: 72, height: 72, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2},
    addText: {fontSize: 11, fontWeight: '600'},
    hint: {fontSize: 11, marginTop: 10, lineHeight: 16},
    viewerBg: {flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center'},
    viewerClose: {position: 'absolute', top: 60, right: 24, zIndex: 2},
    viewerImg: {width: '100%', height: '80%'},
    viewerDelete: {position: 'absolute', bottom: 60, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,59,48,0.9)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22},
    viewerDeleteText: {color: '#fff', fontSize: 14, fontWeight: '700'},
  });

export default EventPhotoSection;
