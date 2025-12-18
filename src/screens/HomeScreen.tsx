import React from 'react';
import { View, Text, StyleSheet, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Button } from '../components/Button';
import type { MainDrawerScreenProps } from '../navigation/types';

type HomeScreenProps = MainDrawerScreenProps<'Home'>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeScreenProps['navigation']>();

  const handleGetStarted = () => {
    navigation.navigate('Upload');
  };

  return (
    <View style={styles.container}>
      {/* Background with tech/sparkle theme */}
      <View style={styles.backgroundOverlay} />
      
      <View style={styles.content}>
        <Text style={styles.sparkle}>✨</Text>
        <Text style={styles.title}>{strings.home.title}</Text>
        <Text style={styles.description}>{strings.home.description}</Text>
        
        <Button
          title={strings.home.getStarted}
          onPress={handleGetStarted}
          style={styles.button}
        />
      </View>

      {/* Decorative elements */}
      <View style={styles.decorativeCircle1} />
      <View style={styles.decorativeCircle2} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.primary,
    opacity: 0.95,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 1,
  },
  sparkle: {
    fontSize: 80,
    marginBottom: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  description: {
    fontSize: 18,
    color: '#FFFFFF',
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 48,
  },
  button: {
    minWidth: 200,
    backgroundColor: colors.accent,
  },
  decorativeCircle1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.secondary,
    opacity: 0.1,
    top: -50,
    left: -50,
  },
  decorativeCircle2: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.accent,
    opacity: 0.1,
    bottom: 50,
    right: -30,
  },
});
