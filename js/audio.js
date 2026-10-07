// Sonido sintetizado con WebAudio (no hay archivos de audio):
// pitidos del semáforo, motores de los autos más cercanos a la cámara,
// rumor general de la carrera y la hinchada.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.voices = [];
  }

  // tiene que llamarse desde un gesto del usuario (click / tap)
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // ruido blanco reutilizable
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 3 voces de motor que se asignan a los autos más cercanos
    for (let k = 0; k < 3; k++) {
      const saw = ctx.createOscillator(); saw.type = 'sawtooth';
      const sq = ctx.createOscillator(); sq.type = 'square';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
      const g = ctx.createGain(); g.gain.value = 0;
      const sqg = ctx.createGain(); sqg.gain.value = 0.5;
      saw.connect(lp); sq.connect(sqg).connect(lp); lp.connect(g).connect(this.master);
      saw.start(); sq.start();
      this.voices.push({ saw, sq, lp, g, car: null });
    }
    // rumor de fondo (todos los autos a lo lejos)
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.8;
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 95;
    const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 400;
    const humG = ctx.createGain(); humG.gain.value = 0.25;
    this.bed = ctx.createGain(); this.bed.gain.value = 0;
    src.connect(bp).connect(this.bed);
    hum.connect(humLp).connect(humG).connect(this.bed);
    this.bed.connect(this.master);
    src.start(); hum.start();
    this.hum = hum;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  beep(freq = 660, dur = 0.18, vol = 0.25, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // "pop" corto para cuando aparecen árboles/gente
  pop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(500 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(1400 + Math.random() * 600, t + 0.06);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  // la hinchada: ruido filtrado con envolvente
  cheer(strength = 1, dur = 2.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * strength, t + 0.25);
    g.gain.linearRampToValueAtTime(0.12 * strength, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }

  // cars: [{ car, dist, v, vTop }] ordenados por cercanía; activity 0..1
  updateEngines(near, activity) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(0.05 * activity, t, 0.3);
    this.hum.frequency.setTargetAtTime(80 + activity * 40, t, 0.3);
    this.voices.forEach((vc, k) => {
      const n = near[k];
      if (!n) { vc.g.gain.setTargetAtTime(0, t, 0.1); return; }
      // cambios de marcha: 8 marchas, las rpm suben y caen
      const r = Math.min(1, n.v / n.vTop);
      const gearPos = r * 7.2;
      const rpm = n.v < 0.5 ? 0.18 : 0.42 + 0.58 * (gearPos - Math.floor(gearPos));
      const f = 55 + rpm * 260 + r * 60;
      vc.saw.frequency.setTargetAtTime(f, t, 0.03);
      vc.sq.frequency.setTargetAtTime(f * 0.5, t, 0.03);
      vc.lp.frequency.setTargetAtTime(500 + rpm * 2600, t, 0.05);
      vc.g.gain.setTargetAtTime(0.16 * n.gain * (0.35 + 0.65 * r), t, 0.06);
    });
  }

  silenceEngines() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const vc of this.voices) vc.g.gain.setTargetAtTime(0, t, 0.1);
    this.bed.gain.setTargetAtTime(0, t, 0.2);
  }
}
