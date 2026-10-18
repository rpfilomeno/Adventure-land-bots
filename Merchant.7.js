// Merchant.7.js — party mule: loots, funnels, sells, supplies. Slot 7.
// Never stands — town only for sale/potion errands (teleport-first), otherwise
// glued to the party. Loot is vendor-sold via sell_all_junk (no player stand).
load_code(99);
var lastPos = null, lastMoveT = 0;
var LOOT_SWEEP = 500; // chase chests within this range of self
var LOOT_REACH = 80;  // walk until this close, loot() fires each tick anyway
CONFIG.supplyEvery = 5 * 60 * 1000; // restock interval (kept)
CONFIG.supplyTopBase = 500;  // initial stock target (adapts to party consumption)
CONFIG.supplyTopMin = 500;   // never buffer less
CONFIG.supplyTopMax = 5000;  // cap
CONFIG.supplyCover = 2;      // buffer = 2 intervals of measured consumption
CONFIG.supplyTop = CONFIG.supplyTopBase;
CONFIG.supplyKeep = 75;      // reserve floor she never delivers below
CONFIG.deliverAmount = 50;   // pots handed per member per delivery
var delivered = 0, consumption = 0, lastCalc = Date.now(); // consumption tracking
var supplyRun = false, supplySince = 0, lastSupply = Date.now();
var supplyFails = 0, supplyCooldownUntil = 0; // 3 straight failures → 15-min backoff
var potRetryUntil = 0; // failed buys back off: rejoin party, retry later
var potPorted = false, potLegs = 0, potShopAt = 0; // per-episode warp + bounded legs

// town task over (or retry pending) → stop shop plots, walk straight back.
function return_to_party() {
	stop("smart");
	follow_ranger(-25, -10);
}

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
	else if (smart.moving && Date.now() - lastMoveT > 12000) stop("smart");
}

function potion_stacks(stat) {
	return character.items.map(function (item, slot) { return { item: item, slot: slot }; })
		.filter(function (e) { return e.item && !e.item.l && !e.item.b && !e.item.r &&
			G.items[e.item.name] && G.items[e.item.name].type == "pot" &&
			G.items[e.item.name].gives.some(function (g) { return g[0] == stat && g[1] > 0; }); });
}

function potion_count(stat) {
	return potion_stacks(stat).reduce(function (s, e) { return s + (e.item.q || 1); }, 0);
}

// 20s timeout race: a never-settling move rejects instead of wedging the run.
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

// stock potions at the nearest seller ("potions" shortcut). NO delivery here —
// delivery is passive (deliver_nearby) and same-map only, so there is no
// cross-map recipient walk to loop on. returns ok:false only on a real failure
// (gold / shop unreachable) so the 3-fail → 15-min backoff can engage.
async function supply_friend() {
	var hp = Math.max(0, CONFIG.supplyTop - potion_count("hp"));
	var mp = Math.max(0, CONFIG.supplyTop - potion_count("mp"));
	if (hp <= 0 && mp <= 0) return { ok: true, stocked: true }; // already stocked
	var hpg = (G.items.hpot0 && G.items.hpot0.g) || 0, mpg = (G.items.mpot0 && G.items.mpot0.g) || 0;
	var hpN = hp, mpN = mp;
	if (hpg > 0 && mpg > 0) { // affordability: HP first, MP with remainder, keep 4000
		var gold = character.gold - 4000;
		hpN = gold > 0 ? Math.min(hp, Math.floor(gold / hpg)) : 0;
		mpN = gold > 0 ? Math.min(mp, Math.floor(Math.max(0, gold - hpN * hpg) / mpg)) : 0;
		if (hpN <= 0 && mpN <= 0) return { ok: false, reason: "gold" };
	}
	stop("smart");
	// "potions" shortcut = validated per-map shop coords (main 56,-122;
	// winter_inn/halloween elsewhere). never find_npc raw coords — those trigger
	// the engine's infinite "Searching for path" restart loop. teleport only on main.
	if (character.map == "main") {
		var terr = await attempt(town(), 30000, "town");
		if (terr) return { ok: false, reason: terr };
	}
	if (character.rip) return { ok: false, reason: "rip" };
	try { await smart_move_safe("potions", 45000); }
	catch (e) { return { ok: false, reason: (e && e.reason) || "move_shop" }; }
	sell_all_junk(); // at the seller anyway → sell loot too (frees slots + gold)
	if (typeof sleep == "function") await sleep(1500); // let sells land before buying
	if (hpN > 0) { try { await buy_with_gold("hpot0", hpN); } catch (e) {} }
	if (mpN > 0) { try { await buy_with_gold("mpot0", mpN); } catch (e) {} }
	return { ok: true, bought: hpN + mpN };
}

// passive top-up: hand pots to nearby party members on the SAME map (no walking).
// per-member cooldown bounds sends; amounts are counted into `delivered` so the
// stock target can track how fast the party actually burns potions.
var lastDeliver = {};
function deliver_nearby() {
	var sent = 0;
	for (var i = 0; i < CONFIG.party.length && sent < 2; i++) {
		var n = CONFIG.party[i];
		if (n == character.name) continue;
		var f = get_player(n);
		if (!f || f.rip || f.map != character.map || distance(character, f) > 200) continue;
		if (Date.now() - (lastDeliver[n] || 0) < 90000) continue; // 90s per member
		var any = false;
		for (var s = 0; s < 2 && sent < 2; s++) {
			var stat = s ? "mp" : "hp";
			var entry = potion_stacks(stat)[0];
			if (!entry) continue;
			var amount = Math.min(CONFIG.deliverAmount, entry.item.q || 1, potion_count(stat) - CONFIG.supplyKeep);
			if (amount <= 0) continue;
			send_item(n, entry.slot, amount).catch(function () {});
			delivered += amount; // feeds consumption tracking
			sent++; any = true;
		}
		if (any) lastDeliver[n] = Date.now();
	}
	return sent;
}

// buffer adapts to measured consumption: what she handed out over the last
// interval ≈ what the party burned. EWMA smooths it; clamped to [min, max].
function update_stock_target() {
	consumption = consumption ? consumption * 0.5 + delivered * 0.5 : delivered;
	CONFIG.supplyTop = Math.min(CONFIG.supplyTopMax, Math.max(CONFIG.supplyTopMin, Math.round(consumption * CONFIG.supplyCover)));
	CONFIG.supplyKeep = Math.max(75, Math.round(CONFIG.supplyTop * 0.15));
	CONFIG.deliverAmount = Math.max(50, Math.round(CONFIG.supplyTop * 0.1));
	delivered = 0;
	lastCalc = Date.now();
}

setInterval(function () {
	if (check_rip()) return;
	use_hp_or_mp();
	regen_check(); // dry → regen (shared cooldown keeps pots first)
	for (var id in get_chests()) loot(id);
	tidy_inventory(); // sell junk nearby, or flag a town sale trip when full
	var dry = quantity("hpot0") + quantity("hpot1") == 0 && quantity("mpot0") + quantity("mpot1") == 0; // no pots at all
	deliver_nearby(); // passive same-map top-up (no walking; feeds consumption tracking)
	if (town_sell_tick()) { unstuck(); set_message("sell"); return; } // full → seller trip
	if (supplyRun) { // stock run in progress — async fn drives movement, don't fight it
		if (Date.now() - supplySince > 180000) { supplyRun = false; stop("smart"); } // watchdog
		else { unstuck(); set_message("supply"); return; }
	}
	// adapt the stock target to measured consumption once per interval.
	if (Date.now() - lastCalc > CONFIG.supplyEvery) update_stock_target();
	// trip to restock on the 5-min schedule (when below target) OR when down to the
	// reserve floor. no page can force an off-schedule trip (walk-back time is safe).
	var hpN = potion_count("hp"), mpN = potion_count("mp");
	var needStock = hpN < CONFIG.supplyTop || mpN < CONFIG.supplyTop;
	var emergency = hpN < CONFIG.supplyKeep || mpN < CONFIG.supplyKeep;
	if (needStock && !townTrip && !in_instance(character.map) && free_slots() > 1 &&
		Date.now() > supplyCooldownUntil && Date.now() - lastSupply > 120000 && // min gap between runs
		(Date.now() - lastSupply > CONFIG.supplyEvery || emergency)) {
		stop("smart");
		supplyRun = true; supplySince = Date.now();
		supply_friend().then(function (r) {
			log("supply: " + JSON.stringify(r));
			if (r && r.ok) supplyFails = 0;
			else { // failed run: count, back off hard after 3 straight — ends the town yo-yo
				supplyFails++;
				if (supplyFails >= 3) { supplyCooldownUntil = Date.now() + 15 * 60 * 1000; log("supply backing off 15m"); }
			}
		}).catch(function () { log("supply failed"); supplyFails++; })
			.then(function () { supplyRun = false; lastSupply = Date.now(); });
		set_message("supply"); return;
	}
	// dry off-main → walk to this map's nearest potions seller (no forced town)
	if (dry && character.map != "main") {
		if (!smart.moving) smart_move_safe("potions", 45000).catch(function () {});
		unstuck(); set_message("pots!"); return;
	}
	// self resupply (any map): teleport only on main, else walk to the local seller.
	// still low after 3 legs → back off 3 min and rejoin the party immediately.
	var lowPots = quantity("hpot0") + quantity("hpot1") < CONFIG.potionMin ||
		quantity("mpot0") + quantity("mpot1") < CONFIG.potionMin;
	if (!lowPots) potPorted = false;
	if (lowPots) {
		if (Date.now() < potRetryUntil) { return_to_party(); unstuck(); set_message("pots"); return; }
		if (!potPorted) {
			potPorted = true; potLegs = 0; potShopAt = 0;
			// teleport only when on main; off-main fall through to the local-seller walk
			if (character.map == "main" && !is_transporting(character)) { stop("smart"); town().catch(function () {}); }
			unstuck(); set_message("pots"); return;
		}
		if (Date.now() - potShopAt > 10000) {
			potShopAt = Date.now();
			sell_all_junk(); // at the seller → dump loot while buying pots
			// affordability: top up what the gold covers (keep 2000), skip when broke
			var hg = (G.items.hpot1 && G.items.hpot1.g) || 100, mg = (G.items.mpot1 && G.items.mpot1.g) || 100;
			var aff = Math.max(0, character.gold - 2000);
			var nH = Math.min(200, Math.floor(aff / hg)), nM = Math.min(200, Math.floor(Math.max(0, aff - nH * hg) / mg));
			if (nH > 0) buy("hpot1", nH).catch(function () {});
			if (nM > 0) buy("mpot1", nM).catch(function () {});
			if (nH <= 0 && nM <= 0) { potRetryUntil = Date.now() + 3 * 60 * 1000; potPorted = false; }
			else if (!smart.moving) smart_move_safe("potions", 45000).catch(function () {});
			if (++potLegs >= 3) { potRetryUntil = Date.now() + 3 * 60 * 1000; potPorted = false; }
		}
		unstuck(); set_message("pots"); return; // keep resupplying until stocked / potLegs cap
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
