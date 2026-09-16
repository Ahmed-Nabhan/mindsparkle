import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { STARTER_DECKS } from '../data/cards';
import { getMission, getNextMission, MISSIONS } from '../data/missions';
import { clearSave, loadSave, writeSave } from '../storage';
import { District, DuelState, GameSave, MissionDef, ScreenId } from '../types';

interface GameContextValue {
  ready: boolean;
  save: GameSave | null;
  screen: ScreenId;
  activeMission: MissionDef | null;
  duel: DuelState | null;
  duelContext: 'rescue' | 'egypt' | 'practice' | null;
  phoneOpen: boolean;
  setScreen: (s: ScreenId) => void;
  setPhoneOpen: (open: boolean) => void;
  createCharacter: (name: string, district: Exclude<District, 'egypt'>) => Promise<void>;
  resetGame: () => Promise<void>;
  travelTo: (district: District) => Promise<void>;
  startRescue: (missionId?: string) => void;
  startEgyptQuest: () => void;
  startPracticeDuel: () => void;
  setDuel: React.Dispatch<React.SetStateAction<DuelState | null>>;
  finishDuelWin: () => Promise<void>;
  finishDuelLose: () => void;
  buyCard: (cardId: string, price: number) => Promise<string | null>;
  incomingMission: MissionDef | null;
  debugUnlockAll: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

function nowIso() {
  return new Date().toISOString();
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [save, setSave] = useState<GameSave | null>(null);
  const [screen, setScreen] = useState<ScreenId>('title');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [activeMission, setActiveMission] = useState<MissionDef | null>(null);
  const [duel, setDuel] = useState<DuelState | null>(null);
  const [duelContext, setDuelContext] = useState<'rescue' | 'egypt' | 'practice' | null>(null);

  useEffect(() => {
    (async () => {
      const existing = await loadSave();
      if (existing) {
        setSave(existing);
        setScreen('hub');
      }
      setReady(true);
    })();
  }, []);

  const persist = async (next: GameSave) => {
    setSave(next);
    await writeSave(next);
  };

  const incomingMission = useMemo(() => {
    if (!save) return null;
    return getNextMission(save.completedMissions);
  }, [save]);

  const createCharacter = async (name: string, district: Exclude<District, 'egypt'>) => {
    const starter = [...STARTER_DECKS[district]];
    const next: GameSave = {
      version: 1,
      playerName: name.trim() || 'Duelist',
      district,
      coins: 500,
      friends: [],
      completedMissions: [],
      collection: [...starter],
      deck: [...starter],
      callOfDragonOwned: false,
      egyptCompleted: false,
      villainHuntUnlocked: false,
      egyptAccessUnlocked: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await persist(next);
    setScreen('hub');
  };

  const resetGame = async () => {
    await clearSave();
    setSave(null);
    setActiveMission(null);
    setDuel(null);
    setDuelContext(null);
    setPhoneOpen(false);
    setScreen('title');
  };

  const travelTo = async (district: District) => {
    if (!save) return;
    if (district === 'egypt' && !save.egyptAccessUnlocked) return;
    await persist({ ...save, district });
  };

  const startRescue = (missionId?: string) => {
    if (!save) return;
    const mission = missionId ? getMission(missionId) : getNextMission(save.completedMissions);
    if (!mission) return;
    setActiveMission(mission);
    setDuelContext('rescue');
    setPhoneOpen(false);
    setScreen('rescue');
  };

  const startEgyptQuest = () => {
    if (!save?.egyptAccessUnlocked || save.egyptCompleted) return;
    setActiveMission(null);
    setDuelContext('egypt');
    setScreen('egypt');
  };

  const startPracticeDuel = () => {
    setActiveMission(null);
    setDuelContext('practice');
    setScreen('duel');
  };

  const finishDuelWin = async () => {
    if (!save) return;

    if (duelContext === 'egypt') {
      const next: GameSave = {
        ...save,
        coins: save.coins + 1000,
        callOfDragonOwned: true,
        egyptCompleted: true,
        collection: save.collection.includes('call_of_dragon')
          ? save.collection
          : [...save.collection, 'call_of_dragon'],
        deck: save.deck.includes('call_of_dragon')
          ? save.deck
          : [...save.deck, 'call_of_dragon'],
      };
      await persist(next);
      setDuel(null);
      setDuelContext(null);
      setScreen('hub');
      return;
    }

    if (duelContext === 'rescue' && activeMission) {
      const friends = save.friends.includes(activeMission.friendId)
        ? save.friends
        : [...save.friends, activeMission.friendId];
      const completedMissions = save.completedMissions.includes(activeMission.id)
        ? save.completedMissions
        : [...save.completedMissions, activeMission.id];
      let collection = [...save.collection];
      let deck = [...save.deck];
      if (activeMission.rewardCardId && !collection.includes(activeMission.rewardCardId)) {
        collection.push(activeMission.rewardCardId);
        deck.push(activeMission.rewardCardId);
      }
      const next: GameSave = {
        ...save,
        friends,
        completedMissions,
        collection,
        deck,
        coins: save.coins + activeMission.rewardCoins,
        villainHuntUnlocked:
          save.villainHuntUnlocked || !!activeMission.unlocksVillainHunt || friends.length >= 10,
        egyptAccessUnlocked:
          save.egyptAccessUnlocked || !!activeMission.unlocksEgypt || friends.length >= 10,
      };
      await persist(next);
      setActiveMission(null);
      setDuel(null);
      setDuelContext(null);
      setScreen('hub');
      return;
    }

    // practice
    await persist({ ...save, coins: save.coins + 100 });
    setDuel(null);
    setDuelContext(null);
    setScreen('hub');
  };

  const finishDuelLose = () => {
    setDuel(null);
    setDuelContext(null);
    setActiveMission(null);
    setScreen('hub');
  };

  const buyCard = async (cardId: string, price: number) => {
    if (!save) return 'No save loaded.';
    if (cardId === 'call_of_dragon') return 'Call of Dragon cannot be bought.';
    if (save.coins < price) return 'Not enough coins.';
    const next: GameSave = {
      ...save,
      coins: save.coins - price,
      collection: [...save.collection, cardId],
      deck: [...save.deck, cardId],
    };
    await persist(next);
    return null;
  };

  const debugUnlockAll = async () => {
    if (!save) return;
    const allFriends = MISSIONS.map((m) => m.friendId);
    const allMissions = MISSIONS.map((m) => m.id);
    await persist({
      ...save,
      friends: allFriends,
      completedMissions: allMissions,
      coins: Math.max(save.coins, 5000),
      villainHuntUnlocked: true,
      egyptAccessUnlocked: true,
    });
  };

  const value: GameContextValue = {
    ready,
    save,
    screen,
    activeMission,
    duel,
    duelContext,
    phoneOpen,
    setScreen,
    setPhoneOpen,
    createCharacter,
    resetGame,
    travelTo,
    startRescue,
    startEgyptQuest,
    startPracticeDuel,
    setDuel,
    finishDuelWin,
    finishDuelLose,
    buyCard,
    incomingMission,
    debugUnlockAll,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}

export function friendCountLabel(save: GameSave | null) {
  return `${save?.friends.length ?? 0}/10 friends`;
}

export function missionProgressLabel(save: GameSave | null) {
  return `${save?.completedMissions.length ?? 0}/${MISSIONS.length} rescues`;
}
