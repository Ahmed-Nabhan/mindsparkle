import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GameProvider, useGame } from './src/game/GameContext';
import { CreateCharacterScreen } from './src/screens/CreateCharacterScreen';
import { DuelScreen } from './src/screens/DuelScreen';
import { EgyptScreen } from './src/screens/EgyptScreen';
import { FriendsScreen } from './src/screens/FriendsScreen';
import { HubScreen } from './src/screens/HubScreen';
import { PhoneModal } from './src/screens/PhoneModal';
import { RescueScreen } from './src/screens/RescueScreen';
import { ShopScreen } from './src/screens/ShopScreen';
import { TitleScreen } from './src/screens/TitleScreen';
import { colors } from './src/theme';

function RootNavigator() {
  const { ready, screen } = useGame();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'title' && <TitleScreen />}
      {screen === 'create' && <CreateCharacterScreen />}
      {screen === 'hub' && <HubScreen />}
      {screen === 'friends' && <FriendsScreen />}
      {screen === 'shop' && <ShopScreen />}
      {screen === 'rescue' && <RescueScreen />}
      {screen === 'duel' && <DuelScreen />}
      {screen === 'egypt' && <EgyptScreen />}
      <PhoneModal />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <GameProvider>
        <RootNavigator />
      </GameProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
