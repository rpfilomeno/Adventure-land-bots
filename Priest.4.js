// Priest.4.js — heals + support, kites toward tank. Slot 4.
load_code(99);

function lowest() {
	var best = null, ratio = 1;
	for (var i = 0; i < CONFIG.party.length; i++) {
		var p = get_player(CONFIG.party[i]) || (CONFIG.party[i] == character.name ? character : null);
		if (!p || p.rip || !p.visible) continue;
		var r = p.hp / p.max_hp;
		if (r < ratio) { ratio = r; best = p; }
	}
	var me = character.hp / character.max_hp;
	if (me < ratio) { ratio = me; best = character; }
	return { who: best, ratio: ratio };
}

setInterval(function () {
	if (check_rip()) return;
	var pm = RangerMsg.target ? get_monster(RangerMsg.target) : null;
	if (sustain(!!(pm && !pm.dead))) return;
	var m = pm;
	if (m && aggro_lost(m)) kite_step(m, CONFIG.tank); // kite toward tank, not randomly
	// revive first: nearest dead party member in range (lowest() skips the dead)
	for (var i = 0; i < CONFIG.party.length; i++) {
		var d = get_player(CONFIG.party[i]);
		if (d && d.rip && !d.npc && can_use("revive", d)) { try_skill("revive", d); break; }
	}
	// tank priority: top the tank past the pull gate before anyone else
	var tk = character.name != CONFIG.tank ? get_player(CONFIG.tank) : character;
	if (tk && !tk.rip && tk.hp / tk.max_hp < CONFIG.tankMinHp && is_in_range(tk, "heal") && can_heal(tk)) {
		heal(tk); return;
	}
	var L = lowest();
	if (L.who && L.ratio < 0.8 && is_in_range(L.who, "heal") && can_heal(L.who)) {
		if (L.ratio < 0.6) try_skill("partyheal");
		else heal(L.who);
		return;
	}
	if (!follow_ranger(-30, -10)) { // backline of ranger
		if (m && can_use("curse", m)) try_skill("curse", m);
		else if (m && can_use("darkblessing")) try_skill("darkblessing");
	}
	set_message(L.who ? "heal:" + L.who.name : "follow");
}, 250);
