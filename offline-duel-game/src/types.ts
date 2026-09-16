export type District = 'domino' | 'academy' | 'egypt';

export type CardType = 'Monster' | 'Spell' | 'Trap';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  atk?: number;
  def?: number;
  level?: number;
  era?: 'dm' | 'gx' | 'both' | 'unique';
  rarity: 'common' | 'rare' | 'unique';
  exclusiveToPlayer?: boolean;
  cannotBeDestroyed?: boolean;
  description: string;
}

export interface ShopItem {
  cardId: string;
  price: number;
}

export interface MissionDef {
  id: string;
  friendId: string;
  friendName: string;
  order: number;
  district: District;
  location: string;
  phoneMessage: string;
  rewardCoins: number;
  rewardCardId?: string;
  enemyName: string;
  enemyDeck: string[];
  enemyLp?: number;
  unlocksVillainHunt?: boolean;
  unlocksEgypt?: boolean;
}

export interface FieldMonster {
  instanceId: string;
  cardId: string;
  atk: number;
  def: number;
  position: 'atk' | 'def';
  bonusAtk: number;
  cannotBeDestroyed?: boolean;
}

export interface DuelState {
  playerLp: number;
  enemyLp: number;
  turn: 'player' | 'enemy';
  playerHand: string[];
  enemyHand: string[];
  playerField: FieldMonster | null;
  enemyField: FieldMonster | null;
  playerSpellTraps: string[];
  enemySpellTraps: string[];
  normalSummonUsed: boolean;
  log: string[];
  winner: 'player' | 'enemy' | null;
  callOfDragonUsedThisDuel: boolean;
}

export interface GameSave {
  version: 1;
  playerName: string;
  district: District;
  coins: number;
  friends: string[];
  completedMissions: string[];
  collection: string[];
  deck: string[];
  callOfDragonOwned: boolean;
  egyptCompleted: boolean;
  villainHuntUnlocked: boolean;
  egyptAccessUnlocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ScreenId =
  | 'title'
  | 'create'
  | 'hub'
  | 'friends'
  | 'shop'
  | 'rescue'
  | 'duel'
  | 'egypt'
  | 'phone';
