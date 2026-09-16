import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGame, friendCountLabel } from '../game/GameContext';
import { colors } from '../theme';

export function TitleScreen() {
  const { save, setScreen, resetGame } = useGame();

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>DUEL PACT</Text>
      <Text style={styles.sub}>Offline personal prototype · DM + GX one world</Text>

      {save ? (
        <>
          <Text style={styles.saveInfo}>
            Welcome back, {save.playerName} · {friendCountLabel(save)}
          </Text>
          <Pressable style={styles.primary} onPress={() => setScreen('hub')}>
            <Text style={styles.primaryText}>Continue</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={resetGame}>
            <Text style={styles.secondaryText}>New Game</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.primary} onPress={() => setScreen('create')}>
          <Text style={styles.primaryText}>Create Duelist</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  brand: {
    color: colors.gold,
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 2,
  },
  sub: {
    color: colors.muted,
    marginTop: 8,
    marginBottom: 36,
    textAlign: 'center',
  },
  saveInfo: {
    color: colors.cream,
    marginBottom: 16,
  },
  primary: {
    backgroundColor: colors.gold,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
    minWidth: 220,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 16,
  },
  secondary: {
    borderColor: colors.muted,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 220,
    alignItems: 'center',
  },
  secondaryText: {
    color: colors.cream,
    fontWeight: '600',
  },
});
