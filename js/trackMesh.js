import * as THREE from 'three';
import { PHYS } from './track.js';

// Acumula triángulos ordenados por "s" (distancia sobre la pista) para poder
// revelarlos de a poco con setDrawRange: así la pista "se va armando".
class Builder {
  constructor() { this.p = []; this.c = []; this.s = []; }
  tri(a, b, c, col, s) {
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) this.c.push(col.r, col.g, col.b);
    this.s.push(s);
  }
  // quad a-b-c-d en sentido antihorario visto desde la cara "de afuera"
  quad(a, b, c, d, col, s) { this.tri(a, b, c, col, s); this.tri(a, c, d, col, s); }
  box(center, fwd, right, len, wid, h, col, s, yBottom) {
    // caja orientada sobre la pista (sin tapa de abajo)
    const hl = len / 2, hw = wid / 2;
    const P = (x, y, z) => new THREE.Vector3()
      .copy(center).addScaledVector(fwd, x).addScaledVector(right, z).setY(y);
    const y0 = yBottom, y1 = yBottom + h;
    const v = [P(-hl, y0, -hw), P(hl, y0, -hw), P(hl, y0, hw), P(-hl, y0, hw),
      P(-hl, y1, -hw), P(hl, y1, -hw), P(hl, y1, hw), P(-hl, y1, hw)];
    this.quad(v[4], v[7], v[6], v[5], col, s); // arriba
    this.quad(v[1], v[0], v[4], v[5], col, s);
    this.quad(v[2], v[1], v[5], v[6], col, s);
    this.quad(v[3], v[2], v[6], v[7], col, s);
    this.quad(v[0], v[3], v[7], v[4], col, s);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    const sArr = Float32Array.from(this.s);
    m.userData.reveal = (sNow) => {
      // cantidad de triángulos con s <= sNow (búsqueda binaria)
      let lo = 0, hi = sArr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sArr[mid] <= sNow) lo = mid + 1; else hi = mid; }
      g.setDrawRange(0, lo * 3);
    };
    return m;
  }
}

const C = (hex) => new THREE.Color(hex);

export function buildTrackMesh(track) {
  const group = new THREE.Group();
  group.name = 'track';
  const N = track.N, half = track.half, ds = track.ds;
  const P = track.pos, R = track.right;

  const pt = (i, d, h = 0) => {
    i = track.idx(i);
    return new THREE.Vector3(P[i * 3] + R[i * 3] * d, P[i * 3 + 1] + h, P[i * 3 + 2] + R[i * 3 + 2] * d);
  };
  const sOf = (i) => i * ds;

  const matVC = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts });

  // ---------------- asfalto (con goma oscura sobre la trazada ideal) -------
  const asphalt = new Builder();
  const base = C('#3b3e44');
  const lanes = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map(f => f * half);
  const shade = (i, d) => {
    const rl = track.rl[track.idx(i)];
    const k = Math.exp(-(((d - rl) / 2.2) ** 2));
    const noise = 0.96 + 0.04 * Math.sin(i * 0.37) * Math.sin(i * 0.11 + d);
    return base.clone().multiplyScalar((1 - 0.35 * k) * noise);
  };
  for (let i = 0; i < N; i++) {
    for (let l = 0; l < lanes.length - 1; l++) {
      const d0 = lanes[l], d1 = lanes[l + 1];
      const col = shade(i, (d0 + d1) / 2);
      asphalt.quad(pt(i, d0, 0.06), pt(i, d1, 0.06), pt(i + 1, d1, 0.06), pt(i + 1, d0, 0.06), col, sOf(i));
    }
  }
  const asphaltMesh = asphalt.mesh(matVC({ roughness: 0.95, side: THREE.DoubleSide }));
  asphaltMesh.receiveShadow = true;
  group.add(asphaltMesh);

  // ---------------- líneas blancas de borde ---------------------------------
  const lines = new Builder();
  const white = C('#f2f2f2');
  for (let i = 0; i < N; i++) {
    for (const sg of [-1, 1]) {
      const a = sg * (half - 0.65), b = sg * (half - 0.25);
      const [d0, d1] = sg > 0 ? [a, b] : [b, a];
      lines.quad(pt(i, d0, 0.09), pt(i, d1, 0.09), pt(i + 1, d1, 0.09), pt(i + 1, d0, 0.09), white, sOf(i));
    }
  }
  const linesMesh = lines.mesh(matVC({ polygonOffset: true, polygonOffsetFactor: -1 }));
  linesMesh.receiveShadow = true;
  group.add(linesMesh);

  // ---------------- pianos (curbs) rojo/blanco en las curvas ----------------
  const kerbOn = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (Math.abs(track.curv[i]) > 1 / 32 && P[i * 3 + 1] < 0.3) {
      for (let k = -8; k <= 8; k++) kerbOn[track.idx(i + k)] = 1;
    }
  }
  const kerbs = new Builder();
  const red = C('#d81e1e');
  for (let i = 0; i < N; i++) {
    if (!kerbOn[i]) continue;
    const col = Math.floor(sOf(i) / 2.2) % 2 ? red : white;
    for (const sg of [-1, 1]) {
      const a = sg * (half - 0.8), b = sg * (half + 0.9);
      const [d0, d1, h0, h1] = sg > 0 ? [a, b, 0.1, 0.2] : [b, a, 0.2, 0.1];
      kerbs.quad(pt(i, d0, h0), pt(i, d1, h1), pt(i + 1, d1, h1), pt(i + 1, d0, h0), col, sOf(i));
    }
  }
  const kerbMesh = kerbs.mesh(matVC({ roughness: 0.6 }));
  kerbMesh.receiveShadow = true;
  group.add(kerbMesh);

  // ---------------- leca (grava) por fuera de las curvas lentas -------------
  const gravel = new Builder();
  const sand = C('#d6bf8a');
  const gw = new Float32Array(N); // ancho de la leca
  const gSide = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const k = track.curv[i];
    if (Math.abs(k) > 1 / 19 && P[i * 3 + 1] < 0.3) {
      for (let j = -25; j <= 25; j++) {
        const q = track.idx(i + j);
        const w = 8 * (1 - Math.abs(j) / 26);
        if (w > gw[q]) { gw[q] = w; gSide[q] = k > 0 ? -1 : 1; } // afuera de la curva
      }
    }
  }
  for (let i = 0; i < N; i++) {
    const j = track.idx(i + 1);
    if (gw[i] < 0.5 || gw[j] < 0.5) continue;
    const sg = gSide[i];
    const in0 = sg * (half + 0.9), out0 = sg * (half + 0.9 + gw[i]), out1 = sg * (half + 0.9 + gw[j]);
    const c = sand.clone().multiplyScalar(0.94 + 0.06 * Math.sin(i * 1.7));
    if (sg > 0) gravel.quad(pt(i, in0, 0.04), pt(i, out0, 0.04), pt(i + 1, out1, 0.04), pt(i + 1, in0, 0.04), c, sOf(i));
    else gravel.quad(pt(i, out0, 0.04), pt(i, in0, 0.04), pt(i + 1, in0, 0.04), pt(i + 1, out1, 0.04), c, sOf(i));
  }
  const gravelMesh = gravel.mesh(matVC({ roughness: 1 }));
  gravelMesh.receiveShadow = true;
  group.add(gravelMesh);
  track.gravel = { width: gw, side: gSide };

  // ---------------- puente: tablero, barandas y pilares ---------------------
  const bridge = new Builder();
  const concrete = C('#a9abae'), concreteDark = C('#8c8e92');
  const wallA = C('#e63946'), wallB = C('#f5f5f5');
  const edge = half + 1.0, thick = 1.3;
  for (let i = 0; i < N; i++) {
    const y0 = P[i * 3 + 1], y1 = P[track.idx(i + 1) * 3 + 1];
    if (y0 < 0.25 && y1 < 0.25) continue;
    const s = sOf(i);
    // banquina de hormigón
    for (const sg of [-1, 1]) {
      const a = sg * half, b = sg * edge;
      const [d0, d1] = sg > 0 ? [a, b] : [b, a];
      bridge.quad(pt(i, d0, 0.05), pt(i, d1, 0.05), pt(i + 1, d1, 0.05), pt(i + 1, d0, 0.05), concrete, s);
    }
    // laterales del tablero y panza
    bridge.quad(pt(i, edge, -thick), pt(i + 1, edge, -thick), pt(i + 1, edge, 0.05), pt(i, edge, 0.05), concreteDark, s);
    bridge.quad(pt(i + 1, -edge, -thick), pt(i, -edge, -thick), pt(i, -edge, 0.05), pt(i + 1, -edge, 0.05), concreteDark, s);
    bridge.quad(pt(i, -edge, -thick), pt(i + 1, -edge, -thick), pt(i + 1, edge, -thick), pt(i, edge, -thick), concreteDark, s);
    // barandas pintadas
    if (y0 > 0.6) {
      const col = Math.floor(s / 4) % 2 ? wallA : wallB;
      for (const sg of [-1, 1]) {
        const din = sg * (edge - 0.45), dout = sg * edge, h = 1.1;
        const [d0, d1] = sg > 0 ? [din, dout] : [dout, din];
        bridge.quad(pt(i, d0, h), pt(i, d1, h), pt(i + 1, d1, h), pt(i + 1, d0, h), concrete, s);
        if (sg > 0) {
          bridge.quad(pt(i + 1, din, 0.05), pt(i, din, 0.05), pt(i, din, h), pt(i + 1, din, h), col, s);
          bridge.quad(pt(i, dout, 0.05), pt(i + 1, dout, 0.05), pt(i + 1, dout, h), pt(i, dout, h), col, s);
        } else {
          bridge.quad(pt(i, din, 0.05), pt(i + 1, din, 0.05), pt(i + 1, din, h), pt(i, din, h), col, s);
          bridge.quad(pt(i + 1, dout, 0.05), pt(i, dout, 0.05), pt(i, dout, h), pt(i + 1, dout, h), col, s);
        }
      }
    }
  }
  // pilares
  const tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpP = new THREE.Vector3();
  let lastPillar = -1e9;
  for (let i = 0; i < N; i++) {
    const y = P[i * 3 + 1], s = sOf(i);
    if (y > thick + 1.2 && s - lastPillar > 15) {
      lastPillar = s;
      for (const sg of [-1, 1]) {
        track.frameAt(s, sg * (half - 2), tmpP, tmpF, tmpR);
        tmpF.setY(0).normalize();
        bridge.box(tmpP, tmpF, tmpR, 1.6, 1.6, y - thick, concrete, s, 0);
      }
    }
  }
  const bridgeMesh = bridge.mesh(matVC({ roughness: 0.8 }));
  bridgeMesh.castShadow = true;
  bridgeMesh.receiveShadow = true;
  group.add(bridgeMesh);

  // ---------------- largada a cuadros + grilla ------------------------------
  const startB = new Builder();
  const blk = C('#111111');
  const cols = 12, cw = track.width / cols;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      const col = (r + c) % 2 ? blk : white;
      const s0 = r * 0.9, s1 = s0 + 0.9;
      const d0 = -half + c * cw, d1 = d0 + cw;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), d = new THREE.Vector3();
      track.frameAt(s0, d0, a, tmpF, tmpR); a.y += 0.1;
      track.frameAt(s0, d1, b, tmpF, tmpR); b.y += 0.1;
      track.frameAt(s1, d1, cc, tmpF, tmpR); cc.y += 0.1;
      track.frameAt(s1, d0, d, tmpF, tmpR); d.y += 0.1;
      startB.quad(a, b, cc, d, col, 0);
    }
  }
  // cajones de la grilla
  for (let k = 0; k < 20; k++) {
    const g = track.gridSlot(k);
    const mk = (s, d) => { const v = new THREE.Vector3(); track.frameAt(s, d, v, tmpF, tmpR); v.y += 0.1; return v; };
    const front = g.s + PHYS.carLength / 2 + 0.8;
    const hw = 1.9, t = 0.3;
    startB.quad(mk(front - t, g.d - hw), mk(front - t, g.d + hw), mk(front, g.d + hw), mk(front, g.d - hw), white, 0);
    startB.quad(mk(front - 3, g.d - hw), mk(front - 3, g.d - hw + t), mk(front, g.d - hw + t), mk(front, g.d - hw), white, 0);
    startB.quad(mk(front - 3, g.d + hw - t), mk(front - 3, g.d + hw), mk(front, g.d + hw), mk(front, g.d + hw - t), white, 0);
  }
  const startMesh = startB.mesh(matVC({ polygonOffset: true, polygonOffsetFactor: -2 }));
  startMesh.receiveShadow = true;
  startMesh.userData.reveal = null; // aparece al final
  startMesh.visible = false;
  group.add(startMesh);

  const revealables = [asphaltMesh, linesMesh, kerbMesh, gravelMesh, bridgeMesh];
  return {
    group,
    startMesh,
    reveal(sNow) {
      for (const m of revealables) m.userData.reveal(sNow);
      startMesh.visible = sNow >= track.length;
    },
  };
}

// Silueta para previsualizar dónde va a quedar la pista (modo AR)
export function buildOutline(track) {
  const b = new Builder();
  const col = C('#ffffff');
  for (let i = 0; i < track.N; i += 2) {
    const P = track.pos, R = track.right;
    const mk = (j, d) => {
      j = track.idx(j);
      return new THREE.Vector3(P[j * 3] + R[j * 3] * d, 0.3 + P[j * 3 + 1] * 0.2, P[j * 3 + 2] + R[j * 3 + 2] * d);
    };
    b.quad(mk(i, -track.half), mk(i, track.half), mk(i + 2, track.half), mk(i + 2, -track.half), col, 0);
  }
  const m = b.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
  return m;
}

// Máquina asfaltadora que va "pintando" la pista durante la construcción
export function buildPaver() {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: '#ffc21a', roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd3ff', roughness: 0.1, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 4.6), yellow);
  body.position.set(0, 1.5, 0);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.6), glass);
  cab.position.set(-0.8, 3.3, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 3), yellow);
  roof.position.set(-0.8, 4.3, 0);
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 5.2, 16), dark);
  roller.rotation.x = Math.PI / 2;
  roller.position.set(3.0, 0.9, 0);
  const screed = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 12), dark);
  screed.position.set(-3.1, 0.45, 0);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff7a00' }));
  beacon.position.set(-0.8, 4.65, 0);
  g.add(body, cab, roof, roller, screed, beacon);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.beacon = beacon;
  g.userData.roller = roller;
  return g;
}
