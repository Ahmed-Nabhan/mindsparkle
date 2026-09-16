import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MISSIONS } from '../data/missions';
import { useGame } from '../game/GameContext';
import { colors } from '../theme';

export function FriendsScreen() {
  const { save, setScreen } = useGame();
  if (!save) return null;

  const friendSet = new Set(save.friends);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Friends</Text>
      <Text style={styles.meta}>{save.friends.length}/10 · Rescue to unlock more</Text>

      {MISSIONS.map((m) => {
        const unlocked = friendSet.has(m.friendId);
        return (
          <View key={m.id} style={[styles.row, unlocked && styles.rowOn]}>
            <Text style={styles.name}>
              {unlocked ? '✓ ' : '○ '}
              {m.friendName}
            </Text>
            <Text style={styles.sub}>
              {unlocked ? 'Friend' : `Mission: ${m.location}`}
            </Text>
          </View>
        );
      })}

      <Pressable onPress={() => setScreen('hub')}>
        <Text style={styles.back}>Back to hub</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: colors.gold, fontSize: 26, fontWeight: '800' },
  meta: { color: colors.muted, marginBottom: 14, marginTop: 4 },
  row: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    opacity: 0.7,
  },
  rowOn: { opacity: 1, borderColor: colors.success, borderWidth: 1 },
  name: { color: colors.cream, fontWeight: '700' },
  sub: { color: colors.muted, marginTop: 4 },
  back: { color: colors.muted, textAlign: 'center', marginTop: 16 },
});
