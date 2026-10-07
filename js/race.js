import { PHYS, accelAt, clamp } from './track.js';

// Simulación de carrera. Cada auto tiene una distancia acumulada `s` sobre la
// línea central (s < 0 = detrás de la largada), un desvío lateral `d`
// (+ = derecha) y una velocidad `v`. La velocidad objetivo sale del perfil
// de velocidades de la pista y del rendimiento auto/piloto; los adelantamientos
// se resuelven moviendo `d` hacia un costado del auto de adelante.

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

const STEP = 1 / 120;
const CL = PHYS.carLength, CW = PHYS.carWidth;

export class Race {
  constructor(track, drivers, { laps = 5, incidents = true, grid = 'quali' } = {}) {
    this.track = track;
    this.laps = laps;
    this.incidents = incidents;
    this.L = track.length;
    this.lim = track.half - CW / 2 - 0.35;
    this.listeners = [];
    this.time = 0;          // reloj de carrera (desde que se apagan las luces)
    this.clock = 0;         // reloj total de simulación
    this.state = 'grid';    // grid | lights | racing | finished | done
    this.lightsOn = 0;
    this.lightTimer = 0;
    this.holdTime = 0.6 + Math.random() * 1.8;
    this.fastestLap = null;
    this.finishOrder = [];
    this.firstCross = [];
    this.leaderFinishedAt = null;
    this.acc = 0;
    this.overtakeCount = 0;
    this.lastPass = new Map();
    // las gomas se gastan igual en una carrera corta o larga: el cruce de
    // rendimiento entre blandas y duras queda siempre a mitad de carrera
    this.wearScale = 5 / Math.max(1, laps);

    // "forma del día", gomas y clasificación: arma la grilla
    const cars = drivers.map((drv, i) => {
      const form = 1 + (Math.random() - 0.5) * 0.024;
      const pace = drv.team.pace * drv.skill * form;
      const compound = pickCompound();
      return {
        id: i, driver: drv, team: drv.team, code: drv.code,
        pace, quali: pace + (Math.random() - 0.5) * 0.045,
        compound, tyre: TYRES[compound],
        launch: 0.82 + Math.random() * 0.3,   // calidad de la largada
        boost: 1, tow: 0, drs: false, pass: null, yieldT: 0,
        s: 0, d: 0, v: 0, dPrev: 0, latVel: 0,
        lapsDone: 0, lapStart: 0, lastLap: null, bestLap: null,
        finished: false, finishTime: null, retired: false, retireReason: null,
        mistake: null, failAt: null, parked: false,
        milestone: -1, gap: 0, interval: 0, pos: 0, gridPos: 0,
        lapNoise: 1, reaction: 0.12 + Math.random() * 0.3 + (1 - drv.skill) * 4,
        spin: 0, nextCorner: 0, lastOvertake: 0,
      };
    });
    cars.sort((a, b) => b.quali - a.quali);
    if (grid === 'reverse') cars.reverse();
    else if (grid === 'mixed') {
      for (let i = cars.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cars[i], cars[j]] = [cars[j], cars[i]]; }
    }
    this.gridMode = grid;
    cars.forEach((c, k) => {
      const g = track.gridSlot(k);
      c.s = g.s; c.d = g.d; c.dPrev = g.d;
      c.gridPos = k + 1; c.pos = k + 1;
      c.nextCorner = 0;
      if (incidents && Math.random() < 0.06) c.failAt = 25 + Math.random() * laps * 28;
    });
    this.cars = cars;
    this.order = cars.slice();
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }

  startLights() {
    if (this.state !== 'grid') return;
    this.state = 'lights';
    this.lightTimer = 0;
    this.lightsOn = 0;
  }

  update(dt) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  step(dt) {
    this.clock += dt;
    if (this.state === 'grid') return;
    if (this.state === 'lights') {
      this.lightTimer += dt;
      const n = Math.min(5, Math.floor(this.lightTimer / 0.9) + 1);
      if (n !== this.lightsOn && this.lightTimer < 5 * 0.9) {
        this.lightsOn = n;
        this.emit('light', { n });
      }
      if (this.lightTimer >= 5 * 0.9 + this.holdTime) {
        this.lightsOn = 0;
        this.state = 'racing';
        this.time = 0;
        this.emit('go');
      }
      return;
    }

    this.time += dt;
    const cars = this.cars, L = this.L, track = this.track;

    for (const c of cars) {
      if (c.parked) continue;
      this._driveCar(c, dt);
    }
    // separación lateral entre autos que van a la par
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.retired) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.retired) continue;
        const ds = wrapDelta(b.s - a.s, L);
        if (Math.abs(ds) > CL + 0.4) continue;
        const sep = b.d - a.d, need = CW + 0.35;
        if (Math.abs(sep) < need) {
          const push = (need - Math.abs(sep)) / 2;
          const sg = sep >= 0 ? 1 : -1;
          a.d = clamp(a.d - sg * push, -this.lim - 1, this.lim + 1);
          b.d = clamp(b.d + sg * push, -this.lim - 1, this.lim + 1);
        }
      }
    }
    // nunca superponerse de frente: si quedó encima del de adelante, atrás
    for (const c of cars) {
      if (c.parked) continue;
      for (const o of cars) {
        if (o === c) continue;
        const ds = wrapDelta(o.s - c.s, L);
        if (ds > 0 && ds < CL + 0.25 && Math.abs(o.d - c.d) < CW + 0.1) {
          c.s -= (CL + 0.25 - ds);
          c.v = Math.min(c.v, o.v);
        }
      }
    }

    // vueltas, tiempos, diferencias
    for (const c of cars) {
      if (c.retired) continue;
      const lapIdx = Math.floor(c.s / L);
      if (c.s >= 0 && lapIdx > c.lapsDone) this._lapCompleted(c);
      const m = Math.floor(c.s / 8);
      if (m > c.milestone && c.s >= 0) {
        c.milestone = m;
        if (this.firstCross[m] === undefined) this.firstCross[m] = this.time;
        c.gap = this.time - this.firstCross[m];
      }
    }

    this._updateOrder();
    if (!this.startReported && this.time > 9) {
      this.startReported = true;
      let best = null;
      for (const c of this.cars) if (!c.retired && (!best || c.gridPos - c.pos > best.gridPos - best.pos)) best = c;
      if (best && best.gridPos - best.pos >= 2) this.emit('start', { car: best, gained: best.gridPos - best.pos });
    }
    this._checkEnd();
  }

  _driveCar(c, dt) {
    const track = this.track, L = this.L;
    const sw = track.wrap(c.s);

    // fallas mecánicas
    if (c.failAt !== null && this.time > c.failAt && !c.retired && !c.finished) {
      c.retired = true;
      c.retireReason = 'motor';
      c.retiredAt = this.time;
      c.pass = null;
      c.drs = false;
      // al costado más cercano (sin caerse del puente)
      const elevated = track.heightAt(sw) > 0.3;
      const side = c.d >= 0 ? 1 : -1;
      c.retireD = side * (elevated ? this.lim + 0.3 : track.half + 4);
      this.emit('retire', { car: c });
    }

    // salida: tiempo de reacción
    if (this.time < c.reaction) { c.v = 0; return; }

    let target = track.speedAt(c.s) * c.pace * c.lapNoise * this.tyreFactor(c);
    const k = Math.abs(track.curvAt(c.s));
    c.boost = 1;
    if (c.yieldT > 0) { target *= 0.965; c.yieldT -= dt; } // cede ante un ataque por adentro

    if (c.retired) {
      // baja la velocidad y se estaciona al costado
      const far = Math.abs(c.d - c.retireD) > 0.4;
      target = far ? Math.max(4, c.v - 10 * dt) : Math.max(0, c.v - 14 * dt);
      c.d += clamp(c.retireD - c.d, -2.5 * dt, 2.5 * dt);
      if (!far && c.v < 0.3) { c.v = 0; c.parked = true; return; }
    } else if (c.finished) {
      target *= 0.55; // vuelta de enfriamiento
    }

    // errores de pilotaje al llegar a una frenada
    if (!c.retired && this.incidents && !c.finished) this._maybeMistake(c);
    if (c.mistake) {
      const mk = c.mistake;
      mk.t += dt;
      if (mk.type === 'wide') {
        target *= 0.72;
        c.d += (mk.side * (this.lim + 1.4) - c.d) * Math.min(1, dt * 2);
      } else {
        target = mk.t < 1.6 ? 0 : target * 0.6;
        c.v = Math.max(0, c.v - 30 * dt);
        c.spin = mk.spinDir * easeOut(Math.min(1, mk.t / 1.6)) * Math.PI * 2; // una vuelta completa
        c.d += (mk.side * (this.lim + 0.8) - c.d) * Math.min(1, dt * 1.5);
      }
      if (mk.t > mk.dur) { c.mistake = null; c.spin = 0; }
    }

    // desvío por fuera de la trazada = más lento en curva
    const rl = track.racingAt(c.s);
    const off = Math.abs(c.d - rl);
    if (k > 1 / 70) target *= 1 - (c.pass ? 0.003 : 0.012) * Math.max(0, off - 1.2);

    // autos cercanos
    let ahead = null, aheadDs = Infinity, behindLapper = null;
    for (const o of this.cars) {
      if (o === c || (o.retired && Math.abs(o.d) > track.half)) continue;
      const ds = wrapDelta(o.s - c.s, L);
      if (ds > 0 && ds < 40 && Math.abs(o.d - c.d) < CW + 0.6 && ds < aheadDs) { ahead = o; aheadDs = ds; }
      if (ds < 0 && ds > -35 && o.s - c.s > L / 2 && !c.finished) behindLapper = o; // me están por doblar
    }

    // rebufo y DRS: se ganan siguiendo de cerca en recta y duran toda la recta
    // (aunque el auto se abra para pasar); el DRS se cierra al frenar
    const onStraight = k < 1 / 250 && track.speedAt(c.s) > PHYS.vTop * 0.8;
    if (ahead && onStraight && aheadDs < 36 && aheadDs > CL * 0.8 && !c.retired) c.tow = Math.max(c.tow, 1 - aheadDs / 36);
    else c.tow = Math.max(0, c.tow - dt * 0.7);
    if (!onStraight || c.retired || c.finished) c.drs = false;
    else if (!c.drs && c.lapsDone >= 1 && ahead && !ahead.retired && aheadDs / Math.max(c.v, 1) < 1.0) c.drs = true;
    if (onStraight && !c.retired) c.boost += 0.045 * c.tow + (c.drs ? 0.055 : 0);
    if (c.pass) c.boost += 0.02; // empujando para pasar
    target *= c.boost;
    if (this.time < 5) target *= Math.min(1, c.launch);

    // bandera azul: hacerse a un lado
    let desired = rl;
    if (behindLapper && !c.retired) {
      desired = behindLapper.d > 0 ? -this.lim * 0.85 : this.lim * 0.85;
      target *= 0.97;
    }

    // ¿intento de sobrepaso?
    if (ahead && !c.pass && !c.retired && !c.mistake && !c.finished && aheadDs < 26) {
      const lapped = ahead.s < c.s - L / 2 || ahead.retired || ahead.mistake;
      const edge = c.pace * this.tyreFactor(c) / (ahead.pace * this.tyreFactor(ahead)) - 1;
      // se tira cuando tiene con qué: rebufo/DRS en recta, mucho más ritmo,
      // o pegado atrás llegando a una frenada (para meterse por adentro)
      const braking = track.speedAt(c.s + 25) < c.v * 0.92;
      const chance = (onStraight && (c.drs || c.tow > 0.45)) || edge > 0.008 || (braking && aheadDs < 11 && edge > -0.004);
      if (lapped || (chance && target > ahead.v - 0.5)) {
        const kNext = track.curvAt(c.s + 35);
        let side = kNext > 0 ? 1 : -1; // por adentro de la próxima curva
        if (Math.abs(ahead.d + side * (CW + 1.0)) > this.lim) side = -side;
        if (Math.abs(ahead.d + side * (CW + 1.0)) <= this.lim + 0.3) c.pass = { target: ahead, side, t: 0 };
      }
    }

    // maniobra en curso
    if (c.pass) {
      const p = c.pass, t = p.target;
      p.t += dt;
      const rel = wrapDelta(c.s - t.s, L); // > 0: ya lo pasé
      const alongside = Math.abs(rel) < CL + 1;
      let lane = t.d + p.side * (CW + 1.0);
      if (Math.abs(lane) > this.lim) {
        const other = t.d - p.side * (CW + 1.0);
        if (!alongside && Math.abs(other) <= this.lim) { p.side = -p.side; lane = other; } else lane = clamp(lane, -this.lim, this.lim);
      }
      if (rel > CL + 2.5 || rel < -32 || (!alongside && p.t > 7) || c.mistake || t.finished !== c.finished) {
        c.pass = null; // terminó (bien o mal): vuelve a su trazada de a poco
      } else {
        desired = lane;
        // frenada tardía por adentro: el que defiende por afuera tiene que ceder
        const kNext = track.curvAt(c.s + 30);
        const inside = Math.sign(kNext) === p.side && Math.abs(kNext) > 1 / 60;
        if (inside && rel > -CL * 1.6) {
          target *= 1.045;
          if (!t.pass) t.yieldT = 0.35;
        }
      }
    }

    // seguir al de adelante (en el mismo carril) sin chocarlo
    if (ahead && !c.retired && !c.mistake) {
      const minGap = CL + 0.8, followDist = CL + 3 + c.v * 0.12;
      if (aheadDs < followDist) {
        const cap = ahead.v + (aheadDs - minGap) * 1.2;
        target = Math.min(target, Math.max(0, cap));
      }
    }

    // integrar velocidad
    if (c.v < target) c.v = Math.min(target, c.v + accelAt(c.v, c.boost) * (this.time < 5 ? c.launch : 1) * dt);
    else c.v = Math.max(target, c.v - PHYS.brake * 1.25 * dt);
    c.s += c.v * dt;

    // movimiento lateral
    if (!c.retired && !c.mistake) {
      desired = clamp(desired, -this.lim, this.lim);
      const rate = Math.min(6, 1.2 + c.v * 0.12);
      const diff = desired - c.d;
      c.d += clamp(diff, -rate * dt, rate * dt);
    }
    c.latVel = (c.d - c.dPrev) / dt;
    c.dPrev = c.d;
  }

  // rendimiento de las gomas: las blandas arrancan más rápidas y se gastan antes
  tyreFactor(c) {
    const lapsRun = Math.max(0, c.s / this.L);
    return 1 + c.tyre.grip - c.tyre.wear * this.wearScale * lapsRun;
  }

  _maybeMistake(c) {
    const cs = this.track.corners;
    if (!cs.length) return;
    const nc = cs[c.nextCorner % cs.length];
    const lapBase = Math.floor(c.s / this.L) * this.L;
    let target = lapBase + nc.brakeS;
    if (target < c.s - this.L / 2) target += this.L;
    if (c.s >= target && c.s < target + 40) {
      c.nextCorner = (c.nextCorner + 1) % cs.length;
      if (c.mistake || this.time < 4) return;
      const p = 0.005 * (1 + (0.995 - c.driver.skill) * 70);
      if (Math.random() < p) {
        const spin = Math.random() < 0.28;
        c.mistake = {
          type: spin ? 'spin' : 'wide', t: 0, dur: spin ? 3.2 : 1.8,
          side: nc.dir > 0 ? -1 : 1, spinDir: Math.random() < 0.5 ? 1 : -1,
        };
        c.pass = null;
        this.emit('mistake', { car: c, corner: nc, type: c.mistake.type });
      }
    } else if (c.s > target + 40) {
      // por si se saltó la detección (p. ej. por la grilla)
      c.nextCorner = (c.nextCorner + 1) % cs.length;
    }
  }

  _lapCompleted(c) {
    c.lapsDone++;
    const lapTime = this.time - c.lapStart;
    c.lapStart = this.time;
    c.lapNoise = 1 + (Math.random() - 0.5) * 0.008;
    if (c.lapsDone >= 1) {
      c.lastLap = lapTime;
      if (c.lapsDone >= 2 && (c.bestLap === null || lapTime < c.bestLap)) c.bestLap = lapTime;
      if (c.lapsDone >= 2 && (!this.fastestLap || lapTime < this.fastestLap.time)) {
        this.fastestLap = { car: c, time: lapTime, lap: c.lapsDone };
        this.emit('fastest', { car: c, time: lapTime });
      }
    }
    if (c.finished) return;
    if (this.state === 'racing' && c.lapsDone >= this.laps) {
      this.state = 'finished';
      this.leaderFinishedAt = this.time;
      this._finish(c);
      this.emit('winner', { car: c });
    } else if (this.state === 'finished') {
      this._finish(c);
    } else {
      if (c === this.order[0]) this.emit('lap', { lap: c.lapsDone + 1, car: c });
    }
  }

  _finish(c) {
    c.finished = true;
    c.finishTime = this.time;
    this.finishOrder.push(c);
    this.emit('finish', { car: c, pos: this.finishOrder.length });
  }

  _updateOrder() {
    const prev = this.order;
    const rank = (c) => {
      if (c.finished) return 1e9 - this.finishOrder.indexOf(c) * 1e6;
      if (c.retired) return -1e9 + (c.retiredAt || 0);
      return c.s;
    };
    const next = this.cars.slice().sort((a, b) => rank(b) - rank(a));
    next.forEach((c, i) => { c.pos = i + 1; });
    // intervalos
    for (let i = 0; i < next.length; i++) {
      const c = next[i];
      c.lapsDown = Math.max(0, Math.floor((next[0].s - c.s) / this.L));
      c.interval = i === 0 ? 0 : c.gap - next[i - 1].gap;
    }
    // adelantamientos
    if (this.time > 5 && this.state === 'racing') {
      for (let i = 0; i < next.length - 1; i++) {
        const a = next[i], b = next[i + 1];
        const pa = prev.indexOf(a), pb = prev.indexOf(b);
        if (pa > pb && !a.retired && !b.retired && !b.mistake && Math.abs(wrapDelta(a.s - b.s, this.L)) < 20 && this.clock - a.lastOvertake > 2) {
          // si b lo había pasado recién, es un ida y vuelta: no se anuncia
          const back = this.lastPass.get(b.id + '>' + a.id);
          this.lastPass.set(a.id + '>' + b.id, this.clock);
          if (back !== undefined && this.clock - back < 6) continue;
          a.lastOvertake = this.clock;
          this.overtakeCount++;
          this.emit('overtake', { car: a, other: b, pos: i + 1 });
        }
      }
    }
    this.order = next;
  }

  _checkEnd() {
    if (this.state !== 'finished') return;
    const running = this.cars.filter(c => !c.finished && !c.retired);
    const timeout = this.time - this.leaderFinishedAt > 75;
    if (running.length === 0 || timeout) {
      for (const c of running) this._finish(c);
      this.state = 'done';
      this.emit('done', { results: this.results() });
    }
  }

  results() {
    const leader = this.finishOrder[0];
    return this.order.map((c, i) => {
      let gap;
      if (c.retired && !c.finished) gap = 'Abandono';
      else if (i === 0) gap = fmtTime(c.finishTime);
      else if (c.lapsDone < leader.lapsDone) {
        const n = leader.lapsDone - c.lapsDone;
        gap = `+${n} ${n === 1 ? 'vuelta' : 'vueltas'}`;
      } else gap = '+' + (c.finishTime - leader.finishTime).toFixed(3);
      const pts = c.retired && !c.finished ? 0 : (POINTS[i] || 0) + (this.fastestLap && this.fastestLap.car === c && i < 10 ? 1 : 0);
      return { pos: i + 1, car: c, gap, pts, best: c.bestLap };
    });
  }
}

export const TYRES = {
  S: { name: 'Blandas', color: '#e10600', grip: 0.012, wear: 0.0105 },
  M: { name: 'Medias', color: '#ffd400', grip: 0.0, wear: 0.0055 },
  H: { name: 'Duras', color: '#f0f0f0', grip: -0.009, wear: 0.0022 },
};

function pickCompound() {
  const r = Math.random();
  return r < 0.38 ? 'S' : r < 0.78 ? 'M' : 'H';
}

export function wrapDelta(d, L) {
  d = ((d % L) + L) % L;
  return d > L / 2 ? d - L : d;
}

export function fmtTime(t) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function easeOut(t) { return 1 - (1 - t) ** 3; }
