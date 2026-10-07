import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { Track, CIRCUITS, PHYS } from './track.js';
import { buildTrackMesh, buildOutline, buildPaver } from './trackMesh.js';
import { buildScenery, clamp01 } from './scenery.js';
import { makeCarMesh } from './car.js';
import { Race, fmtTime } from './race.js';
import { pickDrivers } from './teams.js';
import { Sound } from './audio.js';
import { ARSession, arSupport } from './ar.js';
import { HUD, contrast } from './hud.js';

// ============================================================ estado general
const $ = (id) => document.getElementById(id);
const settings = { laps: 5, cars: 12, incidents: true };
const app = {
  mode: null,          // 'ar' | '3d'
  phase: 'menu',       // menu | placing | building | ready | race | results
  buildT: 0,
  buildSpeed: 1,
  built: false,
  timeScale: 1,
  labels: true,
  camMode: 'orbit',    // orbit | tv | chase
  selected: null,      // id del auto elegido para seguir
  pick: null,          // id del pronóstico
  arSize: 1.2,         // metros
  arYaw: 0,
  placed: false,
};

const track = new Track(CIRCUITS.puente);
const hud = new HUD(track);
const sound = new Sound();

// ============================================================ render
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.48;
controls.minDistance = 25;
controls.maxDistance = 900;
controls.enabled = false;

// cielo y piso para el modo 3D
const sky = skyTexture();
const fog = new THREE.Fog(0xcfe6f7, 700, 2200);
const floor = new THREE.Mesh(new THREE.CircleGeometry(3000, 64), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.75 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// anchor = dónde se apoya la maqueta (AR: en la mesa/piso, con escala);
// content = la maqueta en unidades de pista, centrada.
const anchor = new THREE.Group();
const content = new THREE.Group();
anchor.add(content);
scene.add(anchor);

const hemi = new THREE.HemisphereLight(0xe3f1ff, 0x5d4b38, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
anchor.add(sun, sun.target);

// ---------------------------------------------------- la maqueta
const trackMesh = buildTrackMesh(track);
const scenery = buildScenery(track);
const BASE_H = 6.2; // espesor de la maqueta: su base apoya en y = 0
content.add(scenery.group, trackMesh.group);
content.position.set(-scenery.bounds.cx, BASE_H, -scenery.bounds.cz);
const EXTENT = scenery.bounds.extent;

const paver = buildPaver();
paver.visible = false;
content.add(paver);

const outline = buildOutline(track);
outline.visible = false;
content.add(outline);

// marcador del auto elegido
const marker = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.6, 4), new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false, transparent: true }));
marker.rotation.x = Math.PI;
marker.renderOrder = 998;
marker.visible = false;
content.add(marker);

// humo (abandonos y trompos)
const smoke = makeSmoke();
content.add(smoke.group);

function setScale(meters) {
  const k = app.mode === 'ar' ? meters / EXTENT : 1;
  anchor.scale.setScalar(k);
  // sombras en unidades de mundo
  const r = EXTENT * 0.62 * k;
  const cam = sun.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 1 * k; cam.far = EXTENT * 2.4 * k;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.12 * k;
  sun.position.set(EXTENT * 0.32, EXTENT * 0.9, EXTENT * 0.5);
  sun.target.position.set(0, 0, 0);
}

// ============================================================ autos
let race = null;
let carViews = [];
const P = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3(), H = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const M4 = new THREE.Matrix4();

function newRace() {
  for (const v of carViews) { content.remove(v.mesh); content.remove(v.label); v.label.material.map.dispose(); v.label.material.dispose(); }
  race = new Race(track, pickDrivers(settings.cars), { laps: settings.laps, incidents: settings.incidents });
  race.on(onRaceEvent);
  carViews = race.cars.map(c => {
    const mesh = makeCarMesh(c.team, c.driver === c.team.drivers[1] ? 1 : 0);
    const label = makeLabel();
    content.add(mesh, label);
    return { car: c, mesh, label, drop: 0, labelPos: -1, labelState: '' };
  });
  app.selected = null;
  app.pick = null;
  hud.setupTower(race, (id) => selectCar(id));
  hud.setupMinimapDots(race);
  hud.clearTicker();
  hud.setPickBadge(null);
  hud.updateCarCard(null);
  hud.lights(null);
  scenery.gantry.setLights(0);
  placeCars(0);
}

function placeCars(dt) {
  if (!race) return;
  const local = [];
  for (const v of carViews) {
    const c = v.car;
    track.frameAt(c.s, c.d, P, F, R);
    const yawLat = Math.atan2(c.latVel, Math.max(c.v, 4)) * 0.9;
    H.copy(F).applyAxisAngle(UP, -yawLat + c.spin);
    const x = H.normalize();
    const up = UP.clone().addScaledVector(x, -x.dot(UP)).normalize();
    const z = new THREE.Vector3().crossVectors(x, up);
    M4.makeBasis(x, up, z);
    v.mesh.quaternion.setFromRotationMatrix(M4);
    const offTrack = Math.abs(c.d) > track.half + 0.5 && P.y < 0.3;
    const y = (offTrack ? 0 : P.y + 0.06) + (1 - easeOutBounce(clamp01(v.drop))) * 40;
    v.mesh.position.set(P.x, y, P.z);
    v.mesh.visible = v.drop > 0;
    // etiqueta
    v.label.visible = app.labels && v.drop >= 1 && !(app.mode === '3d' && app.camMode === 'chase' && followCar() === v);
    v.label.position.set(P.x, y + 4.6, P.z);
    const st = c.retired ? 'out' : c.finished ? 'fin' : '';
    if (v.labelPos !== c.pos || v.labelState !== st) { drawLabel(v.label, c, st); v.labelPos = c.pos; v.labelState = st; }
    local.push({ x: P.x, z: P.z, v: c.v, car: c, mesh: v.mesh });
    // humo
    if (c.retired && !c.parked && Math.random() < dt * 30) smoke.emit(P.x, y + 1.2, P.z, 0x555555, 1.6);
    if (c.retired && c.parked && race.time - (c.retiredAt || 0) < 12 && Math.random() < dt * 8) smoke.emit(P.x, y + 1.0, P.z, 0x777777, 1.2);
    if (c.mistake && c.mistake.type === 'spin' && c.v > 2 && Math.random() < dt * 40) smoke.emit(P.x, y + 0.4, P.z, 0xeeeeee, 1.0);
  }
  return local;
}

function selectCar(id) {
  app.selected = app.selected === id ? null : id;
  if (app.selected !== null && app.mode === '3d' && app.camMode === 'orbit') setCamMode('chase');
  refreshHud();
}

// ============================================================ etiquetas
function makeLabel() {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 48;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  setLabelMode(s);
  s.renderOrder = 997;
  s.center.set(0.5, 0);
  return s;
}
// en 3D las etiquetas tienen tamaño fijo en pantalla; en AR, tamaño "real"
function setLabelMode(s) {
  const fixed = app.mode === '3d';
  s.material.sizeAttenuation = !fixed;
  if (fixed) s.scale.set(0.075, 0.0225, 1); else s.scale.set(7, 2.1, 1);
  s.material.needsUpdate = true;
}

function drawLabel(sprite, car, st) {
  const tex = sprite.material.map, cv = tex.image, g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = 'rgba(12,13,18,0.86)';
  roundRect(g, 2, 2, 156, 44, 10); g.fill();
  g.fillStyle = car.team.color; g.fillRect(10, 10, 8, 28);
  g.fillStyle = st === 'out' ? '#888' : '#fff';
  g.font = '900 26px "Titillium Web", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(st === 'out' ? 'OUT' : String(car.pos), 26, 25);
  g.font = '700 26px "Titillium Web", sans-serif';
  g.fillText(car.code, 74, 25);
  tex.needsUpdate = true;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ============================================================ construcción animada
const T_BASE = 1.0, T_TRACK0 = 0.8, T_TRACK = 5.2, T_PROPS0 = 5.8, T_PROPS = 4.2, T_CARS0 = 9.4;
let popTimer = 0;

function resetBuild() {
  app.buildT = 0;
  app.built = false;
  scenery.setBaseProgress(0);
  trackMesh.reveal(-1);
  scenery.setTrackProgress(-1);
  scenery.setPropsProgress(0);
  for (const v of carViews) v.drop = 0;
}

function startBuild() {
  app.phase = 'building';
  app.buildSpeed = 1;
  hud.show(['build']);
  $('build-text').textContent = 'Preparando el terreno…';
  if (app.built) { app.buildT = T_CARS0; for (const v of carViews) v.drop = 0; }
}

function updateBuild(dt) {
  app.buildT += dt * app.buildSpeed;
  const t = app.buildT;
  scenery.setBaseProgress(clamp01(t / T_BASE));
  const tp = clamp01((t - T_TRACK0) / T_TRACK);
  const sNow = track.length * easeInOut(tp);
  trackMesh.reveal(tp >= 1 ? track.length + 1 : sNow);
  scenery.setTrackProgress(tp >= 1 ? track.length + 1 : sNow);
  // asfaltadora
  paver.visible = tp > 0 && tp < 1;
  if (paver.visible) {
    track.frameAt(sNow, 0, P, F, R);
    paver.position.set(P.x, P.y + 0.06, P.z);
    paver.quaternion.setFromRotationMatrix(M4.makeBasis(F.clone().setY(0).normalize(), UP, R));
    paver.userData.beacon.visible = Math.floor(t * 6) % 2 === 0;
  }
  const pp = clamp01((t - T_PROPS0) / T_PROPS);
  scenery.setPropsProgress(pp);
  if (pp > 0 && pp < 0.85) {
    popTimer -= dt;
    if (popTimer <= 0) { sound.pop(); popTimer = 0.07 + Math.random() * 0.08; }
  }
  // autos cayendo en la grilla
  const n = carViews.length;
  carViews.forEach((v, k) => { v.drop = clamp01((t - T_CARS0 - k * 0.14) / 0.9); });
  // textos
  const total = T_CARS0 + n * 0.14 + 0.9;
  $('build-bar').style.width = (clamp01(t / total) * 100).toFixed(1) + '%';
  $('build-text').textContent = t < T_TRACK0 ? 'Preparando el terreno…'
    : tp < 1 ? `Asfaltando la pista… ${Math.round(tp * 100)}%`
      : pp < 0.5 ? 'Plantando árboles y armando las tribunas…'
        : pp < 1 ? 'Llega el público 🇦🇷' : 'Los autos salen a la grilla…';
  if (t >= total) {
    app.built = true;
    toReady();
  }
}

function finishBuildInstantly() {
  app.buildT = 1e3;
  scenery.setBaseProgress(1);
  trackMesh.reveal(track.length + 1);
  scenery.setTrackProgress(track.length + 1);
  scenery.setPropsProgress(1);
  paver.visible = false;
  app.built = true;
}

// ============================================================ fases
function toReady() {
  app.phase = 'ready';
  for (const v of carViews) v.drop = 1;
  hud.show(['predict', 'hud']);
  $('btn-move').classList.toggle('hidden', app.mode !== 'ar');
  hud.buildPredict(race, app.pick, (id) => { app.pick = id; hud.updateTower(race, app.selected, app.pick); });
  hud.updateTower(race, app.selected, app.pick);
  hud.setLap(race);
}

function startRace() {
  if (!race || race.state !== 'grid') return;
  sound.init();
  app.phase = 'race';
  hud.show(['hud']);
  const pc = race.cars.find(c => c.id === app.pick);
  hud.setPickBadge(pc || null);
  race.startLights();
}

function onRaceEvent(type, d) {
  const c = d.car;
  switch (type) {
    case 'light':
      hud.lights(d.n);
      scenery.gantry.setLights(d.n);
      sound.beep(440, 0.22, 0.25, 'square');
      break;
    case 'go':
      hud.lights(0);
      scenery.gantry.setLights(0);
      setTimeout(() => hud.lights(null), 900);
      hud.banner('¡LARGARON!');
      sound.beep(880, 0.6, 0.3, 'square');
      sound.cheer(1.2, 4);
      scenery.cheer(5);
      break;
    case 'start':
      hud.tick(`¡Largadón de ${c.code}! Gana ${d.gained} posiciones`, 'green');
      break;
    case 'overtake': {
      const where = track.cornerAt(c.s);
      if (d.pos === 1) {
        hud.banner(`${c.code} <small>¡nuevo líder!</small>`, 1800);
        sound.cheer(0.9, 2.5);
        scenery.cheer(3);
      }
      hud.tick(`${c.code} pasa a ${d.other.code} por el P${d.pos}${where ? ' en ' + where.name : ''}`);
      break;
    }
    case 'mistake':
      hud.tick(d.type === 'spin' ? `¡Trompo de ${c.code} en ${d.corner.name}!` : `${c.code} se pasa de largo en ${d.corner.name}`, 'yellow');
      if (d.type === 'spin') sound.cheer(0.6, 1.5);
      break;
    case 'retire':
      hud.tick(`💨 Abandono de ${c.code} (${c.team.name}): se rompió el motor`, 'yellow');
      break;
    case 'fastest':
      hud.tick(`⏱ Vuelta rápida de ${c.code}: ${fmtTime(d.time)}`, 'purple');
      break;
    case 'lap':
      if (d.lap === race.laps) { hud.banner('¡ÚLTIMA VUELTA!', 1800); sound.cheer(0.7, 2); }
      else hud.tick(`Vuelta ${d.lap} de ${race.laps} · lidera ${c.code}`, 'blue');
      break;
    case 'winner':
      hud.banner(`🏁 ¡GANA ${c.code}! <small>${c.driver.name} · ${c.team.name}</small>`, 3500);
      sound.cheer(1.5, 6);
      scenery.cheer(10);
      if (app.pick !== null) hud.toast(app.pick === c.id ? '🎉 ¡Acertaste el ganador!' : 'Tu pronóstico no ganó esta vez…', 3200);
      break;
    case 'done':
      setTimeout(showResults, 2600);
      break;
  }
}

function showResults() {
  if (app.phase !== 'race') return;
  app.phase = 'results';
  const stats = loadStats();
  stats.races++;
  if (app.pick !== null) {
    stats.picks++;
    if (race.order[0].id === app.pick) stats.hits++;
  }
  saveStats(stats);
  hud.showResults(race, app.pick, stats);
  sound.silenceEngines();
}

function rematch() {
  newRace();
  for (const v of carViews) v.drop = 0;
  app.phase = 'building';
  app.buildT = T_CARS0;
  hud.show(['build']);
}

function toMenu() {
  if (arSession.session) { arSession.end(); return; } // onEnd vuelve acá
  app.phase = 'menu';
  app.mode = null;
  controls.enabled = false;
  sound.silenceEngines();
  hud.show(['menu']);
  updateStatsLine();
}

// ============================================================ modo 3D
function start3D() {
  sound.init();
  app.mode = '3d';
  app.placed = true;
  camera.near = 0.5; camera.far = 5000; camera.fov = 50;
  camera.updateProjectionMatrix();
  scene.background = sky;
  scene.fog = fog;
  floor.visible = true;
  anchor.position.set(0, 0, 0);
  anchor.quaternion.identity();
  setScale(1);
  renderer.shadowMap.enabled = true;
  sun.shadow.mapSize.set(2048, 2048);
  controls.enabled = true;
  frameCamera();
  setCamMode('orbit');
  $('btn-cam').classList.remove('hidden');
  newRace();
  resetBuild();
  startBuild();
}

// encuadre inicial: desde el lado de las eses, mirando a la tribuna principal,
// a la distancia justa para que la maqueta entre en pantalla (vertical u horizontal)
function frameCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const v = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hTan = Math.tan(v) * camera.aspect;
  const dist = Math.max(EXTENT * 0.56 / hTan, EXTENT * 0.5 / Math.tan(v)) * 1.05;
  controls.target.set(0, BASE_H, -6);
  const dir = new THREE.Vector3(0.2, 0.66, -1).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.maxDistance = Math.max(900, dist * 1.6);
  controls.update();
}

// postes de las cámaras de TV: al costado de la pista, lejos de cualquier
// otro tramo (así nunca quedan justo encima de un auto) y adentro de la maqueta
const tvPosts = [];
for (let k = 0; k < 16; k++) {
  const s = (k + 0.5) * track.length / 16;
  track.frameAt(s, 0, P, F, R);
  let best = null;
  for (const off of [26, 34, 44]) {
    for (const side of [1, -1]) {
      const x = P.x + R.x * side * (track.half + off), z = P.z + R.z * side * (track.half + off);
      const b = scenery.bounds;
      if (x < b.minX + 4 || x > b.maxX - 4 || z < b.minZ + 4 || z > b.maxZ - 4) continue;
      const near = track.nearest(x, z).dist;
      if (near < track.half + 18) continue;
      if (!best || near < best.near) best = { x, z, near };
    }
    if (best) break;
  }
  if (best) tvPosts.push(new THREE.Vector3(best.x, P.y + 20, best.z));
}
let tvPost = 0;
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();

function setCamMode(m) {
  app.camMode = m;
  controls.enabled = m === 'orbit';
  $('btn-cam').textContent = { orbit: '🎥', tv: '📺', chase: '🏎' }[m];
  if (m === 'orbit') { camera.fov = 50; camera.updateProjectionMatrix(); }
}

function followCar() {
  if (!race) return null;
  const id = app.selected !== null ? app.selected : race.order[0].id;
  return carViews.find(v => v.car.id === id) || null;
}

function updateCamera3D(dt) {
  if (app.mode !== '3d') return;
  if (app.camMode === 'orbit') { controls.update(); return; }
  const v = followCar();
  if (!v || v.drop < 1) { controls.update(); return; }
  const carWorld = v.mesh.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(v.mesh.quaternion).setY(0).normalize();
  if (app.camMode === 'chase') {
    camPos.copy(carWorld).addScaledVector(fwd, -15).add(new THREE.Vector3(0, 6.5, 0));
    camTarget.copy(carWorld).addScaledVector(fwd, 9).add(new THREE.Vector3(0, 1.5, 0));
    const k = 1 - Math.exp(-dt * 6);
    camera.position.lerp(camPos, k);
    controls.target.lerp(camTarget, k);
    camera.lookAt(controls.target);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  } else {
    // cámara de TV: el poste más cercano, con zoom
    let best = tvPost, bd = Infinity;
    tvPosts.forEach((p, k) => {
      const dd = content.localToWorld(p.clone()).distanceTo(carWorld);
      if (dd < bd) { bd = dd; best = k; }
    });
    const curD = content.localToWorld(tvPosts[tvPost].clone()).distanceTo(carWorld);
    if (best !== tvPost && curD > bd * 1.35) tvPost = best;
    const postW = content.localToWorld(tvPosts[tvPost].clone());
    camera.position.copy(postW);
    controls.target.lerp(carWorld, 1 - Math.exp(-dt * 10));
    camera.lookAt(controls.target);
    const dist = postW.distanceTo(carWorld);
    camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(20 / dist)), 12, 55);
    camera.updateProjectionMatrix();
  }
}

// ============================================================ modo AR
const arSession = new ARSession(renderer, $('overlay'));
scene.add(arSession.reticle);

async function startAR() {
  sound.init();
  try {
    camera.near = 0.01; camera.far = 60;
    camera.updateProjectionMatrix();
    app.mode = 'ar';
    app.placed = false;
    scene.background = null;
    scene.fog = null;
    floor.visible = false;
    controls.enabled = false;
    $('btn-cam').classList.add('hidden');
    sun.shadow.mapSize.set(1024, 1024);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    setScale(app.arSize);
    newRace();
    resetBuild();
    await arSession.start();
    toPlacing();
  } catch (err) {
    console.error(err);
    app.mode = null;
    hud.toast('No se pudo iniciar la realidad aumentada: ' + (err && err.message ? err.message : err), 4000);
    toMenu();
  }
}

function toPlacing() {
  app.phase = 'placing';
  app.placed = false;
  hud.show(['place']);
  $('btn-place').disabled = true;
  $('place-hint').textContent = 'Mové el teléfono despacio apuntando al piso o a una mesa…';
  outline.visible = !app.built;
  anchor.visible = false;
}

function placeHere() {
  if (app.phase !== 'placing' || !arSession.hasHit) return;
  app.placed = true;
  outline.visible = false;
  arSession.reticle.visible = false;
  anchor.visible = true;
  if (!app.built) startBuild();
  else if (race.state === 'grid') toReady();
  else { app.phase = race.state === 'done' ? 'results' : 'race'; hud.show(app.phase === 'results' ? ['results'] : ['hud']); }
}

arSession.onSelect = (e) => {
  if (app.phase === 'placing') { placeHere(); return; }
  // tocar un auto para seguirlo
  const ray = arSession.rayFromSelect(e, new THREE.Ray());
  if (ray) pickCarByRay(ray, 0.06);
};
arSession.onEnd = () => {
  app.mode = null;
  anchor.visible = true;
  anchor.position.set(0, 0, 0);
  anchor.quaternion.identity();
  arSession.reticle.visible = false;
  outline.visible = false;
  app.phase = 'menu';
  hud.show(['menu']);
  sound.silenceEngines();
  updateStatsLine();
};

const tmpQ = new THREE.Quaternion();
function updatePlacing() {
  const r = arSession.reticle;
  if (!arSession.hasHit) {
    r.visible = false;
    anchor.visible = false;
    $('btn-place').disabled = true;
    return;
  }
  r.visible = true;
  $('btn-place').disabled = false;
  $('place-hint').textContent = 'Tocá la pantalla o el botón para colocar el autódromo';
  // posición del hit, girada para que la recta principal mire al jugador
  const hitPos = new THREE.Vector3().setFromMatrixPosition(arSession.hitMatrix);
  const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  // el lado -z de la maqueta (las eses) queda hacia el jugador: se ve la recta
  // principal con la tribuna de frente
  const yaw = Math.atan2(camPos.x - hitPos.x, camPos.z - hitPos.z) + Math.PI + app.arYaw;
  anchor.position.copy(hitPos);
  anchor.quaternion.copy(tmpQ.setFromAxisAngle(UP, yaw));
  anchor.visible = true;
  setScale(app.arSize);
}

// ============================================================ elegir autos tocándolos
function pickCarByRay(ray, worldTol) {
  let best = null, bd = Infinity;
  for (const v of carViews) {
    if (!v.mesh.visible) continue;
    const p = v.mesh.getWorldPosition(new THREE.Vector3());
    const d = ray.distanceToPoint(p);
    const tol = app.mode === 'ar' ? Math.max(worldTol, 6 * anchor.scale.x) : worldTol;
    if (d < tol && d < bd) { bd = d; best = v; }
  }
  if (best) selectCar(best.car.id);
}

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || app.mode !== '3d') return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  pickCarByRay(rc.ray, 8);
});

// ============================================================ HUD periódico + audio
let hudTimer = 0, cardTimer = 0;
function refreshHud() {
  if (!race) return;
  hud.updateTower(race, app.selected, app.pick);
  hud.setLap(race);
  const sel = race.cars.find(c => c.id === app.selected);
  hud.updateCarCard(sel || null, race);
  const pc = race.cars.find(c => c.id === app.pick);
  if (pc && app.phase === 'race') hud.setPickBadge(pc);
}

function updateAudio(local) {
  if (!race || app.phase !== 'race' || !local) { sound.silenceEngines(); return; }
  const camLocal = content.worldToLocal(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld));
  const D0 = EXTENT * 0.22;
  const near = local
    .filter(l => !l.car.parked)
    .map(l => {
      const dist = Math.hypot(l.x - camLocal.x, l.z - camLocal.z, camLocal.y);
      return { v: l.v, vTop: PHYS.vTop, dist, gain: 1 / (1 + (dist / D0) ** 2) };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
  const activity = race.state === 'racing' || race.state === 'finished' ? 1 : race.state === 'done' ? 0.5 : 0.25;
  sound.updateEngines(near, activity);
}

// ============================================================ loop
let lastT = performance.now();
let elapsed = 0;
setScale(1);

renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  elapsed += dt;

  if (app.mode === 'ar' && frame) {
    arSession.update(frame);
    if (app.phase === 'placing') updatePlacing();
  }

  if (app.phase === 'building') updateBuild(dt);
  if (race && (app.phase === 'race' || app.phase === 'results' || (app.phase === 'placing' && race.state !== 'grid'))) race.update(dt * app.timeScale);

  const local = placeCars(dt);
  smoke.update(dt);
  scenery.update(dt, elapsed, local);

  // marcador del auto elegido
  const sv = app.selected !== null ? carViews.find(v => v.car.id === app.selected) : null;
  marker.visible = !!sv && sv.drop >= 1 && !(app.mode === '3d' && app.camMode === 'chase');
  if (sv) {
    marker.position.copy(sv.mesh.position).add(new THREE.Vector3(0, 8 + Math.sin(elapsed * 4) * 0.6, 0));
    marker.rotation.y += dt * 2;
  }

  updateCamera3D(dt);

  if (race && app.phase !== 'menu') {
    hudTimer -= dt; cardTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.25; hud.updateTower(race, app.selected, app.pick); hud.setLap(race); }
    if (cardTimer <= 0) {
      cardTimer = 0.1;
      const sel = race.cars.find(c => c.id === app.selected);
      hud.updateCarCard(sel || null, race);
      hud.updateMinimap(race, app.selected);
      const pc = race.cars.find(c => c.id === app.pick);
      if (pc && app.phase === 'race') hud.setPickBadge(pc);
    }
  }
  updateAudio(local);

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================ UI: eventos
document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const key = seg.dataset.opt, val = Number(b.dataset.v);
    settings[key] = key === 'incidents' ? val === 1 : val;
  });
});

// en AR, los toques sobre la interfaz no tienen que "colocar" ni elegir autos
document.querySelectorAll('.ui, .panel, .screen, button').forEach(el => {
  el.addEventListener('beforexrselect', (e) => e.preventDefault());
});

$('btn-3d').addEventListener('click', start3D);
$('btn-ar').addEventListener('click', startAR);
$('btn-place').addEventListener('click', placeHere);
$('btn-rot').addEventListener('click', () => { app.arYaw += Math.PI / 4; });
$('size').addEventListener('input', (e) => {
  app.arSize = Number(e.target.value);
  $('size-val').textContent = app.arSize.toFixed(1) + ' m';
  if (app.mode === 'ar') setScale(app.arSize);
});
$('btn-fast').addEventListener('click', () => { app.buildSpeed = app.buildSpeed > 1 ? 1 : 4; $('btn-fast').textContent = app.buildSpeed > 1 ? '▶ Normal' : '⏩ Acelerar'; });
$('btn-go').addEventListener('click', startRace);
$('btn-move').addEventListener('click', toPlacing);
$('btn-again').addEventListener('click', rematch);
$('btn-menu').addEventListener('click', toMenu);
$('btn-exit').addEventListener('click', toMenu);
$('btn-sound').addEventListener('click', () => {
  sound.init();
  sound.setMuted(!sound.muted);
  $('btn-sound').textContent = sound.muted ? '🔇' : '🔊';
});
$('btn-labels').addEventListener('click', () => {
  app.labels = !app.labels;
  $('btn-labels').classList.toggle('off', !app.labels);
});
const SPEEDS = [1, 2, 4, 0.5];
$('btn-speed').addEventListener('click', () => {
  app.timeScale = SPEEDS[(SPEEDS.indexOf(app.timeScale) + 1) % SPEEDS.length];
  $('btn-speed').textContent = app.timeScale === 0.5 ? '×½' : '×' + app.timeScale;
});
$('btn-cam').addEventListener('click', () => {
  const order = ['orbit', 'tv', 'chase'];
  setCamMode(order[(order.indexOf(app.camMode) + 1) % order.length]);
  hud.toast({ orbit: 'Cámara libre', tv: 'Cámara de TV', chase: 'Cámara detrás del auto' }[app.camMode], 1200);
});

// ============================================================ estadísticas del pronóstico
function loadStats() {
  try { return { races: 0, picks: 0, hits: 0, ...JSON.parse(localStorage.getItem('f1ar-stats') || '{}') }; } catch { return { races: 0, picks: 0, hits: 0 }; }
}
function saveStats(s) { try { localStorage.setItem('f1ar-stats', JSON.stringify(s)); } catch { /* sin storage */ } }
function updateStatsLine() {
  const s = loadStats();
  $('stats-line').textContent = s.races ? `Carreras: ${s.races} · Pronósticos acertados: ${s.hits}/${s.picks}` : '';
}
updateStatsLine();

// ============================================================ soporte AR
arSupport().then(({ ok, why }) => {
  $('btn-ar').disabled = !ok;
  $('ar-note').textContent = ok ? 'Apuntá a una mesa o al piso: el autódromo se arma ahí mismo.' : why;
  if (!ok) $('btn-3d').classList.add('primary');
});

// juego sin conexión (y app de Android aunque se cierre el servidor interno)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker:', err));
}

// para pruebas automáticas
window.__f1ar = { app, get race() { return race; }, settings, start3D, startRace, finishBuildInstantly, hud, contrast, renderer, scene, camera, setCamMode, selectCar };

// ============================================================ utilidades
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }
function easeOutBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5aa2e6');
  grad.addColorStop(0.55, '#a9d2f3');
  grad.addColorStop(1, '#e6f2fb');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const tones = ['#9b7653', '#a7825e', '#916c4a', '#a07a55', '#8b6646', '#a8835c', '#97714e', '#9f7b58'];
  for (let k = 0; k < 8; k++) {
    g.fillStyle = tones[k];
    g.fillRect(k * 64, 0, 64, 512);
    for (let l = 0; l < 26; l++) {
      g.strokeStyle = `rgba(60,35,15,${0.05 + Math.random() * 0.1})`;
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      const x = k * 64 + Math.random() * 64;
      g.moveTo(x, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.02 + l) * 3, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,22,8,0.45)';
    g.fillRect(k * 64, 0, 2, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.anisotropy = 8;
  return t;
}

function makeSmoke() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const group = new THREE.Group();
  const pool = [];
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    group.add(s);
    pool.push({ s, life: 0, max: 1, vy: 0, size: 1 });
  }
  let next = 0;
  return {
    group,
    emit(x, y, z, color, size) {
      const p = pool[next]; next = (next + 1) % pool.length;
      p.s.position.set(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5));
      p.s.material.color.set(color);
      p.life = 0; p.max = 1.4 + Math.random(); p.vy = 2 + Math.random() * 2; p.size = size;
      p.s.visible = true;
    },
    update(dt) {
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.life += dt;
        const t = p.life / p.max;
        if (t >= 1) { p.s.visible = false; continue; }
        p.s.position.y += p.vy * dt;
        p.s.scale.setScalar(p.size * (1 + t * 4));
        p.s.material.opacity = 0.55 * (1 - t);
      }
    },
  };
}
