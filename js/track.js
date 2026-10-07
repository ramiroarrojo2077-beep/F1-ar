import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Circuitos. Cada uno es un polígono cerrado de vértices; cada vértice se
// redondea con un arco de radio r, así las curvas quedan limpias. `start` es
// dónde va la línea de largada: la recta tiene que tener lugar detrás para la
// grilla. Ejes: x = este, z = sur (hacia quien mira), y = arriba.
// ---------------------------------------------------------------------------

export const CIRCUITS = {
  puente: {
    id: 'puente',
    name: 'Autódromo del Puente',
    subtitle: 'Figura en 8 con puente, horquilla y eses',
    width: 12,
    // Polígono de vértices: cada vértice se redondea con un arco de radio r.
    // y = altura (se interpola suave entre vértices), name = nombre de la curva.
    start: [30, 63],
    vertices: [
      { x: 110, z: 63, r: 16, name: 'la Horquilla' },
      { x: 110, z: 24, r: 14, name: 'la Horquilla' },
      { x: 18, z: -26.18, r: 400, y: 7.6, name: 'el Puente' },
      { x: -66, z: -72, r: 18, name: 'el Mirador' },
      { x: -56, z: -102, r: 18, name: 'el Mirador' },
      { x: 0, z: -102, r: 22, name: 'las Eses del Mate' },
      { x: 22, z: -86, r: 20, name: 'las Eses del Mate' },
      { x: 46, z: -106, r: 20, name: 'las Eses del Mate' },
      { x: 72, z: -88, r: 22, name: 'las Eses del Mate' },
      { x: 118, z: -96, r: 16, name: 'el Cóndor' },
      { x: 118, z: -62, r: 18, name: 'el Cóndor' },
      { x: -30, z: -8.65, r: 12, name: 'la Chicana' },
      { x: -35.5, z: 6.4, r: 12, name: 'la Chicana' },
      { x: -115, z: 22, r: 15, name: 'la curva del Tango' },
      { x: -115, z: 63, r: 16, name: 'la curva del Tango' },
    ],
    // escenografía: tribunas (se ubican del lado de la pista donde cae el punto)
    stands: [
      { x: 30, z: 84, len: 84, rows: 6, main: true },
      { x: 134, z: 43, len: 30, rows: 5 },
      { x: -138, z: 42, len: 30, rows: 5 },
      { x: -88, z: -96, len: 30, rows: 5 },
    ],
    pit: { from: -64, to: 46 },
    pond: { x: 27, z: -58, rx: 13, rz: 8 },
  },
};

// Física "de juguete" en unidades de la pista (1 u ≈ 0,9 m reales)
export const PHYS = {
  vTop: 58,        // velocidad máxima en recta
  aLat: 24,        // aceleración lateral máxima en curva
  brake: 38,       // desaceleración al frenar
  accel: 21,       // aceleración desde parado
  kmh: 5.6,        // factor para mostrar km/h
  carLength: 6.4,
  carWidth: 2.4,
};

const UP = new THREE.Vector3(0, 1, 0);
export const GRID_SPACING = 6.2;

export class Track {
  constructor(def) {
    this.def = def;
    this.width = def.width;
    this.half = def.width / 2;

    const path = buildPath(def);
    this.length = path.length;
    this.vertexInfo = path.fillets;

    // muestreo uniforme por longitud de arco
    const N = Math.round(this.length / 0.6);
    this.N = N;
    this.ds = this.length / N;
    this.pos = new Float32Array(N * 3);
    this.fwd = new Float32Array(N * 3);   // tangente 3D
    this.right = new Float32Array(N * 3); // lateral horizontal (derecha)
    const e = {};
    for (let i = 0; i < N; i++) {
      path.eval(i * this.ds, e);
      this.pos.set([e.x, e.y, e.z], i * 3);
      const f = new THREE.Vector3(e.tx, e.dy, e.tz).normalize();
      this.fwd.set([f.x, f.y, f.z], i * 3);
      this.right.set([-e.tz, 0, e.tx], i * 3);
    }

    this.curv = this._curvatureOf((i, out) => out.set(this.pos[i * 3], this.pos[i * 3 + 2]));
    this._computeRacingLine();
    this.rlCurv = this._curvatureOf((i, out) => {
      const o = this.rl[i];
      out.set(this.pos[i * 3] + this.right[i * 3] * o, this.pos[i * 3 + 2] + this.right[i * 3 + 2] * o);
    });
    smoothCircular(this.rlCurv, 4);
    this._computeSpeedProfile();
    this._findCorners(path);
    this._bounds();
  }

  idx(i) { const N = this.N; return ((i % N) + N) % N; }
  wrap(s) { const L = this.length; return ((s % L) + L) % L; }

  // curvatura con signo: > 0 dobla a la derecha
  _curvatureOf(getXZ) {
    const N = this.N, out = new Float32Array(N);
    const a = new THREE.Vector2(), b = new THREE.Vector2(), c = new THREE.Vector2();
    const step = 3;
    for (let i = 0; i < N; i++) {
      getXZ(this.idx(i - step), a); getXZ(i, b); getXZ(this.idx(i + step), c);
      const h1 = Math.atan2(b.y - a.y, b.x - a.x);
      const h2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = h2 - h1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const len = a.distanceTo(b) * 0.5 + b.distanceTo(c) * 0.5;
      out[i] = d / Math.max(len, 1e-4);
    }
    return out;
  }

  // Trazada ideal: "banda elástica" que se tensa dentro de los límites de la
  // pista. Converge a algo parecido a la trazada de mínima curvatura
  // (afuera - vértice - afuera).
  _computeRacingLine() {
    const M = 420, N = this.N;
    const lim = this.half - PHYS.carWidth / 2 - 0.6;
    const cx = new Float32Array(M), cz = new Float32Array(M);
    const rx = new Float32Array(M), rz = new Float32Array(M);
    const off = new Float32Array(M);
    for (let j = 0; j < M; j++) {
      const i = Math.floor(j * N / M);
      cx[j] = this.pos[i * 3]; cz[j] = this.pos[i * 3 + 2];
      rx[j] = this.right[i * 3]; rz[j] = this.right[i * 3 + 2];
    }
    for (let it = 0; it < 1500; it++) {
      for (let j = 0; j < M; j++) {
        const a = (j + M - 1) % M, b = (j + 1) % M;
        const ax = cx[a] + rx[a] * off[a], az = cz[a] + rz[a] * off[a];
        const bx = cx[b] + rx[b] * off[b], bz = cz[b] + rz[b] * off[b];
        const px = cx[j] + rx[j] * off[j], pz = cz[j] + rz[j] * off[j];
        const mx = (ax + bx) / 2 - px, mz = (az + bz) / 2 - pz;
        off[j] = clamp(off[j] + 0.6 * (mx * rx[j] + mz * rz[j]), -lim, lim);
      }
    }
    // pasar a resolución completa
    this.rl = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const f = i * M / N, j = Math.floor(f), k = f - j;
      this.rl[i] = off[j % M] * (1 - k) + off[(j + 1) % M] * k;
    }
    smoothCircular(this.rl, 6);
  }

  _computeSpeedProfile() {
    const N = this.N, v = new Float32Array(N), ds = this.ds;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.rlCurv[i]);
      v[i] = Math.min(PHYS.vTop, Math.sqrt(PHYS.aLat / Math.max(k, 1e-5)));
    }
    // frenada (hacia atrás) y aceleración (hacia adelante), dos vueltas
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 2 * N; n > 0; n--) {
        const i = this.idx(n - 1), j = this.idx(n);
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * PHYS.brake * ds));
      }
      for (let n = 0; n < 2 * N; n++) {
        const i = this.idx(n), j = this.idx(n + 1);
        const a = accelAt(v[i]);
        v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * a * ds));
      }
    }
    this.vmax = v;
  }

  _findCorners(path) {
    // una curva por vértice que realmente dobla
    this.corners = path.fillets
      .filter(f => Math.abs(f.theta) > 0.2)
      .map(f => ({ s: f.sMid, apex: Math.round(f.sMid / this.ds) % this.N, dir: Math.sign(f.theta), name: f.name, radius: f.r }))
      .sort((a, b) => a.s - b.s);
    this.corners.forEach((c, n) => {
      c.number = n + 1;
      c.name = c.name || `la curva ${n + 1}`;
      c.vmin = this.vmax[c.apex];
      c.brakeS = this._brakePointBefore(c.apex);
    });
  }

  _brakePointBefore(apex) {
    // punto de velocidad mínima cerca del vértice y desde ahí hacia atrás
    // hasta donde la velocidad deja de subir (= punto de frenada)
    let i = apex;
    for (let k = -40; k <= 40; k++) {
      const j = this.idx(apex + k);
      if (this.vmax[j] < this.vmax[i]) i = j;
    }
    for (let n = 0; n < this.N / 4; n++) {
      const prev = this.idx(i - 1);
      if (this.vmax[prev] <= this.vmax[i] + 1e-3) break;
      i = prev;
    }
    return i * this.ds;
  }

  _bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
    for (let i = 0; i < this.N; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      maxY = Math.max(maxY, y);
    }
    this.bounds = { minX, maxX, minZ, maxZ, maxY };
  }

  // cajón de la grilla k (0 = pole). La pole va del lado de adentro de la 1ª curva.
  gridSlot(k) {
    const first = this.corners[0];
    const pole = first && first.dir > 0 ? 1 : -1;
    return { s: -6 - k * GRID_SPACING, d: (k % 2 === 0 ? pole : -pole) * 2.8 };
  }

  cornerAt(s) {
    s = this.wrap(s);
    let best = null, bd = Infinity;
    for (const c of this.corners) {
      let d = Math.abs(c.s - s); d = Math.min(d, this.length - d);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // valores interpolados en la distancia s
  sample(arr, s) {
    const f = this.wrap(s) / this.ds, i = Math.floor(f), k = f - i;
    return arr[this.idx(i)] * (1 - k) + arr[this.idx(i + 1)] * k;
  }
  speedAt(s) { return this.sample(this.vmax, s); }
  heightAt(s) {
    const f = this.wrap(s) / this.ds, i = Math.floor(f), k = f - i;
    return this.pos[this.idx(i) * 3 + 1] * (1 - k) + this.pos[this.idx(i + 1) * 3 + 1] * k;
  }
  racingAt(s) { return this.sample(this.rl, s); }
  curvAt(s) { return this.sample(this.rlCurv, s); }

  // posición + base ortonormal en (s, desvío lateral d)
  frameAt(s, d, outPos, outFwd, outRight) {
    const f = this.wrap(s) / this.ds, i0 = Math.floor(f), k = f - i0;
    const a = this.idx(i0) * 3, b = this.idx(i0 + 1) * 3;
    const P = this.pos, F = this.fwd, R = this.right;
    outRight.set(R[a] + (R[b] - R[a]) * k, 0, R[a + 2] + (R[b + 2] - R[a + 2]) * k).normalize();
    outFwd.set(F[a] + (F[b] - F[a]) * k, F[a + 1] + (F[b + 1] - F[a + 1]) * k, F[a + 2] + (F[b + 2] - F[a + 2]) * k).normalize();
    outPos.set(
      P[a] + (P[b] - P[a]) * k + outRight.x * d,
      P[a + 1] + (P[b + 1] - P[a + 1]) * k,
      P[a + 2] + (P[b + 2] - P[a + 2]) * k + outRight.z * d,
    );
    return outPos;
  }

  // punto de la línea central (rápido, sin interpolar)
  pointXZ(i) { return [this.pos[i * 3], this.pos[i * 3 + 2]]; }

  // muestra más cercana (en planta) a (x, z) y su distancia
  nearest(x, z) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < this.N; i += 2) {
      const dx = this.pos[i * 3] - x, dz = this.pos[i * 3 + 2] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return { i: bi, dist: Math.sqrt(best) };
  }
}

// Arma el recorrido: polígono cerrado con cada vértice redondeado por un arco
// tangente (filete). Devuelve una función eval(s) con posición, tangente y altura.
function buildPath(def) {
  const V = def.vertices, n = V.length;
  const fillets = V.map((v, i) => {
    const A = V[(i - 1 + n) % n], C = V[(i + 1) % n];
    const u1 = norm2(v.x - A.x, v.z - A.z), u2 = norm2(C.x - v.x, C.z - v.z);
    const theta = Math.atan2(u1.x * u2.z - u1.z * u2.x, u1.x * u2.x + u1.z * u2.z); // > 0 derecha
    const sg = theta >= 0 ? 1 : -1;
    const T = v.r * Math.tan(Math.abs(theta) / 2);
    const p1 = { x: v.x - u1.x * T, z: v.z - u1.z * T };
    const p2 = { x: v.x + u2.x * T, z: v.z + u2.z * T };
    const c = { x: p1.x - u1.z * v.r * sg, z: p1.z + u1.x * v.r * sg };
    const a0 = Math.atan2(p1.z - c.z, p1.x - c.x);
    return { p1, p2, c, a0, sg, theta, T, r: v.r, arcLen: v.r * Math.abs(theta), y: v.y || 0, name: v.name };
  });
  // piezas: arco i, recta i -> i+1
  const pieces = [];
  let s = 0;
  fillets.forEach((f, i) => {
    const g = fillets[(i + 1) % n];
    f.sStart = s;
    pieces.push({ type: 'arc', f, s0: s, len: f.arcLen });
    s += f.arcLen;
    f.sMid = f.sStart + f.arcLen / 2;
    const dx = g.p1.x - f.p2.x, dz = g.p1.z - f.p2.z;
    const len = Math.hypot(dx, dz);
    const segLen = Math.hypot(V[(i + 1) % n].x - V[i].x, V[(i + 1) % n].z - V[i].z);
    if (f.T + g.T > segLen + 1e-6) console.warn(`[pista] radios demasiado grandes entre vértices ${i} y ${(i + 1) % n}`);
    pieces.push({ type: 'line', a: f.p2, dx: dx / (len || 1), dz: dz / (len || 1), s0: s, len });
    s += len;
  });
  const total = s;

  // la largada: punto del recorrido más cercano a def.start
  const tmp = {};
  let s0 = 0;
  if (def.start) {
    let best = Infinity;
    for (let q = 0; q < total; q += 0.25) {
      evalRaw(q, tmp);
      const d = (tmp.x - def.start[0]) ** 2 + (tmp.z - def.start[1]) ** 2;
      if (d < best) { best = d; s0 = q; }
    }
  }
  for (const f of fillets) f.sMid = ((f.sMid - s0) % total + total) % total;

  // alturas: claves en el medio de cada vértice, interpolación coseno
  const keys = fillets.map(f => ({ s: f.sMid, y: f.y })).sort((a, b) => a.s - b.s);
  function heightAt(q) {
    let k1 = keys.length - 1;
    for (let k = 0; k < keys.length; k++) if (keys[k].s <= q) k1 = k;
    const A = keys[k1], B = keys[(k1 + 1) % keys.length];
    let span = B.s - A.s; if (span <= 0) span += total;
    let t = q - A.s; if (t < 0) t += total;
    const u = Math.min(1, t / span);
    return A.y + (B.y - A.y) * (1 - Math.cos(u * Math.PI)) / 2;
  }

  function evalRaw(q, out) {
    q = ((q % total) + total) % total;
    let p = pieces[pieces.length - 1];
    for (const pc of pieces) { if (q < pc.s0 + pc.len) { p = pc; break; } }
    const t = q - p.s0;
    if (p.type === 'line') {
      out.x = p.a.x + p.dx * t; out.z = p.a.z + p.dz * t; out.tx = p.dx; out.tz = p.dz;
    } else {
      const f = p.f, ang = f.a0 + f.sg * t / f.r;
      out.x = f.c.x + Math.cos(ang) * f.r; out.z = f.c.z + Math.sin(ang) * f.r;
      out.tx = -Math.sin(ang) * f.sg; out.tz = Math.cos(ang) * f.sg;
    }
    return out;
  }

  return {
    length: total,
    fillets,
    eval(q, out) {
      const sq = q + s0;
      evalRaw(sq, out);
      out.y = heightAt(q);
      out.dy = (heightAt(q + 0.5) - heightAt(q - 0.5 < 0 ? q - 0.5 + total : q - 0.5)) / 1.0;
      return out;
    },
  };
}

function norm2(x, z) { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; }

// aceleración disponible a velocidad v (boost > 1 = menos resistencia: rebufo/DRS)
export function accelAt(v, boost = 1) {
  const r = v / (PHYS.vTop * boost);
  return Math.max(0.5, PHYS.accel * (1 - r * r * 0.92));
}

function smoothCircular(arr, radius) {
  const N = arr.length, src = Float32Array.from(arr);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[(i + k + N) % N];
    arr[i] = sum / (2 * radius + 1);
  }
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export { UP };
