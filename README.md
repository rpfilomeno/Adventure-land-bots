# Adventure-land-bots

Party bot scripts for [Adventure.Land](https://adventure.land), built on the in-game
`runner_functions.js` API. One shared core plus a thin script per class.

A 4-character party (`ranger` leader, `warrior` tank, `priest` healer, `merchant`
mule) farms, loots, heals, sells and restocks potions with no manual input.

## Files and code slots

Filenames follow Adventure.Land's `name.slot.js` convention — the number before
`.js` is the code slot the file belongs in. The VS Code AdventureLand extension
uploads them to the right slot automatically; otherwise paste each file into the
matching slot in the in-game code editor.

| File | Slot | Class | Role |
|---|---|---|---|
| `Common.99.js` | 99 | — | shared core: CONFIG, skills, kite, follow, pathing, loot, supply |
| `Ranger.1.js` | 1 | Ranger | party leader, target picker, single-aggro lock |
| `Warrior.2.js` | 2 | Warrior | main tank |
| `Paladin.3.js` | 3 | Paladin | off-tank (optional, unused in the 4-man setup) |
| `Priest.4.js` | 4 | Priest | heals / support |
| `Mage.5.js` | 5 | Mage | ranged DPS (optional) |
| `Rogue.6.js` | 6 | Rogue | melee DPS (optional) |
| `Merchant.7.js` | 7 | Merchant | loot mule, seller, potion supplier |
| `config.local.example.98.js` | — | — | **template** for your private slot 98 config |

Every class file starts with `load_code(99)`, so slot 99 must always be current.

## Setup

### 1. Upload the scripts

Point the AL VS Code extension at this folder (or copy the `.js` files into its
managed folder) and let it sync slots `1-7` and `99`.

### 2. Create your local config

Real character names live **outside this public repo**. Create `config.local.98.js`
(gitignored) from the template:

```bash
cp config.local.example.98.js config.local.98.js
```

Then edit it:

```js
CONFIG.ranger   = "YourRangerName";
CONFIG.tank     = "YourTankName";
CONFIG.priest   = "YourPriestName";
CONFIG.merchant = "YourMerchantName";
CONFIG.party    = ["YourRangerName", "YourTankName", "YourPriestName", "YourMerchantName"];
```

Upload it to **code slot 98**. `Common.99.js` runs `load_code(98)` after building
`CONFIG`, so your names override the placeholders.

> **Fallback:** if `load_code(98)` misbehaves on your client (empty slot logs an
> error or resolves asynchronously), put the same `CONFIG.*` lines at the **top**
> of each character's own default slot, *before* `load_code(1..7)`. Neither spot
> is ever committed.

### 3. Tune the farm

Set the monsters to hunt at the top of `Ranger.1.js` (or override in slot 98):

```js
CONFIG.monsters = ["goo"];
```

All class scripts only attack monsters present in `CONFIG.monsters` — they never
wander off-list.

### 4. Run

Set each character's active code to its class slot (`1` for the ranger, `2` the
warrior, `4` the priest, `7` the merchant). The ranger invites the others; the
rest join and follow it anywhere on any map.

## Party design

**Ranger leads.** It picks targets from `CONFIG.monsters`, locks one at a time,
and broadcasts target/position/map over `send_cm` a few times a second. No
array-target skills ever fire, and it does not switch targets mid-lock.

**Ranged units kite** when the tanks lose aggro. **Tanks kite to the backline**
below `CONFIG.tankCritHp` (30%), and **no new pulls happen while the tank is under
`CONFIG.tankMinHp`** (65%).

**Skill gating is runtime-checked** against `G.skills` — level, MP, cooldown and
range — with a `BAD{}` blacklist for level-locked skills, so the scripts degrade
gracefully to plain `attack` / `heal` at low level.

**Loot funnels to the merchant.** Fighters `send_item` everything to it and never
leave the party (only emergency: merchant unseen *and* dry *and* inventory full).

**Only the merchant sells and buys.** It sweeps the chest, sells loot, and keeps
the party stocked from a **dynamic buffer starting at 500 potions** that grows
from measured consumption. Delivery is **same-map only** — no cross-map walks, no
paging, a 120 s gap between runs and a 15-minute backoff after repeated failures.

**Teleport is restricted**: `town()` only fires on the main map; otherwise the
merchant walks to the potions seller via the `"potions"` shortcut. Raw
`find_npc` coordinates are never passed to `smart_move` — that's what causes the
"Searching for path" infinite loop (an 8-second no-progress watchdog is also in
place).

**Auto-recover**: characters respawn after the 10-second revive window, and fall
back to `regen_hp` / `regen_mp` when out of potions.

## Tuning knobs

Set in `Common.99.js`, overridable in slot 98.

| Key | Default | Meaning |
|---|---|---|
| `ranger` / `tank` / `priest` / `merchant` | placeholders | character names |
| `party` | 4 names | roster, ranger first |
| `monsters` | `["goo"]` | only monsters bots will attack |
| `tankMinHp` | `0.65` | no new pulls below this |
| `tankCritHp` | `0.30` | tanks kite to backline below this |
| `followDist` | `30` | hold distance to the ranger |
| `kiteMax` | `600` | max kite radius from the ranger anchor |
| `potionMin` | `20` | restock trip only when idle and below this |
| `minMpReserve` | `100` | MP held back for heal/escape |

## Troubleshooting

**Overhead message key**

| Message | Meaning |
|---|---|
| `scout` / monster name | ranger healthy, working |
| `wait tank` | waiting for the tank to recover |
| `critical` / `recover` | tank below threshold, kiting / holding |
| `tank:<name>` / `heal:<name>` | current aggro target / heal target |
| `mule` | merchant working around the party |
| `wait party` | merchant's map differs from the ranger's |
| `sell` | merchant is on a selling trip |
| `pots` / `pots!` | merchant is resupplying (floor breach) |
| `supply` | merchant is delivering potions |

**Skill errors / "skill not available"**

Run in-game to see what your level actually has:

```js
show_json(G.skills);
```

Unknown or level-locked skills are blacklisted automatically, so this is usually
cosmetic.

**"Searching for path" repeating forever**

Something routed `smart_move` at an unreachable or unvalidated target. The bots
only ever use validated string shortcuts (`"potions"`, `"scrolls"`,
`"exchange"`, `"town"`, `"bank"`) and `smart_move_safe`, which abandons a leg
after 8 seconds without progress. If you add a new travel target, use a shortcut
or a validated `{x, y, map}` — never `find_npc(...)` coordinates.

**Merchant stuck in town**

Check the overhead message above to see which branch it's in (`sell`, `pots`,
`supply`, `mule`, `wait party`).

## License

See [LICENSE](LICENSE).
