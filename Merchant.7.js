// Merchant.7.js — party mule: loots, funnels, sells, supplies. Slot 7.
// Never stands — town only for ONE combined run (sell the bag + restock),
// teleport-first, otherwise glued to the party. Loot is vendor-sold at the
// seller (no player stand). Caps and timings live in CONFIG (Common.99.js).
load_code(99);
var lastPos = null, lastMoveT = 0;
var LOOT_SWEEP = 500; // chase chests within this range of self
var LOOT_REACH = 80;  // walk until this close, loot() fires each tick anyway

var runActive = false, runSince = 0, lastRun = Date.now(); // the one town run
var runFails = 0, runCooldownUntil = 0; // 3 straight failures → tripBackoffHard
var lastMuleCm = 0; // heartbeat throttle

// nearest unlooted chest with coordinates, within maxDist of self
function nearest_chest(maxDist) {
	var best = null, bd = maxDist || Infinity;
	var chests = get_chests();
	for (var id in chests) {
		var c = chests[id];
		if (!c || c.x == null || c.y == null) continue;
		var d = distance(character, c);
		if (d < bd) { bd = d; best = c; }
	}
	return best;
}

// clear a jammed smart plot (stale plot or blocked path)
function unstuck() {
	var dx = lastPos ? Math.hypot(character.x - lastPos.x, character.y - lastPos.y) : 999;
	if (dx >= 5) { lastPos = { x: character.x, y: character.y }; lastMoveT = Date.now(); }
	else if (smart.moving && Date.now() - lastMoveT > CONFIG.stuckAfter) stop("smart");
}

// timeout race: a never-settling move rejects instead of wedging the run.
function with_timeout(promise, ms) {
	return Promise.race([promise, new Promise(function (_, rej) {
		setTimeout(function () { rej({ reason: "timeout" }); }, ms);
	})]);
}

// await a step; returns null on success or the failure reason string.
async function attempt(promise, ms, reason) {
	try { await with_timeout(promise, ms); return null; }
	catch (e) { return (e && e.reason) || reason; }
}

// heartbeat: lets fighters tell "mule offline" (vendor it yourself) from "mule
// merely away or dead" (hold and wait for her).
function mule_heartbeat() {
	if (Date.now() - lastMuleCm < 5000) return;
	lastMuleCm = Date.now();
	send_cm(CONFIG.party, { mule: 1 }).catch(function () {});
}

// biggest pot stack of a stat — delivery must not be capped by a tiny first stack.
function best_pot_stack(stat) {
	var list = potion_stacks(stat), best = null;
	for (var i = 0; i < list.length; i++) {
		if (!best || (list[i].item.q || 1) > (best.item.q || 1)) best = list[i];
	}
	return best;
}

// pull delivery: fill pot requests fighters page in (cm {t:"pots"}), same map, no
// walking. only the stats the fighter flagged low are handed, filled to its cap.
// the cooldown is stamped on every attempt, even a failed one, so a pending
// request retries once per delivery cycle instead of once per tick.
var lastDeliver = {}, potRequests = {};
character.on("cm", function (m) {
	if (!m.message || typeof m.message != "object" || m.message.t != "pots") return;
	if (m.name == character.name || CONFIG.party.indexOf(m.name) < 0) return;
	potRequests[m.name] = { hp: m.message.hp || 0, mp: m.message.mp || 0, at: Date.now() };
});

function deliver_requested() {
	var sent = 0;
	for (var i = 0; i < CONFIG.party.length; i++) {
		var n = CONFIG.party[i];
		if (n == character.name) continue;
		var r = potRequests[n];
		if (!r) continue;
		if (Date.now() - r.at > CONFIG.deliverEvery * 2) { delete potRequests[n]; continue; } // stale
		var f = get_player(n);
		if (!f || f.rip || f.map != character.map) continue; // wait until same map
		if (Date.now() - (lastDeliver[n] || 0) < CONFIG.deliverEvery) continue;
		lastDeliver[n] = Date.now(); // stamped even if nothing can be sent (retry cadence)
		var pending = false;
		for (var s = 0; s < 2; s++) {
			var stat = s ? "mp" : "hp";
			var have = s ? r.mp : r.hp;
			if (have >= CONFIG.potionMin) continue; // this stat wasn't flagged low
			var entry = best_pot_stack(stat);
			if (!entry) { pending = true; continue; } // nothing in stock — keep the request
			var amount = Math.min(CONFIG.potionMax - have, entry.item.q || 1, potion_count(stat) - CONFIG.supplyKeep);
			if (amount <= 0) { pending = true; continue; } // below the reserve floor — keep it
			send_item(n, entry.slot, amount).catch(function () {});
			sent++;
			if (s) r.mp = CONFIG.potionMax; else r.hp = CONFIG.potionMax; // this stat is filled
		}
		if (!pending) delete potRequests[n]; // every flagged stat got its delivery
	}
	return sent;
}

// ONE town run: travel to the seller, sell the whole bag + pot excess, then top
// the stock up to the cap. both triggers (full bag, low stock) share this trip,
// so a bag that fills mid-restock rides along instead of causing a second visit.
async function town_run() {
	stop("smart");
	if (character.map == "main") {
		var terr = await attempt(town(), 30000, "town");
		if (terr) return { ok: false, reason: terr };
	}
	if (character.rip) return { ok: false, reason: "rip" };
	try { await smart_move_safe("potions", CONFIG.tripTimeout); }
	catch (e) { return { ok: false, reason: (e && e.reason) || "move_shop" }; }
	sell_all_junk();
	sell_excess_pots();
	if (free_slots() <= 1) sell_excess_pots(CONFIG.supplyKeep); // still full → emergency floor
	if (typeof sleep == "function") await sleep(1500); // let sells land before buying
	// buy AFTER the sells — they just changed the counts (the old code bought the
	// pre-trip amount and never landed on the target)
	var hpN = Math.max(0, CONFIG.potionMaxMerchant - potion_count("hp"));
	var mpN = Math.max(0, CONFIG.potionMaxMerchant - potion_count("mp"));
	var hpg = (G.items.hpot0 && G.items.hpot0.g) || 0, mpg = (G.items.mpot0 && G.items.mpot0.g) || 0;
	if (hpg > 0 && mpg > 0) { // affordability: HP first, MP with the remainder, keep goldReserve
		var gold = character.gold - CONFIG.goldReserve;
		hpN = gold > 0 ? Math.min(hpN, Math.floor(gold / hpg)) : 0;
		mpN = gold > 0 ? Math.min(mpN, Math.floor(Math.max(0, gold - hpN * hpg) / mpg)) : 0;
		if (hpN <= 0 && mpN <= 0) return { ok: false, reason: "gold" };
	}
	if (hpN > 0) { try { await buy_with_gold("hpot0", hpN); } catch (e) {} }
	if (mpN > 0) { try { await buy_with_gold("mpot0", mpN); } catch (e) {} }
	return { ok: true, bought: hpN + mpN };
}

setInterval(function () {
	if (check_rip()) return;
	use_hp_or_mp();
	regen_check(); // dry → regen (shared cooldown keeps pots first)
	for (var id in get_chests()) loot(id);
	tidy_inventory(); // full → dump the bag (throttled; the mule always sells her own)
	mule_heartbeat();
	deliver_requested(); // fill paged pot requests (no walking)
	if (runActive) { // town run in progress — the async fn drives movement, don't fight it
		if (Date.now() - runSince > CONFIG.tripTimeout) { runActive = false; stop("smart"); } // watchdog
		else { unstuck(); set_message("supply"); return; }
	}
	// ONE trip for both jobs: the bag stuck full (no NPC in reach), or the stock
	// below cap on its cadence — the supplyKeep floor is the emergency case.
	var sinceRun = Date.now() - lastRun;
	var hpN = potion_count("hp"), mpN = potion_count("mp");
	var full = free_slots() <= 1 && sellFailed;
	var needStock = hpN < CONFIG.potionMaxMerchant || mpN < CONFIG.potionMaxMerchant;
	var emergency = hpN < CONFIG.supplyKeep || mpN < CONFIG.supplyKeep;
	var want = full || (needStock && (emergency ? sinceRun > CONFIG.retryEvery : sinceRun > CONFIG.supplyEvery));
	if (want && sinceRun > CONFIG.retryEvery && !in_instance(character.map) && Date.now() > runCooldownUntil) {
		stop("smart");
		runActive = true; runSince = Date.now();
		town_run().then(function (r) {
			log("town: " + JSON.stringify(r));
			if (r && r.ok) runFails = 0;
			else { // failed run: count, back off hard after 3 straight — ends the town yo-yo
				runFails++;
				runCooldownUntil = Date.now() + (runFails >= 3 ? CONFIG.tripBackoffHard : CONFIG.tripBackoff);
				if (runFails >= 3) log("town backing off (hard)");
			}
		}).catch(function () {
			runFails++;
			runCooldownUntil = Date.now() + (runFails >= 3 ? CONFIG.tripBackoffHard : CONFIG.tripBackoff);
		}).then(function () { runActive = false; lastRun = Date.now(); });
		set_message("supply"); return;
	}
	var m = RangerMsg.target ? get_monster(RangerMsg.target) : null;
	if (m && aggro_lost(m)) kite_step(m, CONFIG.tank); // targeted → safety first, no looting
	else {
		var chest = nearest_chest(LOOT_SWEEP);
		if (chest && distance(character, chest) > LOOT_REACH) {
			if (!is_moving(character)) xmove(chest.x, chest.y); // walk to the drops
		}
		else {
			follow_ranger(-25, -10); // hug the party — nothing to grab
			// safe-opportunistic DPS: locked target only, in range, nothing hunting me
			if (m && !m.dead && can_attack(m) && !targeted()) {
				attack(m).catch(function () {});
			}
		}
	}
	unstuck();
	set_message((RangerMsg.map && character.map != RangerMsg.map) ? "wait party" : "mule");
}, 1000);
