import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGame } from '../game/GameContext';
import { createDuel } from '../game/duelEngine';
import { colors } from '../theme';

export function EgyptScreen() {
  const { save, setScreen, setDuel } = useGame();

  if (!save) return null;

  if (save.egyptCompleted) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Chamber claimed</Text>
        <Text style={styles.body}>Call of Dragon is already yours. No one else can obtain it.</Text>
        <Pressable onPress={() => setScreen('hub')}>
          <Text style={styles.back}>Back to hub</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>EGYPT · VALLEY OF THE SEALED</Text>
      <Text style={styles.title}>Call of Dragon</Text>
      <Text style={styles.body}>
        The Trial of Bonds recognizes your {save.friends.length} friends. Defeat the Sealed
        Guardian to claim the exclusive card: 10000/10000, cannot be destroyed, +1000 ATK per
        battle destroy.
      </Text>
      <Pressable
        style={styles.primary}
        onPress={() => {
          setDuel(
            createDuel(save.deck, [
              'sealed_guardian',
              'thug_bruiser',
              'dark_magician',
              'mirror_force',
              'blue_eyes_white_dragon',
            ], 5000),
          );
          setScreen('duel');
        }}
      >
        <Text style={styles.primaryText}>Duel Sealed Guardian</Text>
      </Pressable>
      <Pressable onPress={() => setScreen('hub')}>
        <Text style={styles.back}>Leave Egypt</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1B140A',
    padding: 24,
    justifyContent: 'center',
  },
  eyebrow: { color: colors.egypt, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.gold, fontSize: 30, fontWeight: '800', marginTop: 8 },
  body: { color: colors.cream, marginTop: 16, lineHeight: 22, marginBottom: 24 },
  primary: {
    backgroundColor: colors.egypt,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontWeight: '800' },
  back: { color: colors.muted, textAlign: 'center', marginTop: 16 },
});
