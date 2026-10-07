import * as THREE from 'three';

// Utilidades para armar modelos con primitivas y fusionarlos en una sola
// geometría con colores por vértice.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export function part(list, geom, color, pos, rot = [0, 0, 0], scl = [1, 1, 1]) {
  let g = geom.index ? geom.toNonIndexed() : geom.clone();
  g.deleteAttribute('uv');
  tmpQ.setFromEuler(tmpE.set(rot[0], rot[1], rot[2]));
  tmpM.compose(tmpP.set(pos[0], pos[1], pos[2]), tmpQ, tmpS.set(scl[0], scl[1], scl[2]));
  g.applyMatrix4(tmpM);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  list.push(g);
}

// caja que se afina hacia +X (o -X): sección (h0,w0) atrás -> (h1,w1) adelante
export function taperBox(len, h0, w0, h1, w1, dropFront = 0) {
  const g = new THREE.BoxGeometry(len, 1, 1).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const front = p.getX(i) > 0;
    const h = front ? h1 : h0, w = front ? w1 : w0;
    p.setY(i, p.getY(i) * h - (front ? dropFront : 0));
    p.setZ(i, p.getZ(i) * w);
  }
  g.computeVertexNormals();
  return g;
}

export function merge(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

