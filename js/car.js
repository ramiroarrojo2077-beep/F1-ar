import * as THREE from 'three';
import { part, taperBox, merge } from './geom.js';

// Modelo 3D de un F1 armado con primitivas y fusionado en una sola geometría
// con colores por vértice (1 draw call por auto). Ejes locales:
// +X = adelante, +Y = arriba, +Z = derecha. Largo ≈ 6,4 u.

const COMPOUNDS = ['#e10600', '#ffd400', '#f0f0f0'];
const cache = new Map();

export function carGeometry(team, seat = 0) {
  const key = team.name + seat;
  if (cache.has(key)) return cache.get(key);
  const L = [];
  const body = team.color, acc = team.accent, carbon = '#16171a', tyre = '#141414', rim = '#3a3d42';
  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

  // piso y difusor
  part(L, box(5.3, 0.1, 2.0), carbon, [-0.15, 0.2, 0]);
  part(L, taperBox(0.7, 0.32, 1.5, 0.12, 1.5), carbon, [-2.85, 0.32, 0]);
  // monocasco
  part(L, taperBox(2.4, 0.62, 0.95, 0.55, 0.8), body, [0.55, 0.58, 0]);
  // trompa (se afina y baja)
  part(L, taperBox(1.6, 0.48, 0.72, 0.2, 0.28, 0.12), body, [2.45, 0.5, 0]);
  // pontones
  for (const z of [-0.78, 0.78]) {
    part(L, taperBox(2.2, 0.28, 0.32, 0.5, 0.55), body, [-0.45, 0.48, z]);
    part(L, box(0.12, 0.42, 0.5), carbon, [0.66, 0.5, z]); // toma de aire
  }
  // cubierta del motor (se afina hacia atrás)
  part(L, taperBox(2.5, 0.28, 0.26, 0.78, 0.72), body, [-1.35, 0.72, 0]);
  // franja de color de acento
  part(L, taperBox(2.4, 0.06, 0.3, 0.06, 0.74, -0.24), acc, [-1.3, 0.89, 0]);
  // toma de aire sobre el piloto + T-cam (negra o amarilla según el piloto)
  part(L, taperBox(0.55, 0.34, 0.3, 0.42, 0.4), carbon, [-0.15, 1.18, 0]);
  part(L, box(0.18, 0.1, 0.42), seat ? '#ffd400' : '#111', [-0.1, 1.44, 0]);
  // cockpit, casco y halo
  part(L, box(0.85, 0.05, 0.55), '#050505', [0.75, 0.9, 0]);
  part(L, new THREE.SphereGeometry(0.24, 12, 8), acc, [0.5, 1.03, 0]);
  part(L, box(0.06, 0.05, 0.36), '#111', [0.68, 1.06, 0]); // visera
  part(L, new THREE.TorusGeometry(0.42, 0.05, 6, 14, Math.PI), carbon, [0.38, 1.17, 0], [Math.PI / 2, 0, -Math.PI / 2]);
  part(L, box(0.07, 0.28, 0.07), carbon, [0.8, 1.02, 0]);
  // espejos
  for (const z of [-0.55, 0.55]) part(L, box(0.12, 0.1, 0.2), body, [1.0, 1.0, z]);
  // alerón delantero
  part(L, box(0.55, 0.06, 2.55), carbon, [3.0, 0.2, 0]);
  part(L, box(0.35, 0.05, 2.4), acc, [2.85, 0.3, 0], [0, 0, 0.25]);
  for (const z of [-1.27, 1.27]) part(L, box(0.75, 0.34, 0.05), body, [2.95, 0.3, z]);
  // alerón trasero
  part(L, box(0.55, 0.08, 1.95), body, [-2.95, 1.2, 0]);
  part(L, box(0.36, 0.06, 1.95), acc, [-2.82, 1.36, 0], [0, 0, 0.35]);
  for (const z of [-0.98, 0.98]) part(L, box(0.95, 0.8, 0.06), carbon, [-2.9, 1.02, z]);
  part(L, box(0.2, 0.6, 0.1), carbon, [-2.7, 0.82, 0]);
  // suspensión
  for (const z of [-0.6, 0.6]) {
    part(L, box(0.06, 0.04, 0.95), carbon, [1.95, 0.55, z]);
    part(L, box(0.06, 0.04, 0.95), carbon, [1.95, 0.35, z]);
    part(L, box(0.06, 0.04, 0.85), carbon, [-1.95, 0.6, z]);
    part(L, box(0.06, 0.04, 0.85), carbon, [-1.95, 0.38, z]);
  }
  // ruedas (cubiertas + llanta + banda del compuesto)
  const compound = COMPOUNDS[(team.name.length + seat) % 3];
  const wheels = [[1.95, 0.42, 1.06, 0.42, 0.42], [-1.95, 0.46, 1.04, 0.46, 0.56]];
  for (const [x, y, zz, r, w] of wheels) {
    for (const sg of [-1, 1]) {
      const z = zz * sg;
      part(L, new THREE.CylinderGeometry(r, r, w, 18), tyre, [x, y, z], [Math.PI / 2, 0, 0]);
      part(L, new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14), rim, [x, y, z], [Math.PI / 2, 0, 0]);
      part(L, new THREE.TorusGeometry(r * 0.8, 0.035, 4, 18), compound, [x, y, z + sg * (w / 2 + 0.005)]);
    }
  }
  const g = merge(L);
  cache.set(key, g);
  return g;
}

let sharedMat = null;
export function carMaterial() {
  if (!sharedMat) sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18 });
  return sharedMat;
}

export function makeCarMesh(team, seat) {
  const m = new THREE.Mesh(carGeometry(team, seat), carMaterial());
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}
