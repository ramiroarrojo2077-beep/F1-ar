import * as THREE from 'three';
import { part, merge } from './geom.js';
import { TEAMS } from './teams.js';

// Escenografía del circuito: terreno (maqueta), árboles, tribunas con público,
// boxes, pórtico de largada con semáforo, barreras de gomas, carteles,
// banderas, laguna y un dirigible. Todo aparece con animación.

const rand = mulberry32(20261006);
const UP = new THREE.Vector3(0, 1, 0);

export function buildScenery(track) {
  const def = track.def;
  const group = new THREE.Group();
  group.name = 'scenery';
  const half = track.half;
  const pops = [];       // objetos que aparecen con animación
  const tmpP = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3();

  // -------------------------------------------------- tribunas (ubicación)
  const stands = (def.stands || []).map(sd => {
    const { i } = track.nearest(sd.x, sd.z);
    const s = i * track.ds;
    track.frameAt(s, 0, tmpP, tmpF, tmpR);
    const side = (sd.x - tmpP.x) * tmpR.x + (sd.z - tmpP.z) * tmpR.z >= 0 ? 1 : -1;
    // si hay leca cerca, alejar la tribuna
    let gw = 0;
    for (let k = -Math.round(sd.len / 2 / track.ds); k <= Math.round(sd.len / 2 / track.ds); k++) {
      const q = track.idx(i + k);
      if (track.gravel.side[q] === side) gw = Math.max(gw, track.gravel.width[q]);
    }
    const front = half + (gw > 0 ? gw + 4 : 5.5);
    const rows = sd.rows || 5, depth = rows * 1.5;
    // base derecha: fwd × arriba = out (por eso fwd se invierte de un lado)
    const fwd = new THREE.Vector3(tmpF.x, 0, tmpF.z).normalize().multiplyScalar(side);
    const out = new THREE.Vector3(tmpR.x, 0, tmpR.z).multiplyScalar(side);
    const center = tmpP.clone().setY(0).addScaledVector(out, front + depth / 2);
    return { ...sd, s, side, front, rows, depth, fwd, out, center, excite: 0 };
  });

  // -------------------------------------------------- límites del terreno
  const b = track.bounds;
  let minX = b.minX - half - 16, maxX = b.maxX + half + 16, minZ = b.minZ - half - 16, maxZ = b.maxZ + half + 16;
  for (const st of stands) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = st.center.clone().addScaledVector(st.fwd, sx * st.len / 2).addScaledVector(st.out, sz * st.depth / 2);
      minX = Math.min(minX, p.x - 6); maxX = Math.max(maxX, p.x + 6);
      minZ = Math.min(minZ, p.z - 6); maxZ = Math.max(maxZ, p.z + 6);
    }
  }
  const bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  bounds.extent = Math.max(maxX - minX, maxZ - minZ);

  // -------------------------------------------------- terreno (maqueta)
  const base = buildBase(bounds);
  group.add(base);

  // -------------------------------------------------- laguna
  let pondMesh = null;
  if (def.pond) {
    const pd = def.pond;
    const pg = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: '#cbb27a', roughness: 1 }));
    rim.scale.set(pd.rx + 1.6, pd.rz + 1.6, 1);
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03;
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: '#2f7fc4', roughness: 0.15, metalness: 0.1 }));
    water.scale.set(pd.rx, pd.rz, 1);
    water.rotation.x = -Math.PI / 2; water.position.y = 0.06;
    rim.receiveShadow = water.receiveShadow = true;
    pg.add(rim, water);
    // juncos
    const reeds = [];
    for (let k = 0; k < 18; k++) {
      const a = rand() * Math.PI * 2;
      part(reeds, new THREE.ConeGeometry(0.35, 1.6 + rand(), 5), '#5c8f2e', [Math.cos(a) * (pd.rx + 0.8), 0.8, Math.sin(a) * (pd.rz + 0.8)]);
    }
    const reedMesh = new THREE.Mesh(merge(reeds), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
    pg.add(reedMesh);
    pg.position.set(pd.x, 0, pd.z);
    group.add(pg);
    pondMesh = pg;
    pops.push({ obj: pg, delay: 0.0, mode: 'scale' });
  }

  // -------------------------------------------------- tribunas (modelos + público)
  const people = [];
  stands.forEach((st, n) => {
    const { mesh, seats } = buildStand(st, n);
    group.add(mesh);
    pops.push({ obj: mesh, delay: 0.05 + n * 0.06, mode: 'rise' });
    for (const seat of seats) people.push({ ...seat, stand: st, delay: 0.25 + n * 0.06 + seat.row * 0.03 + rand() * 0.05 });
  });
  const crowd = buildCrowd(people);
  group.add(crowd.group);

  // -------------------------------------------------- boxes
  if (def.pit) {
    const pit = buildPit(track, def.pit, stands.find(s => s.main));
    group.add(pit);
    pops.push({ obj: pit, delay: 0.12, mode: 'rise' });
  }

  // -------------------------------------------------- pórtico de largada
  const gantry = buildGantry(track);
  group.add(gantry.group);
  pops.push({ obj: gantry.group, delay: 0.3, mode: 'rise' });

  // -------------------------------------------------- carteles frente a la tribuna principal
  for (const st of stands) {
    const boards = buildBoards(st);
    group.add(boards);
    pops.push({ obj: boards, delay: 0.18, mode: 'rise' });
  }

  // -------------------------------------------------- banderas argentinas
  const flags = [];
  const mainStand = stands.find(s => s.main) || stands[0];
  if (mainStand) {
    for (const f of [-0.42, 0, 0.42]) {
      const fl = buildFlag();
      const p = mainStand.center.clone().addScaledVector(mainStand.fwd, f * mainStand.len).addScaledVector(mainStand.out, mainStand.depth / 2 + 0.6);
      fl.group.position.copy(p);
      fl.group.rotation.y = Math.atan2(-mainStand.fwd.z, mainStand.fwd.x);
      group.add(fl.group);
      flags.push(fl);
      pops.push({ obj: fl.group, delay: 0.5, mode: 'rise' });
    }
  }

  // -------------------------------------------------- árboles
  const trees = buildTrees(track, bounds, stands, def);
  group.add(trees.group);

  // -------------------------------------------------- barreras de gomas
  const tyres = buildTyreWalls(track);
  group.add(tyres);

  // -------------------------------------------------- dirigible
  const blimp = buildBlimp();
  blimp.visible = false;
  group.add(blimp);

  // ======================================================================
  let cheerT = 0;
  const api = {
    group, bounds, stands, gantry, base,
    cheer(sec = 3) { cheerT = Math.max(cheerT, sec); },
    // p entre 0 y 1
    setBaseProgress(p) {
      const e = p <= 0 ? 0 : easeOutBack(Math.min(1, p));
      base.scale.set(Math.max(1e-3, e), Math.max(1e-3, Math.min(1, p * 1.5)), Math.max(1e-3, e));
      base.visible = p > 0;
    },
    setTrackProgress(sNow) {
      // las gomas aparecen a medida que pasa la asfaltadora
      let n = 0;
      const arr = tyres.userData.sList;
      while (n < arr.length && arr[n] <= sNow) n++;
      tyres.count = n;
    },
    setPropsProgress(p) {
      for (const it of pops) {
        const t = clamp01((p - it.delay) / 0.25);
        const e = t >= 1 ? 1 : easeOutBack(t);
        it.obj.visible = t > 0;
        if (it.mode === 'rise') it.obj.scale.set(1, Math.max(1e-3, e), 1);
        else it.obj.scale.setScalar(Math.max(1e-3, e));
      }
      trees.setProgress(p);
      crowd.setProgress(p);
      blimp.visible = p > 0.6;
    },
    update(dt, time, carsWorld) {
      if (cheerT > 0) cheerT -= dt;
      // emoción de cada tribuna según autos cerca
      for (const st of stands) {
        let near = 0;
        if (carsWorld) {
          for (const c of carsWorld) {
            const dx = c.x - st.center.x, dz = c.z - st.center.z;
            const along = Math.abs(dx * st.fwd.x + dz * st.fwd.z) - st.len / 2;
            const dist = Math.hypot(Math.max(0, along), dx * st.out.x + dz * st.out.z);
            near = Math.max(near, 1 - clamp01((dist - 10) / 30));
          }
        }
        const target = Math.max(near * 0.7, cheerT > 0 ? 1 : 0, 0.08);
        st.excite += (target - st.excite) * Math.min(1, dt * 3);
      }
      crowd.update(time);
      for (const fl of flags) fl.update(time);
      // dirigible dando vueltas
      const a = time * 0.05;
      const r = bounds.extent * 0.28;
      blimp.position.set(bounds.cx + Math.cos(a) * r, 52 + Math.sin(time * 0.3) * 1.5, bounds.cz + Math.sin(a) * r);
      blimp.rotation.y = -a - Math.PI;
    },
  };
  api.setBaseProgress(0);
  api.setPropsProgress(0);
  api.setTrackProgress(-1);
  return api;
}

// ---------------------------------------------------------------- terreno
function buildBase(bd) {
  const w = bd.maxX - bd.minX, h = bd.maxZ - bd.minZ, r = 18;
  const shape = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x0 + w - r, y0); shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  shape.lineTo(x0 + w, y0 + h - r); shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  shape.lineTo(x0 + r, y0 + h); shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  shape.lineTo(x0, y0 + r); shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const depth = 5;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2, curveSegments: 10 });
  geo.rotateX(Math.PI / 2); // la forma queda en XZ; el extruido va hacia abajo
  geo.translate(0, -0.6, 0);
  const grass = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const soil = new THREE.MeshStandardMaterial({ map: soilTexture(), roughness: 1 });
  const mesh = new THREE.Mesh(geo, [grass, soil]);
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.position.set(bd.cx, 0, bd.cz);
  // tapa superior a y = 0: con rotateX(+90) la cara z=0 queda en y=0 y el resto abajo
  return g;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#4f9b3c' : '#5aa845';
    g.fillRect(0, i * 32, 256, 32);
  }
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${20 + rand() * 40},${90 + rand() * 70},${20 + rand() * 30},0.35)`;
    g.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 80, 1 / 80);
  t.anisotropy = 4;
  return t;
}

function soilTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4c8f36'); grad.addColorStop(0.08, '#4c8f36');
  grad.addColorStop(0.1, '#7a5233'); grad.addColorStop(0.55, '#6b4529');
  grad.addColorStop(0.6, '#8a7a66'); grad.addColorStop(1, '#6d6152');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${rand() * 0.15})`;
    g.fillRect(rand() * 64, 30 + rand() * 226, 3, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(0.05, 1 / 6.2);
  t.offset.set(0, 4.6 / 6.2);
  return t;
}

// ---------------------------------------------------------------- tribuna
function buildStand(st, n) {
  const L = [];
  const { len, rows } = st;
  const concrete = '#c9ccd1', seatA = '#74acdf', seatB = '#f4f4f4', roofCol = '#f7f7f7';
  const stepD = 1.5, rise = 0.9, base = 1.0;
  for (let r = 0; r < rows; r++) {
    const h = base + r * rise;
    part(L, new THREE.BoxGeometry(len, h, stepD), concrete, [0, h / 2, r * stepD + stepD / 2]);
    part(L, new THREE.BoxGeometry(len, 0.12, stepD * 0.45), r % 2 ? seatA : seatB, [0, h + 0.06, r * stepD + stepD * 0.7]);
  }
  const top = base + rows * rise;
  const backZ = rows * stepD;
  part(L, new THREE.BoxGeometry(len, top + 4.2, 0.5), '#aeb2b8', [0, (top + 4.2) / 2, backZ + 0.25]);
  for (const sx of [-1, 1]) part(L, new THREE.BoxGeometry(0.5, top + 4.2, backZ + 0.5), '#aeb2b8', [sx * (len / 2 + 0.25), (top + 4.2) / 2, backZ / 2 + 0.25]);
  // techo en voladizo
  part(L, new THREE.BoxGeometry(len + 1.4, 0.35, backZ + 2.2), roofCol, [0, top + 4.4, backZ / 2 - 0.6], [-0.06, 0, 0]);
  part(L, new THREE.BoxGeometry(len + 1.4, 0.55, 0.3), n % 2 ? '#e10600' : '#74acdf', [0, top + 4.15, -1.65]);
  // columnas traseras
  for (let x = -len / 2; x <= len / 2 + 0.1; x += 10) part(L, new THREE.BoxGeometry(0.5, top + 4.4, 0.5), '#8f949b', [x, (top + 4.4) / 2, backZ + 0.8]);

  const geo = merge(L);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  // ubicar: x local = a lo largo de la pista, z local = alejándose de la pista
  const basis = new THREE.Matrix4().makeBasis(st.fwd, UP, st.out);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.copy(st.center).addScaledVector(st.out, -st.depth / 2);

  // asientos con gente (coordenadas de mundo)
  const seats = [];
  const yaw = Math.atan2(-st.out.x, -st.out.z); // mirando a la pista
  for (let r = 0; r < rows; r++) {
    const h = base + r * rise + 0.12;
    for (let x = -len / 2 + 0.7; x <= len / 2 - 0.7; x += 1.0) {
      if (rand() > 0.86) continue;
      const lx = x + (rand() - 0.5) * 0.3, lz = r * stepD + stepD * 0.55;
      const p = mesh.position.clone().addScaledVector(st.fwd, lx).addScaledVector(st.out, lz).setY(h);
      seats.push({ pos: p, yaw: yaw + (rand() - 0.5) * 0.5, row: r });
    }
  }
  return { mesh, seats };
}

// ---------------------------------------------------------------- público
const SHIRTS = ['#74acdf', '#74acdf', '#ffffff', '#74acdf', '#e10600', '#ffd400', '#1f3aa8', '#ff7a00', '#00704a', '#23233a', '#ff4f9a', '#2ad4e0', '#7a1f3d', '#c3c9cf'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d9a066'];

function buildCrowd(people) {
  const group = new THREE.Group();
  // cuerpo con brazos abajo y con brazos arriba (hinchas festejando)
  const mkBody = (armsUp) => {
    const L = [];
    part(L, new THREE.BoxGeometry(0.46, 0.8, 0.32), '#3a3f4a', [0, 0.4, 0]); // piernas (jean)
    part(L, new THREE.BoxGeometry(0.6, 0.72, 0.38), '#ffffff', [0, 1.16, 0]); // remera
    if (armsUp) {
      part(L, new THREE.BoxGeometry(0.16, 0.7, 0.16), '#ffffff', [-0.42, 1.75, 0], [0, 0, 0.45]);
      part(L, new THREE.BoxGeometry(0.16, 0.7, 0.16), '#ffffff', [0.42, 1.75, 0], [0, 0, -0.45]);
    } else {
      part(L, new THREE.BoxGeometry(0.15, 0.66, 0.16), '#ffffff', [-0.39, 1.12, 0]);
      part(L, new THREE.BoxGeometry(0.15, 0.66, 0.16), '#ffffff', [0.39, 1.12, 0]);
    }
    return merge(L);
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const ups = people.filter(() => rand() < 0.3);
  const upSet = new Set(ups);
  const downs = people.filter(p => !upSet.has(p));
  const meshUp = new THREE.InstancedMesh(mkBody(true), mat, Math.max(1, ups.length));
  const meshDown = new THREE.InstancedMesh(mkBody(false), mat, Math.max(1, downs.length));
  const headGeo = new THREE.IcosahedronGeometry(0.25, 1);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(1, people.length));
  const col = new THREE.Color();
  const all = [];
  ups.forEach((p, i) => all.push({ ...p, mesh: meshUp, idx: i }));
  downs.forEach((p, i) => all.push({ ...p, mesh: meshDown, idx: i }));
  all.forEach((p, h) => {
    p.head = h;
    p.phase = rand() * Math.PI * 2;
    p.freq = 7 + rand() * 4;
    p.scale = 0.9 + rand() * 0.2;
    p.mesh.setColorAt(p.idx, col.set(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
    heads.setColorAt(h, col.set(SKIN[Math.floor(rand() * SKIN.length)]));
  });
  for (const m of [meshUp, meshDown, heads]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    group.add(m);
  }
  meshUp.count = ups.length; meshDown.count = downs.length; heads.count = people.length;

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  let progress = 0;
  function write(time) {
    for (const p of all) {
      const t = clamp01((progress - p.delay) / 0.12);
      const sc = (t >= 1 ? 1 : easeOutBack(t)) * p.scale;
      const ex = p.stand.excite;
      const jump = Math.max(0, Math.sin(time * p.freq + p.phase)) * 0.55 * ex * ex;
      Q.setFromAxisAngle(UP, p.yaw);
      P.copy(p.pos); P.y += jump;
      M.compose(P, Q, S.setScalar(Math.max(1e-3, sc)));
      p.mesh.setMatrixAt(p.idx, M);
      P.y += 1.78 * sc;
      M.compose(P, Q, S.setScalar(Math.max(1e-3, sc)));
      heads.setMatrixAt(p.head, M);
    }
    meshUp.instanceMatrix.needsUpdate = true;
    meshDown.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }
  meshUp.castShadow = meshDown.castShadow = false;
  return {
    group,
    count: people.length,
    setProgress(p) { progress = p; write(0); },
    update(time) { write(time); },
  };
}

// ---------------------------------------------------------------- boxes
function buildPit(track, pit, mainStand) {
  const side = mainStand ? -mainStand.side : -1;
  const half = track.half;
  const g = new THREE.Group();
  const P = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3();
  // calle de boxes (asfalto) y muro
  const lane = [];
  const pts = [];
  for (let s = pit.from; s <= pit.to; s += 2) pts.push(s);
  const quad = (a, b, c, d, color, list) => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z]);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const cc = new THREE.Color(color), col = new Float32Array(18);
    for (let k = 0; k < 6; k++) col.set([cc.r, cc.g, cc.b], k * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    list.push(geo);
  };
  const at = (s, d, y) => { track.frameAt(s, d, P, F, R); return P.clone().setY(y); };
  for (let k = 0; k < pts.length - 1; k++) {
    const s0 = pts[k], s1 = pts[k + 1];
    const taper = (s) => clamp01(Math.min(s - pit.from, pit.to - s) / 14);
    const w0 = 0.5 + 6 * taper(s0), w1 = 0.5 + 6 * taper(s1);
    const a0 = side * (half + 1.3), a1 = side * (half + 1.3 + w0), b1 = side * (half + 1.3 + w1);
    const [p, q, r2, t2] = side > 0
      ? [at(s0, a0, 0.05), at(s0, a1, 0.05), at(s1, b1, 0.05), at(s1, a0, 0.05)]
      : [at(s0, a1, 0.05), at(s0, a0, 0.05), at(s1, a0, 0.05), at(s1, b1, 0.05)];
    quad(p, q, r2, t2, '#45484e', lane);
  }
  const laneMesh = new THREE.Mesh(merge(lane), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  laneMesh.receiveShadow = true;
  g.add(laneMesh);

  // muro de boxes, garajes con los colores de cada escudería y cartel
  const L = [];
  const mid = (pit.from + pit.to) / 2, length = pit.to - pit.from - 24;
  track.frameAt(mid, 0, P, F, R);
  const fwd = new THREE.Vector3(F.x, 0, F.z).normalize().multiplyScalar(side);
  const out = new THREE.Vector3(R.x, 0, R.z).multiplyScalar(side);
  const wall = P.clone().setY(0).addScaledVector(out, half + 0.15);
  const bldg = P.clone().setY(0).addScaledVector(out, half + 8.6 + 5);
  const bl = []; // en coords locales del edificio
  part(bl, new THREE.BoxGeometry(length, 4.6, 10), '#e9ecef', [0, 2.3, 0]);
  part(bl, new THREE.BoxGeometry(length + 1, 0.4, 11), '#2b2f36', [0, 4.8, 0]);
  part(bl, new THREE.BoxGeometry(length * 0.9, 1.2, 0.2), '#9fd3ff', [0, 3.7, -5.05]); // ventanal
  const n = TEAMS.length, gw = length / n;
  TEAMS.forEach((t, k) => {
    part(bl, new THREE.BoxGeometry(gw * 0.8, 2.8, 0.2), t.color, [-length / 2 + gw * (k + 0.5), 1.4, -5.05]);
  });
  // torre de control
  part(bl, new THREE.BoxGeometry(6, 12, 6), '#e9ecef', [0, 6, 3]);
  part(bl, new THREE.BoxGeometry(6.6, 2.2, 6.6), '#7fc3ff', [0, 10.6, 3]);
  part(bl, new THREE.BoxGeometry(7.2, 0.4, 7.2), '#2b2f36', [0, 12.1, 3]);
  const bmesh = new THREE.Mesh(merge(bl), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  bmesh.castShadow = bmesh.receiveShadow = true;
  bmesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, UP, out));
  bmesh.position.copy(bldg);
  g.add(bmesh);
  // cartel "F1 AR" sobre la torre
  const sign = textPlane('F1 AR', 9, 2.6, '#e10600', '#ffffff');
  sign.position.copy(bldg).addScaledVector(out, 3).setY(14.2);
  sign.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd.clone().negate(), UP, out.clone().negate()));
  g.add(sign);
  // muro
  part(L, new THREE.BoxGeometry(length + 20, 1.0, 0.45), '#d9d9d9', [0, 0.5, 0]);
  const wmesh = new THREE.Mesh(merge(L), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  wmesh.castShadow = true;
  wmesh.quaternion.copy(bmesh.quaternion);
  wmesh.position.copy(wall).addScaledVector(out, 0.6);
  g.add(wmesh);
  return g;
}

// ---------------------------------------------------------------- pórtico + semáforo
function buildGantry(track) {
  const g = new THREE.Group();
  const P = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3();
  track.frameAt(0, 0, P, F, R);
  const fwd = new THREE.Vector3(F.x, 0, F.z).normalize();
  const right = new THREE.Vector3(R.x, 0, R.z);
  const span = track.half + 1.8;
  const L = [];
  part(L, new THREE.BoxGeometry(0.6, 8.4, 0.6), '#2b2f36', [0, 4.2, -span]);
  part(L, new THREE.BoxGeometry(0.6, 8.4, 0.6), '#2b2f36', [0, 4.2, span]);
  part(L, new THREE.BoxGeometry(0.8, 1.0, span * 2 + 0.6), '#e10600', [0, 8.0, 0]);
  part(L, new THREE.BoxGeometry(0.7, 1.4, 7.2), '#111111', [-0.6, 6.8, 0]);
  const m = new THREE.Mesh(merge(L), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  m.castShadow = true;
  g.add(m);
  // 5 luces (se ven desde la grilla y desde arriba)
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: '#330000', emissive: '#ff0000', emissiveIntensity: 0, roughness: 0.3 });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat);
    s.position.set(-1.0, 6.8, (k - 2) * 1.35);
    g.add(s);
    lights.push(mat);
  }
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, UP, right));
  g.position.copy(P).setY(P.y);
  return {
    group: g,
    setLights(n, green = false) {
      lights.forEach((mat, k) => {
        const on = k < n;
        mat.emissive.set(green ? '#00ff55' : '#ff0000');
        mat.emissiveIntensity = on || green ? 3 : 0;
        mat.color.set(on ? '#ff2222' : green ? '#22ff66' : '#330000');
      });
    },
  };
}

// ---------------------------------------------------------------- carteles
const ADS = ['F1 AR', 'DULCE DE LECHE', 'MATE POWER', 'PAMPA ENERGY', 'ALFAJOR GP', 'TANGO OIL', 'ASADO TYRES'];
let adTex = null;
function buildBoards(st) {
  if (!adTex) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 64;
    const g = c.getContext('2d');
    const colors = ['#e10600', '#1f3aa8', '#111111', '#00704a', '#ff7a00', '#74acdf', '#7a1f3d'];
    const w = 1024 / ADS.length;
    ADS.forEach((t, k) => {
      g.fillStyle = colors[k % colors.length]; g.fillRect(k * w, 0, w, 64);
      g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, k * w + w / 2, 33, w - 10);
    });
    adTex = new THREE.CanvasTexture(c);
    adTex.colorSpace = THREE.SRGBColorSpace;
    adTex.wrapS = THREE.RepeatWrapping;
  }
  const tex = adTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(st.len / 60, 1);
  const geo = new THREE.PlaneGeometry(st.len, 1.2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
  const back = new THREE.Mesh(new THREE.BoxGeometry(st.len, 1.25, 0.15), new THREE.MeshStandardMaterial({ color: '#333' }));
  const g = new THREE.Group();
  m.position.set(0, 0.95, -0.09);
  back.position.set(0, 0.95, 0);
  g.add(back, m);
  // de frente a la pista
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(st.fwd.clone().negate(), UP, st.out.clone().negate()));
  g.position.copy(st.center).addScaledVector(st.out, -st.depth / 2 - 2.2);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// cartel con texto legible de los dos lados (dos planos espalda con espalda)
function textPlane(text, w, h, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.font = `italic 900 ${c.height * 0.72}px sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  const geo = new THREE.PlaneGeometry(w, h);
  const grp = new THREE.Group();
  const front = new THREE.Mesh(geo, mat);
  const back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  back.position.z = -0.02;
  grp.add(front, back);
  return grp;
}

// ---------------------------------------------------------------- banderas
let flagTex = null;
function buildFlag() {
  if (!flagTex) {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 78;
    const g = c.getContext('2d');
    g.fillStyle = '#74acdf'; g.fillRect(0, 0, 120, 78);
    g.fillStyle = '#ffffff'; g.fillRect(0, 26, 120, 26);
    g.fillStyle = '#f6b40e'; g.beginPath(); g.arc(60, 39, 8, 0, Math.PI * 2); g.fill();
    flagTex = new THREE.CanvasTexture(c);
    flagTex.colorSpace = THREE.SRGBColorSpace;
  }
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 14, 6), new THREE.MeshStandardMaterial({ color: '#ddd', metalness: 0.5, roughness: 0.4 }));
  pole.position.y = 7;
  const geo = new THREE.PlaneGeometry(4.2, 2.7, 12, 1);
  geo.translate(2.1, 0, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
  cloth.position.y = 12.5;
  group.add(pole, cloth);
  const pos = geo.attributes.position, base = Float32Array.from(pos.array);
  const ph = rand() * 6;
  return {
    group,
    update(time) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        pos.setZ(i, Math.sin(x * 1.4 - time * 5 + ph) * 0.18 * x);
      }
      pos.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- árboles
function buildTrees(track, bd, stands, def) {
  const group = new THREE.Group();
  const spots = [];
  const okSpot = (x, z) => {
    if (x < bd.minX + 4 || x > bd.maxX - 4 || z < bd.minZ + 4 || z > bd.maxZ - 4) return false;
    const { i, dist } = track.nearest(x, z);
    const gw = track.gravel.width[i] || 0;
    if (dist < track.half + 6 + gw) return false;
    for (const st of stands) {
      const dx = x - st.center.x, dz = z - st.center.z;
      if (Math.abs(dx * st.fwd.x + dz * st.fwd.z) < st.len / 2 + 4 && Math.abs(dx * st.out.x + dz * st.out.z) < st.depth / 2 + 6) return false;
    }
    if (def.pit) {
      // zona de boxes: franja interior de la recta principal
      const s = i * track.ds;
      const inPit = (s >= track.wrap(def.pit.from) || s <= def.pit.to) && dist < track.half + 26;
      const main = stands.find(st => st.main);
      if (inPit && main) {
        const P = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3();
        track.frameAt(s, 0, P, F, R);
        const sideOf = (x - P.x) * R.x + (z - P.z) * R.z;
        if (Math.sign(sideOf) === -main.side) return false;
      }
    }
    if (def.pond) {
      const u = (x - def.pond.x) / (def.pond.rx + 3), v = (z - def.pond.z) / (def.pond.rz + 3);
      if (u * u + v * v < 1) return false;
    }
    for (const t of spots) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 16) return false;
    return true;
  };
  // grupos (bosquecitos) + sueltos
  const clusters = [];
  for (let k = 0; k < 16; k++) clusters.push([bd.minX + rand() * (bd.maxX - bd.minX), bd.minZ + rand() * (bd.maxZ - bd.minZ)]);
  let tries = 0;
  while (spots.length < 150 && tries < 6000) {
    tries++;
    let x, z;
    if (rand() < 0.65) {
      const c = clusters[Math.floor(rand() * clusters.length)];
      x = c[0] + gauss() * 9; z = c[1] + gauss() * 9;
    } else {
      x = bd.minX + rand() * (bd.maxX - bd.minX); z = bd.minZ + rand() * (bd.maxZ - bd.minZ);
    }
    if (okSpot(x, z)) spots.push({ x, z });
  }
  // a cada árbol una especie
  const pines = [], rounds = [];
  const cx = (bd.minX + bd.maxX) / 2, cz = (bd.minZ + bd.maxZ) / 2;
  const maxR = Math.hypot(bd.maxX - bd.minX, bd.maxZ - bd.minZ) / 2;
  for (const s of spots) {
    s.scale = 0.75 + rand() * 0.65;
    s.rot = rand() * Math.PI * 2;
    s.delay = 0.1 + 0.55 * Math.hypot(s.x - cx, s.z - cz) / maxR + rand() * 0.08;
    (rand() < 0.38 ? pines : rounds).push(s);
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const mk = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = n; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    return m;
  };
  // pino: tronco + dos conos
  const pineTrunk = new THREE.CylinderGeometry(0.28, 0.4, 2.4, 6); pineTrunk.translate(0, 1.2, 0);
  const L = [];
  part(L, new THREE.ConeGeometry(2.4, 4.6, 7), '#ffffff', [0, 4.2, 0]);
  part(L, new THREE.ConeGeometry(1.8, 3.6, 7), '#ffffff', [0, 6.6, 0]);
  const pineCrown = merge(L);
  const roundTrunk = new THREE.CylinderGeometry(0.35, 0.5, 3.2, 6); roundTrunk.translate(0, 1.6, 0);
  const L2 = [];
  part(L2, new THREE.IcosahedronGeometry(2.6, 0), '#ffffff', [0, 4.6, 0]);
  part(L2, new THREE.IcosahedronGeometry(1.8, 0), '#ffffff', [1.4, 3.9, 0.6]);
  part(L2, new THREE.IcosahedronGeometry(1.6, 0), '#ffffff', [-1.2, 4.1, -0.8]);
  const roundCrown = merge(L2);
  const sets = [
    { list: pines, trunk: mk(pineTrunk, trunkMat, pines.length), crown: mk(pineCrown, leafMat, pines.length), colors: ['#2f6b3a', '#2a5e34', '#3a7a45'] },
    { list: rounds, trunk: mk(roundTrunk, trunkMat, rounds.length), crown: mk(roundCrown, leafMat, rounds.length), colors: ['#5fa83f', '#4f9a3a', '#78b84a', '#6aa84f', '#9b7fd4', '#5fa83f', '#c6d84a'] },
  ];
  const col = new THREE.Color();
  for (const set of sets) {
    set.list.forEach((s, k) => {
      set.crown.setColorAt(k, col.set(set.colors[Math.floor(rand() * set.colors.length)]));
    });
    if (set.crown.instanceColor) set.crown.instanceColor.needsUpdate = true;
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  return {
    group,
    count: spots.length,
    setProgress(p) {
      for (const set of sets) {
        set.list.forEach((s, k) => {
          const t = clamp01((p - s.delay) / 0.2);
          const e = t >= 1 ? 1 : easeOutElastic(t);
          Q.setFromAxisAngle(UP, s.rot);
          M.compose(P.set(s.x, 0, s.z), Q, S.set(s.scale * Math.max(1e-3, Math.min(1, t * 3)), s.scale * Math.max(1e-3, e), s.scale * Math.max(1e-3, Math.min(1, t * 3))));
          set.trunk.setMatrixAt(k, M);
          set.crown.setMatrixAt(k, M);
        });
        set.trunk.instanceMatrix.needsUpdate = true;
        set.crown.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// ---------------------------------------------------------------- gomas
function buildTyreWalls(track) {
  const items = [];
  const P = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3();
  const { width, side } = track.gravel;
  let last = -1e9;
  for (let i = 0; i < track.N; i++) {
    const s = i * track.ds;
    if (width[i] < 5 || s - last < 1.15) continue;
    last = s;
    const d = side[i] * (track.half + 0.9 + width[i] + 1.0);
    track.frameAt(s, d, P, F, R);
    items.push({ s, x: P.x, z: P.z, k: items.length });
  }
  const geo = new THREE.CylinderGeometry(0.55, 0.55, 1.0, 10);
  geo.translate(0, 0.5, 0);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), Math.max(1, items.length));
  const M = new THREE.Matrix4(), col = new THREE.Color();
  items.forEach((it, k) => {
    M.makeTranslation(it.x, 0, it.z);
    m.setMatrixAt(k, M);
    m.setColorAt(k, col.set(Math.floor(k / 2) % 2 ? '#e8e8e8' : '#d81e1e'));
  });
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = true;
  m.userData.sList = items.map(it => it.s);
  m.count = 0;
  return m;
}

// ---------------------------------------------------------------- dirigible
function buildBlimp() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.45 }));
  body.scale.set(9, 2.8, 2.8);
  const band = new THREE.Mesh(new THREE.SphereGeometry(1.01, 24, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16), new THREE.MeshStandardMaterial({ color: '#74acdf', roughness: 0.5 }));
  band.scale.copy(body.scale);
  const gond = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: '#333' }));
  gond.position.y = -2.9;
  g.add(body, band, gond);
  const finMat = new THREE.MeshStandardMaterial({ color: '#e10600' });
  for (let k = 0; k < 4; k++) {
    const pivot = new THREE.Group();
    pivot.rotation.x = k * Math.PI / 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.15), finMat);
    fin.position.set(-7.4, 1.7, 0);
    pivot.add(fin);
    g.add(pivot);
  }
  for (const sz of [-1, 1]) {
    const t = textPlane('F1 AR', 7, 1.8, '#74acdf', '#ffffff');
    t.position.set(0.5, 0.2, sz * 2.86);
    if (sz < 0) t.rotation.y = Math.PI;
    g.add(t);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- utilidades
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; }
function easeOutElastic(t) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  return Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
}
function gauss() { return (rand() + rand() + rand() - 1.5) / 0.5; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
