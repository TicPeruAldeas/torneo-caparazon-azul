// Torneo general de la tarde: calendario, puntajes y conexión en vivo (compartido por /marcador y /control)
(function () {
  // Calendario de parejas rotativas (Mario Kart y Mario Tennis): [[pareja A], [pareja B]]
  const SCHEDULE = [
    [[3, 11], [8, 9]], [[1, 5], [6, 10]], [[2, 4], [7, 13]], [[6, 12], [1, 3]], [[8, 13], [2, 5]],
    [[7, 9], [10, 12]], [[4, 11], [2, 6]], [[3, 5], [7, 12]], [[1, 13], [9, 11]], [[4, 8], [3, 10]],
    [[9, 13], [6, 7]], [[4, 5], [10, 11]], [[1, 2], [8, 12]]
  ];
  const NUMS = Array.from({ length: 13 }, (_, i) => i + 1);
  const GAME_NAMES = { mk: "Mario Kart World", tennis: "Mario Tennis", smash: "Smash Bros. Ultimate" };
  const GAME_SHORT = { mk: "Mario Kart", tennis: "Tennis", smash: "Smash" };
  const SMASH = {
    campeon: { label: "Campeón", pts: 13, slots: 1 },
    sub: { label: "Subcampeón", pts: 12, slots: 1 },
    tercero: { label: "3.º lugar", pts: 11, slots: 1 },
    cuarto: { label: "4.º lugar", pts: 10, slots: 1 },
    cuartos: { label: "Eliminado en cuartos", pts: 7.5, slots: 4 },
    primera: { label: "Eliminado en 1.ª ronda", pts: 3, slots: 5 }
  };

  const fmt = x => x == null ? "—" : (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));

  // Jugadores por número: nombre y personaje desde las reservas
  function playersByNum(state) {
    const t = state.tournament || {}, out = {};
    for (const p of state.picks || []) {
      const n = t.numbers?.[p.id];
      if (n) out[n] = { num: n, name: p.name, character: p.character, pickId: p.id };
    }
    for (const n of NUMS) if (!out[n]) out[n] = { num: n, name: `Jugador ${n}`, character: null, pickId: null };
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

  // Ranking de un juego → puntos generales 13..1; empates (mismos puntos, desempate y orden manual) se reparten
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
      for (let p = i; p <= j; p++) sum += 13 - p;
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
    for (const n of NUMS) {
      const st = t.smash?.[n];
      smash[n] = { stage: st || null, gp: st ? SMASH[st].pts : null };
      if (st) smashDone++;
    }
    const total = {};
    for (const n of NUMS) total[n] = (mk[n].gp || 0) + (tennis[n].gp || 0) + (smash[n].gp || 0);
    const generalOrder = [...NUMS].sort((a, b) => total[b] - total[a] || a - b);
    const generalRank = {};
    generalOrder.forEach((n, i) => { generalRank[n] = i > 0 && total[n] === total[generalOrder[i - 1]] ? generalRank[generalOrder[i - 1]] : i + 1; });
    return { mk, tennis, smash, total, mkOrder, tennisOrder, generalOrder, generalRank, progress: { mk: mkDone, tennis: tennisDone, smash: smashDone } };
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
        C.mk[n].pts, C.mk[n].firsts, C.tennis[n].pts, C.tennis[n].wins, C.smash[n].stage ? SMASH[C.smash[n].stage].label : ""]);
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
    { theme: "mario", tag: "Bienvenida", title: "Torneo general de la tarde", lead: "13 jugadores · 3 juegos · gana quien sume más puntos generales",
      games: [["mk", "Mario Kart World", "Supervivencia en parejas rotativas"], ["tennis", "Mario Tennis", "Dobles en parejas rotativas"], ["smash", "Super Smash Bros. Ultimate", "Torneo 1 vs 1"]] },
    { theme: "mario", tag: "Puntos generales", title: "Así se suman los puntos", lead: "En cada juego se arma un ranking. Según tu puesto, sumas:",
      table: true, foot: "Si dos o más jugadores empatan en un puesto, se reparten los puntos de esos puestos (ej.: empate en 3.º y 4.º = 10,5 cada uno)." },
    { theme: "mario", tag: "Parejas", title: "Calendario de parejas rotativas", lead: "Se usa en Mario Kart y en Mario Tennis",
      items: ["Cada jugador tiene un número del 1 al 13, por sorteo.", "Cada uno juega 4 partidas.", "Nunca repites compañero.", "Nunca juegas dos partidas seguidas."] },
    { theme: "mk", tag: "Juego 1", title: "Mario Kart World · Supervivencia", sections: [
      ["Configuración", "150cc, la misma dificultad de CPU y los mismos objetos en todas las partidas."],
      ["Puntos", "Cada jugador suma 25 − su posición final (1.º = 24, 10.º = 15, 24.º = 1). La pareja que sume más en la partida gana +3 para cada integrante."],
      ["Ranking", "Suma de tus 4 partidas."],
      ["Desempate", "Más primeros puestos; si siguen empatados, partida extra."],
      ["Duración", "1 h 45 min a 2 h."]] },
    { theme: "tennis", tag: "Juego 2", title: "Mario Tennis · Dobles", sections: [
      ["Configuración", "Sets a 3 juegos, la misma cancha y las mismas reglas en todos los partidos."],
      ["Puntos", "1 punto por cada juego que gane tu pareja, y +3 a cada integrante de la pareja ganadora. En un 3-1: cada ganador suma 6 y cada perdedor 1."],
      ["Ranking", "Suma de tus 4 partidos."],
      ["Desempate", "Más partidos ganados; si siguen empatados, tie-break directo."],
      ["Duración", "1 h 30 min a 1 h 40 min."]] },
    { theme: "smash", tag: "Juego 3", title: "Super Smash Bros. Ultimate", sections: [
      ["Formato", "Eliminación directa 1 vs 1, individual. El juego arma el cuadro al azar (3 jugadores pasan directo a la siguiente ronda)."],
      ["Configuración", "3 vidas, 7 minutos, sin objetos, escenario fijo (Campo de Batalla o Destino Final). Final al mejor de 3."],
      ["Puntos generales", "Campeón 13 · Subcampeón 12 · 3.º lugar 11 · 4.º lugar 10 · eliminados en cuartos 7,5 · eliminados en primera ronda 3."],
      ["Duración", "50 a 60 minutos."]] },
    { theme: "mario", tag: "Importante", title: "Antes de empezar",
      items: ["Anotar los resultados apenas termine cada partida.", "Las reglas no se cambian a mitad de un juego.", "Gana la tarde quien sume más puntos generales en los 3 juegos."] }
  ];

  // Sorteo en vivo: presentación y luego un número cada STEP ms (ruleta SPIN ms y revelación)
  const DRAW = { INTRO: 3500, STEP: 3000, SPIN: 2000 };
  function drawPhase(draw) {
    if (!draw?.at) return null;
    const ms = serverNow() - draw.at;
    if (ms < DRAW.INTRO) return { phase: "intro", revealed: 0, k: 0 };
    const step = Math.floor((ms - DRAW.INTRO) / DRAW.STEP);
    if (step >= 13) return { phase: "done", revealed: 13, k: 12 };
    const inStep = (ms - DRAW.INTRO) % DRAW.STEP;
    return { phase: inStep < DRAW.SPIN ? "spin" : "show", revealed: inStep < DRAW.SPIN ? step : step + 1, k: step };
  }

  // Cronómetros: tiempo acumulado + lo que corre desde start (hora del servidor)
  function elapsed(tm) { return tm ? (tm.acc || 0) + (tm.running ? Math.max(0, serverNow() - tm.start) : 0) : 0; }
  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (hh ? hh + ":" + String(mm).padStart(2, "0") : String(mm).padStart(2, "0")) + ":" + String(ss).padStart(2, "0");
  }

  window.Torneo = { SCHEDULE, NUMS, GAME_NAMES, GAME_SHORT, SMASH, fmt, playersByNum, mkMatch, tennisMatch, matchDone, compute, onDeck, nextMatchFor, toCsv, serverNow, elapsed, fmtDuration, SLIDES, DRAW, drawPhase, connect };
})();
