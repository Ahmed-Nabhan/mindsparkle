import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getCard } from '../data/cards';
import { SHOPS } from '../data/shops';
import { useGame } from '../game/GameContext';
import { colors } from '../theme';

export function ShopScreen() {
  const { save, setScreen, buyCard } = useGame();
  const [message, setMessage] = useState('');

  if (!save) return null;

  const shopKey = save.district === 'academy' ? 'academy' : 'domino';
  const shop = SHOPS[shopKey];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{shop.name}</Text>
      <Text style={styles.meta}>{save.coins} coins · Call of Dragon never sold here</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {shop.inventory.map((item) => {
        const card = getCard(item.cardId);
        return (
          <View key={item.cardId} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                {card.type === 'Monster' ? `${card.atk}/${card.def}` : card.type} · {item.price} coins
              </Text>
            </View>
            <Pressable
              style={styles.buy}
              onPress={async () => {
                const err = await buyCard(item.cardId, item.price);
                setMessage(err ?? `Bought ${card.name}!`);
              }}
            >
              <Text style={styles.buyText}>Buy</Text>
            </Pressable>
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
  meta: { color: colors.muted, marginBottom: 12, marginTop: 4 },
  message: { color: colors.success, marginBottom: 10, fontWeight: '600' },
  row: {
    backgroundColor: colors.panel,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardName: { color: colors.cream, fontWeight: '700' },
  cardMeta: { color: colors.muted, marginTop: 4 },
  buy: {
    backgroundColor: colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buyText: { color: colors.bg, fontWeight: '800' },
  back: { color: colors.muted, textAlign: 'center', marginTop: 16 },
});
