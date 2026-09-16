# Offline Duel Adventure — Personal iPhone Prototype

**Status:** Private offline single-player only (not for public release)  
**Platform:** iPhone (local install / TestFlight-to-self or Unity/Xcode device build)  
**Mode:** Offline, no servers, local save only  
**IP note:** Personal-only build may use original Yu-Gi-Oh names/cards. Do not publish, share APK/IPA, or put on stores without a license or a full rename pass.

---

## 1. Elevator pitch

You create a duelist, wake up in a shared Yu-Gi-Oh world that merges **Duel Monsters** and **GX**, befriend 10 characters through phone rescue missions, buy cards with coins, explore Egypt to claim the unique boss card **Call of Dragon**, then hunt villains across the map.

---

## 2. World structure (one world, two cultures)

One seamless adventure map with districts:

| District | Vibe | Hub | Shop |
|---|---|---|---|
| **Domino City** | Duel Monsters era | Domino Square | Domino Card Shop |
| **Duel Academy Isle** | GX era | Academy Courtyard | Academy Card Shop |
| **Egypt Excavation Zone** | Ancient / endgame key | Valley of the Sealed | No shop (quest only) |

- Player chooses starting district: **Domino** or **Academy**.
- Travel unlocks early (train / boat / gate) so it feels like one world.
- Villain encounters appear in multiple locations after friendship gate.

---

## 3. Player fantasy & top power list

### Character creation
- Name, look, starting district, starter deck (Domino classic or Academy hero/cyber flavor).

### Strongest 5 NPCs (story power ceiling)
1. Yami Yugi  
2. Yugi Muto  
3. Seto Kaiba  
4. Zane Truesdale  
5. Jaden Yuki  

Player can surpass them after obtaining **Call of Dragon** and late decks.

---

## 4. Core game loop

```
Create character
  → Explore hub / talk to NPCs
  → Receive phone rescue alerts
  → Save character → become friends
  → Earn coins + cards
  → Shop / build deck
  → Duel rivals
  → Gather 10 friends
  → Unlock villain hunt
  → Discover Egypt → Call of Dragon
  → Face endgame villains
```

---

## 5. Friendship system (10 friends)

### Rule
- Target: **10 friends**.
- Friendships come mainly from **rescue missions** triggered by **in-game phone messages**.
- After ~5 friends, light villain teases begin.
- At **10 friends**, full villain hunt unlocks.

### Phone UI
- Fake smartphone overlay in-game.
- Push-style alert: “[Character] is in danger at [Location].”
- Accept → travel → short rescue scenario → optional mini-duel or battle → friendship unlocked.

### Friendship rewards
- Character joins Friends list  
- Small coin reward  
- 1 character-themed card or pack ticket  
- Occasional story tip (Egypt rumor after friend #7+)

Full roster + mission scripts: see `missions/friend-rescues.md`.

---

## 6. Duel system (MVP rules)

Keep MVP duel rules simple and Yu-Gi-Oh flavored:

- 4000 LP  
- Main Monster Zones: 3 (MVP) / expand to 5 later  
- Spell/Trap Zones: 3  
- Normal Summon 1/turn  
- Tribute for Level 5–6 (1) and 7+ (2)  
- Battle phase  
- Win: reduce enemy LP to 0  

### Special player-only summon option
During a duel, if:
- opponent summons a monster with **ATK > your current monster ATK**, OR  
- you control **no monster**,

then show button: **Call of Dragon** (only if owned).

---

## 7. Signature card — Call of Dragon

| Field | Value |
|---|---|
| Name | **Call of Dragon** |
| ATK / DEF | **10000 / 10000** |
| Owner | **Player only** — never in NPC decks, shops, packs, or enemy rewards |
| Acquisition | Unique discovery in **Egypt** |
| Summon | Special Summon via player option; **no tributes** |
| Protection | **Cannot be destroyed** by battle or card effects |
| Growth | When this card destroys a monster by battle: gain **+1000 ATK** (duel-persistent) |
| Ignition | Once per turn: destroy 1 Spell/Trap on the field |

### Implementation notes
- `canBeDestroyed = false`  
- Growth stored as `bonusAtk = kills * 1000`  
- Display ATK = `10000 + bonusAtk`  
- Do **not** add to any shop inventory or AI deck pools  
- Flag: `exclusiveToPlayer: true`

Full quest: see `missions/egypt-call-of-dragon.md`.

---

## 8. Economy & shops

### Coins
Earn from: duels won, rescues, exploration chests, daily offline login bonus (optional).

### Shops
- **Domino Card Shop** — DM-era pool  
- **Academy Card Shop** — GX-era pool  
- Both use same coin currency  
- For personal fun build: wide catalog is OK  
- Recommended soft limit even privately: ultra-boss cards (except Call of Dragon) stay rare/quest-only so progression still feels good

Starter catalog stub: `data/shops.json`.

---

## 9. Villain hunt (post–10 friends)

Unlocked when `friendsCount >= 10`.

Suggested first villains (personal build):
1. Rare Hunter cell — Domino alley  
2. Shadow Rider remnant — Academy abandoned dorm  
3. Marik / Ghouls-inspired cult cell — Egypt approach  
4. Final rival gauntlet — Kaiba / Zane / Jaden exhibition + Yami trial

Each villain node: travel → short cutscene → hard duel → coin/card reward.

---

## 10. Save system (offline iPhone)

Local-only JSON / PlayerPrefs / files:
- player profile  
- deck + collection  
- friends unlocked  
- mission flags  
- coins  
- Call of Dragon owned + Egypt quest state  
- world position / current district  

No login. No cloud. No ads.

---

## 11. MVP build order (ship-to-phone test)

### Phase A — Playable skeleton
1. Title → Create character → pick Domino or Academy  
2. Hub walk (simple 3D or even scene-based locations first)  
3. Phone alert → 1 rescue → 1 friendship  
4. Basic duel vs 1 NPC  
5. Shop buy 1 card  
6. Local save/load  

### Phase B — Core fantasy
7. Full 10 rescue missions  
8. 10-friend gate → villain hunt start  
9. Egypt zone → Call of Dragon unlock  
10. Call of Dragon duel option + effects  

### Phase C — Content depth
11. Expand card pools  
12. More villains / locations  
13. Polish UI, phone, animations  

---

## 12. Suggested tech (iPhone personal build)

Pick one:
- **Unity + iOS build** (best for 3D world/duel presentation)
- **Unreal** (heavier for solo mobile prototype)
- **Godot 4** (fine, iOS export more setup)

Recommended for this scope: **Unity (URP)** + local ScriptableObjects/JSON for cards & missions.

Folder intent for future Unity project:
```
Assets/
  Data/Cards/
  Data/Missions/
  Data/Characters/
  Scripts/Core/
  Scripts/Duel/
  Scripts/World/
  Scripts/UI/Phone/
  Scenes/Hub_Domino/
  Scenes/Hub_Academy/
  Scenes/Egypt/
  Scenes/Duel/
```

Data stubs living in this repo now under `docs/offline-duel-game/data/`.

---

## 13. Document index

| File | Contents |
|---|---|
| `GAME_DESIGN.md` | This master design |
| `missions/friend-rescues.md` | All 10 friendship rescue missions |
| `missions/egypt-call-of-dragon.md` | Egypt exclusive card quest |
| `data/characters.json` | Cast + friend flags |
| `data/cards.json` | Starter cards + Call of Dragon |
| `data/shops.json` | Domino + Academy shop pools |
| `data/missions.json` | Machine-readable mission list |
| `MVP_CHECKLIST.md` | Build checklist |

---

## 14. Design decisions locked

- Offline only, personal iPhone  
- DM + GX share one world  
- Original Yu-Gi-Oh names OK for private build  
- 10 friends via phone rescue missions  
- Shops in both districts  
- **Call of Dragon**: 10000/10000, +1000 per battle destroy, cannot be destroyed, no tributes, player-only, found in Egypt  
