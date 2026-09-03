import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTranslation} from 'react-i18next';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import {useTheme} from '../../theme/ThemeContext';
import {
  getMembers, getOrCreateMe, getSharedEventContext, sharedEventAction,
  SharedEventContext, ShareMember, subscribeSharedCalendar,
} from '../../services/sharedCalendarService';

type Props = {
  calendarId: string;
  eventId: string;
  /** A viewer can still mark attendance (the server allows it) but cannot
   * comment or add/remove photos — the compose UI for those is hidden here
   * to match, rather than only discovering the restriction from a failed
   * write. */
  readOnly?: boolean;
};
const empty: SharedEventContext = {comments: [], attendance: [], photos: [], activity: [], revisions: []};

const SharedEventCollaboration: React.FC<Props> = ({calendarId, eventId, readOnly}) => {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [context, setContext] = useState(empty);
  const [members, setMembers] = useState<ShareMember[]>([]);
  const [meId, setMeId] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const reload = useCallback(async () => {
    const [next, list, me] = await Promise.all([
      getSharedEventContext(calendarId, eventId), getMembers(calendarId), getOrCreateMe(),
    ]);
    setContext(next); setMembers(list); setMeId(me.id);
  }, [calendarId, eventId]);

  useEffect(() => {
    let alive = true;
    const run = async () => { try { if (alive) await reload(); } catch {} };
    run();
    const timer = setInterval(run, 60_000);
    let unsubscribe = () => {};
    subscribeSharedCalendar(calendarId, run).then(fn => { if (alive) unsubscribe = fn; else fn(); });
    return () => { alive = false; clearInterval(timer); unsubscribe(); };
  }, [calendarId, reload]);

  const act = useCallback(async (action: string, payload: Record<string, unknown>) => {
    setBusy(true);
    try { setContext(await sharedEventAction(calendarId, eventId, action, payload)); }
    catch { Alert.alert(t('sharedActionErrorTitle'), t('sharedActionErrorBody')); }
    finally { setBusy(false); }
  }, [calendarId, eventId, t]);

  const sendComment = useCallback(async () => {
    const body = comment.trim(); if (!body) return;
    await act('comment', {body}); setComment('');
  }, [act, comment]);

  const uploadUris = useCallback(async (uris: Array<{uri?: string; type?: string}>) => {
    for (const item of uris) {
      if (!item.uri) continue;
      try {
        const base64 = await RNFS.readFile(item.uri.replace(/^file:\/\//, ''), 'base64');
        await act('photo', {mimeType: item.type || 'image/jpeg', base64});
      } catch { Alert.alert(t('sharedPhotoErrorTitle'), t('sharedPhotoErrorBody')); }
    }
  }, [act, t]);

  const choosePhoto = useCallback(() => Alert.alert(t('sharedAddPhotoTitle'), undefined, [
    {text: t('sharedAddPhotoLibrary'), onPress: async () => { const r=await launchImageLibrary({mediaType:'photo',selectionLimit:10,quality:.7,maxWidth:1600,maxHeight:1600}); await uploadUris(r.assets ?? []); }},
    {text: t('sharedAddPhotoCamera'), onPress: async () => { const r=await launchCamera({mediaType:'photo',quality:.7,maxWidth:1600,maxHeight:1600}); await uploadUris(r.assets ?? []); }},
    {text: t('cancel'), style:'cancel'},
  ]), [uploadUris, t]);

  const names = useMemo(() => new Map(members.map(m => [m.id, m.name])), [members]);
  const mine = context.attendance.find(a => a.memberId === meId)?.status;
  const memberFallback = t('sharedMemberFallback');
  const statusLabels = {
    going: t('sharedAttendanceGoing'),
    maybe: t('sharedAttendanceMaybe'),
    declined: t('sharedAttendanceDeclined'),
  } as const;

  return <View style={styles.section}>
    <Text style={styles.heading}>{t('sharedAttendanceHeading')}</Text>
    <View style={styles.chips}>{(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map(status =>
      <TouchableOpacity key={status} style={[styles.chip,mine===status&&styles.chipOn]} onPress={() => act('attendance',{status})}>
        <Text style={[styles.chipText,mine===status&&styles.chipTextOn]}>{statusLabels[status]}</Text>
      </TouchableOpacity>)}</View>
    {context.attendance.length>0 && <Text style={styles.summary}>{context.attendance.map(a=>`${names.get(a.memberId)||memberFallback}: ${statusLabels[a.status]}`).join('　')}</Text>}

    <View style={styles.headRow}>
      <Text style={styles.heading}>{t('sharedPhotosHeading')}</Text>
      {!readOnly && <TouchableOpacity onPress={choosePhoto}><Ionicons name="camera-outline" size={22} color={colors.primary}/></TouchableOpacity>}
    </View>
    <View style={styles.photos}>{context.photos.map(p=>
      <TouchableOpacity key={p.id} onLongPress={readOnly ? undefined : () => act('photo_delete',{id:p.id})} disabled={readOnly}>
        <Image source={{uri:`data:${p.mimeType};base64,${p.base64}`}} style={styles.photo}/>
      </TouchableOpacity>)}</View>

    <Text style={styles.heading}>{t('sharedCommentsHeading')}</Text>
    {context.comments.map(c=><View key={c.id} style={styles.comment}><Text style={styles.author}>{names.get(c.memberId)||memberFallback}</Text><Text style={styles.body}>{c.body}</Text></View>)}
    {!readOnly && (
      <View style={styles.compose}>
        <TextInput style={styles.input} value={comment} onChangeText={setComment} placeholder={t('sharedCommentPlaceholder')} placeholderTextColor={colors.textTertiary} multiline/>
        <TouchableOpacity onPress={sendComment} disabled={busy||!comment.trim()}><Ionicons name="send" size={22} color={comment.trim()?colors.primary:colors.disabled}/></TouchableOpacity>
      </View>
    )}

    <TouchableOpacity style={styles.headRow} onPress={()=>setHistoryOpen(v=>!v)}><Text style={styles.heading}>{t('sharedHistoryHeading')}</Text><Ionicons name={historyOpen?'chevron-down':'chevron-forward'} size={16} color={colors.textTertiary}/></TouchableOpacity>
    {historyOpen && context.activity.map(a=><Text key={a.seq} style={styles.activity}>{names.get(a.memberId)||memberFallback}・{a.action}・{new Date(a.createdAt).toLocaleString()}</Text>)}
    {historyOpen && context.revisions.map(r=><Text key={`r-${r.revisionId}`} style={styles.activity}>{t('sharedHistorySavedVersion', {title: String(r.snapshot.title || t('sharedHistoryDefaultTitle'))})}・{new Date(r.createdAt).toLocaleString()}</Text>)}
    {busy&&<ActivityIndicator style={styles.busy} size="small" color={colors.primary}/>}
  </View>;
};

const makeStyles=(c:any)=>StyleSheet.create({
  section:{margin:16,padding:14,borderRadius:12,backgroundColor:c.surface,gap:10},heading:{fontSize:13,fontWeight:'700',color:c.textSecondary},headRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},chips:{flexDirection:'row',gap:8},chip:{paddingVertical:7,paddingHorizontal:13,borderRadius:16,backgroundColor:c.inputBackground},chipOn:{backgroundColor:c.primary},chipText:{fontSize:13,color:c.text},chipTextOn:{color:c.onPrimary,fontWeight:'700'},summary:{fontSize:11,color:c.textTertiary},photos:{flexDirection:'row',flexWrap:'wrap',gap:8},photo:{width:72,height:72,borderRadius:9},comment:{padding:10,borderRadius:9,backgroundColor:c.inputBackground},author:{fontSize:11,fontWeight:'700',color:c.textSecondary,marginBottom:3},body:{fontSize:14,color:c.text},compose:{flexDirection:'row',alignItems:'flex-end',gap:8},input:{flex:1,minHeight:40,maxHeight:100,borderRadius:10,paddingHorizontal:11,paddingVertical:9,backgroundColor:c.inputBackground,color:c.text},activity:{fontSize:12,color:c.textSecondary,paddingVertical:3},busy:{position:'absolute',top:12,right:46},
});
export default SharedEventCollaboration;
