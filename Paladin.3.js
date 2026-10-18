// Paladin.3.js — off-tank, peels for priest. Slot 3.
load_code(99);

setInterval(function () {
	if (check_rip()) return;
	var a = assist_target();
	if (sustain(a.seen)) return;
	// peel: monster hitting priest first
	var peel = null;
	for (var id in parent.entities) {
		var e = parent.entities[id];
		if (e.type == "monster" && !e.dead && get_target_of(e) && in_arr(get_target_of(e).name, CONFIG.party)) { peel = e; break; }
	}
	var m = peel;
	if (!m) {
		if (!a.seen) { follow_ranger(-20, 0); return; } // run to ranger = run to monster
		m = a.monster;
	}
	if (character.hp / character.max_hp < CONFIG.tankCritHp) {
		kite_step(m, backline_anchor()); // critical — kite to backline, no gap-closing
		if (can_attack(m)) attack(m);
		set_message("critical"); return;
	}
	if (character.hp < character.max_hp * 0.5) { try_skill("absorb", character); heal(character); }
	if (!is_in_range(m)) { if (!is_moving(character)) xmove(m.x, m.y); return; }
	if (!try_skill("stomp", m) && !try_skill("cleave", m) && can_attack(m)) attack(m);
	if (character.hp < character.max_hp * 0.35 && can_heal(character)) heal(character);
}, 250);
