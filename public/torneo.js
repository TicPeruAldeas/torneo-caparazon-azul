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

  // Datos en vivo: personajes + estado por SSE
  async function connect(onState, onStatus) {
    const chars = await fetch("/characters.json").then(r => r.json());
    const charById = Object.fromEntries(chars.characters.map(c => [c.id, c]));
    const open = () => {
      const es = new EventSource("/api/events");
      es.onopen = () => onStatus?.(true);
      es.onmessage = ev => { try { onState(JSON.parse(ev.data), { chars, charById }); } catch (e) { console.error(e); } };
      es.onerror = () => onStatus?.(false);
    };
    open();
    return { chars, charById };
  }

  window.Torneo = { SCHEDULE, NUMS, GAME_NAMES, GAME_SHORT, SMASH, fmt, playersByNum, mkMatch, tennisMatch, compute, connect };
})();
