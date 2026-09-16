import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGame } from '../game/GameContext';
import { createDuel } from '../game/duelEngine';
import { colors } from '../theme';

export function RescueScreen() {
  const { activeMission, save, setScreen, setDuel } = useGame();

  if (!activeMission || !save) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>No active rescue</Text>
        <Pressable onPress={() => setScreen('hub')}>
          <Text style={styles.back}>Back to hub</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>RESCUE MISSION</Text>
      <Text style={styles.title}>{activeMission.friendName}</Text>
      <Text style={styles.loc}>{activeMission.location}</Text>
      <Text style={styles.body}>{activeMission.phoneMessage}</Text>
      <Text style={styles.enemy}>Opponent: {activeMission.enemyName}</Text>
      <Text style={styles.reward}>
        Reward: {activeMission.rewardCoins} coins
        {activeMission.rewardCardId ? ' + card' : ''}
      </Text>

      <Pressable
        style={styles.primary}
        onPress={() => {
          setDuel(createDuel(save.deck, activeMission.enemyDeck, activeMission.enemyLp ?? 4000));
          setScreen('duel');
        }}
      >
        <Text style={styles.primaryText}>Start Rescue Duel</Text>
      </Pressable>
      <Pressable onPress={() => setScreen('hub')}>
        <Text style={styles.back}>Retreat to hub</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 24,
    justifyContent: 'center',
  },
  eyebrow: { color: colors.danger, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.gold, fontSize: 30, fontWeight: '800', marginTop: 8 },
  loc: { color: colors.accent, marginTop: 6 },
  body: { color: colors.cream, marginTop: 16, lineHeight: 22 },
  enemy: { color: colors.text, marginTop: 18, fontWeight: '700' },
  reward: { color: colors.muted, marginTop: 8, marginBottom: 24 },
  primary: {
    backgroundColor: colors.gold,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontWeight: '800' },
  back: { color: colors.muted, textAlign: 'center', marginTop: 16 },
});
