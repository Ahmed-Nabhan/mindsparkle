import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Button } from '../components/Button';
import type { MainDrawerScreenProps } from '../navigation/types';

type HomeScreenProps = MainDrawerScreenProps<'Home'>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenProps['navigation']>();

  const handleUpload = () => {
    navigation.navigate('Upload');
  };

  const handleChat = () => {
    navigation.navigate('ChatMind');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>{strings.home.title}</Text>

        <Button
          title="Upload Document"
          onPress={handleUpload}
          style={styles.primaryButton}
        />

        <Button
          title="Chat Mind"
          onPress={handleChat}
          style={styles.chatButton}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 32,
  },
  primaryButton: {
    minWidth: 220,
    marginBottom: 14,
  },
  chatButton: {
    minWidth: 220,
  },
});
