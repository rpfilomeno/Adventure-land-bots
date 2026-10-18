// Rogue.6.js — melee dps, retreats to tank when focused. Slot 6.
load_code(99);

setInterval(function () {
	if (check_rip()) return;
	var a = assist_target();
	if (sustain(a.seen)) return;
	if (!a.seen) { follow_ranger(0, 25); return; } // flank ranger → monster enters vision
	var m = a.monster;
	if (aggro_lost(m) && character.hp < character.max_hp * 0.6) {
		kite_step(m, CONFIG.tank); // retreat toward tank, not away
		if (can_attack(m)) attack(m);
		return;
	}
	if (!is_in_range(m)) {
		if (!is_moving(character)) xmove(m.x, m.y);
		return;
	}
	if (!get_target_of(m) && can_use("invis")) try_skill("invis"); // opener only
	if (!try_skill("quickstab", m) && !try_skill("quickpunch", m) && !try_skill("shadowstrike", m)
		&& !try_skill("pcoat") && can_attack(m)) attack(m);
}, 250);
