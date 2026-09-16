import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getCard } from '../data/cards';
import { useGame } from '../game/GameContext';
import {
  attack,
  canOfferCallOfDragon,
  createDuel,
  endPlayerTurn,
  fieldLabel,
  playMonsterFromHand,
  playSpellTrap,
  summonCallOfDragon,
  useCallOfDragonBreak,
} from '../game/duelEngine';
import { colors } from '../theme';

export function DuelScreen() {
  const {
    save,
    duel,
    setDuel,
    duelContext,
    activeMission,
    finishDuelWin,
    finishDuelLose,
    setScreen,
  } = useGame();

  useEffect(() => {
    if (!save || duel) return;
    if (duelContext === 'practice') {
      setDuel(
        createDuel(save.deck, ['thug_beater', 'thug_bruiser', 'beaver_warrior', 'mystical_elf']),
      );
    }
  }, [save, duel, duelContext, setDuel]);

  if (!save || !duel) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Preparing duel...</Text>
      </View>
    );
  }

  const enemyName =
    duelContext === 'egypt'
      ? 'Sealed Guardian'
      : duelContext === 'rescue' && activeMission
        ? activeMission.enemyName
        : 'Practice Opponent';

  const offerDragon = canOfferCallOfDragon(duel, save.callOfDragonOwned);
  const controllingDragon = duel.playerField?.cardId === 'call_of_dragon';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>DUEL</Text>
      <Text style={styles.sub}>vs {enemyName}</Text>
      <Text style={styles.lp}>
        You {duel.playerLp} LP · Enemy {duel.enemyLp} LP
      </Text>
      <Text style={styles.turn}>{duel.turn === 'player' ? 'Your turn' : 'Enemy turn'}</Text>

      <View style={styles.fieldBox}>
        <Text style={styles.fieldLabel}>Enemy field</Text>
        <Text style={styles.fieldValue}>{fieldLabel(duel.enemyField)}</Text>
        <Text style={styles.muted}>
          ST: {duel.enemySpellTraps.length ? duel.enemySpellTraps.map((id) => getCard(id).name).join(', ') : 'None'}
        </Text>
      </View>

      <View style={styles.fieldBox}>
        <Text style={styles.fieldLabel}>Your field</Text>
        <Text style={styles.fieldValue}>{fieldLabel(duel.playerField)}</Text>
        <Text style={styles.muted}>
          ST: {duel.playerSpellTraps.length ? duel.playerSpellTraps.map((id) => getCard(id).name).join(', ') : 'None'}
        </Text>
      </View>

      {offerDragon ? (
        <Pressable style={styles.dragonBtn} onPress={() => setDuel(summonCallOfDragon(duel))}>
          <Text style={styles.dragonText}>Summon Call of Dragon</Text>
        </Pressable>
      ) : null}

      {controllingDragon ? (
        <Pressable style={styles.secondary} onPress={() => setDuel(useCallOfDragonBreak(duel))}>
          <Text style={styles.secondaryText}>Destroy 1 Spell/Trap</Text>
        </Pressable>
      ) : null}

      <Text style={styles.section}>Hand</Text>
      {duel.playerHand.map((cardId, index) => {
        const card = getCard(cardId);
        return (
          <Pressable
            key={`${cardId}-${index}`}
            style={styles.cardRow}
            disabled={!!duel.winner || duel.turn !== 'player'}
            onPress={() =>
              setDuel(
                card.type === 'Monster'
                  ? playMonsterFromHand(duel, cardId)
                  : playSpellTrap(duel, cardId),
              )
            }
          >
            <Text style={styles.cardName}>{card.name}</Text>
            <Text style={styles.cardMeta}>
              {card.type === 'Monster' ? `${card.atk}/${card.def}` : card.type}
            </Text>
          </Pressable>
        );
      })}

      {!duel.winner && duel.turn === 'player' ? (
        <View style={styles.actions}>
          <Pressable style={styles.primary} onPress={() => setDuel(attack(duel))}>
            <Text style={styles.primaryText}>Attack</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setDuel(endPlayerTurn(duel))}>
            <Text style={styles.secondaryText}>End Turn</Text>
          </Pressable>
        </View>
      ) : null}

      {duel.winner === 'player' ? (
        <Pressable style={styles.primary} onPress={finishDuelWin}>
          <Text style={styles.primaryText}>Collect Rewards</Text>
        </Pressable>
      ) : null}
      {duel.winner === 'enemy' ? (
        <Pressable style={styles.danger} onPress={finishDuelLose}>
          <Text style={styles.primaryText}>Return to Hub</Text>
        </Pressable>
      ) : null}

      <Text style={styles.section}>Battle Log</Text>
      {[...duel.log].slice(-8).map((line, i) => (
        <Text key={`${line}-${i}`} style={styles.log}>
          • {line}
        </Text>
      ))}

      {!duel.winner ? (
        <Pressable
          onPress={() => {
            setDuel(null);
            setScreen('hub');
          }}
        >
          <Text style={styles.back}>Flee (no reward)</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: colors.gold, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.cream, marginTop: 4 },
  lp: { color: colors.text, marginTop: 8, fontWeight: '700' },
  turn: { color: colors.accent, marginBottom: 12 },
  fieldBox: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  fieldLabel: { color: colors.muted, marginBottom: 4 },
  fieldValue: { color: colors.cream, fontWeight: '700', fontSize: 16 },
  muted: { color: colors.muted, marginTop: 4 },
  section: { color: colors.gold, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  cardRow: {
    backgroundColor: colors.bgAlt,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardName: { color: colors.cream, fontWeight: '700' },
  cardMeta: { color: colors.muted },
  actions: { gap: 8, marginTop: 8 },
  primary: {
    backgroundColor: colors.gold,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: colors.bg, fontWeight: '800' },
  secondary: {
    borderWidth: 1,
    borderColor: colors.muted,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryText: { color: colors.cream, fontWeight: '700' },
  dragonBtn: {
    backgroundColor: '#5B1E1E',
    borderColor: colors.gold,
    borderWidth: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  dragonText: { color: colors.gold, fontWeight: '800' },
  danger: {
    backgroundColor: colors.danger,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  log: { color: colors.muted, marginBottom: 4 },
  back: { color: colors.muted, textAlign: 'center', marginTop: 16 },
});
