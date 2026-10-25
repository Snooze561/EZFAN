'use strict';
// Side view of the user's case (front on the left) with a simulated airflow.
// Uses the globals of app.js (state, config, changed, fanName, esc, fmt, temp, profile) and of casegeo.js.

const slotName = (id) => { const [zone, n] = id.split('-'); return `${ZONE_NAMES[zone] ?? zone} ${n}`; };

const CASE = (() => {
  let g = null;          // geometry of the current layout
  let geoKey = '';
  let selected = null;
  let panelFor;          // which slot the side panel currently shows
  let built = false;
  let canvas, ctx;
  let particles = [];
  let lastFrame = 0;
  const spin = {};

  // ---------- live data ----------

  function slotInfo(id) {
    const slot = config.slots[id];
    if (!slot || slot.content !== 'Fan' || !g.slots[id]) return null;
    const control = state.snapshot.controls.find((c) => c.id === slot.controlId);
    const fan = profile().fans.find((f) => f.controlId === slot.controlId);
    const rt = state.fans?.find((f) => f.controlId === slot.controlId);
    const pct = fan?.mode === 'Bios' && !state.identifying ? control?.percent : rt?.applied ?? control?.percent;
    const rpm = control?.pairedFanRpm;
    // When the header reports RPM we trust it, otherwise we fall back on the duty cycle.
    const strength = rpm != null && rpm > 0 ? Math.min(rpm / 1800, 1.2) : Math.max((pct ?? 0) / 100, 0);
    return { slot, control, fan, rt, pct, rpm, strength };
  }

  const onRadiator = (id) => g.aio && id.startsWith(g.aio.zone + '-');

  function airflow() {
    let intake = 0, exhaust = 0;
    for (const id of Object.keys(g.slots)) {
      const info = slotInfo(id);
      if (!info) continue;
      let flow = info.strength * (g.slots[id].size === 140 ? 1.35 : 1);
      if (onRadiator(id)) flow *= 0.75; // a radiator chokes the fan a little
      if (info.slot.direction === 'In') intake += flow; else exhaust += flow;
    }
    return { intake, exhaust };
  }

  // ---------- drawing ----------

  function build(root) {
    root.innerHTML = `
      <div class="case-layout">
        <div class="case-stage">
          <svg class="case-svg" viewBox="0 0 ${GEO.W} ${GEO.H}" id="caseSvg">${GEO.defs()}<g id="chassis"></g><g id="slots"></g><g id="glassLayer"></g></svg>
          <canvas class="case-canvas" id="caseCanvas" width="${GEO.W}" height="${GEO.H}"></canvas>
        </div>
        <aside class="case-side">
          <div class="card">
            <h2>Pression dans le boîtier</h2>
            <div class="pressure"><div class="pressure-bar"><div id="pressureMark"></div></div>
              <div class="row muted"><span>Négative</span><span>Équilibrée</span><span>Positive</span></div></div>
            <div id="pressureText" class="pressure-text"></div>
          </div>
          <div class="card" id="slotPanel"></div>
          <div class="card legend">
            <div><span class="dot in"></span>Air frais (entrée)</div>
            <div><span class="dot out"></span>Air chaud (sortie)</div>
            <div class="muted">La vitesse des particules suit la vitesse réelle des ventilos. Clique sur un emplacement pour dire ce qu'il y a dedans.</div>
          </div>
        </aside>
      </div>`;
    canvas = document.getElementById('caseCanvas');
    ctx = canvas.getContext('2d');
    document.getElementById('slots').addEventListener('click', (e) => {
      const el = e.target.closest('[data-slot]');
      if (!el) return;
      selected = el.dataset.slot;
      renderSlots(true);
      renderPanel();
    });
    built = true;
    requestAnimationFrame(frame);
  }

  function ensureGeometry() {
    const key = JSON.stringify([config.layout, config.cooler]);
    if (key === geoKey && g) return;
    geoKey = key;
    g = GEO.build(config.layout, config.cooler);
    particles = [];
    const def = g.def;
    document.getElementById('chassis').innerHTML = GEO.chassis(g, {
      cpu: hardwareName('Cpu'), gpu: hardwareName('Gpu'), temps: true,
      name: def.id === 'generic' ? '' : `${def.brand} ${def.model}`,
    });
    document.getElementById('glassLayer').innerHTML = GEO.glass(g);
    renderSlots(true);
  }

  function hardwareName(type) {
    const t = state.snapshot.temperatures.find((x) => x.hardwareType.startsWith(type) && !(type === 'Gpu' && /\(TM\) Graphics/.test(x.hardware)));
    return (t?.hardware ?? '').replace(/^(AMD|Intel\(R\)|NVIDIA)\s+/i, '').replace(/GeForce\s+/i, '');
  }

  let slotsKey = '';

  function renderSlots(force) {
    // Only rebuilt when the layout changes: rebuilding every second would swallow clicks.
    const key = JSON.stringify([selected, geoKey, Object.keys(g.slots).map((id) => {
      const s = config.slots[id];
      return s?.content === 'Fan' ? [s.controlId, s.direction] : null;
    })]);
    if (key === slotsKey && !force) return;
    slotsKey = key;
    document.getElementById('slots').innerHTML = GEO.slotsSvg(g, (id) => {
      const s = config.slots[id];
      return s?.content === 'Fan' ? { filled: true, direction: s.direction } : { filled: false };
    }, selected);
  }

  // ---------- side panel ----------

  function renderPanel() {
    panelFor = selected;
    const panel = document.getElementById('slotPanel');
    if (!selected) {
      const def = g.def;
      panel.innerHTML = `<h2>${esc(def.id === 'generic' ? 'Ton boîtier' : def.brand + ' ' + def.model)}</h2>
        <p class="muted">Refroidissement CPU : ${config.cooler.type === 'Aio' ? `AIO ${config.cooler.size} mm (${esc(ZONE_NAMES[config.cooler.zone]?.toLowerCase() ?? '')})` : 'ventirad'}.
        Clique sur un ventilo ou sur un « + » pour modifier un emplacement.</p>
        <button id="rerunWizard">Refaire l'assistant de configuration</button>`;
      document.getElementById('rerunWizard').addEventListener('click', () => WIZARD.open());
      return;
    }
    const slot = config.slots[selected] ?? (config.slots[selected] = { content: 'Empty', controlId: null, direction: 'In', size: 120, label: '' });
    const controls = state.snapshot.controls.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === slot.controlId ? 'selected' : ''}>${esc(fanName(c.id))}</option>`).join('');
    panel.innerHTML = `
      <div class="row"><h2>${esc(slotName(selected))}</h2><button id="slotClose" title="Fermer">✕</button></div>
      <div class="seg"><button data-content="Empty" class="${slot.content === 'Empty' ? 'on' : ''}">Vide</button>
        <button data-content="Fan" class="${slot.content === 'Fan' ? 'on' : ''}">Ventilo</button></div>
      <div id="slotFan" ${slot.content === 'Fan' ? '' : 'hidden'}>
        <label>Branché sur<select id="slotControl"><option value="">(aucune prise)</option>${controls}</select></label>
        <div class="seg"><button data-dir="In" class="${slot.direction === 'In' ? 'on' : ''}">Entrée d'air</button>
          <button data-dir="Out" class="${slot.direction === 'Out' ? 'on' : ''}">Sortie d'air</button></div>
        <label>Description<input id="slotLabel" value="${esc(slot.label)}" placeholder="Corsair 120, Arctic P12..."></label>
        <div class="slot-live" id="slotLive"></div>
      </div>`;
    document.getElementById('slotClose').addEventListener('click', () => { selected = null; renderSlots(true); renderPanel(); });
    panel.querySelectorAll('[data-content]').forEach((b) => b.addEventListener('click', () => { slot.content = b.dataset.content; changed(); renderPanel(); }));
    panel.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { slot.direction = b.dataset.dir; changed(); renderPanel(); }));
    document.getElementById('slotControl').addEventListener('change', (e) => { slot.controlId = e.target.value || null; changed(); renderPanel(); });
    document.getElementById('slotLabel').addEventListener('input', (e) => { slot.label = e.target.value; changed(false); });
    renderLive();
  }

  function renderLive() {
    const live = document.getElementById('slotLive');
    if (!live || !selected) return;
    const info = slotInfo(selected);
    if (!info?.control) { live.innerHTML = '<p class="muted">Choisis la prise de la carte mère où ce ventilo est branché.</p>'; return; }
    const mode = info.fan?.mode === 'Bios' ? 'BIOS' : info.fan?.mode === 'Fixed' ? 'Vitesse fixe' : info.rt?.reason ?? '';
    const shared = Object.entries(config.slots).filter(([id, s]) => g.slots[id] && s.content === 'Fan' && s.controlId === info.slot.controlId).length;
    live.innerHTML = `
      <div class="row"><span class="big">${fmt(info.pct)} %</span><span class="rpm">${info.rpm != null ? fmt(info.rpm) + ' RPM' : ''}</span></div>
      <div class="muted">${esc(mode)}</div>
      ${shared > 1 ? `<div class="muted">Cette prise pilote ${shared} emplacements (ventilos en Y ou en série).</div>` : ''}`;
  }

  function renderPressure() {
    const { intake, exhaust } = airflow();
    const total = intake + exhaust;
    const balance = total > 0 ? (intake - exhaust) / total : 0; // -1 .. 1
    document.getElementById('pressureMark').style.left = `${50 + balance * 50}%`;
    const word = Math.abs(balance) < 0.06 ? 'équilibrée' : balance > 0 ? (balance > 0.2 ? 'positive' : 'légèrement positive') : (balance < -0.2 ? 'négative' : 'légèrement négative');
    const advice = balance < -0.06
      ? 'Plus d\'air sort qu\'il n\'en rentre : la poussière entre par les fentes non filtrées. Fais tourner les entrées un peu plus vite.'
      : balance > 0.2 ? 'Beaucoup d\'air entre : bon contre la poussière, vérifie juste que l\'air chaud sort bien.'
      : balance > 0.06 ? 'Un peu plus d\'air entre qu\'il n\'en sort : c\'est l\'idéal, la poussière reste devant les filtres.'
      : 'Bon équilibre. L\'idéal est d\'avoir un tout petit peu plus d\'air qui entre que d\'air qui sort.';
    document.getElementById('pressureText').innerHTML = total > 0
      ? `<strong>Pression ${word}</strong><br><span class="muted">Débit estimé : entrée ${fmt(intake * 100)} · sortie ${fmt(exhaust * 100)}. ${advice}</span>`
      : '<span class="muted">Aucun ventilo placé pour l\'instant.</span>';
  }

  function renderTemps() {
    const t = (id, el) => { const v = temp(id)?.value; const n = document.getElementById(el); if (n) n.textContent = v != null ? fmt(v, 0) + ' °C' : ''; };
    t(config.safety.cpuSensorId, 'cpuTemp');
    t(config.safety.gpuSensorId, 'gpuTemp');
    const v1 = temp(config.intakeSensorId)?.value, v2 = temp(config.exhaustSensorId)?.value;
    const a = document.getElementById('caseTempIn'), b = document.getElementById('caseTempOut');
    if (a) a.textContent = v1 != null ? `Entrées ${fmt(v1, 0)} °C` : '';
    if (b) b.textContent = v2 != null ? `Sorties ${fmt(v2, 0)} °C` : '';
  }

  // ---------- particles ----------

  function emitters() {
    const list = [];
    for (const [id, s] of Object.entries(g.slots)) {
      const info = slotInfo(id);
      if (!info || info.strength <= 0.01) continue;
      const out = info.slot.direction === 'Out';
      let dir = s.kind === 'face' ? [0, 0] : [...s.inward];
      if (out) dir = [-dir[0], -dir[1]];
      list.push({ id, s, out, dir, strength: info.strength, pos: GEO.center(s), rad: onRadiator(id) });
    }
    return list;
  }

  const inside = (p, r) => r && p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

  function step(dt) {
    const { IN, GPU, SHROUD, CPU, t: THICK, s: scale } = g;
    const em = emitters();
    const sources = em.filter((e) => !e.out), sinks = em.filter((e) => e.out);
    const k = (scale / 1.76) ** 2; // forces were tuned on the 4000D drawing

    // Spawn new air at every intake, more for faster fans.
    for (const e of sources) {
      const n = e.strength * 130 * dt;
      const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let i = 0; i < count && particles.length < 1400; i++) {
        let x, y, vx, vy;
        if (e.s.kind === 'face') {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * e.s.r * 0.85;
          x = e.s.cx + Math.cos(a) * r; y = e.s.cy + Math.sin(a) * r;
          vx = Math.cos(a) * 160 * e.strength; vy = Math.sin(a) * 160 * e.strength;
        } else {
          const along = Math.random();
          x = e.dir[0] !== 0 ? e.pos[0] + e.dir[0] * THICK / 2 : e.s.x + along * e.s.w;
          y = e.dir[1] !== 0 ? e.pos[1] + e.dir[1] * THICK / 2 : e.s.y + along * e.s.h;
          vx = e.dir[0] * 220 * e.strength; vy = e.dir[1] * 220 * e.strength;
        }
        // Air pulled in through a radiator is already warm.
        particles.push({ x, y, vx, vy, heat: e.rad ? 0.55 : 0, age: 0, exiting: null });
      }
    }

    const cpuT = temp(config.safety.cpuSensorId)?.value ?? 40, gpuT = temp(config.safety.gpuSensorId)?.value ?? 40;
    for (const p of particles) {
      p.age += dt;
      if (p.exiting) { p.x += p.vx * dt; p.y += p.vy * dt; p.exiting.t -= dt; continue; }
      // Field: pulled towards each exhaust, pushed away from each intake.
      let fx = 0, fy = 0;
      for (const e of sinks) {
        const dx = e.pos[0] - p.x, dy = e.pos[1] - p.y, d2 = dx * dx + dy * dy + 2000;
        const f = 5e6 * k * e.strength / d2;
        fx += (dx / Math.sqrt(d2)) * f; fy += (dy / Math.sqrt(d2)) * f;
      }
      for (const e of sources) {
        const dx = p.x - e.pos[0], dy = p.y - e.pos[1], d2 = dx * dx + dy * dy + 2000;
        const f = 4.5e6 * k * e.strength / d2;
        fx += (dx / Math.sqrt(d2)) * f; fy += (dy / Math.sqrt(d2)) * f;
      }
      const f = Math.hypot(fx, fy), cap = 420;
      if (f > cap) { fx *= cap / f; fy *= cap / f; }
      p.vx += (fx - p.vx) * Math.min(dt * 0.9, 1) + (Math.random() - 0.5) * 30;
      p.vy += (fy - p.vy) * Math.min(dt * 0.9, 1) + (Math.random() - 0.5) * 30;
      p.x += p.vx * dt; p.y += p.vy * dt;

      // Hot parts warm the air passing next to them.
      if (Math.hypot(p.x - CPU.x, p.y - CPU.y) < CPU.r * 3.5 && !g.aio) p.heat += dt * 0.6 * Math.max(cpuT - 25, 5) / 40;
      if (p.x > GPU.x0 - 20 && p.x < GPU.x1 + 20 && p.y > GPU.y0 - 50 && p.y < GPU.y1 + 50) p.heat += dt * 0.8 * Math.max(gpuT - 25, 5) / 40;
      p.heat = Math.min(p.heat + dt * 0.03, 1);

      // Solid parts: the air goes around the GPU and over the PSU shroud.
      if (inside(p, GPU)) { p.y = p.y < (GPU.y0 + GPU.y1) / 2 ? GPU.y0 : GPU.y1; p.vy = -p.vy * 0.3; }
      if (inside(p, SHROUD)) { p.y = SHROUD.y0; p.vy = -Math.abs(p.vy) * 0.3; }
      p.x = Math.min(Math.max(p.x, IN.x0 + 4), IN.x1 - 4);
      p.y = Math.min(Math.max(p.y, IN.y0 + 4), IN.y1 - 4);

      // Fresh air first spreads into the case before an exhaust can take it.
      for (const e of p.age < 0.6 ? [] : sinks) {
        const s = e.s;
        const hit = s.kind === 'face'
          ? Math.hypot(p.x - s.cx, p.y - s.cy) < s.r * 0.8
          : p.x > s.x - 14 && p.x < s.x + s.w + 14 && p.y > s.y - 14 && p.y < s.y + s.h + 14;
        if (hit) {
          const speed = 260 * e.strength + 60;
          p.vx = e.dir[0] * speed; p.vy = e.dir[1] * speed;
          // Air leaving through the radiator picks up the CPU heat.
          if (e.rad) p.heat = Math.max(p.heat, 0.85);
          p.exiting = { t: s.kind === 'face' ? 0.25 : 0.5, face: s.kind === 'face' };
          break;
        }
      }
    }
    particles = particles.filter((p) => p.age < 14 && (!p.exiting || p.exiting.t > 0));
  }

  function color(heat, alpha) {
    const c0 = [90, 169, 255], c1 = [235, 235, 235], c2 = [255, 138, 91];
    const [a, b, t] = heat < 0.5 ? [c0, c1, heat * 2] : [c1, c2, (heat - 0.5) * 2];
    const m = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
    return `rgba(${m(0)},${m(1)},${m(2)},${alpha})`;
  }

  function draw() {
    ctx.clearRect(0, 0, GEO.W, GEO.H);
    ctx.lineWidth = 2.6;
    for (const p of particles) {
      const alpha = p.exiting?.face ? p.exiting.t * 3 : Math.min(p.age * 3, 0.85);
      ctx.strokeStyle = color(p.heat, alpha);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    }
  }

  function animateFans(dt) {
    for (const [id, s] of Object.entries(g.slots)) {
      const info = slotInfo(id);
      if (!info) continue;
      // Drawn far slower than reality, a 1000 RPM fan would just be a blur.
      const speed = (info.rpm ?? (info.pct ?? 0) * 15) / 1000;
      spin[id] = ((spin[id] ?? 0) + dt * speed * 360) % 360;
      if (s.kind === 'face') {
        document.getElementById('blades-' + id)?.setAttribute('transform', `rotate(${spin[id]} ${s.cx} ${s.cy})`);
      } else {
        const off = ((spin[id] / 360) * GEO.STRIPE * 6) % GEO.STRIPE;
        document.getElementById('stripes-' + id)?.setAttribute('transform', s.w > s.h ? `translate(${off} 0)` : `translate(0 ${off})`);
      }
    }
  }

  function frame(t) {
    const dt = Math.min((t - (lastFrame || t)) / 1000, 0.05);
    lastFrame = t;
    if (g && state && config && !document.getElementById('tab-case').hidden && !document.getElementById('wizard')?.open) {
      step(dt);
      draw();
      animateFans(dt);
    }
    requestAnimationFrame(frame);
  }

  return {
    render(root) {
      if (!config.layout) return;
      if (!built) build(root);
      ensureGeometry();
      if (selected && !g.slots[selected]) selected = null;
      renderSlots();
      renderTemps();
      renderPressure();
      if (panelFor !== selected) renderPanel();
      else renderLive();
    },
    reset() { geoKey = ''; panelFor = undefined; },
  };
})();
