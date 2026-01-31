import React, { useEffect } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { config } from '../constants/config';
import type { RootStackScreenProps } from '../navigation/types';

type WelcomeScreenProps = RootStackScreenProps<'Welcome'>;

export const WelcomeScreen: React.FC = () => {
  const navigation = useNavigation<WelcomeScreenProps['navigation']>();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('Main');
    }, config.animation.welcomeScreenDuration);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/splash.png')}
        style={styles.splash}
        resizeMode="cover"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splash: {
    width: '100%',
    height: '100%',
  },
});
