import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useGame } from '../game/GameContext';
import { colors } from '../theme';
import { District } from '../types';

export function CreateCharacterScreen() {
  const { createCharacter, setScreen } = useGame();
  const [name, setName] = useState('');
  const [district, setDistrict] = useState<Exclude<District, 'egypt'>>('domino');

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Create Your Duelist</Text>
      <TextInput
        style={styles.input}
        placeholder="Your name"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Starting district</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.choice, district === 'domino' && styles.choiceOn]}
          onPress={() => setDistrict('domino')}
        >
          <Text style={styles.choiceText}>Domino City</Text>
          <Text style={styles.choiceSub}>Duel Monsters vibe</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, district === 'academy' && styles.choiceOn]}
          onPress={() => setDistrict('academy')}
        >
          <Text style={styles.choiceText}>Duel Academy</Text>
          <Text style={styles.choiceSub}>GX vibe</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.primary}
        onPress={() => createCharacter(name, district)}
      >
        <Text style={styles.primaryText}>Enter the World</Text>
      </Pressable>
      <Pressable onPress={() => setScreen('title')}>
        <Text style={styles.back}>Back</Text>
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
  title: {
    color: colors.gold,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 20,
  },
  input: {
    backgroundColor: colors.panel,
    color: colors.text,
    borderRadius: 10,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.bgAlt,
  },
  label: {
    color: colors.muted,
    marginBottom: 10,
  },
  row: { gap: 12, marginBottom: 24 },
  choice: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  choiceOn: { borderColor: colors.gold },
  choiceText: { color: colors.cream, fontWeight: '700', fontSize: 16 },
  choiceSub: { color: colors.muted, marginTop: 4 },
  primary: {
    backgroundColor: colors.gold,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontWeight: '800' },
  back: { color: colors.muted, textAlign: 'center', marginTop: 16 },
});
