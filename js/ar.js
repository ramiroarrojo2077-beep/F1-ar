import * as THREE from 'three';

// Manejo de la sesión WebXR "immersive-ar": hit-test para encontrar el piso o
// una mesa, retícula de colocación y toques de pantalla (select).

export async function arSupport() {
  if (!window.isSecureContext) return { ok: false, why: 'La realidad aumentada necesita HTTPS.' };
  if (!navigator.xr) return { ok: false, why: 'Este navegador no soporta WebXR. Probá Chrome en Android, o jugá en 3D.' };
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    return ok ? { ok: true } : { ok: false, why: 'Este dispositivo no soporta AR con WebXR (en iPhone usá el modo 3D).' };
  } catch {
    return { ok: false, why: 'No se pudo consultar el soporte de AR.' };
  }
}

export class ARSession {
  constructor(renderer, overlayRoot) {
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.session = null;
    this.hitSource = null;
    this.hitMatrix = new THREE.Matrix4();
    this.hasHit = false;
    this.onSelect = null; // (event) => void
    this.onEnd = null;

    // retícula: aro + punto
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.075, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe10600, depthTest: false }),
    );
    ring.renderOrder = dot.renderOrder = 999;
    g.add(ring, dot);
    g.matrixAutoUpdate = false;
    g.visible = false;
    this.reticle = g;
  }

  async start() {
    const init = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: this.overlayRoot },
    };
    const session = await navigator.xr.requestSession('immersive-ar', init);
    this.session = session;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener('select', (e) => this.onSelect && this.onSelect(e));
    session.addEventListener('end', () => {
      this.hitSource = null;
      this.session = null;
      this.reticle.visible = false;
      this.hasHit = false;
      this.onEnd && this.onEnd();
    });
    return session;
  }

  end() { if (this.session) this.session.end(); }

  // llamar en cada frame XR
  update(frame) {
    if (!frame || !this.hitSource) return;
    const ref = this.renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(this.hitSource);
    if (hits.length) {
      const pose = hits[0].getPose(ref);
      if (pose) {
        this.hitMatrix.fromArray(pose.transform.matrix);
        this.reticle.matrix.copy(this.hitMatrix);
        this.hasHit = true;
        return;
      }
    }
    this.hasHit = false;
  }

  // rayo de un toque (para elegir autos tocándolos)
  rayFromSelect(e, out) {
    try {
      const ref = this.renderer.xr.getReferenceSpace();
      const pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
      if (!pose) return null;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      out.origin.setFromMatrixPosition(m);
      out.direction.set(0, 0, -1).transformDirection(m);
      return out;
    } catch {
      return null;
    }
  }
}
