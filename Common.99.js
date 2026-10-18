// Common.99.js — shared party core. Load via: load_code(99)
// Reference: runner_functions.js (attack/heal/use_skill/send_cm/smart_move)

// silence "Received a code message" — the ranger broadcasts several times per
// second and the game logs every receipt. same scope as the runner, so this sticks.
if (typeof code_settings != "undefined") code_settings.log_cm = false;
if (typeof code_settings != "undefined") code_settings.log_smart_move = false; // quiet "Searching for path"

var CONFIG = {
	ranger: "RangerName",              // party leader / target picker
	party: ["RangerName", "TankName", "PriestName", "MerchantName"],
	priest: "PriestName",              // priest name (mage feeds it MP via energize)
	tank: "TankName",                  // main tank name (kite rally point)
	merchant: "MerchantName",          // loot mule — fighters funnel everything here
	tankMinHp: 0.65,                   // no NEW pull while tank below this
	tankCritHp: 0.30,                  // below this tanks kite to the backline
	monsters: ["goo"],                 // generic farm target, override per run
	followDist: 30,                    // hold distance to ranger
	kiteMax: 600,                      // max kite radius from ranger anchor
	potionMin: 20,                     // restock below this (fight first, trip only when idle)
	minMpReserve: 100,                 // keep MP for heal/escape
};

// local overrides live in slot 98 (config.local.98.js, gitignored) so real
// character names never reach this public repo. copy config.local.example.98.js
// to get started. if load_code on an empty slot misbehaves on your client, put
// the same CONFIG.* lines at the top of the character's own default slot instead.
try {
	if (typeof load_code == "function") load_code(98);
} catch (e) { /* no local config — placeholders above are used as-is */ }

var RangerMsg = { target: null, x: 0, y: 0, map: "main" };
var BAD = {}; // skills that don't exist / level-locked

character.on("cm", function (m) {
	if (m.name == CONFIG.ranger && m.message && typeof m.message == "object") { RangerMsg = m.message; RangerMsg._t = Date.now(); }
});

// potion supply is merchant-scheduled (5-min interval + reserve floor) + passive
// same-map delivery. fighters no longer page the merchant.

function can_use(name, target) {
	if (BAD[name] || !G.skills[name]) return false;
	if (is_on_cooldown(name)) return false;
	if (character.mp < (G.skills[name].mp || 0) + CONFIG.minMpReserve) return false;
	if (G.skills[name].level && character.level < G.skills[name].level) { BAD[name] = 1; return false; }
	if (target && !is_in_range(target, name)) return false;
	return true;
}

function try_skill(name, target, extra) {
	if (!can_use(name, target)) return false;
	use_skill(name, target, extra).then(function (r) {
		if (r && r.failed && (r.reason == "skill_locked" || r.reason == "level")) BAD[name] = 1;
	}).catch(function () {});
	return true;
}

// Kite one step away from monster m, rallying toward towardTank's position.
// Samples 5 directions x 2 step lengths, scores walkable ones by
// (distance from monster) - 0.4 x (distance to tank), takes the best.
// Holds position when nothing safe gains ground. Returns true if a step issued.
var kiteBlocks = 0, kiteHoldUntil = 0;
function kite_step(m, towardTank) {
	if (Date.now() < kiteHoldUntil) return false; // cooling down after repeated blocks
	var dx = character.x - m.x, dy = character.y - m.y;
	var d = Math.hypot(dx, dy) || 1;
	var a = Math.atan2(dy / d, dx / d);
	var ax = RangerMsg.x || character.x, ay = RangerMsg.y || character.y;
	var k = towardTank ? get_player(towardTank) : null;
	var angs = [a, a + 1.05, a - 1.05, a + 2.1, a - 2.1], steps = [40, 20];
	var best = null, bestScore = -Infinity;
	for (var i = 0; i < angs.length; i++) {
		for (var s = 0; s < steps.length; s++) {
			var nx = character.x + Math.cos(angs[i]) * steps[s];
			var ny = character.y + Math.sin(angs[i]) * steps[s];
			if (k) { nx = nx * 0.7 + k.x * 0.3; ny = ny * 0.7 + k.y * 0.3; }
			if (Math.hypot(nx - ax, ny - ay) > CONFIG.kiteMax) continue; // don't split party
			if (!can_move_to(nx, ny) || is_transporting(character)) continue; // no path — skip
			var dm = Math.hypot(nx - m.x, ny - m.y);
			var score = dm - (k ? Math.hypot(nx - k.x, ny - k.y) * 0.4 : 0);
			if (score > bestScore) { bestScore = score; best = { x: nx, y: ny, dm: dm }; }
		}
	}
	if (!best || best.dm < d * 0.8) { // cornered or no retreat path — hold, keep DPS
		if (++kiteBlocks >= 3) { kiteHoldUntil = Date.now() + 2000; kiteBlocks = 0; }
		return false;
	}
	kiteBlocks = 0;
	move(best.x, best.y);
	return true;
}

// standoff doctrine for ranged: sit in [0.7, 0.95] x range of m.
// returns true if a move was issued (caller: skip other moves that tick).
function hold_range(m, towardTank) {
	var d = distance(character, m);
	if (d < character.range * 0.7) { kite_step(m, towardTank); return true; }
	if (d > character.range * 0.95) {
		if (!is_moving(character)) xmove(m.x, m.y);
		return true;
	}
	return false;
}

// true if any live monster is targeting me
function targeted() {
	for (var id in parent.entities) {
		var e = parent.entities[id];
		if (e && e.type == "monster" && !e.dead && get_target_of(e) == character) return true;
	}
	return false;
}

function aggro_lost(m) {
	return m && get_target_of(m) == character && distance(character, m) < character.range * 0.9;
}

// true for instance maps (crypt, winter_instance, ...) — can't be path-walked into.
function in_instance(map) {
	return !!(map && G.maps[map] && G.maps[map].instance);
}

// Follow ranger anywhere. cross-map via smart_move_safe (loop-proof); a party
// inside an instance we're not in → hold (can't path in); repeated failures back off.
var followFails = 0, followHoldUntil = 0;
function follow_ranger(ox, oy) {
	if (!RangerMsg.map || is_transporting(character)) return false;
	if (Date.now() < followHoldUntil) return false; // backing off after repeated failures
	if (RangerMsg.map != character.map && in_instance(RangerMsg.map)) return false; // can't enter
	if (character.map != RangerMsg.map || distance(character, { x: RangerMsg.x, y: RangerMsg.y }) > 800) {
		if (!smart.moving) {
			smart_move_safe({ x: RangerMsg.x, y: RangerMsg.y, map: RangerMsg.map }, 45000)
				.then(function () { followFails = 0; })
				.catch(function () { if (++followFails >= 3) { followHoldUntil = Date.now() + 60000; followFails = 0; } });
		}
		return true;
	}
	var tx = RangerMsg.x + (ox || 0), ty = RangerMsg.y + (oy || 0);
	if (distance(character, { x: tx, y: ty }) > CONFIG.followDist && !is_moving(character)) xmove(tx, ty);
	return distance(character, { x: tx, y: ty }) > CONFIG.followDist;
}

// smart_move with a progress watchdog. the engine pathfinder restarts itself
// forever when a found path's next step can't be walked (unreachable/blocked
// target), spamming "Searching for path" and never giving up. this aborts on
// no-progress instead, so callers get a fast, attributable failure.
// resolves {success:true} on arrival, rejects {reason:"path_lost"|"timeout"}.
function smart_move_safe(dest, timeoutMs) {
	var lastX = character.real_x, lastY = character.real_y, lastMove = 0, started = Date.now();
	return new Promise(function (resolve, reject) {
		var settled = false, timer = setInterval(tick, 500);
		function done(fn, v) { if (settled) return; settled = true; clearInterval(timer); fn(v); }
		function tick() {
			if (Date.now() - started > (timeoutMs || 45000)) { stop("smart"); return done(reject, { reason: "timeout" }); }
			if (!smart.moving) return; // not started yet, or the promise already settled
			if (Math.hypot(character.real_x - lastX, character.real_y - lastY) >= 5) {
				lastX = character.real_x; lastY = character.real_y; lastMove = Date.now(); return;
			}
			if (!lastMove) { lastMove = Date.now(); return; } // just began moving
			if (Date.now() - lastMove > 8000) { stop("smart"); return done(reject, { reason: "path_lost" }); }
		}
		smart_move(dest).then(function () { done(resolve, { success: true }); })
			.catch(function (e) { done(reject, e || { reason: "failed" }); });
	});
}

// below tankCritHp the tank retreats instead of holding.
function tank_critical() {
	if (!CONFIG.tank) return false;
	var k = character.name == CONFIG.tank ? character : get_player(CONFIG.tank);
	if (!k || k.rip || k.visible === false) return false;
	return k.hp / k.max_hp < CONFIG.tankCritHp;
}

// kite rally point behind the fight: priest if visible, else ranger.
function backline_anchor() {
	var p = CONFIG.priest ? get_player(CONFIG.priest) : null;
	if (p && !p.rip && p.visible) return p.name;
	return CONFIG.ranger;
}

// no pots left → regen abilities (share potion cooldown, so they can never
// lock out a real potion — they only fire at zero potions). all classes.
function regen_check() {
	var hp0 = quantity("hpot0") + quantity("hpot1"), mp0 = quantity("mpot0") + quantity("mpot1");
	if (hp0 == 0 && character.hp < character.max_hp) try_skill("regen_hp");
	if (mp0 == 0 && character.mp < character.max_mp) try_skill("regen_mp");
}

// no new pull while the tank is down, unseen, or below tankMinHp.
// current locks always finish — this gates only NEW fights.
function tank_healthy() {
	if (!CONFIG.tank) return true;
	var k = character.name == CONFIG.tank ? character : get_player(CONFIG.tank);
	if (!k || k.rip || k.visible === false) return false;
	return k.hp / k.max_hp >= CONFIG.tankMinHp;
}

// returns {monster, seen} — seen=false when the ranger's target isn't in MY vision.
// callers must run to the ranger first (which puts the monster in vision), never chase blind.
function assist_target() {
	var m = RangerMsg.target ? get_monster(RangerMsg.target) : null;
	if (m && m.visible && !m.dead) return { monster: m, seen: true };
	if (!tank_healthy()) return { monster: null, seen: false }; // hold new fights till tank recovers
	for (var i = 0; i < CONFIG.monsters.length; i++) {
		var t = get_nearest_monster({ type: CONFIG.monsters[i], target: CONFIG.ranger, no_target: true });
		if (t) return { monster: t, seen: true };
	}
	return { monster: null, seen: false };
}

var potionTrip = 0; // last potion-run timestamp (throttle)

function free_slots() {
	if (character.esize != null) return character.esize;
	var n = 0;
	for (var i = 0; i < character.items.length; i++) if (!character.items[i]) n++;
	return n;
}

var sellFailed = false; // last sell attempt failed (no NPC in range) → town trip needed
var townTrip = null;    // {back, started, legAt, progPos, lastFree, deadLegs} — aborts on no-progress, never destroys
var townCooldownUntil = 0; // retry backoff: failed trips re-arm from the party, not the shop
var skipSell = {};      // session quarantine: item signatures that survived sale attempts

function junk_sig(it) {
	return it.name + "@" + (it.level || 0);
}

function cheapest_junk() {
	var keep = { hpot0: 1, hpot1: 1, mpot0: 1, mpot1: 1, xptoken: 1 };
	var worst = -1, worstVal = Infinity;
	for (var i = 0; i < character.items.length; i++) {
		var it = character.items[i];
		if (!it || keep[it.name] || skipSell[junk_sig(it)]) continue;
		var v = item_value(it);
		if (v < worstVal) { worstVal = v; worst = i; }
	}
	return worst;
}

// when inventory is full: sell cheapest junk to a nearby NPC (full stack, to free the slot).
// never blocks combat; sets sellFailed so town_sell_tick knows a town trip is needed.
function tidy_inventory() {
	if (free_slots() > 1) { sellFailed = false; return; }
	// merchant in sight → funnel drains the bags, don't vendor what it will collect
	if (character.name != CONFIG.merchant && get_player(CONFIG.merchant)) return;
	var w = cheapest_junk();
	if (w < 0) return;
	var q = (character.items[w] && character.items[w].q) || 1;
	sell(w, q).then(function (r) { if (r && r.failed) sellFailed = true; }).catch(function () { sellFailed = true; });
}

function sell_all_junk() {
	var keep = { hpot0: 1, hpot1: 1, mpot0: 1, mpot1: 1, xptoken: 1 };
	for (var i = 0; i < character.items.length; i++) {
		var it = character.items[i];
		if (!it || keep[it.name] || skipSell[junk_sig(it)]) continue;
		sell(i, it.q || 1).catch(function () {});
	}
}

// inventory full + no NPC in reach → head to the nearest potions seller and sell.
// on main: teleport to spawn first. off-main: walk to this map's seller via the
// "potions" shortcut (winter_inn/halloween locally; main otherwise). never uses
// find_npc raw coords. returns true while the trip is busy (skip combat that tick).
function town_sell_tick() {
	if (townTrip) {
		if (Date.now() - townTrip.started > 90000) { // watchdog: abort, rejoin party, retry later
			townTrip = null; sellFailed = false;
			townCooldownUntil = Date.now() + 3 * 60 * 1000;
			stop("smart"); return true;
		}
		if (is_transporting(character)) return true;
		if (smart.moving) { // jammed-plot guard: no progress for 12s → clear it
			if (!townTrip.progPos) townTrip.progPos = { x: character.x, y: character.y, t: Date.now() };
			else if (Math.hypot(character.x - townTrip.progPos.x, character.y - townTrip.progPos.y) >= 5)
				townTrip.progPos = { x: character.x, y: character.y, t: Date.now() };
			else if (Date.now() - townTrip.progPos.t > 12000) { stop("smart"); townTrip.progPos = null; }
			return true;
		}
		townTrip.progPos = null;
		// done as soon as space is free — leave the seller immediately.
		if (free_slots() > 1) {
			var b = townTrip.back;
			townTrip = null; sellFailed = false;
			if (b && b.map != character.map && character.name == CONFIG.ranger) smart_move_safe(b, 45000).catch(function () {});
			return true;
		}
		if (Date.now() - (townTrip.legAt || 0) > 10000) {
			townTrip.legAt = Date.now();
			// teleport only when on the main map (clean spawn, clears wedges).
			// off-main we walk to this map's nearest potions seller instead.
			if (!townTrip.ported && character.map == "main") {
				townTrip.ported = true;
				stop("smart"); town().catch(function () {});
				return true;
			}
			// no-progress abort: first leg sets baseline (may fire pre-arrival);
			// two later legs freeing zero slots → quarantine, back off, rejoin party.
			if (townTrip.lastFree < 0) townTrip.lastFree = free_slots();
			else if (free_slots() >= townTrip.lastFree) townTrip.deadLegs++;
			else { townTrip.deadLegs = 0; townTrip.lastFree = free_slots(); }
			if (townTrip.deadLegs >= 2) {
				var q = cheapest_junk();
				if (q >= 0 && character.items[q]) skipSell[junk_sig(character.items[q])] = 1;
				townTrip = null; sellFailed = false;
				townCooldownUntil = Date.now() + 3 * 60 * 1000;
				stop("smart");
				return true;
			}
			sell_all_junk(); // no-op if no NPC in range (fails fast)
			smart_move_safe("potions", 45000).catch(function () {}); // local seller
		}
		return true;
	}
	if (free_slots() <= 1 && sellFailed && cheapest_junk() >= 0 && Date.now() > townCooldownUntil) {
		// tank discipline: selling is the mule's job — fighters funnel to it and hold.
		// only trip if abandoned (mule unseen).
		if (character.name != CONFIG.merchant && get_player(CONFIG.merchant)) return false;
		townTrip = { back: { x: character.x, y: character.y, map: character.map }, started: Date.now(), legAt: 0, progPos: null, lastFree: -1, deadLegs: 0, ported: false };
		return true; // first leg teleports (main) or walks to the local seller
	}
	return false;
}

// everyone loots, fighters funnel all loot to the merchant (who sells it in town).
// 2 slots per tick to avoid socket spam; merchant itself skips (it IS the mule).
function funnel_to_merchant() {
	if (character.name == CONFIG.merchant || !CONFIG.merchant) return false;
	var m = get_player(CONFIG.merchant);
	if (!m || m.rip) return false;
	var keep = { hpot0: 1, hpot1: 1, mpot0: 1, mpot1: 1, xptoken: 1 };
	var sent = 0;
	for (var i = 0; i < character.items.length && sent < 2; i++) {
		var it = character.items[i];
		if (!it || keep[it.name]) continue;
		send_item(CONFIG.merchant, i, it.q || 1).catch(function () {});
		sent++;
	}
	return sent > 0;
}

var ripSince = 0; // death timestamp — 10s revive window, then respawn, 10s per attempt

// auto-respawn with priest-revive window. returns true while dead (skip the tick).
function check_rip() {
	if (!character.rip) { ripSince = 0; return false; }
	if (!ripSince) { ripSince = Date.now(); stop("smart"); } // one-time: drop stale plots
	if (Date.now() - ripSince > 10000) {
		ripSince = Date.now(); // re-arm: one attempt per 10s, never spam
		respawn().catch(function () {});
	}
	return true;
}

function sustain(hasTarget) {
	use_hp_or_mp();
	regen_check(); // dry → regen abilities (pots-first preserved by shared cooldown)
	for (var id in get_chests()) loot(id); // everyone grabs nearby chests before they expire
	funnel_to_merchant(); // fighters pass everything to the merchant — never blocks combat
	tidy_inventory(); // free a slot via nearby NPC if possible — never blocks combat
	if (town_sell_tick()) return true; // town trip starting/in progress — skip combat this tick
	// fight first: only detour for potions when idle (no target) or already en route,
	// throttled so a failed buy (no gold) can't soft-lock combat.
	// tank discipline: potion trips are merchant-only — fighters hold for the supply
	// run (never merely low). abandoned + bone-dry may still trip, idle moment only.
	var qh = quantity("hpot0") + quantity("hpot1"), qm = quantity("mpot0") + quantity("mpot1");
	var low = qh < CONFIG.potionMin || qm < CONFIG.potionMin;
	var mayTrip = character.name == CONFIG.merchant ||
		(qh == 0 && qm == 0 && !get_player(CONFIG.merchant));
	if (low && mayTrip && (!hasTarget || smart.moving) && Date.now() - potionTrip > 30000) {
		potionTrip = Date.now();
		if (!smart.moving) {
			// "potions" shortcut (validated per-map coords — never find_npc raw
			// coords, which cause the pathfinder restart loop). teleport only when
			// already on the main map; off-main the shortcut routes to the local shop.
			stop("smart");
			(character.map == "main" ? town().catch(function () {}) : Promise.resolve())
				.then(function () { return smart_move_safe("potions", 45000); })
				.then(function () {
					buy("hpot1", 200).catch(function () {});
					buy("mpot1", 200).catch(function () {});
				})
				.catch(function () {});
		}
		return true;
	}
	return false;
}
