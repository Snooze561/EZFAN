'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null ? '-' : Number(v).toFixed(d));
const tempClass = (v) => (v >= 80 ? 'hot' : v >= 60 ? 'warm' : '');

let state = null;      // last /api/state answer (live values)
let config = null;     // local copy of the settings, source of truth once loaded
let selectedCurve = null;
let saveTimer = null;
let tab = 'case';

const profile = () => config.profiles[config.activeProfile];
const curveById = (id) => profile().curves.find((c) => c.id === id);
const fanName = (id) => config.fanNames[id] ?? id;
const temp = (id) => state?.snapshot.temperatures.find((t) => t.id === id);
const sensorLabel = (id) => { const t = temp(id); return t ? `${t.name} (${t.hardware})` : 'Aucune sonde'; };
const direction = (name) => (/entr[ée]e/i.test(name) ? 'in' : /sortie/i.test(name) ? 'out' : '');

// ---------- saving ----------

function changed(rerender = true) {
  $('saveState').textContent = 'Modifications en cours...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
  if (rerender) render();
}

async function save() {
  try {
    const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    $('saveState').textContent = r.ok ? 'Réglages enregistrés' : 'Erreur : ' + (await r.text());
  } catch {
    $('saveState').textContent = 'Erreur : l\'appli ne répond plus';
  }
}

// ---------- header / profiles ----------

function renderProfiles() {
  $('profiles').innerHTML = Object.keys(config.profiles)
    .map((n) => `<button data-profile="${esc(n)}" class="${n === config.activeProfile ? 'on' : ''}">${esc(n)}</button>`)
    .join('');
}

$('profiles').addEventListener('click', (e) => {
  const name = e.target.dataset.profile;
  if (!name || name === config.activeProfile) return;
  config.activeProfile = name;
  if (!curveById(selectedCurve)) selectedCurve = profile().curves[0]?.id;
  changed();
});

$('profileMenu').addEventListener('click', () => { $('newProfileName').value = ''; $('profileDialog').showModal(); });
$('dupProfile').addEventListener('click', (e) => {
  const name = $('newProfileName').value.trim();
  if (!name || config.profiles[name]) { e.preventDefault(); $('newProfileName').focus(); return; }
  config.profiles[name] = structuredClone(profile());
  config.activeProfile = name;
  changed();
});
$('delProfile').addEventListener('click', (e) => {
  if (Object.keys(config.profiles).length < 2) { e.preventDefault(); return; }
  delete config.profiles[config.activeProfile];
  config.activeProfile = Object.keys(config.profiles)[0];
  selectedCurve = profile().curves[0]?.id;
  changed();
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.tab) return;
  tab = e.target.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  for (const t of ['case', 'fans', 'curves', 'sensors']) $('tab-' + t).hidden = t !== tab;
  render();
});

// ---------- fans tab ----------

function isSpare(control, fan) {
  return fan.mode === 'Bios' && !(control.pairedFanRpm > 0) && control.id.startsWith('/lpc/');
}

function renderFans() {
  const main = [], spare = [];
  for (const fan of profile().fans) {
    const control = state.snapshot.controls.find((c) => c.id === fan.controlId);
    if (!control) continue;
    (isSpare(control, fan) ? spare : main).push(fanCard(fan, control));
  }
  syncCards($('fans'), main);
  syncCards($('spare'), spare);
  $('spareBox').hidden = spare.length === 0;
}

// Cards are built once and then only refreshed, so typing in a name or dragging a slider is not interrupted.
function syncCards(root, cards) {
  const ids = cards.map((c) => c.dataset.id);
  [...root.children].forEach((el) => { if (!ids.includes(el.dataset.id)) el.remove(); });
  cards.forEach((c) => { if (c.parentElement !== root) root.appendChild(c); });
}

const cardCache = new Map();

function fanCard(fan, control) {
  let card = cardCache.get(fan.controlId);
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = fan.controlId;
    card.innerHTML = `
      <input class="title" title="Clique pour renommer">
      <div class="hw"></div>
      <div class="row"><span class="big"></span><span class="rpm"></span></div>
      <div class="bar"><div></div></div>
      <div class="seg">
        <button data-mode="Bios">BIOS</button><button data-mode="Fixed">Fixe</button><button data-mode="Curve">Courbe</button>
      </div>
      <div class="fixed"><input type="range" min="0" max="100" step="1"><div class="muted fixedLabel"></div></div>
      <div class="curve"><select></select></div>
      <div class="reason"></div>`;
    const id = fan.controlId;
    const current = () => profile().fans.find((f) => f.controlId === id);
    card.querySelector('.title').addEventListener('input', (e) => { config.fanNames[id] = e.target.value; changed(false); });
    card.querySelector('.seg').addEventListener('click', (e) => {
      const mode = e.target.dataset.mode;
      if (!mode) return;
      const f = current();
      f.mode = mode;
      if (mode === 'Curve' && !curveById(f.curveId)) f.curveId = profile().curves[0]?.id ?? null;
      changed();
    });
    const range = card.querySelector('input[type=range]');
    range.addEventListener('input', () => { current().fixedPercent = Number(range.value); changed(false); refreshFanCard(card, current(), control); });
    card.querySelector('select').addEventListener('change', (e) => { current().curveId = e.target.value; changed(); });
    cardCache.set(id, card);
  }
  refreshFanCard(card, fan, control);
  return card;
}

function refreshFanCard(card, fan, control) {
  const name = fanName(fan.controlId);
  const title = card.querySelector('.title');
  if (document.activeElement !== title) title.value = name;
  card.className = 'card ' + (direction(name) ? 'dir-' + direction(name) : '');
  card.querySelector('.hw').textContent = `${control.name} · ${control.hardware}`;
  const rt = state.fans?.find((f) => f.controlId === fan.controlId);
  const pct = fan.mode === 'Bios' ? control.percent : rt?.applied ?? control.percent;
  card.querySelector('.big').textContent = fmt(pct) + ' %';
  card.querySelector('.bar > div').style.width = (pct ?? 0) + '%';
  card.querySelector('.rpm').textContent = control.pairedFanRpm != null ? fmt(control.pairedFanRpm) + ' RPM' : '';
  card.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === fan.mode));
  card.querySelector('.fixed').hidden = fan.mode !== 'Fixed';
  card.querySelector('.curve').hidden = fan.mode !== 'Curve';
  const range = card.querySelector('input[type=range]');
  if (document.activeElement !== range) range.value = fan.fixedPercent;
  card.querySelector('.fixedLabel').textContent = `Vitesse fixe : ${fmt(fan.fixedPercent)} %`;
  const select = card.querySelector('select');
  const options = profile().curves.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (select.dataset.options !== options) { select.innerHTML = options; select.dataset.options = options; }
  if (document.activeElement !== select) select.value = fan.curveId ?? '';
  const reason = card.querySelector('.reason');
  reason.textContent = fan.mode === 'Bios' ? 'Géré par le BIOS / la carte graphique' : rt?.reason ?? '';
  reason.classList.toggle('alert', /sécurité/i.test(rt?.reason ?? ''));
}

// ---------- curves tab ----------

const CH = { w: 720, h: 340, l: 44, r: 16, t: 16, b: 32, tMin: 20, tMax: 100 };
const xOf = (t) => CH.l + ((t - CH.tMin) / (CH.tMax - CH.tMin)) * (CH.w - CH.l - CH.r);
const yOf = (p) => CH.t + (1 - p / 100) * (CH.h - CH.t - CH.b);
const tOf = (x) => CH.tMin + ((x - CH.l) / (CH.w - CH.l - CH.r)) * (CH.tMax - CH.tMin);
const pOf = (y) => (1 - (y - CH.t) / (CH.h - CH.t - CH.b)) * 100;
let drag = null;

function renderCurveList() {
  const curves = profile().curves;
  if (!curveById(selectedCurve)) selectedCurve = curves[0]?.id;
  $('curveList').innerHTML = curves.map((c) => {
    const rt = state.curves?.find((x) => x.curveId === c.id);
    return `<button class="curve-item ${c.id === selectedCurve ? 'on' : ''}" data-curve="${esc(c.id)}">
      ${esc(c.name)}<small>${rt?.temp != null ? fmt(rt.temp, 1) + ' °C → ' + fmt(rt.output) + ' %' : 'pas de sonde'}</small></button>`;
  }).join('');
}

$('curveList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-curve]');
  if (!b) return;
  selectedCurve = b.dataset.curve;
  editorBuiltFor = null;
  render();
});

$('addCurve').addEventListener('click', () => {
  const id = Math.random().toString(36).slice(2, 10);
  profile().curves.push({
    id, name: 'Nouvelle courbe', sensorId: config.safety.cpuSensorId, hysteresis: 2, rampUp: 8, rampDown: 3,
    points: [{ temp: 30, percent: 30 }, { temp: 60, percent: 60 }, { temp: 80, percent: 100 }],
  });
  selectedCurve = id;
  editorBuiltFor = null;
  changed();
});

let editorBuiltFor = null;

function renderEditor() {
  const c = curveById(selectedCurve);
  const ed = $('editor');
  if (!c) { ed.innerHTML = '<div class="card muted">Aucune courbe dans ce profil.</div>'; editorBuiltFor = null; return; }
  if (editorBuiltFor !== c.id + config.activeProfile) {
    editorBuiltFor = c.id + config.activeProfile;
    const sensors = state.snapshot.temperatures
      .map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.hardware)}</option>`).join('');
    ed.innerHTML = `
      <div class="card">
        <div class="fields">
          <label>Nom<input data-k="name"></label>
          <label>Sonde de température<select data-k="sensorId">${sensors}</select></label>
          <label>Hystérésis (°C)<input type="number" min="0" max="15" step="0.5" data-k="hysteresis"></label>
          <label>Accélération max (%/s)<input type="number" min="1" max="100" step="1" data-k="rampUp"></label>
          <label>Ralentissement max (%/s)<input type="number" min="1" max="100" step="1" data-k="rampDown"></label>
        </div>
        <svg class="chart" viewBox="0 0 ${CH.w} ${CH.h}" id="chart"></svg>
        <p class="hint">Glisse les points pour régler la courbe. Double-clic pour ajouter un point, clic droit pour en retirer un.</p>
        <div class="users" id="curveUsers"></div>
        <div class="row gap"><button class="danger" id="delCurve">Supprimer cette courbe</button></div>
      </div>`;
    ed.querySelectorAll('[data-k]').forEach((el) => {
      el.value = c[el.dataset.k] ?? '';
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const k = el.dataset.k;
        c[k] = el.type === 'number' ? Number(el.value) : el.value;
        changed(false);
        renderCurveList();
        drawChart();
      });
    });
    $('delCurve').addEventListener('click', () => {
      const p = profile();
      p.curves = p.curves.filter((x) => x.id !== c.id);
      // Fans that used it fall back to BIOS rather than to an unknown curve.
      p.fans.forEach((f) => { if (f.curveId === c.id) { f.curveId = null; f.mode = 'Bios'; } });
      selectedCurve = p.curves[0]?.id;
      editorBuiltFor = null;
      changed();
    });
    bindChart(c);
  }
  const users = profile().fans.filter((f) => f.mode === 'Curve' && f.curveId === c.id).map((f) => fanName(f.controlId));
  $('curveUsers').textContent = users.length ? 'Utilisée par : ' + users.join(', ') : 'Aucun ventilo n\'utilise cette courbe.';
  drawChart();
}

function evaluate(points, t) {
  if (!points.length) return null;
  if (t <= points[0].temp) return points[0].percent;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].temp) {
      const a = points[i - 1], b = points[i];
      return a.percent + ((t - a.temp) / Math.max(b.temp - a.temp, 0.001)) * (b.percent - a.percent);
    }
  }
  return points[points.length - 1].percent;
}

function drawChart() {
  const c = curveById(selectedCurve);
  const svg = $('chart');
  if (!c || !svg) return;
  const pts = c.points;
  let g = '';
  for (let t = CH.tMin; t <= CH.tMax; t += 10)
    g += `<line class="gridline" x1="${xOf(t)}" x2="${xOf(t)}" y1="${CH.t}" y2="${CH.h - CH.b}"/><text class="axis" x="${xOf(t)}" y="${CH.h - 10}" text-anchor="middle">${t}°</text>`;
  for (let p = 0; p <= 100; p += 20)
    g += `<line class="gridline" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${yOf(p)}" y2="${yOf(p)}"/><text class="axis" x="${CH.l - 8}" y="${yOf(p) + 4}" text-anchor="end">${p}%</text>`;
  if (pts.length) {
    const line = [[CH.tMin, pts[0].percent], ...pts.map((p) => [p.temp, p.percent]), [CH.tMax, pts[pts.length - 1].percent]];
    const d = line.map(([t, p], i) => `${i ? 'L' : 'M'}${xOf(t)},${yOf(p)}`).join(' ');
    g += `<path class="area" d="${d} L${xOf(CH.tMax)},${yOf(0)} L${xOf(CH.tMin)},${yOf(0)} Z"/><path class="line" d="${d}"/>`;
  }
  const live = state.curves?.find((x) => x.curveId === c.id);
  const liveTemp = temp(c.sensorId)?.value;
  if (liveTemp != null) {
    const out = evaluate(pts, liveTemp);
    const x = xOf(Math.min(Math.max(liveTemp, CH.tMin), CH.tMax));
    g += `<line class="liveline" x1="${x}" x2="${x}" y1="${CH.t}" y2="${CH.h - CH.b}"/>
          <circle class="live" cx="${x}" cy="${yOf(out)}" r="6"/>
          <text class="tip" x="${x + 10}" y="${Math.max(yOf(out) - 10, CH.t + 12)}">${fmt(liveTemp, 1)} °C → ${fmt(live?.output ?? out)} %</text>`;
  }
  pts.forEach((p, i) => {
    g += `<circle class="pt ${drag?.i === i ? 'drag' : ''}" data-i="${i}" cx="${xOf(p.temp)}" cy="${yOf(p.percent)}" r="8"/>`;
    if (drag?.i === i) g += `<text class="tip" x="${xOf(p.temp) + 12}" y="${yOf(p.percent) - 12}">${fmt(p.temp)} °C · ${fmt(p.percent)} %</text>`;
  });
  svg.innerHTML = g;
}

function svgPoint(svg, e) {
  const r = svg.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * CH.w, y: ((e.clientY - r.top) / r.height) * CH.h };
}

function bindChart(c) {
  const svg = $('chart');
  svg.addEventListener('pointerdown', (e) => {
    const i = e.target.dataset?.i;
    if (i == null || e.button !== 0) return;
    drag = { i: Number(i) };
    svg.setPointerCapture(e.pointerId);
    drawChart();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { x, y } = svgPoint(svg, e);
    const pts = curveById(selectedCurve).points;
    // Each point stays between its neighbours so the curve never folds back on itself.
    const lo = drag.i > 0 ? pts[drag.i - 1].temp + 1 : CH.tMin;
    const hi = drag.i < pts.length - 1 ? pts[drag.i + 1].temp - 1 : CH.tMax;
    pts[drag.i].temp = Math.round(Math.min(Math.max(tOf(x), lo), hi));
    pts[drag.i].percent = Math.round(Math.min(Math.max(pOf(y), 0), 100));
    drawChart();
  });
  const end = () => { if (drag) { drag = null; changed(false); drawChart(); } };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', (e) => {
    const { x, y } = svgPoint(svg, e);
    const pts = curveById(selectedCurve).points;
    const t = Math.round(Math.min(Math.max(tOf(x), CH.tMin), CH.tMax));
    if (pts.some((p) => Math.abs(p.temp - t) < 1)) return;
    pts.push({ temp: t, percent: Math.round(Math.min(Math.max(pOf(y), 0), 100)) });
    pts.sort((a, b) => a.temp - b.temp);
    changed(false);
    drawChart();
  });
  svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const i = e.target.dataset?.i;
    const pts = curveById(selectedCurve).points;
    if (i == null || pts.length <= 2) return;
    pts.splice(Number(i), 1);
    changed(false);
    drawChart();
  });
}

// ---------- sensors tab ----------

let safetyBuilt = false;

function renderSensors() {
  if (!safetyBuilt) {
    safetyBuilt = true;
    const opts = state.snapshot.temperatures.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.hardware)}</option>`).join('');
    $('safetyForm').innerHTML = `
      <label>Sonde du processeur<select data-k="cpuSensorId">${opts}</select></label>
      <label>Seuil critique CPU (°C)<input type="number" min="60" max="110" data-k="criticalCpu"></label>
      <label>Sonde de la carte graphique<select data-k="gpuSensorId">${opts}</select></label>
      <label>Seuil critique GPU (°C)<input type="number" min="60" max="110" data-k="criticalGpu"></label>
      <p class="muted" style="grid-column:1/-1;margin:0">Au-dessus d'un seuil, tous les ventilos pilotés passent à 100 %.
        Un Ryzen 7600X peut monter à 95 °C en pleine charge, c'est normal pour lui.</p>`;
    $('safetyForm').querySelectorAll('[data-k]').forEach((el) => {
      el.value = config.safety[el.dataset.k] ?? '';
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        config.safety[el.dataset.k] = el.type === 'number' ? Number(el.value) : el.value;
        changed(false);
      });
    });
  }
  const list = (items, unit) => items.map((s) => `
    <div class="item"><div class="label">${esc(s.name)}<small>${esc(s.hardware)}</small></div>
    <div class="v ${unit === '°C' ? tempClass(s.value) : ''}">${fmt(s.value, unit === '°C' ? 1 : 0)} ${unit}</div></div>`).join('');
  $('temps').innerHTML = list(state.snapshot.temperatures, '°C');
  $('rpms').innerHTML = list(state.snapshot.fans, 'RPM');
}

// ---------- autostart ----------

async function loadAutostart() {
  try {
    const r = await (await fetch('/api/autostart')).json();
    $('autostart').checked = r.enabled;
  } catch { /* the setting just stays unchecked */ }
}

$('autostart').addEventListener('change', async (e) => {
  const r = await fetch('/api/autostart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: e.target.checked }) });
  $('autostartText').textContent = r.ok
    ? (e.target.checked ? 'Activé : l\'appli démarrera toute seule à ta prochaine connexion.' : 'Désactivé.')
    : 'Windows a refusé la modification. Relance l\'appli en administrateur.';
  loadAutostart();
});

loadAutostart();

// ---------- loop ----------

function render() {
  if (!state || !config) return;
  renderProfiles();
  $('safety').hidden = !state.safetyActive;
  const warnings = (state.warnings ?? []).map((w) => `<div class="safety warn">${esc(w)}</div>`).join('');
  if ($('warnings').innerHTML !== warnings) $('warnings').innerHTML = warnings;
  if (tab === 'case') CASE.render($('caseRoot'));
  if (tab === 'fans') renderFans();
  if (tab === 'curves') { renderCurveList(); renderEditor(); }
  if (tab === 'sensors') renderSensors();
}

let wizardShown = false;

// After the wizard the server rebuilt the settings: take them back and redraw everything.
function reloadConfig() {
  config = null;
  editorBuiltFor = null;
  safetyBuilt = false;
  CASE.reset();
  tick();
}

async function tick() {
  try {
    state = await (await fetch('/api/state')).json();
    if (!config) { config = state.config; $('saveState').textContent = 'Réglages enregistrés'; }
    if (!config.setupDone && !wizardShown) { wizardShown = true; WIZARD.open(); }
    WIZARD.tick();
    if (!drag) render();
  } catch {
    $('saveState').textContent = 'L\'appli ne répond plus. Est-elle toujours ouverte ?';
  }
}

tick();
setInterval(tick, 1000);
