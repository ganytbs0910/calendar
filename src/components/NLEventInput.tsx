import React, {useState, useMemo, useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useTheme} from '../theme/ThemeContext';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {parseEventText, ParsedEvent} from '../utils/eventParser';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fired when the user confirms a successfully-parsed event. */
  onParsed: (parsed: ParsedEvent) => void;
}

const formatPreview = (p: ParsedEvent, t: (k: string) => string): string => {
  const date = `${p.startDate.getMonth() + 1}/${p.startDate.getDate()}`;
  const sH = String(p.startDate.getHours()).padStart(2, '0');
  const sM = String(p.startDate.getMinutes()).padStart(2, '0');
  const eH = String(p.endDate.getHours()).padStart(2, '0');
  const eM = String(p.endDate.getMinutes()).padStart(2, '0');
  const titleText = p.title || t('noTitle');
  return `${date}  ${sH}:${sM} 〜 ${eH}:${eM}\n${titleText}`;
};

const NLEventInput: React.FC<Props> = ({visible, onClose, onParsed}) => {
  const {t} = useTranslation();
  const {colors} = useTheme();
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? parseEventText(text) : null), [text]);

  useEffect(() => {
    if (!visible) setText('');
  }, [visible]);

  const handleSubmit = () => {
    if (!parsed) return;
    Keyboard.dismiss();
    onParsed(parsed);
  };

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kbWrap}>
        <TouchableOpacity
          style={[styles.backdrop, {backgroundColor: 'rgba(0,0,0,0.5)'}]}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={[styles.sheet, {backgroundColor: colors.surface}]}>
          <View style={styles.header}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
              <Text style={[styles.title, {color: colors.text}]}>{t('nlEventTitle')}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, {color: colors.textTertiary}]}>{t('nlEventHint')}</Text>
          <TextInput
            style={[
              styles.input,
              {color: colors.text, backgroundColor: colors.inputBackground},
            ]}
            value={text}
            onChangeText={setText}
            placeholder={t('nlEventPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            autoFocus
            multiline
            returnKeyType="done"
            blurOnSubmit
          />
          <View style={styles.previewBox}>
            {parsed ? (
              <>
                <Text style={[styles.previewLabel, {color: colors.textSecondary}]}>
                  {t('nlEventPreview')}
                </Text>
                <Text style={[styles.previewText, {color: colors.text}]}>
                  {formatPreview(parsed, t)}
                </Text>
              </>
            ) : text.trim().length > 0 ? (
              <Text style={[styles.error, {color: colors.error}]}>{t('nlEventError')}</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              {backgroundColor: parsed ? colors.primary : colors.disabled},
            ]}
            disabled={!parsed}
            onPress={handleSubmit}>
            <Text style={[styles.submitText, {color: colors.onPrimary}]}>
              {t('next')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  kbWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    padding: 20,
    paddingBottom: 32,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    marginBottom: 12,
  },
  input: {
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    minHeight: 60,
    maxHeight: 140,
    textAlignVertical: 'top',
  },
  previewBox: {
    minHeight: 56,
    marginTop: 12,
  },
  previewLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  previewText: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  },
  error: {
    fontSize: 12,
  },
  submitBtn: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default NLEventInput;
