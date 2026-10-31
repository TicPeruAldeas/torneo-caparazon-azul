// Torneo general de la tarde: calendario, puntajes y conexión en vivo (compartido por /marcador y /control)
(function () {
  // Respaldo para navegadores de tablets algo antiguas
  if (!Element.prototype.replaceChildren) Element.prototype.replaceChildren = function () { while (this.firstChild) this.removeChild(this.firstChild); this.append.apply(this, arguments); };
  // Calendario de parejas rotativas (Mario Kart y Mario Tennis): [[pareja A], [pareja B]]
  // 12 jugadores: 4 partidas cada uno, nunca el mismo compañero, nunca dos partidas seguidas
  const SCHEDULE = [
    [[8, 11], [5, 10]], [[2, 4], [1, 6]], [[7, 12], [3, 9]], [[2, 10], [1, 5]], [[7, 11], [4, 12]], [[8, 9], [3, 6]],
    [[5, 12], [1, 4]], [[2, 8], [7, 9]], [[6, 10], [3, 11]], [[4, 7], [5, 9]], [[2, 6], [10, 12]], [[1, 11], [3, 8]]
  ];
  const PLAYERS = 12, MATCHES = SCHEDULE.length;
  const NUMS = Array.from({ length: PLAYERS }, (_, i) => i + 1);
  const GAME_NAMES = { mk: "Mario Kart World", tennis: "Mario Tennis", smash: "Smash Bros. Ultimate" };
  const GAME_SHORT = { mk: "Mario Kart", tennis: "Tennis", smash: "Smash" };
  const SMASH = {
    campeon: { label: "Campeón", pts: 12, slots: 1 },
    sub: { label: "Subcampeón", pts: 11, slots: 1 },
    tercero: { label: "3.º lugar", pts: 10, slots: 1 },
    cuarto: { label: "4.º lugar", pts: 9, slots: 1 },
    cuartos: { label: "Eliminado en cuartos", pts: 6.5, slots: 4 },
    primera: { label: "Eliminado en 1.ª ronda", pts: 3, slots: 3 }
  };

  const fmt = x => x == null ? "—" : (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));

  // Jugadores por número: nombre y personaje desde las reservas; noSmash = no juega Smash
  function playersByNum(state) {
    const t = state.tournament || {}, out = {}, off = t.smashOut || [];
    for (const p of state.picks || []) {
      const n = t.numbers?.[p.id];
      if (n) out[n] = { num: n, name: p.name, character: p.character, pickId: p.id, noSmash: off.includes(p.id) };
    }
    for (const n of NUMS) if (!out[n]) out[n] = { num: n, name: `Jugador ${n}`, character: null, pickId: null, noSmash: false };
    return out;
  }

  function mkMatch(t, i) {
    const res = t.mk?.[i] || {}, [A, B] = SCHEDULE[i];
    const all = [...A, ...B], complete = all.every(n => res[n]);
    const pts = {};
    for (const n of all) if (res[n]) pts[n] = 25 - res[n];
    let bonus = null;
    if (complete) {
      const sa = pts[A[0]] + pts[A[1]], sb = pts[B[0]] + pts[B[1]];
      bonus = sa > sb ? "A" : sb > sa ? "B" : null;
      return { res, pts, complete, bonus, sumA: sa, sumB: sb };
    }
    return { res, pts, complete, bonus, sumA: null, sumB: null };
  }

  function tennisMatch(t, i) {
    const r = t.tennis?.[i];
    const complete = !!r && r.a !== r.b && (r.a === 3 || r.b === 3);
    return { a: r?.a ?? null, b: r?.b ?? null, complete, winner: complete ? (r.a === 3 ? "A" : "B") : null };
  }

  // Ranking de un juego → puntos generales 12..1; empates (mismos puntos, desempate y orden manual) se reparten
  function generalPoints(stats, tieKey, tb) {
    const key = n => [stats[n].pts, stats[n][tieKey], tb?.[n] ? 100 - tb[n] : 0];
    const order = [...NUMS].sort((a, b) => {
      const ka = key(a), kb = key(b);
      return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2] || a - b;
    });
    let i = 0;
    while (i < order.length) {
      let j = i;
      const k = key(order[i]).join("|");
      while (j + 1 < order.length && key(order[j + 1]).join("|") === k) j++;
      let sum = 0;
      for (let p = i; p <= j; p++) sum += PLAYERS - p;
      for (let p = i; p <= j; p++) { stats[order[p]].gp = sum / (j - i + 1); stats[order[p]].rank = i + 1; stats[order[p]].tied = j > i; }
      i = j + 1;
    }
    return order;
  }

  function compute(state) {
    const t = state.tournament || {};
    const mk = {}, tennis = {}, smash = {};
    for (const n of NUMS) {
      mk[n] = { pts: 0, firsts: 0, played: 0, bonus: 0, gp: null, rank: null, tied: false };
      tennis[n] = { pts: 0, wins: 0, played: 0, gp: null, rank: null, tied: false };
    }
    let mkDone = 0, tennisDone = 0;
    SCHEDULE.forEach(([A, B], i) => {
      const m = mkMatch(t, i);
      for (const [n, p] of Object.entries(m.pts)) {
        mk[n].pts += p; mk[n].played++;
        if (m.res[n] === 1) mk[n].firsts++;
      }
      if (m.complete) {
        mkDone++;
        if (m.bonus) for (const n of m.bonus === "A" ? A : B) { mk[n].pts += 3; mk[n].bonus += 3; }
      }
      const tm = tennisMatch(t, i);
      if (tm.complete) {
        tennisDone++;
        for (const [side, pair] of [["A", A], ["B", B]]) {
          const games = side === "A" ? tm.a : tm.b, won = tm.winner === side;
          for (const n of pair) { tennis[n].pts += games + (won ? 3 : 0); tennis[n].played++; if (won) tennis[n].wins++; }
        }
      }
    });
    const mkOrder = generalPoints(mk, "firsts", t.tb?.mk);
    const tennisOrder = generalPoints(tennis, "wins", t.tb?.tennis);
    if (!mkDone) for (const n of NUMS) mk[n].gp = null;
    if (!tennisDone) for (const n of NUMS) tennis[n].gp = null;
    let smashDone = 0;
    const P = playersByNum(state), smashIn = NUMS.filter(n => !P[n].noSmash);
    for (const n of NUMS) {
      const out = P[n].noSmash, st = out ? null : t.smash?.[n];
      smash[n] = { stage: st || null, gp: st ? SMASH[st].pts : null, out };
      if (st) smashDone++;
    }
    const total = {};
    for (const n of NUMS) total[n] = (mk[n].gp || 0) + (tennis[n].gp || 0) + (smash[n].gp || 0);
    const generalOrder = [...NUMS].sort((a, b) => total[b] - total[a] || a - b);
    const generalRank = {};
    generalOrder.forEach((n, i) => { generalRank[n] = i > 0 && total[n] === total[generalOrder[i - 1]] ? generalRank[generalOrder[i - 1]] : i + 1; });
    return { mk, tennis, smash, total, mkOrder, tennisOrder, generalOrder, generalRank, smashIn, progress: { mk: mkDone, tennis: tennisDone, smash: smashDone, smashTotal: smashIn.length } };
  }

  const matchDone = (t, g, i) => g === "mk" ? mkMatch(t, i).complete : tennisMatch(t, i).complete;

  // Quién está jugando la partida en pantalla y quién entra en la siguiente
  function onDeck(t) {
    const g = t.current?.game, i = t.current?.match ?? 0;
    const out = { playing: new Set(), next: new Set() };
    if (g !== "mk" && g !== "tennis") return out;
    if (!matchDone(t, g, i)) SCHEDULE[i].flat().forEach(n => out.playing.add(n));
    for (let k = i + 1; k < SCHEDULE.length; k++) {
      if (!matchDone(t, g, k)) { SCHEDULE[k].flat().forEach(n => out.next.add(n)); break; }
    }
    return out;
  }

  // Próxima partida pendiente de un jugador, empezando por el juego en curso
  function nextMatchFor(t, num) {
    const start = t.current?.game === "tennis" ? ["tennis", "mk"] : ["mk", "tennis"];
    for (const g of start) {
      for (let i = 0; i < SCHEDULE.length; i++) {
        const [A, B] = SCHEDULE[i];
        if (!A.includes(num) && !B.includes(num)) continue;
        if (matchDone(t, g, i)) continue;
        const mine = A.includes(num) ? A : B, rivals = mine === A ? B : A;
        const partner = mine.find(n => n !== num);
        const isNow = t.current?.game === g && t.current?.match === i;
        const ahead = t.current?.game === g ? SCHEDULE.slice(t.current.match, i).filter((_, k) => !matchDone(t, g, t.current.match + k)).length : null;
        return { game: g, match: i, partner, rivals, isNow, ahead };
      }
    }
    return null;
  }

  // Exportar: CSV para Excel (separador ; y coma decimal)
  function toCsv(state) {
    const C = compute(state), P = playersByNum(state);
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Puesto", "Número", "Jugador", "Personaje", "Pts Mario Kart", "Pts Tennis", "Pts Smash", "Total", "MK puntos", "MK 1.º puestos", "Tennis puntos", "Tennis victorias", "Smash etapa"]];
    for (const n of C.generalOrder) {
      rows.push([C.generalRank[n], n, P[n].name, P[n].character || "", fmt(C.mk[n].gp), fmt(C.tennis[n].gp), fmt(C.smash[n].gp), fmt(C.total[n]),
        C.mk[n].pts, C.mk[n].firsts, C.tennis[n].pts, C.tennis[n].wins, C.smash[n].out ? "No juega" : C.smash[n].stage ? SMASH[C.smash[n].stage].label : ""]);
    }
    return "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n");
  }
  // Datos en vivo: personajes + estado por SSE; reloj alineado con el servidor
  let offset = 0;
  const serverNow = () => Date.now() + offset;
  async function connect(onState, onStatus) {
    const chars = await fetch("/characters.json").then(r => r.json());
    const charById = Object.fromEntries(chars.characters.map(c => [c.id, c]));
    const open = () => {
      const es = new EventSource("/api/events");
      es.onopen = () => onStatus?.(true);
      es.onmessage = ev => {
        try {
          const st = JSON.parse(ev.data);
          if (st.now) offset = st.now - Date.now();
          onState(st, { chars, charById });
        } catch (e) { console.error(e); }
      };
      es.onerror = () => onStatus?.(false);
    };
    open();
    return { chars, charById };
  }

  // Presentación de reglas: una pantalla a la vez
  const SLIDES = [
    { theme: "mario", tag: "Bienvenida", title: "Torneo general de la tarde", lead: "12 jugadores · 3 juegos · gana quien sume más puntos generales",
      games: [["mk", "Mario Kart World", "En parejas que cambian cada partida"], ["tennis", "Mario Tennis", "Dobles, en parejas que cambian"], ["smash", "Super Smash Bros. Ultimate", "1 vs 1, eliminación directa"]] },
    { theme: "mario", tag: "Parejas", title: "Parejas que cambian", lead: "En Mario Kart y en Mario Tennis",
      items: ["Un sorteo te da un número del 1 al 12.", "Con ese número juegas 4 partidas, cada una con un compañero distinto.", "Tus 4 compañeros y tus rivales salen del sorteo: nadie los elige.", "Nunca juegas dos partidas seguidas."] },
    { theme: "mk", tag: "Juego 1", title: "Mario Kart · tus puntos", sections: [
      ["Tu carrera", "Mientras mejor llegues, más sumas: 1.º = 24 pts, 2.º = 23, 3.º = 22… (25 menos tu puesto)."],
      ["Versus", "Cada carrera es un versus entre 2 parejas. Se suman los puntos individuales de los dos: gana la pareja que sume más."],
      ["Bono +3", "Si tu pareja gana el versus, cada uno recibe +3 puntos adicionales, individualmente. Ej.: si llegaste 3.º, te tocan 22 por tu puesto + 3 del bono = 25.", "gold"],
      ["Al final", "Se suman tus 4 carreras. Si dos quedan con los mismos puntos, va adelante quien ganó más carreras."]] },
    { theme: "tennis", tag: "Juego 2", title: "Mario Tennis · tus puntos", sections: [
      ["Partido", "Cada partido es un versus entre 2 parejas. Gana la pareja que llegue primero a 3 juegos."],
      ["Tus puntos", "Por cada juego que gane tu pareja, sumas 1 punto (tú y tu compañero)."],
      ["Bono +3", "Si tu pareja gana el partido, cada uno recibe +3 puntos adicionales, individualmente. Ej.: ganan 3 a 1 → sumas 3 por los juegos + 3 del bono = 6. Los que perdieron se llevan 1 (el juego que ganaron).", "gold"],
      ["Al final", "Se suman tus 4 partidos. Si dos quedan con los mismos puntos, va adelante quien ganó más partidos."]] },
    { theme: "smash", tag: "Juego 3", title: "Smash Bros. · tus puntos", sections: [
      ["Formato", "Todos contra todos en llaves 1 vs 1: si pierdes, quedas eliminado. Juegan 11."],
      ["Puntos", "Según hasta dónde llegues: Campeón 12 · Subcampeón 11 · 3.º 10 · 4.º 9 · eliminado en cuartos 6,5 · eliminado en primera ronda 3."]] },
    { theme: "mario", tag: "Puntos generales", title: "¿Cómo se gana la tarde?", lead: "En Mario Kart y Mario Tennis se arma una tabla. Según tu puesto en cada tabla, sumas:",
      table: true, foot: "Esos puntos + los de Smash = tu total. Gana quien tenga el total más alto. Si dos empatan en un puesto, se reparten esos puntos." },
    { theme: "mario", tag: "Importante", title: "Antes de empezar",
      items: ["Los resultados se anotan apenas termina cada partida.", "Las reglas no cambian a mitad de un juego.", "Gana la tarde quien sume más puntos en los 3 juegos."] }
  ];

  // Sorteo en vivo: presentación y luego un número cada STEP ms (ruleta SPIN ms y revelación)
  const DRAW = { INTRO: 3500, STEP: 3000, SPIN: 2000 };
  function drawPhase(draw) {
    if (!draw?.at) return null;
    const ms = serverNow() - draw.at;
    if (ms < DRAW.INTRO) return { phase: "intro", revealed: 0, k: 0 };
    const step = Math.floor((ms - DRAW.INTRO) / DRAW.STEP);
    if (step >= PLAYERS) return { phase: "done", revealed: PLAYERS, k: PLAYERS - 1 };
    const inStep = (ms - DRAW.INTRO) % DRAW.STEP;
    return { phase: inStep < DRAW.SPIN ? "spin" : "show", revealed: inStep < DRAW.SPIN ? step : step + 1, k: step };
  }

  // Cronómetros: tiempo acumulado + lo que corre desde start (hora del servidor)
  function elapsed(tm) { return tm ? (tm.acc || 0) + (tm.running ? Math.max(0, serverNow() - tm.start) : 0) : 0; }
  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (hh ? hh + ":" + String(mm).padStart(2, "0") : String(mm).padStart(2, "0")) + ":" + String(ss).padStart(2, "0");
  }

  window.Torneo = { SCHEDULE, NUMS, PLAYERS, MATCHES, GAME_NAMES, GAME_SHORT, SMASH, fmt, playersByNum, mkMatch, tennisMatch, matchDone, compute, onDeck, nextMatchFor, toCsv, serverNow, elapsed, fmtDuration, SLIDES, DRAW, drawPhase, connect };
})();
