import { PHYS } from './track.js';
import { fmtTime } from './race.js';

// Interfaz HTML que va encima del 3D / de la cámara en AR.

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

export class HUD {
  constructor(track) {
    this.track = track;
    this.rows = new Map();
    this.dots = new Map();
    this.tickers = [];
    this.bannerTimer = null;
    this.toastTimer = null;
    this.rowH = 24;
    this._buildMap($('menu-map'), false);
    this._buildMap($('minimap'), true);
    $('circuit-name').textContent = track.def.name;
    $('circuit-sub').textContent = track.def.subtitle;
    const lapRef = track.vmax.reduce((t, v) => t + track.ds / v, 0);
    $('circuit-stats').innerHTML = `
      <dt>Largo</dt><dt>Curvas</dt><dt>Récord teórico</dt>
      <dd>${(track.length * 0.9 / 1000).toFixed(2)} km</dd><dd>${track.corners.length}</dd><dd>${fmtTime(lapRef)}</dd>`;
  }

  // ------------------------------------------------------------ mapa SVG
  _buildMap(svg, withDots) {
    const t = this.track, b = t.bounds, pad = t.half + 4;
    const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
    svg.setAttribute('viewBox', `${b.minX - pad} ${b.minZ - pad} ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    let d = '';
    for (let i = 0; i <= t.N; i += 4) {
      const j = i % t.N;
      d += (i ? 'L' : 'M') + t.pos[j * 3].toFixed(1) + ' ' + t.pos[j * 3 + 2].toFixed(1);
    }
    d += 'Z';
    const mk = (tag, attrs) => {
      const el = document.createElementNS(SVGNS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      svg.appendChild(el);
      return el;
    };
    mk('path', { d, fill: 'none', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': t.width * 1.15, 'stroke-linejoin': 'round' });
    mk('path', { d, fill: 'none', stroke: withDots ? '#9aa0ab' : '#eceef2', 'stroke-width': t.width * 0.55, 'stroke-linejoin': 'round' });
    // tramo elevado (puente) en celeste
    let bd = '', on = false;
    for (let i = 0; i <= t.N; i += 2) {
      const j = i % t.N, up = t.pos[j * 3 + 1] > 2;
      if (up) { bd += (on ? 'L' : 'M') + t.pos[j * 3].toFixed(1) + ' ' + t.pos[j * 3 + 2].toFixed(1); on = true; } else on = false;
    }
    if (bd) mk('path', { d: bd, fill: 'none', stroke: '#74acdf', 'stroke-width': t.width * 0.55, 'stroke-linecap': 'round' });
    // largada
    const sx = t.pos[0], sz = t.pos[2], rx = t.right[0], rz = t.right[2];
    mk('line', { x1: sx - rx * t.half, y1: sz - rz * t.half, x2: sx + rx * t.half, y2: sz + rz * t.half, stroke: '#e10600', 'stroke-width': 4 });
    if (withDots) this.mapLayer = svg;
  }

  setupMinimapDots(race) {
    for (const el of this.dots.values()) el.remove();
    this.dots.clear();
    for (const c of race.cars) {
      const el = document.createElementNS(SVGNS, 'circle');
      el.setAttribute('r', 5.5);
      el.setAttribute('fill', c.team.color);
      el.setAttribute('stroke', '#fff');
      el.setAttribute('stroke-width', 1.5);
      this.mapLayer.appendChild(el);
      this.dots.set(c.id, el);
    }
  }

  updateMinimap(race, selectedId) {
    const t = this.track;
    // los de atrás primero para que el líder quede arriba
    for (let k = race.order.length - 1; k >= 0; k--) {
      const c = race.order[k];
      const el = this.dots.get(c.id);
      if (!el) continue;
      const f = t.wrap(c.s) / t.ds, i = Math.floor(f) % t.N;
      const x = t.pos[i * 3] + t.right[i * 3] * c.d, z = t.pos[i * 3 + 2] + t.right[i * 3 + 2] * c.d;
      el.setAttribute('cx', x.toFixed(1));
      el.setAttribute('cy', z.toFixed(1));
      el.setAttribute('r', c.id === selectedId ? 8 : k === 0 ? 7 : 5.5);
      el.setAttribute('stroke', c.id === selectedId ? '#ffd400' : '#fff');
      el.style.opacity = c.retired ? 0.35 : 1;
      this.mapLayer.appendChild(el);
    }
  }

  // ------------------------------------------------------------ pantallas
  show(ids) {
    for (const id of ['menu', 'place', 'build', 'predict', 'hud', 'results']) $(id).classList.toggle('hidden', !ids.includes(id));
  }

  // ------------------------------------------------------------ torre de tiempos
  setupTower(race, onSelect) {
    const tower = $('tower');
    tower.innerHTML = '';
    this.rowH = window.innerWidth <= 520 ? 21 : 24;
    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.style.height = race.cars.length * this.rowH + 'px';
    tower.appendChild(inner);
    this.rows.clear();
    for (const c of race.cars) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.style.position = 'absolute';
      row.style.left = '0'; row.style.right = '0';
      row.style.transition = 'transform .45s cubic-bezier(.3,1.2,.4,1)';
      row.innerHTML = `<span class="p"></span><span class="c" style="background:${c.team.color}"></span><span class="n">${c.code}</span><span class="g"></span>`;
      row.addEventListener('click', () => onSelect(c.id));
      inner.appendChild(row);
      this.rows.set(c.id, { el: row, p: row.children[0], g: row.children[3], lastPos: c.pos });
    }
    this.updateTower(race, null, null);
  }

  updateTower(race, selectedId, pickId) {
    const leader = race.order[0];
    race.order.forEach((c, i) => {
      const r = this.rows.get(c.id);
      if (!r) return;
      r.el.style.transform = `translateY(${i * this.rowH}px)`;
      r.p.textContent = i + 1;
      let g;
      if (c.retired) g = 'AB';
      else if (c.finished && i === 0) g = '🏁';
      else if (i === 0) g = race.state === 'grid' || race.state === 'lights' ? 'Pole' : 'Líder';
      else if (race.state === 'grid' || race.state === 'lights') g = '';
      else if (c.lapsDown > 0) g = `+${c.lapsDown}V`;
      else g = '+' + Math.max(0, c.gap - leader.gap).toFixed(1);
      if (c.mistake && !c.retired) g = '⚠ ' + g;
      if (c.finished && i > 0) g = '🏁 ' + g;
      r.g.textContent = g;
      const fl = race.fastestLap && race.fastestLap.car === c;
      r.el.classList.toggle('fl', !!fl && i > 0);
      r.el.classList.toggle('sel', c.id === selectedId);
      r.el.classList.toggle('pick', c.id === pickId);
      r.el.classList.toggle('out', c.retired);
      if (c.pos !== r.lastPos) {
        r.el.classList.toggle('up', c.pos < r.lastPos);
        r.el.classList.toggle('down', c.pos > r.lastPos);
        clearTimeout(r.t);
        r.t = setTimeout(() => r.el.classList.remove('up', 'down'), 1600);
        r.lastPos = c.pos;
      }
    });
  }

  setLap(race) {
    const leader = race.order[0];
    const lap = Math.min(race.laps, Math.max(1, leader.lapsDone + 1));
    $('lap').textContent = race.state === 'finished' || race.state === 'done' ? '🏁' : `${lap}/${race.laps}`;
    $('rtime').textContent = fmtTime(race.state === 'grid' || race.state === 'lights' ? 0 : race.time);
  }

  lights(n) {
    const el = $('lights');
    if (n === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    [...el.children].forEach((d, k) => d.classList.toggle('on', k < n));
  }

  banner(html, ms = 2200) {
    const el = $('banner');
    el.innerHTML = html;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  tick(text, cls = '') {
    const box = $('ticker');
    const el = document.createElement('div');
    el.className = 'tick ' + cls;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 600); }, 4500);
  }

  clearTicker() { $('ticker').innerHTML = ''; }

  toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  updateCarCard(c, race) {
    const el = $('carcard');
    if (!c) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const kmh = Math.round(c.v * PHYS.kmh);
    const leader = race.order[0];
    const gap = c === leader ? 'Líder' : c.lapsDown > 0 ? `+${c.lapsDown} V` : '+' + Math.max(0, c.gap - leader.gap).toFixed(3);
    const status = c.retired ? 'Abandono' : c.finished ? 'Terminó' : c.mistake ? (c.mistake.type === 'spin' ? 'Trompo' : 'Se pasó') : c.boost > 1.05 ? 'DRS' : c.boost > 1.005 ? 'Rebufo' : '';
    el.innerHTML = `
      <h4><span class="num" style="background:${c.team.color};color:${contrast(c.team.color)}">${c.driver.number}</span>${c.driver.name}</h4>
      <div class="team">${c.team.name}</div>
      <div class="speed">${kmh} <small>KM/H</small> <small style="color:var(--yellow)">${status}</small></div>
      <dl>
        <dt>Posición</dt><dd>P${c.pos} <small style="color:var(--muted)">(largó ${c.gridPos}º)</small></dd>
        <dt>Diferencia</dt><dd>${gap}</dd>
        <dt>Última</dt><dd>${fmtTime(c.lastLap)}</dd>
        <dt>Mejor</dt><dd ${race.fastestLap && race.fastestLap.car === c ? 'style="color:var(--purple)"' : ''}>${fmtTime(c.bestLap)}</dd>
      </dl>`;
  }

  // ------------------------------------------------------------ pronóstico
  buildPredict(race, pickId, onPick) {
    const list = $('predict-list');
    list.innerHTML = '';
    for (const c of race.order) {
      const b = document.createElement('button');
      b.className = 'chip' + (c.id === pickId ? ' on' : '');
      b.innerHTML = `<span class="bar-c" style="background:${c.team.color}"></span>${c.gridPos}. ${c.code} <small>${c.driver.name.split(' ').slice(-1)[0]}</small>`;
      b.addEventListener('click', () => {
        [...list.children].forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        onPick(c.id);
      });
      list.appendChild(b);
    }
  }

  setPickBadge(c) {
    const el = $('mypick');
    if (!c) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = `★ Tu pronóstico: ${c.code} (P${c.pos})`;
  }

  // ------------------------------------------------------------ resultados
  showResults(race, pickId, stats) {
    const res = race.results();
    const pod = $('podium');
    const top = [res[1], res[0], res[2]];
    pod.innerHTML = top.map((r, k) => r ? `
      <div class="pod p${[2, 1, 3][k]}">
        <div class="who" style="color:${r.car.team.color === '#23233a' ? '#fff' : r.car.team.color}">${r.car.code}</div>
        <div class="tm">${r.car.driver.name}<br>${r.car.team.name}</div>
        <div class="step">${[2, 1, 3][k]}</div>
      </div>` : '<div></div>').join('');

    const pr = $('pick-result');
    pr.className = '';
    if (pickId !== null && pickId !== undefined) {
      const r = res.find(x => x.car.id === pickId);
      const win = r.pos === 1;
      pr.className = win ? 'win' : 'lose';
      pr.innerHTML = win
        ? `🎉 ¡Acertaste! ${r.car.driver.name} ganó la carrera.`
        : `Tu pronóstico: ${r.car.driver.name} terminó ${r.car.retired && !r.car.finished ? 'abandonando' : 'P' + r.pos}. ¡La próxima será!`;
      pr.innerHTML += `<br><small style="color:var(--muted)">Aciertos: ${stats.hits} de ${stats.picks} pronósticos</small>`;
    } else pr.innerHTML = '';

    const fl = race.fastestLap;
    $('results-table').innerHTML = `
      <thead><tr><th>Pos</th><th>Piloto</th><th class="r">Tiempo</th><th class="r">Mejor vuelta</th><th class="r">Pts</th></tr></thead>
      <tbody>${res.map(r => `
        <tr class="${r.car.id === pickId ? 'pick' : ''}">
          <td>${r.pos}</td>
          <td><span class="num" style="background:${r.car.team.color};color:${contrast(r.car.team.color)}">${r.car.code}</span> ${r.car.driver.name}${r.car.id === pickId ? ' ★' : ''}</td>
          <td class="r">${r.gap}</td>
          <td class="r ${fl && fl.car === r.car ? 'fl' : ''}">${fmtTime(r.best)}</td>
          <td class="r">${r.pts || ''}</td>
        </tr>`).join('')}</tbody>`;
    this.show(['results']);
  }
}

export function contrast(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#111' : '#fff';
}
