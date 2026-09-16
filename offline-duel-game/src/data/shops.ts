import { ShopItem } from '../types';

export const SHOPS: Record<'domino' | 'academy', { id: string; name: string; inventory: ShopItem[] }> = {
  domino: {
    id: 'domino_card_shop',
    name: 'Domino Card Shop',
    inventory: [
      { cardId: 'kuriboh', price: 100 },
      { cardId: 'baby_dragon', price: 150 },
      { cardId: 'mystical_elf', price: 120 },
      { cardId: 'beaver_warrior', price: 120 },
      { cardId: 'dark_magician', price: 1200 },
      { cardId: 'blue_eyes_white_dragon', price: 2000 },
      { cardId: 'red_eyes_black_dragon', price: 1500 },
      { cardId: 'polymerization', price: 400 },
      { cardId: 'monster_reborn', price: 900 },
      { cardId: 'mirror_force', price: 900 },
    ],
  },
  academy: {
    id: 'academy_card_shop',
    name: 'Academy Card Shop',
    inventory: [
      { cardId: 'elemental_hero_avian', price: 150 },
      { cardId: 'elemental_hero_burstinatrix', price: 150 },
      { cardId: 'armed_dragon_lv3', price: 250 },
      { cardId: 'cyber_dragon', price: 1400 },
      { cardId: 'polymerization', price: 400 },
      { cardId: 'monster_reborn', price: 900 },
      { cardId: 'mirror_force', price: 900 },
      { cardId: 'beaver_warrior', price: 120 },
    ],
  },
};
