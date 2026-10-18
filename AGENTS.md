# AGENTS.md

## What this is

Bot scripts for the browser game [Adventure.Land](https://adventure.land). They run
**inside the game client's sandbox** (`runner_functions.js` API) — not in Node or a
browser page you control. There is no package.json, no build, no lint, no tests, no CI.

## Rules that break things if you ignore them

- **Never commit real character names.** Private config lives in gitignored
  `config.local.98.js` (see `.gitignore` and `config.local.example.98.js`). Only the
  `.example` file is tracked.
- **Filename = code slot.** `Ranger.1.js` means "upload to in-game code slot 1". The
  AL VS Code extension keys off this. Don't rename files or add a `src/` layout.
- **Every class file starts with `load_code(99)`**; `Common.99.js` in turn runs
  `load_code(98)` for local config. Change the shared core in slot 99, not per class.
- **Plain script style only** — top-level `var` / `function`, ES5-ish. The game evals
  each slot into the character's global scope: no `require`, `import`/`export`,
  `let`/`const` at top level, modules, or npm dependencies.
- **Monsters: list-only.** Bots attack only types in `CONFIG.monsters`. Never add
  code that targets unlisted monsters; the ranger's `pick()` is deliberately tiered
  and list-bound.
- **Travel uses validated `smart_move` shortcuts only** (`"potions"`, `"scrolls"`,
  `"exchange"`, `"town"`, `"bank"`) plus `smart_move_safe` (8s no-progress watchdog).
  Passing raw `find_npc(...)` coordinates to `smart_move` causes the known infinite
  "Searching for path" loop. If you add a travel target, use a shortcut or a
  validated `{x, y, map}`.
- **Skill use is runtime-gated** via `can_use()`/`try_skill()` against `G.skills`
  (level, MP, cooldown, range) with a `BAD{}` blacklist for level-locked/unknown
  skills. Don't hardcode level checks; let the gate degrade gracefully.
- **AoE is opt-in** (`CONFIG.allowAoE`, off by default). The ranger never fires
  array-target skills and never switches targets mid-lock.

## Where things live

- `Common.99.js` — shared core: `CONFIG`, skill gate, kiting, follow, pathing, loot,
  supply. Tuning knobs are in the `CONFIG` object at the top; slot 98 overrides them.
- `Ranger.1.js` — party leader and target picker; broadcasts target/pos/map via
  `send_cm` several times a second. Per-run overrides (e.g. `CONFIG.monsters`) go
  right after `load_code(99)` here.
- `Warrior.2.js` tank, `Priest.4.js` healer, `Merchant.7.js` loot mule + seller +
  potion supplier; `Paladin/Mage/Rogue` optional.
- Party invariants: only the merchant sells/buys/exchanges; fighters funnel all loot
  to it with `send_item`; fighters never leave the party (except the documented
  merchant-dry-and-full emergency).

## Verifying changes

No local harness exists — verification is in-game. Useful checks:

- `show_json(G.skills);` in the game console to see what a skill actually requires.
- Overhead messages above characters are the runtime state machine; the README's
  Troubleshooting table maps each message (`scout`, `wait tank`, `sell`, `supply`,
  ...) to the branch that produced it. When editing control flow, keep those strings
  accurate — they're the only debugging surface.

`README.md` is the user-facing source of truth for setup and tuning; update it when
behavior or knobs change.
