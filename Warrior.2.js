// Warrior.2.js — main tank, holds aggro. Slot 2.
load_code(99);

setInterval(function () {
	if (check_rip()) return;
	var a = assist_target();
	if (sustain(a.seen)) return; // target known → trips wait for idle (or never, mule's job)
	if (!a.seen) { follow_ranger(20, 0); return; } // run to ranger = run to monster
	var m = a.monster;
	// re-taunt if add is on backline (kept even while critical — hold aggro retreating)
	var vt = get_target_of(m);
	if (vt && vt != character && (vt.name == CONFIG.ranger || in_arr(vt.name, CONFIG.party))) try_skill("taunt", m);
	if (character.name == CONFIG.tank && tank_critical()) {
		kite_step(m, backline_anchor()); // critical — kite to backline, no gap-closing
		if (can_attack(m)) attack(m);
		set_message("critical"); return;
	}
	if (character.name == CONFIG.tank && !tank_healthy() && !is_in_range(m)) {
		set_message("recover"); return; // battered — hold ground, don't pull next
	}
	if (!is_in_range(m)) { if (!is_moving(character)) xmove(m.x, m.y); return; }
	if (!try_skill("charge", m) && !try_skill("stomp", m) && !try_skill("agitate", m)
		&& !try_skill("cleave", m) && !try_skill("warcry") && can_attack(m)) attack(m);
	set_message("tank:" + (m.name || ""));
}, 250);
