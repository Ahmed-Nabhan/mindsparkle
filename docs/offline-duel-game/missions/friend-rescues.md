# 10 Friend Rescue Missions

Trigger channel: **in-game phone messages**.  
Accepting a mission marks it active; completing it adds the character to **Friends**.

Progression tip:
- Missions 1–4: easy, teach systems  
- Missions 5–7: introduce stronger foes  
- Missions 8–10: pre-villain pressure + Egypt rumor

---

## Friend 01 — Yugi Muto
- **District:** Domino City  
- **Phone message:** “Yugi is cornered in Domino Square alley by card thieves!”  
- **Objective:** Reach alley → defeat 2 thug duelists (easy decks)  
- **Optional:** Give him a Monster Reborn / healing item flavor beat  
- **Reward:** 300 coins + Kuriboh  
- **Friendship line:** Yugi trusts you and shares Domino shortcuts  

## Friend 02 — Joey Wheeler
- **District:** Domino City  
- **Phone message:** “Joey’s duel bet went bad at the pier. He’s in trouble!”  
- **Objective:** Pier rescue duel vs debt collector  
- **Reward:** 350 coins + Baby Dragon  
- **Friendship line:** Joey joins as loud hype friend; unlocks casual Domino sparring  

## Friend 03 — Téa Gardner
- **District:** Domino City  
- **Phone message:** “Téa never came back from the museum night tour…”  
- **Objective:** Museum stealth/search → short duel vs shadow spirit  
- **Reward:** 300 coins + Happy Lover / supportive spell  
- **Friendship line:** Téa sends better phone tips for future rescues  

## Friend 04 — Tristan Taylor
- **District:** Domino City  
- **Phone message:** “Tristan got locked in the industrial warehouse district!”  
- **Objective:** Clear warehouse guards (1 duel + 1 simple puzzle door)  
- **Reward:** 300 coins + rare scrap metal cosmetic / Earth monster  
- **Friendship line:** Tristan helps with item finds in Domino  

## Friend 05 — Syrus Truesdale
- **District:** Duel Academy  
- **Phone message:** “Syrus is panicking — bullies forced him into an unfair dorm duel!”  
- **Objective:** Interrupt unfair rules → rematch on fair terms  
- **Reward:** 400 coins + Vehicroid token card  
- **Friendship line:** Syrus opens Academy dorm side paths  

## Friend 06 — Chazz Princeton
- **District:** Duel Academy  
- **Phone message:** “Chazz’s rare binder was stolen near the pier docks under the Academy cliffs!”  
- **Objective:** Chase thieves → recover binder → duel leader  
- **Reward:** 450 coins + Armed Dragon LV3  
- **Friendship line:** Chazz becomes rival-friend; offers hard practice duels  

## Friend 07 — Alexis Rhodes
- **District:** Duel Academy  
- **Phone message:** “Alexis disappeared after investigating the abandoned dorm wing.”  
- **Objective:** Abandoned dorm exploration → duel Shadow-style opponent  
- **Reward:** 500 coins + Cyber Angel beginner card  
- **Friendship line:** Alexis shares rumor: “Something sealed in Egypt answers only one duelist…”  

## Friend 08 — Bastion Misawa
- **District:** Duel Academy  
- **Phone message:** “Bastion’s formula lab overloaded — duel spirits are leaking!”  
- **Objective:** Stabilize 3 terminals + duel corrupted lab construct  
- **Reward:** 500 coins + Water Dragon sample / science spell  
- **Friendship line:** Bastion unlocks deck-analysis tips (UI hint for weak matchups)  

## Friend 09 — Zane Truesdale
- **District:** Duel Academy / Cyber Pavilion  
- **Phone message:** “Zane is being forced into a black-market under-duel. He won’t ask for help — but he needs it.”  
- **Objective:** Infiltrate under-duel arena → assist Zane in 2v1 turning into fair 1v1 ally finish  
- **Reward:** 700 coins + Cyber Dragon  
- **Friendship line:** Zane respects you; harder Cyber practice unlocked  

## Friend 10 — Jaden Yuki
- **District:** Academy arena / wild field edge  
- **Phone message:** “Jaden challenged a masked villain alone outside campus. Get there NOW.”  
- **Objective:** Arrive mid-duel → tag-in / finish villain  
- **Reward:** 800 coins + Elemental HERO Burstinatrix (or Neos support starter)  
- **Friendship line:** Jaden becomes friend #10 → **Villain Hunt unlocked** + Egypt expedition access

---

## Bonus befriendable (after 10, optional)
Not required for gate, but available for content:
- Yami Yugi (spirit trial, not a normal rescue)
- Seto Kaiba (pride duel invitation)
- Mai Valentine
- Weevil / Rex redemption mini-arcs

---

## Mission state flags
```
mission_<id>_received
mission_<id>_accepted
mission_<id>_completed
friend_<characterId>_unlocked
friendsCount
villainHuntUnlocked  // friendsCount >= 10
egyptAccessUnlocked  // friendsCount >= 10 OR after friend 07 rumor + 10
```

Recommended unlock: Egypt expedition available when `friendsCount >= 10` (Jaden rescue complete).
