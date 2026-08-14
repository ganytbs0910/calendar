// ── FeedbackScreen — 意見ボックス ────────────────────────────────────────────
//
// 送信内容は Supabase の calendar_feedback に入り、DBトリガーから Discord へ
// 即通知される（開発者が気付けるように）。
//
// calendar_feedback は anon から INSERT のみ許可で SELECT は不可。
// 他人の投稿が読めないようにするためで、この画面にも送信履歴を持たせていない。
//
// 文言は feedbackCopy.ts に切り出してある。ここには文字列を書かないこと。

import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import {useTheme} from '../theme/ThemeContext';
import {
  MAX_CONTACT_LENGTH,
  MAX_MESSAGE_LENGTH,
  submitFeedback,
  type FeedbackCategory,
} from '../services/feedbackService';
import {ja as copy} from './feedbackCopy';

interface Props {
  onClose: () => void;
}

const CATEGORIES: {key: FeedbackCategory; icon: string; tint: string}[] = [
  {key: 'bug', icon: 'bug-outline', tint: '#FF3B30'},
  {key: 'request', icon: 'bulb-outline', tint: '#FFCC00'},
  {key: 'ux', icon: 'compass-outline', tint: '#5856D6'},
  {key: 'other', icon: 'chatbubble-outline', tint: '#8E8E93'},
];

const FeedbackScreen: React.FC<Props> = ({onClose}) => {
  const {colors} = useTheme();
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = useCallback(async () => {
    // 二重送信はここで止まる。連打で同じ意見が並ぶのを防ぐ唯一の手当て。
    if (isSending) return;
    setIsSending(true);
    try {
      const result = await submitFeedback({category, message, contact});

      if (result.ok) {
        // 送れたときだけ入力を消す。失敗時に消すと書き直しになる。
        setMessage('');
        setContact('');
        Alert.alert(copy.successTitle, copy.successBody, [{text: 'OK', onPress: onClose}]);
        return;
      }
      Alert.alert(copy.errorTitle, copy.errors[result.reason]);
    } finally {
      setIsSending(false);
    }
  }, [category, contact, isSending, message, onClose]);

  const remaining = MAX_MESSAGE_LENGTH - message.length;
  const canSubmit = message.trim().length > 0 && !isSending;

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.titleRow, {borderBottomColor: colors.border}]}>
        <Text style={[styles.screenTitle, {color: colors.text}]}>{copy.title}</Text>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}
          accessibilityRole="button"
          accessibilityLabel={copy.close}>
          <Ionicons name="close" size={26} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text style={[styles.lead, {color: colors.textSecondary}]}>{copy.lead}</Text>

          <Text style={[styles.label, {color: colors.text}]}>{copy.categoryLabel}</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? c.tint : colors.surface,
                      borderColor: active ? c.tint : colors.border,
                    },
                  ]}>
                  <Ionicons
                    name={c.icon as any}
                    size={14}
                    color={active ? '#fff' : c.tint}
                    style={styles.chipIcon}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      {color: active ? '#fff' : colors.text, fontWeight: active ? '700' : '400'},
                    ]}>
                    {copy.categories[c.key]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, {color: colors.text}]}>{copy.messageLabel}</Text>
          <TextInput
            style={[
              styles.textArea,
              {backgroundColor: colors.surface, borderColor: colors.border, color: colors.text},
            ]}
            value={message}
            onChangeText={setMessage}
            placeholder={copy.messagePlaceholder}
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            textAlignVertical="top"
            editable={!isSending}
          />
          <Text
            style={[
              styles.counter,
              // 残り20文字を切ったら色を変える。打ち切られてから気付くのを避ける。
              {color: remaining <= 20 ? colors.error : colors.textTertiary},
            ]}>
            {message.length} / {MAX_MESSAGE_LENGTH}
          </Text>

          <Text style={[styles.label, {color: colors.text}]}>{copy.contactLabel}</Text>
          <TextInput
            style={[
              styles.input,
              {backgroundColor: colors.surface, borderColor: colors.border, color: colors.text},
            ]}
            value={contact}
            onChangeText={setContact}
            placeholder={copy.contactPlaceholder}
            placeholderTextColor={colors.textTertiary}
            maxLength={MAX_CONTACT_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!isSending}
          />

          <View style={[styles.noteBox, {backgroundColor: colors.surfaceSecondary}]}>
            <Ionicons
              name="lock-closed-outline"
              size={14}
              color={colors.textTertiary}
              style={styles.noteIcon}
            />
            <Text style={[styles.note, {color: colors.textSecondary}]}>{copy.note}</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.submit,
              {backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.4},
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{disabled: !canSubmit, busy: isSending}}
            accessibilityLabel={isSending ? copy.submitting : copy.submit}>
            {isSending ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.submitText, {color: colors.onPrimary}]}>{copy.submit}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1},
  fill: {flex: 1},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  screenTitle: {fontSize: 24, fontWeight: '700'},
  content: {paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48},
  lead: {fontSize: 13, lineHeight: 20, marginBottom: 24},
  label: {fontSize: 13, fontWeight: '700', marginBottom: 8},
  categoryRow: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    // 縦 10 + 文字 ≒ 36pt。行に4つ並ぶので幅より高さで押しやすさを稼ぐ。
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  chipIcon: {marginRight: 4},
  chipText: {fontSize: 13},
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 150,
    fontSize: 15,
    lineHeight: 21,
  },
  counter: {fontSize: 11, textAlign: 'right', marginTop: 6, marginBottom: 20},
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  noteBox: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 12,
    marginTop: 20,
    marginBottom: 24,
  },
  noteIcon: {marginRight: 8, marginTop: 2},
  note: {flex: 1, fontSize: 12, lineHeight: 18},
  submit: {borderRadius: 12, paddingVertical: 16, alignItems: 'center'},
  submitText: {fontSize: 16, fontWeight: '700'},
});

export default FeedbackScreen;
