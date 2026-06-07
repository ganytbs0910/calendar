import React from 'react';
import {Modal, View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useTheme} from '../theme/ThemeContext';
import {getPlatformLabel} from '../services/versionCheckService';

interface UpdateAvailableModalProps {
  visible: boolean;
  currentVersion?: string;
  latestVersion?: string;
  onUpdate: () => void;
  onDismiss: () => void;
}

export const UpdateAvailableModal: React.FC<UpdateAvailableModalProps> = ({
  visible,
  currentVersion,
  latestVersion,
  onUpdate,
  onDismiss,
}) => {
  const {t} = useTranslation();
  const {colors} = useTheme();
  const store = getPlatformLabel();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, {backgroundColor: colors.surface}]}>
          <View style={[styles.iconWrap, {backgroundColor: colors.surfaceSecondary}]}>
            <Ionicons name="cloud-download-outline" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.title, {color: colors.text}]}>{t('updateAvailableTitle')}</Text>
          <Text style={[styles.message, {color: colors.textSecondary}]}>
            {t('updateAvailableMessage', {store})}
          </Text>
          {(currentVersion || latestVersion) && (
            <View style={[styles.versionRow, {borderColor: colors.border}]}>
              {currentVersion ? (
                <View style={styles.versionCell}>
                  <Text style={[styles.versionLabel, {color: colors.textTertiary}]}>
                    {t('updateVersionCurrent')}
                  </Text>
                  <Text style={[styles.versionValue, {color: colors.text}]}>{currentVersion}</Text>
                </View>
              ) : null}
              {latestVersion ? (
                <View style={styles.versionCell}>
                  <Text style={[styles.versionLabel, {color: colors.textTertiary}]}>
                    {t('updateVersionLatest')}
                  </Text>
                  <Text style={[styles.versionValue, {color: colors.primary}]}>{latestVersion}</Text>
                </View>
              ) : null}
            </View>
          )}
          <TouchableOpacity
            style={[styles.primaryBtn, {backgroundColor: colors.primary}]}
            onPress={onUpdate}>
            <Text style={styles.primaryBtnText}>{t('updateNow')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onDismiss}>
            <Text style={[styles.secondaryBtnText, {color: colors.textSecondary}]}>
              {t('updateLater')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    paddingTop: 28,
    paddingBottom: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  versionRow: {
    flexDirection: 'row',
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginBottom: 20,
    paddingVertical: 10,
  },
  versionCell: {
    flex: 1,
    alignItems: 'center',
  },
  versionLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  versionValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 12,
    marginTop: 4,
  },
  secondaryBtnText: {
    fontSize: 14,
  },
});

export default UpdateAvailableModal;
