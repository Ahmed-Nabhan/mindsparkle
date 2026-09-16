import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGame, friendCountLabel, missionProgressLabel } from '../game/GameContext';
import { colors } from '../theme';

export function HubScreen() {
  const {
    save,
    setScreen,
    setPhoneOpen,
    travelTo,
    startRescue,
    startEgyptQuest,
    startPracticeDuel,
    incomingMission,
    debugUnlockAll,
  } = useGame();

  if (!save) return null;

  const districtLabel =
    save.district === 'domino'
      ? 'Domino City'
      : save.district === 'academy'
        ? 'Duel Academy'
        : 'Egypt · Valley of the Sealed';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>DUEL PACT</Text>
      <Text style={styles.hello}>
        {save.playerName} · {districtLabel}
      </Text>
      <Text style={styles.meta}>
        {friendCountLabel(save)} · {missionProgressLabel(save)} · {save.coins} coins
      </Text>

      {incomingMission ? (
        <Pressable style={styles.alert} onPress={() => setPhoneOpen(true)}>
          <Text style={styles.alertTitle}>Phone alert</Text>
          <Text style={styles.alertBody}>{incomingMission.phoneMessage}</Text>
          <Text style={styles.alertCta}>Open phone</Text>
        </Pressable>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.panelText}>No new rescue alerts. All current friends are safe.</Text>
        </View>
      )}

      <Text style={styles.section}>Travel</Text>
      <View style={styles.row}>
        <Pressable style={styles.chip} onPress={() => travelTo('domino')}>
          <Text style={styles.chipText}>Domino</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => travelTo('academy')}>
          <Text style={styles.chipText}>Academy</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, !save.egyptAccessUnlocked && styles.chipDisabled]}
          onPress={() => travelTo('egypt')}
        >
          <Text style={styles.chipText}>Egypt</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Actions</Text>
      <Pressable style={styles.primary} onPress={() => setPhoneOpen(true)}>
        <Text style={styles.primaryText}>Phone</Text>
      </Pressable>
      {incomingMission ? (
        <Pressable style={styles.primary} onPress={() => startRescue()}>
          <Text style={styles.primaryText}>Start Rescue</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.secondary} onPress={() => setScreen('shop')}>
        <Text style={styles.secondaryText}>Card Shop</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => setScreen('friends')}>
        <Text style={styles.secondaryText}>Friends List</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={startPracticeDuel}>
        <Text style={styles.secondaryText}>Practice Duel</Text>
      </Pressable>
      {save.egyptAccessUnlocked && !save.egyptCompleted ? (
        <Pressable style={[styles.primary, styles.egypt]} onPress={startEgyptQuest}>
          <Text style={styles.primaryText}>Egypt Quest · Call of Dragon</Text>
        </Pressable>
      ) : null}
      {save.callOfDragonOwned ? (
        <View style={styles.owned}>
          <Text style={styles.ownedText}>Call of Dragon secured. Player exclusive.</Text>
        </View>
      ) : null}
      {save.villainHuntUnlocked ? (
        <View style={styles.owned}>
          <Text style={styles.ownedText}>Villain Hunt unlocked (10 friends).</Text>
        </View>
      ) : null}

      <Pressable style={styles.debug} onPress={debugUnlockAll}>
        <Text style={styles.debugText}>Debug: unlock 10 friends + Egypt</Text>
      </Pressable>

      <Pressable onPress={() => setScreen('title')}>
        <Text style={styles.back}>Title Screen</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  brand: { color: colors.gold, fontSize: 28, fontWeight: '800' },
  hello: { color: colors.cream, marginTop: 6, fontSize: 16 },
  meta: { color: colors.muted, marginTop: 4, marginBottom: 16 },
  alert: {
    backgroundColor: '#2A1E14',
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  alertTitle: { color: colors.gold, fontWeight: '800' },
  alertBody: { color: colors.cream, marginTop: 6 },
  alertCta: { color: colors.accent, marginTop: 8, fontWeight: '700' },
  panel: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  panelText: { color: colors.muted },
  section: {
    color: colors.gold,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    backgroundColor: colors.panel,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: colors.cream, fontWeight: '600' },
  primary: {
    backgroundColor: colors.gold,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  egypt: { backgroundColor: colors.egypt },
  primaryText: { color: colors.bg, fontWeight: '800' },
  secondary: {
    borderWidth: 1,
    borderColor: colors.muted,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryText: { color: colors.cream, fontWeight: '700' },
  owned: {
    backgroundColor: colors.panel,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  ownedText: { color: colors.success, fontWeight: '600' },
  back: { color: colors.muted, textAlign: 'center', marginTop: 12 },
  debug: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5A3A3A',
    alignItems: 'center',
  },
  debugText: { color: '#C98888', fontWeight: '600', fontSize: 12 },
});
