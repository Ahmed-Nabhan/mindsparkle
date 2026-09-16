# Egypt Quest — Call of Dragon

**Type:** Unique player-only acquisition  
**Card:** Call of Dragon  
**Requirement:** `friendsCount >= 10` (Villain Hunt / expedition unlocked)  
**Repeatable:** No — once claimed, gone forever from the world

---

## Premise
After your 10th friendship, Alexis’s rumor + Jaden’s tip point to Egypt: an ancient sealed chamber that responds only to a duelist who formed true bonds.

No NPC owns this card. Shops never sell it. Enemy decks never use it.

---

## Quest steps

### Step 1 — Expedition unlock
- Phone message from Yugi / Jaden:
  > “The map leads to the Valley of the Sealed. Whatever sleeps there… it’s calling you.”
- Fast travel node **Egypt Excavation Zone** unlocks.

### Step 2 — Valley approach
- Traverse desert path.
- Optional: 1 random bandit duel (coins).
- Reach **Outer Obelisk Camp**.

### Step 3 — Trial of Bonds
- Tablet puzzle / 3 friendship totems.
- Check: must have 10 friends flag.
- Flavor: totems light with names of friends you saved.

### Step 4 — Guardian duel
- Face **Sealed Guardian** (strong boss, but beatable without Call of Dragon).
- Suggested guardian ATK ceiling ~3500–4000 ace so the quest is earned, not trivial.
- Win → inner chamber opens.

### Step 5 — Claim Call of Dragon
- Cutscene: stone coffin / gold sarcophagus card seal.
- Card added to collection exactly once.
- Flags:
  - `callOfDragonOwned = true`
  - `egyptQuestCompleted = true`
  - remove world pickup permanently

### Step 6 — Exit ambush (optional spice)
- Rare Hunter / cult remnant tries to steal it.
- Duel with Call of Dragon now available as emergency summon option.

---

## Card definition (runtime)

```json
{
  "id": "call_of_dragon",
  "name": "Call of Dragon",
  "atk": 10000,
  "def": 10000,
  "exclusiveToPlayer": true,
  "cannotBeDestroyed": true,
  "summon": {
    "type": "special",
    "tributes": 0,
    "playerOnlyOption": true,
    "appearsWhen": [
      "opponentMonsterAtkGreaterThanYourMonster",
      "youControlNoMonster"
    ]
  },
  "effects": [
    {
      "id": "devour_growth",
      "trigger": "afterDestroyMonsterByBattle",
      "gainAtk": 1000,
      "scope": "thisDuel"
    },
    {
      "id": "spell_trap_break",
      "type": "ignition",
      "oncePerTurn": true,
      "destroy": "oneSpellOrTrap"
    }
  ]
}
```

---

## UI / UX
- When conditions met and card is in hand/collection usable state, show glowing button:
  **“Summon Call of Dragon”**
- Only on human player HUD.
- AI must never evaluate or own this card.

---

## Fail-safes
- If player loses guardian duel: retry at checkpoint, card not granted.
- If save corrupts: `callOfDragonOwned` is source of truth; do not re-spawn world pickup if true.
- If card somehow added via debug: still keep `exclusiveToPlayer` combat rules.
