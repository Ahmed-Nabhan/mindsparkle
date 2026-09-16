import assert from 'node:assert/strict';
import {
  attack,
  canOfferCallOfDragon,
  createDuel,
  summonCallOfDragon,
} from '../src/game/duelEngine';
import { FieldMonster } from '../src/types';

const duel = createDuel(
  ['beaver_warrior', 'kuriboh', 'monster_reborn', 'mirror_force'],
  ['thug_bruiser', 'thug_beater', 'beaver_warrior', 'mystical_elf'],
);

assert.equal(duel.playerLp, 4000);
assert.equal(canOfferCallOfDragon(duel, true), true);

const withDragon = summonCallOfDragon(duel);
assert.equal(withDragon.playerField?.cardId, 'call_of_dragon');
assert.equal((withDragon.playerField?.atk ?? 0) + (withDragon.playerField?.bonusAtk ?? 0), 10000);

const enemyField: FieldMonster = {
  instanceId: 'e1',
  cardId: 'thug_beater',
  atk: 1400,
  def: 1000,
  position: 'atk',
  bonusAtk: 0,
};

const primed = {
  ...withDragon,
  enemyField,
};
const afterAttack = attack(primed);
assert.equal(afterAttack.playerField?.bonusAtk, 1000);
assert.equal(afterAttack.enemyField, null);

console.log('duelEngine smoke tests passed');
