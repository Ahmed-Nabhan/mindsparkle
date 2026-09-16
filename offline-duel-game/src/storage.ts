import AsyncStorage from '@react-native-async-storage/async-storage';
import { GameSave } from './types';

const SAVE_KEY = 'offline_duel_save_v1';

export async function loadSave(): Promise<GameSave | null> {
  const raw = await AsyncStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameSave;
  } catch {
    return null;
  }
}

export async function writeSave(save: GameSave): Promise<void> {
  const next = { ...save, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(SAVE_KEY, JSON.stringify(next));
}

export async function clearSave(): Promise<void> {
  await AsyncStorage.removeItem(SAVE_KEY);
}
