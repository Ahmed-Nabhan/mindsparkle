import { getCard } from '../data/cards';
import { DuelState, FieldMonster } from '../types';

let instanceCounter = 0;

function uid(prefix: string) {
  instanceCounter += 1;
  return `${prefix}_${instanceCounter}`;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function monsterFromCard(cardId: string): FieldMonster {
  const card = getCard(cardId);
  return {
    instanceId: uid('m'),
    cardId,
    atk: card.atk ?? 0,
    def: card.def ?? 0,
    position: 'atk',
    bonusAtk: 0,
    cannotBeDestroyed: !!card.cannotBeDestroyed,
  };
}

function currentAtk(m: FieldMonster) {
  return m.atk + m.bonusAtk;
}

export function createDuel(playerDeck: string[], enemyDeck: string[], enemyLp = 4000): DuelState {
  const pDeck = shuffle(playerDeck);
  const eDeck = shuffle(enemyDeck);
  return {
    playerLp: 4000,
    enemyLp,
    turn: 'player',
    playerHand: pDeck.slice(0, 4),
    enemyHand: eDeck.slice(0, 4),
    playerField: null,
    enemyField: null,
    playerSpellTraps: [],
    enemySpellTraps: [],
    normalSummonUsed: false,
    log: ['Duel start! Draw your opening hand.'],
    winner: null,
    callOfDragonUsedThisDuel: false,
  };
}

export function canOfferCallOfDragon(state: DuelState, owned: boolean): boolean {
  if (!owned || state.winner || state.turn !== 'player' || state.callOfDragonUsedThisDuel) {
    return false;
  }
  if (!state.playerField) return true;
  if (!state.enemyField) return false;
  return currentAtk(state.enemyField) > currentAtk(state.playerField);
}

export function summonCallOfDragon(state: DuelState): DuelState {
  if (state.winner) return state;
  const dragon = monsterFromCard('call_of_dragon');
  return {
    ...state,
    playerField: dragon,
    callOfDragonUsedThisDuel: true,
    log: [...state.log, 'Call of Dragon descends with no tribute!'],
  };
}

export function playMonsterFromHand(state: DuelState, cardId: string): DuelState {
  if (state.winner || state.turn !== 'player' || state.normalSummonUsed) return state;
  const card = getCard(cardId);
  if (card.type !== 'Monster') return state;
  if (!state.playerHand.includes(cardId)) return state;

  // Simplified tribute: level 5+ needs existing monster tribute
  if ((card.level ?? 1) >= 5 && !state.playerField) {
    return {
      ...state,
      log: [...state.log, `${card.name} needs a tribute. Summon a weaker monster first.`],
    };
  }

  const hand = [...state.playerHand];
  hand.splice(hand.indexOf(cardId), 1);

  return {
    ...state,
    playerHand: hand,
    playerField: monsterFromCard(cardId),
    normalSummonUsed: true,
    log: [...state.log, `You summon ${card.name}!`],
  };
}

export function playSpellTrap(state: DuelState, cardId: string): DuelState {
  if (state.winner || state.turn !== 'player') return state;
  const card = getCard(cardId);
  if (card.type === 'Monster') return state;
  if (!state.playerHand.includes(cardId)) return state;

  const hand = [...state.playerHand];
  hand.splice(hand.indexOf(cardId), 1);

  if (cardId === 'monster_reborn') {
    return {
      ...state,
      playerHand: hand,
      playerLp: state.playerLp + 500,
      log: [...state.log, 'Monster Reborn (MVP): you gain 500 LP.'],
    };
  }

  if (cardId === 'mirror_force' && state.enemyField && !state.enemyField.cannotBeDestroyed) {
    return {
      ...state,
      playerHand: hand,
      enemyField: null,
      log: [...state.log, 'Mirror Force destroys the enemy monster!'],
    };
  }

  return {
    ...state,
    playerHand: hand,
    playerSpellTraps: [...state.playerSpellTraps, cardId],
    log: [...state.log, `You set/activate ${card.name}.`],
  };
}

export function useCallOfDragonBreak(state: DuelState): DuelState {
  if (state.winner || state.turn !== 'player') return state;
  if (!state.playerField || state.playerField.cardId !== 'call_of_dragon') return state;
  if (state.enemySpellTraps.length === 0) {
    return { ...state, log: [...state.log, 'No enemy Spell/Trap to destroy.'] };
  }
  const remaining = [...state.enemySpellTraps];
  const removed = remaining.pop();
  return {
    ...state,
    enemySpellTraps: remaining,
    log: [...state.log, `Call of Dragon destroys ${getCard(removed!).name}!`],
  };
}

export function attack(state: DuelState): DuelState {
  if (state.winner || state.turn !== 'player' || !state.playerField) return state;

  const attacker = state.playerField;
  const atk = currentAtk(attacker);

  if (!state.enemyField) {
    const enemyLp = Math.max(0, state.enemyLp - atk);
    const next: DuelState = {
      ...state,
      enemyLp,
      log: [...state.log, `Direct attack! Enemy takes ${atk} damage.`],
      winner: enemyLp <= 0 ? 'player' : state.winner,
    };
    return next.winner ? { ...next, log: [...next.log, 'You win the duel!'] } : next;
  }

  const defender = state.enemyField;
  const defValue = defender.position === 'def' ? defender.def : currentAtk(defender);

  if (atk > defValue) {
    const damage =
      defender.position === 'atk' ? atk - currentAtk(defender) : 0;
    const enemyLp = Math.max(0, state.enemyLp - damage);
    let playerField = attacker;
    if (attacker.cardId === 'call_of_dragon') {
      playerField = { ...attacker, bonusAtk: attacker.bonusAtk + 1000 };
    }
    const next: DuelState = {
      ...state,
      enemyField: defender.cannotBeDestroyed ? defender : null,
      enemyLp,
      playerField,
      log: [
        ...state.log,
        `Your ${getCard(attacker.cardId).name} destroys ${getCard(defender.cardId).name}!`,
        attacker.cardId === 'call_of_dragon' ? 'Call of Dragon gains +1000 ATK!' : '',
      ].filter(Boolean),
      winner: enemyLp <= 0 ? 'player' : state.winner,
    };
    return next.winner ? { ...next, log: [...next.log, 'You win the duel!'] } : next;
  }

  if (atk < defValue) {
    if (attacker.cannotBeDestroyed) {
      const playerLp = Math.max(0, state.playerLp - (defValue - atk));
      const next: DuelState = {
        ...state,
        playerLp,
        log: [
          ...state.log,
          'Call of Dragon cannot be destroyed, but you still take battle damage!',
        ],
        winner: playerLp <= 0 ? 'enemy' : state.winner,
      };
      return next.winner ? { ...next, log: [...next.log, 'You lost the duel...'] } : next;
    }
    const playerLp = Math.max(0, state.playerLp - (defValue - atk));
    const next: DuelState = {
      ...state,
      playerField: null,
      playerLp,
      log: [...state.log, 'Your monster is destroyed in battle!'],
      winner: playerLp <= 0 ? 'enemy' : state.winner,
    };
    return next.winner ? { ...next, log: [...next.log, 'You lost the duel...'] } : next;
  }

  // Equal ATK
  return {
    ...state,
    playerField: attacker.cannotBeDestroyed ? attacker : null,
    enemyField: defender.cannotBeDestroyed ? defender : null,
    log: [...state.log, 'Both monsters are destroyed in a clash!'],
  };
}

function enemyPlay(state: DuelState): DuelState {
  let next = { ...state };
  const monsterIds = next.enemyHand.filter((id) => getCard(id).type === 'Monster');
  if (!next.enemyField && monsterIds.length) {
    // Pick strongest affordable monster
    const sorted = [...monsterIds].sort(
      (a, b) => (getCard(b).atk ?? 0) - (getCard(a).atk ?? 0),
    );
    let chosen = sorted[sorted.length - 1];
    for (const id of sorted) {
      const level = getCard(id).level ?? 1;
      if (level < 5 || next.enemyField) {
        chosen = id;
        break;
      }
    }
    // If all are high level and no field, pick lowest level
    chosen =
      sorted.find((id) => (getCard(id).level ?? 1) < 5) ??
      sorted[sorted.length - 1];

    const card = getCard(chosen);
    if ((card.level ?? 1) < 5 || next.enemyField) {
      const hand = [...next.enemyHand];
      hand.splice(hand.indexOf(chosen), 1);
      next = {
        ...next,
        enemyHand: hand,
        enemyField: monsterFromCard(chosen),
        log: [...next.log, `Enemy summons ${card.name}!`],
      };
    }
  }

  // Set a trap if available
  if (next.enemyHand.includes('mirror_force') && !next.enemySpellTraps.includes('mirror_force')) {
    const hand = [...next.enemyHand];
    hand.splice(hand.indexOf('mirror_force'), 1);
    next = {
      ...next,
      enemyHand: hand,
      enemySpellTraps: [...next.enemySpellTraps, 'mirror_force'],
      log: [...next.log, 'Enemy sets a card.'],
    };
  }

  return next;
}

function enemyAttack(state: DuelState): DuelState {
  if (!state.enemyField) return state;
  const attacker = state.enemyField;
  const atk = currentAtk(attacker);

  if (!state.playerField) {
    const playerLp = Math.max(0, state.playerLp - atk);
    const next: DuelState = {
      ...state,
      playerLp,
      log: [...state.log, `Enemy direct attack for ${atk}!`],
      winner: playerLp <= 0 ? 'enemy' : state.winner,
    };
    return next.winner ? { ...next, log: [...next.log, 'You lost the duel...'] } : next;
  }

  const defender = state.playerField;
  const defAtk = currentAtk(defender);

  // Mirror Force intercept
  if (state.playerSpellTraps.includes('mirror_force') && !attacker.cannotBeDestroyed) {
    const traps = state.playerSpellTraps.filter((id) => id !== 'mirror_force');
    return {
      ...state,
      enemyField: null,
      playerSpellTraps: traps,
      log: [...state.log, 'Your Mirror Force destroys the enemy attacker!'],
    };
  }

  if (atk > defAtk) {
    if (defender.cannotBeDestroyed) {
      const playerLp = Math.max(0, state.playerLp - (atk - defAtk));
      const next: DuelState = {
        ...state,
        playerLp,
        log: [
          ...state.log,
          'Enemy attacks, but Call of Dragon cannot be destroyed!',
        ],
        winner: playerLp <= 0 ? 'enemy' : state.winner,
      };
      return next.winner ? { ...next, log: [...next.log, 'You lost the duel...'] } : next;
    }
    const playerLp = Math.max(0, state.playerLp - (atk - defAtk));
    const next: DuelState = {
      ...state,
      playerField: null,
      playerLp,
      log: [...state.log, 'Enemy destroys your monster!'],
      winner: playerLp <= 0 ? 'enemy' : state.winner,
    };
    return next.winner ? { ...next, log: [...next.log, 'You lost the duel...'] } : next;
  }

  if (atk < defAtk) {
    if (attacker.cannotBeDestroyed) {
      return {
        ...state,
        enemyLp: Math.max(0, state.enemyLp - (defAtk - atk)),
        log: [...state.log, 'Enemy monster survives somehow and clashes.'],
      };
    }
    const enemyLp = Math.max(0, state.enemyLp - (defAtk - atk));
    const next: DuelState = {
      ...state,
      enemyField: null,
      enemyLp,
      log: [...state.log, 'Enemy monster is destroyed by your defender!'],
      winner: enemyLp <= 0 ? 'player' : state.winner,
    };
    return next.winner ? { ...next, log: [...next.log, 'You win the duel!'] } : next;
  }

  return {
    ...state,
    playerField: defender.cannotBeDestroyed ? defender : null,
    enemyField: attacker.cannotBeDestroyed ? attacker : null,
    log: [...state.log, 'Clash! Equal ATK monsters are destroyed.'],
  };
}

export function endPlayerTurn(state: DuelState): DuelState {
  if (state.winner || state.turn !== 'player') return state;

  let next: DuelState = {
    ...state,
    turn: 'enemy',
    log: [...state.log, "Enemy's turn..."],
  };

  next = enemyPlay(next);
  if (!next.winner) {
    next = enemyAttack(next);
  }

  if (next.winner) return next;

  // Draw for player
  return {
    ...next,
    turn: 'player',
    normalSummonUsed: false,
    log: [...next.log, 'Your turn!'],
  };
}

export function fieldLabel(monster: FieldMonster | null): string {
  if (!monster) return 'Empty';
  const card = getCard(monster.cardId);
  const atk = currentAtk(monster);
  return `${card.name} [${atk}/${monster.def}]`;
}
