// Mage.5.js — ranged dps, kites if tanks drop aggro. Slot 5.
load_code(99);

setInterval(function () {
	if (check_rip()) return;
	var a = assist_target();
	if (sustain(a.seen)) return;
	if (!a.seen) { follow_ranger(-30, 10); return; }
	var m = a.monster;
	if (aggro_lost(m)) { // tanks failed -> kite at max range, keep DPS
		try_skill("mshield", character);
		kite_step(m, CONFIG.tank);
		if (!try_skill("burst", m) && can_attack(m)) attack(m);
		return;
	}
	if (distance(character, m) < character.range * 0.6) kite_step(m, CONFIG.tank); // too close — back off
	if (!is_in_range(m, "burst")) {
		if (!is_in_range(m) && distance(character, m) > character.range * 1.5 && can_use("blink", null))
			use_skill("blink", [m.x + 20, m.y]).catch(function () { xmove(m.x, m.y); });
		else if (!is_moving(character)) xmove(m.x, m.y);
		return;
	}
	var priest = CONFIG.priest ? get_player(CONFIG.priest) : null;
	if (priest && priest.mp / priest.max_mp < 0.5 && can_use("energize", priest)) try_skill("energize", priest, 300);
	if (!try_skill("burst", m) && !try_skill("cburst", m) && !try_skill("mentalburst", m) && can_attack(m)) attack(m);
}, 250);
