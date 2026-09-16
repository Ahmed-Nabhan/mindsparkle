import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useGame } from '../game/GameContext';
import { colors } from '../theme';

export function PhoneModal() {
  const { phoneOpen, setPhoneOpen, incomingMission, startRescue, save } = useGame();

  return (
    <Modal visible={phoneOpen} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.phone}>
          <Text style={styles.notch}>DUEL PHONE</Text>
          <Text style={styles.header}>{save?.playerName}'s messages</Text>

          {incomingMission ? (
            <View style={styles.message}>
              <Text style={styles.from}>SOS · {incomingMission.friendName}</Text>
              <Text style={styles.body}>{incomingMission.phoneMessage}</Text>
              <Text style={styles.loc}>{incomingMission.location}</Text>
              <Pressable style={styles.accept} onPress={() => startRescue(incomingMission.id)}>
                <Text style={styles.acceptText}>Accept Rescue</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.empty}>Inbox clear. No one needs help right now.</Text>
          )}

          <Pressable style={styles.close} onPress={() => setPhoneOpen(false)}>
            <Text style={styles.closeText}>Close Phone</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 24,
  },
  phone: {
    backgroundColor: '#111820',
    borderRadius: 28,
    padding: 20,
    borderWidth: 3,
    borderColor: '#2C3948',
    minHeight: 420,
  },
  notch: {
    alignSelf: 'center',
    color: colors.muted,
    marginBottom: 12,
    letterSpacing: 2,
    fontSize: 12,
  },
  header: { color: colors.cream, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  message: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
  },
  from: { color: colors.danger, fontWeight: '800' },
  body: { color: colors.text, marginTop: 8, lineHeight: 20 },
  loc: { color: colors.accent, marginTop: 8 },
  accept: {
    marginTop: 14,
    backgroundColor: colors.gold,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  acceptText: { color: colors.bg, fontWeight: '800' },
  empty: { color: colors.muted, marginTop: 24 },
  close: { marginTop: 'auto', paddingTop: 24, alignItems: 'center' },
  closeText: { color: colors.muted, fontWeight: '600' },
});
