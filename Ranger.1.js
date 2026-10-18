// Ranger.1.js — party leader, single-aggro picker. Slot 1.
load_code(99);
CONFIG.monsters = ["goo"]; // override per farm
CONFIG.allowAoE = false;   // single-aggro: never array-target skills
var lockedId = null, marked = null, lockTime = 0;
var lastCm = { target: undefined, x: 0, y: 0, map: "" }, lastCmT = 0;

function locked() {
	var m = lockedId ? get_monster(lockedId) : null;
	if (m && !m.dead && m.visible) return m;
	lockedId = null; marked = null;
	return null;
}

function isolated(t) {
	// true if no other live monster in body-aggro range — prefers clean pulls
	for (var id in parent.entities) {
		var e = parent.entities[id];
		if (e.type == "monster" && !e.dead && e.id != t.id && distance(t, e) < 60) return false;
	}
	return true;
}

function pick() {
	// LIST-ONLY: never touch unlisted types. tiered within the list —
	// 1. isolated untargeted of any listed type  2. any untargeted listed  3. nearest listed (help party)
	for (var i = 0; i < CONFIG.monsters.length; i++) {
		var t = get_nearest_monster({ type: CONFIG.monsters[i], no_target: true });
		if (t && isolated(t)) return t;
	}
	for (var j = 0; j < CONFIG.monsters.length; j++) {
		var u = get_nearest_monster({ type: CONFIG.monsters[j], no_target: true });
		if (u) return u;
	}
	for (var k = 0; k < CONFIG.monsters.length; k++) {
		var v = get_nearest_monster({ type: CONFIG.monsters[k] });
		if (v) return v;
	}
	return null; // nothing listed in vision → idle "scout", no attack, no pull
}

setInterval(function () {
	if (check_rip()) return;
	// pick FIRST so sustain knows a target exists — potion trips only run when truly idle.
	// current lock always finishes; new locks wait for a healthy tank.
	var healthy = tank_healthy();
	var t = locked() || (healthy ? pick() : null);
	if (sustain(!!t)) return;
	if (t) {
		if (lockedId != t.id) { lockedId = t.id; lockTime = Date.now(); }
		if (Date.now() - lockTime > 15000 && !t.visible) { lockedId = null; t = null; }
	}
	if (t) {
		change_target(t); // never switch while locked
		if (marked != t.id && try_skill("huntersmark", t)) marked = t.id;
		if (aggro_lost(t)) kite_step(t, CONFIG.tank); // tanks failed -> kite to melee, still DPS
		// single-target only: no 3shot/5shot array attacks
		if (!try_skill("supershot", t) && !try_skill("piercingshot", t) && can_attack(t)) {
			attack(t).then(function () { reduce_cooldown("attack", character.ping * 0.95); }).catch(function () {});
		}
		else hold_range(t, CONFIG.tank); // standoff band: step in/out, else hold
	}
	// broadcast picker state — followers follow/move to this on any map.
	// change-triggered + 2s heartbeat (was: every tick — socket + log spam).
	if (CONFIG.party.length) {
		var msg = { target: t ? t.id : null, locked: !!t,
			x: Math.round(character.x), y: Math.round(character.y), map: character.map };
		if (msg.target != lastCm.target || msg.map != lastCm.map ||
			Math.hypot(msg.x - lastCm.x, msg.y - lastCm.y) > 30 || Date.now() - lastCmT > 2000) {
			lastCm = msg; lastCmT = Date.now();
			send_cm(CONFIG.party, msg).catch(function () {});
		}
	}
	set_message(t ? t.name : (healthy ? "scout" : "wait tank"));
}, 250);
