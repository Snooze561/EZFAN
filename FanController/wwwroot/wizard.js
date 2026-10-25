'use strict';
// First-launch setup: case, slots, CPU cooling, fan placement, headers, sensors, profile.
// Works on a draft copy of the settings and sends it to /api/setup at the end.

const WIZARD = (() => {
  const STEPS = ['Bienvenue', 'Boîtier', 'Emplacements', 'Refroidissement', 'Ventilos', 'Prises', 'Sondes', 'Profil'];
  const PROFILES = [
    { name: 'Bureautique', icon: '🖥', text: 'Internet, travail, vidéos. Le plus silencieux possible, les ventilos accélèrent seulement si ça chauffe vraiment.' },
    { name: 'Jeux légers', icon: '🎮', text: 'Jeux peu gourmands (e-sport, indé). Un peu plus de souffle, toujours discret.' },
    { name: 'Jeux AAA', icon: '🔥', text: 'Gros jeux. Les ventilos du boîtier suivent la carte graphique, qui chauffe le plus.' },
    { name: 'Performance', icon: '⚡', text: 'Refroidissement maximal pour les longues sessions et le rendu. Plus bruyant.' },
  ];

  let draft = null;
  let stepIndex = 0;
  let caseFilter = '';
  let activeHeader = null;
  let profileChoice = 'Bureautique';
  let dialog;

  const zone = (z) => draft.layout.zones[z] ?? (draft.layout.zones[z] = { count: 0, size: 120 });
  const geo = () => GEO.build(draft.layout, draft.cooler);
  const isGpu = (c) => c.id.startsWith('/gpu');
  const plausible = (t) => t.value != null && t.value >= 15 && t.value <= 100;

  function open() {
    draft = structuredClone(config);
    draft.layout ??= GEO.defaultLayout(caseById('generic'));
    draft.cooler ??= { type: 'Air', size: 360, zone: 'front' };
    draft.slots ??= {};
    draft.specialHeaders ??= {};
    for (const z of ZONES) zone(z);
    profileChoice = Defaults.includes(config.activeProfile) ? config.activeProfile : 'Bureautique';
    stepIndex = 0;
    activeHeader = null;
    suggestSensors();
    dialog = document.getElementById('wizard');
    if (!dialog.open) dialog.showModal();
    render();
  }

  const Defaults = PROFILES.map((p) => p.name);

  // ---------- frame ----------

  function render() {
    const body = { 0: welcome, 1: casePicker, 2: zones, 3: cooling, 4: fans, 5: headers, 6: sensors, 7: profiles }[stepIndex]();
    dialog.innerHTML = `
      <div class="wz">
        <div class="wz-top">
          <div class="wz-brand">EZ<span>FAN</span></div>
          <div class="wz-steps">${STEPS.map((s, i) => `<div class="wz-step ${i === stepIndex ? 'on' : i < stepIndex ? 'done' : ''}"><span>${i + 1}</span>${s}</div>`).join('')}</div>
          ${config.setupDone ? '<button class="wz-close" data-act="close" title="Fermer sans enregistrer">✕</button>' : ''}
        </div>
        <div class="wz-body">${body}</div>
        <div class="wz-nav">
          ${stepIndex > 0 ? '<button data-act="back">← Retour</button>' : '<span></span>'}
          <span class="muted" id="wzHint"></span>
          ${stepIndex < STEPS.length - 1 ? '<button class="on" data-act="next">Continuer →</button>' : '<button class="on" data-act="finish">Terminer et lancer EZFAN</button>'}
        </div>
      </div>`;
    bind();
    tick();
  }

  function bind() {
    dialog.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b)));
    const search = dialog.querySelector('#wzSearch');
    if (search) {
      search.addEventListener('input', () => { caseFilter = search.value; refreshCaseGrid(); });
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
    dialog.querySelector('.wz-drawing svg')?.addEventListener('click', (e) => {
      const el = e.target.closest('[data-slot]');
      if (el) clickSlot(el.dataset.slot);
    });
    dialog.querySelectorAll('select[data-sensor]').forEach((s) => s.addEventListener('change', () => {
      const k = s.dataset.sensor;
      if (k === 'cpu') draft.safety.cpuSensorId = s.value;
      else if (k === 'gpu') draft.safety.gpuSensorId = s.value || null;
      else draft[k] = s.value || null;
    }));
  }

  async function act(name, el) {
    if (name === 'next') { stepIndex++; activeHeader = null; render(); return; }
    if (name === 'back') { stepIndex--; activeHeader = null; render(); return; }
    if (name === 'close') { dialog.close(); return; }
    if (name === 'finish') return finish();
    if (name === 'case') return pickCase(el.dataset.id);
    if (name === 'count') {
      const z = zone(el.dataset.zone);
      z.count = Math.max(0, Math.min(el.dataset.zone === 'rear' ? 2 : 4, z.count + Number(el.dataset.delta)));
      return render();
    }
    if (name === 'size') { zone(el.dataset.zone).size = Number(el.dataset.size); return render(); }
    if (name === 'cooler') {
      draft.cooler.type = el.dataset.type;
      if (el.dataset.size) draft.cooler.size = Number(el.dataset.size);
      if (draft.cooler.type === 'Aio' && !zone(draft.cooler.zone).count) draft.cooler.zone = ZONES.find((z) => zone(z).count && z !== 'rear') ?? 'front';
      return render();
    }
    if (name === 'coolerZone') { draft.cooler.zone = el.dataset.zone; return render(); }
    if (name === 'classic') return classicFans();
    if (name === 'clearFans') { for (const id of Object.keys(draft.slots)) draft.slots[id].content = 'Empty'; return render(); }
    if (name === 'header') { activeHeader = activeHeader === el.dataset.id ? null : el.dataset.id; return render(); }
    if (name === 'spin') {
      activeHeader = el.dataset.id;
      await fetch('/api/identify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ controlId: el.dataset.id, seconds: 10 }) });
      return render();
    }
    if (name === 'role') {
      const id = el.dataset.id, role = el.dataset.role;
      if (draft.specialHeaders[id] === role) delete draft.specialHeaders[id];
      else {
        draft.specialHeaders[id] = role;
        // A header that drives the CPU cooler or the pump is not a case fan.
        for (const s of Object.values(draft.slots)) if (s.controlId === id) s.controlId = null;
      }
      return render();
    }
    if (name === 'profile') { profileChoice = el.dataset.name; return render(); }
  }

  // ---------- steps ----------

  function welcome() {
    return `<div class="wz-hero">
      <div class="wz-logo">EZ<span>FAN</span></div>
      <h1>On configure ton PC en quelques minutes</h1>
      <p>Choisis ton boîtier, place tes ventilos, et EZFAN s'occupe des courbes : bureautique, jeux légers, jeux AAA ou performance.</p>
      <ul class="wz-list">
        <li>Tes ventilos restent gérés par le BIOS tant que l'assistant n'est pas terminé.</li>
        <li>Tout se modifie ensuite à la main, rien n'est figé.</li>
      </ul>
    </div>`;
  }

  function casePicker() {
    return `<h2 class="wz-title">Quel est ton boîtier ?</h2>
      <input id="wzSearch" class="wz-search" placeholder="Rechercher : 4000D, O11, H5, North..." value="${esc(caseFilter)}">
      <div class="wz-cases" id="wzCases">${caseCards()}</div>`;
  }

  function caseCards() {
    const q = caseFilter.trim().toLowerCase();
    return CASES.filter((c) => !q || `${c.brand} ${c.model}`.toLowerCase().includes(q) || c.id === 'generic')
      .map((c) => `<button class="wz-case ${draft.layout.caseId === c.id ? 'on' : ''}" data-act="case" data-id="${c.id}">
        ${GEO.thumbnail(c)}<strong>${esc(c.model)}</strong><small>${esc(c.brand)}${c.dual ? ' · double chambre' : ''}</small></button>`).join('');
  }

  function refreshCaseGrid() {
    const grid = dialog.querySelector('#wzCases');
    grid.innerHTML = caseCards();
    grid.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b)));
  }

  function pickCase(id) {
    if (draft.layout.caseId !== id) {
      draft.layout = GEO.defaultLayout(caseById(id));
      // Keep what the user already placed when the slot still exists.
    }
    stepIndex = 2;
    render();
  }

  function drawing(status, opts = {}) {
    const g = geo();
    const def = g.def;
    return `<div class="wz-drawing ${opts.small ? 'small' : ''}"><svg viewBox="0 0 ${GEO.W} ${GEO.H}">${GEO.defs()}${GEO.chassis(g, { name: def.id === 'generic' ? '' : `${def.brand} ${def.model}` })}
      ${GEO.slotsSvg(g, status, null)}${GEO.glass(g)}</svg></div>`;
  }

  const emptyStatus = () => ({ filled: false });

  function zones() {
    const def = caseById(draft.layout.caseId);
    const rows = ZONES.map((z) => {
      const spec = def[z] ?? {};
      const sizes = def.id === 'generic' ? [120, 140] : Object.keys(spec).map(Number);
      const zl = zone(z);
      return `<div class="wz-zone">
        <div><strong>${ZONE_NAMES[z]}</strong><small>${sizes.length ? 'Max : ' + sizes.map((s) => `${spec[s] ?? 3} × ${s}`).join(' ou ') : 'pas prévu d\'origine'}</small></div>
        <div class="wz-counter"><button data-act="count" data-zone="${z}" data-delta="-1">−</button><span>${zl.count}</span><button data-act="count" data-zone="${z}" data-delta="1">+</button></div>
        <div class="seg">${[120, 140].map((s) => `<button data-act="size" data-zone="${z}" data-size="${s}" class="${zl.size === s ? 'on' : ''}">${s}</button>`).join('')}</div>
      </div>`;
    }).join('');
    return `<h2 class="wz-title">Les emplacements de ventilos</h2>
      <p class="wz-sub">Voici les emplacements prévus par le fabricant. Ajoute ou retire-en si ton boîtier est différent.</p>
      <div class="wz-split">${drawing(emptyStatus)}<div class="wz-zones">${rows}</div></div>`;
  }

  function cooling() {
    const c = draft.cooler;
    const aios = [120, 240, 280, 360, 420];
    const zonesOk = ZONES.filter((z) => zone(z).count > 0);
    return `<h2 class="wz-title">Comment est refroidi ton processeur ?</h2>
      <div class="wz-choices">
        <button class="wz-choice ${c.type === 'Air' ? 'on' : ''}" data-act="cooler" data-type="Air"><span class="wz-icon">❄</span><strong>Ventirad</strong><small>Radiateur à ailettes avec ventilo sur le CPU</small></button>
        ${aios.map((s) => `<button class="wz-choice ${c.type === 'Aio' && c.size === s ? 'on' : ''}" data-act="cooler" data-type="Aio" data-size="${s}"><span class="wz-icon">💧</span><strong>AIO ${s}</strong><small>Watercooling ${s} mm</small></button>`).join('')}
      </div>
      ${c.type === 'Aio' ? `<h3 class="wz-h3">Où est monté le radiateur ?</h3>
        <div class="seg wz-seg">${zonesOk.map((z) => `<button data-act="coolerZone" data-zone="${z}" class="${c.zone === z ? 'on' : ''}">${ZONE_NAMES[z]}</button>`).join('')}</div>` : ''}
      ${drawing(emptyStatus, { small: true })}`;
  }

  function fanStatus(id) {
    const s = draft.slots[id];
    return s?.content === 'Fan' ? { filled: true, direction: s.direction } : { filled: false };
  }

  function fans() {
    const g = geo();
    let intake = 0, exhaust = 0;
    for (const id of Object.keys(g.slots)) {
      const s = draft.slots[id];
      if (s?.content !== 'Fan') continue;
      if (s.direction === 'In') intake++; else exhaust++;
    }
    const verdict = intake + exhaust === 0 ? 'Aucun ventilo placé.'
      : intake > exhaust ? `${intake} entrées pour ${exhaust} sorties : pression positive, c'est très bien.`
      : intake === exhaust ? `${intake} entrées pour ${exhaust} sorties : équilibré. EZFAN fera tourner les entrées un peu plus vite.`
      : `${intake} entrées pour ${exhaust} sorties : pression négative. EZFAN compensera en accélérant les entrées.`;
    return `<h2 class="wz-title">Place tes ventilos</h2>
      <p class="wz-sub">Clique sur un emplacement : une fois pour une <b class="in">entrée d'air</b>, deux fois pour une <b class="out">sortie</b>, trois fois pour le vider.</p>
      <div class="wz-split">${drawing(fanStatus)}
        <div class="wz-side">
          <div class="card"><strong>Bilan</strong><p class="muted">${verdict}</p></div>
          <button data-act="classic" class="wide">Remplir comme un montage classique</button>
          <button data-act="clearFans" class="wide">Tout vider</button>
          <p class="muted">Classique : l'air frais entre par l'avant, le côté et le bas, et sort par le dessus et l'arrière.</p>
        </div></div>`;
  }

  function clickSlot(id) {
    if (stepIndex === 4) {
      const s = draft.slots[id] ?? (draft.slots[id] = { content: 'Empty', controlId: null, direction: 'In', size: 120, label: '' });
      if (s.content !== 'Fan') { s.content = 'Fan'; s.direction = 'In'; }
      else if (s.direction === 'In') s.direction = 'Out';
      else s.content = 'Empty';
      render();
    } else if (stepIndex === 5 && activeHeader) {
      const s = draft.slots[id];
      if (s?.content !== 'Fan') return;
      s.controlId = s.controlId === activeHeader ? null : activeHeader;
      delete draft.specialHeaders[activeHeader];
      render();
    }
  }

  function classicFans() {
    const g = geo();
    for (const [id, sl] of Object.entries(g.slots)) {
      const dir = sl.zone === 'top' || sl.zone === 'rear' ? 'Out' : 'In';
      const s = draft.slots[id] ?? (draft.slots[id] = { controlId: null, size: 120, label: '' });
      s.content = 'Fan';
      s.direction = dir;
    }
    render();
  }

  function headerNumber(controlId) {
    const c = state.snapshot.controls.find((x) => x.id === controlId);
    return c ? c.name.replace(/^GPU Fan\s*/i, 'GPU ').replace(/^Fan\s*#?/i, '') : '?';
  }

  function headers() {
    const g = geo();
    const controls = state.snapshot.controls.filter((c) => !isGpu(c));
    const gpus = state.snapshot.controls.filter(isGpu);
    const used = (id) => Object.entries(draft.slots).filter(([sid, s]) => g.slots[sid] && s.content === 'Fan' && s.controlId === id).map(([sid]) => slotName(sid));
    const cards = controls.map((c) => {
      const slots = used(c.id), role = draft.specialHeaders[c.id];
      const summary = role === 'CpuCooler' ? 'Ventirad CPU' : role === 'Pump' ? 'Pompe de l\'AIO' : slots.length ? slots.join(', ') : 'Rien d\'assigné';
      return `<div class="wz-header ${activeHeader === c.id ? 'on' : ''} ${c.pairedFanRpm > 0 ? '' : 'off'}">
        <button class="wz-header-main" data-act="header" data-id="${esc(c.id)}">
          <strong>${esc(c.name)}</strong><small data-live-rpm="${esc(c.id)}">${c.pairedFanRpm > 0 ? fmt(c.pairedFanRpm) + ' RPM' : 'rien de branché ?'}</small>
          <span class="wz-assign">${esc(summary)}</span></button>
        <div class="wz-header-actions">
          <button data-act="spin" data-id="${esc(c.id)}" title="Fait tourner cette prise à fond pendant 10 secondes">Faire tourner</button>
          <button data-act="role" data-role="CpuCooler" data-id="${esc(c.id)}" class="${role === 'CpuCooler' ? 'on' : ''}">Ventirad</button>
          ${draft.cooler.type === 'Aio' ? `<button data-act="role" data-role="Pump" data-id="${esc(c.id)}" class="${role === 'Pump' ? 'on' : ''}">Pompe</button>` : ''}
        </div></div>`;
    }).join('');
    const status = (id) => {
      const s = draft.slots[id];
      if (s?.content !== 'Fan') return { filled: false };
      return { filled: true, direction: s.direction, highlight: activeHeader && s.controlId === activeHeader, text: s.controlId ? '#' + headerNumber(s.controlId) : '?' };
    };
    return `<h2 class="wz-title">Sur quelle prise est branché chaque ventilo ?</h2>
      <p class="wz-sub">Choisis une prise à gauche, clique sur « Faire tourner » : elle passe à fond 10 secondes et les autres ralentissent.
        Clique ensuite dans le dessin sur les ventilos qui ont accéléré.</p>
      <div class="wz-split reverse">
        <div class="wz-headers">${cards}
          ${gpus.length ? '<p class="muted">Les ventilos de la carte graphique restent gérés par la carte, tu pourras les régler plus tard.</p>' : ''}</div>
        ${drawing(status)}
      </div>`;
  }

  function suggestSensors() {
    const board = state.snapshot.temperatures.filter((t) => t.hardwareType === 'SuperIO' && plausible(t));
    if (!draft.intakeSensorId && board.length) draft.intakeSensorId = [...board].sort((a, b) => a.value - b.value)[0].id;
    if (!draft.exhaustSensorId && board.length) draft.exhaustSensorId = [...board].sort((a, b) => b.value - a.value)[0].id;
  }

  function sensors() {
    const temps = state.snapshot.temperatures;
    const opt = (sel, filter) => temps.filter(filter).map((t) =>
      `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)} · ${esc(t.hardware)}${plausible(t) ? '' : ' (semble débranchée)'}</option>`).join('');
    const row = (label, help, key, sel, filter, allowNone) => `<div class="wz-sensor">
      <div><strong>${label}</strong><small>${help}</small></div>
      <select data-sensor="${key}">${allowNone ? '<option value="">(aucune)</option>' : ''}${opt(sel, filter)}</select>
      <span class="wz-live" data-live-temp="${key}"></span></div>`;
    const board = temps.filter((t) => t.hardwareType === 'SuperIO');
    return `<h2 class="wz-title">Les sondes de température</h2>
      <p class="wz-sub">EZFAN a écarté les sondes qui donnent des valeurs impossibles. Pour le boîtier, prends la plus fraîche pour les entrées et une plus chaude (près du processeur ou des VRM) pour les sorties.</p>
      <div class="wz-sensors">
        ${row('Processeur', 'Pilote l\'AIO ou le ventirad', 'cpu', draft.safety.cpuSensorId, (t) => t.hardwareType === 'Cpu')}
        ${row('Carte graphique', 'Utilisée par les profils Jeux AAA et Performance', 'gpu', draft.safety.gpuSensorId, (t) => t.hardwareType.startsWith('Gpu'), true)}
        ${row('Air qui entre', 'Sonde de carte mère pour les ventilos d\'entrée', 'intakeSensorId', draft.intakeSensorId, (t) => t.hardwareType === 'SuperIO' || t.hardwareType === 'Motherboard')}
        ${row('Air qui sort', 'Sonde de carte mère pour les ventilos de sortie', 'exhaustSensorId', draft.exhaustSensorId, (t) => t.hardwareType === 'SuperIO' || t.hardwareType === 'Motherboard')}
      </div>
      <h3 class="wz-h3">Toutes les sondes de la carte mère</h3>
      <div class="list">${board.map((t) => `<div class="item ${plausible(t) ? '' : 'dim'}"><div class="label">${esc(t.name)}<small>${plausible(t) ? 'OK' : 'semble débranchée'}</small></div><div class="v" data-live-id="${esc(t.id)}">${fmt(t.value, 1)} °C</div></div>`).join('')}</div>`;
  }

  function profiles() {
    return `<h2 class="wz-title">Quel usage par défaut ?</h2>
      <p class="wz-sub">EZFAN crée les 4 profils. Tu pourras passer de l'un à l'autre en un clic, depuis l'appli ou l'icône près de l'horloge.</p>
      <div class="wz-profiles">${PROFILES.map((p) => `<button class="wz-profile ${profileChoice === p.name ? 'on' : ''}" data-act="profile" data-name="${p.name}">
        <span class="wz-icon">${p.icon}</span><strong>${p.name}</strong><small>${p.text}</small></button>`).join('')}</div>`;
  }

  // ---------- finish ----------

  function nameHeaders() {
    const g = geo();
    for (const c of state.snapshot.controls) {
      const role = draft.specialHeaders[c.id];
      if (role) { draft.fanNames[c.id] = role === 'Pump' ? 'Pompe AIO' : 'Ventirad CPU'; continue; }
      const slots = Object.entries(draft.slots).filter(([id, s]) => g.slots[id] && s.content === 'Fan' && s.controlId === c.id);
      if (!slots.length) continue;
      const zonesUsed = [...new Set(slots.map(([id]) => id.split('-')[0]))];
      const what = zonesUsed.map((z) => {
        const n = slots.filter(([id]) => id.startsWith(z + '-')).length;
        const isRad = draft.cooler.type === 'Aio' && draft.cooler.zone === z;
        return `${isRad ? 'AIO ' : ''}${ZONE_NAMES[z]}${n > 1 ? ' x' + n : ''}`;
      }).join(' + ');
      const dirs = new Set(slots.map(([, s]) => s.direction));
      draft.fanNames[c.id] = `${what} (${dirs.size > 1 ? 'mixte' : dirs.has('In') ? 'entrée' : 'sortie'})`;
    }
  }

  async function finish() {
    // Slots that no longer exist in the layout are dropped.
    const g = geo();
    for (const id of Object.keys(draft.slots)) if (!g.slots[id]) delete draft.slots[id];
    nameHeaders();
    const r = await fetch('/api/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: draft, activeProfile: profileChoice }),
    });
    if (!r.ok) { document.getElementById('wzHint').textContent = 'Erreur : ' + (await r.text()); return; }
    dialog.close();
    reloadConfig();
  }

  // Live values (RPM, temperatures) refresh without rebuilding the step.
  function tick() {
    if (!dialog?.open) return;
    dialog.querySelectorAll('[data-live-rpm]').forEach((el) => {
      const c = state.snapshot.controls.find((x) => x.id === el.dataset.liveRpm);
      el.textContent = c?.pairedFanRpm > 0 ? fmt(c.pairedFanRpm) + ' RPM' : 'rien de branché ?';
    });
    dialog.querySelectorAll('[data-live-id]').forEach((el) => { el.textContent = fmt(temp(el.dataset.liveId)?.value, 1) + ' °C'; });
    dialog.querySelectorAll('[data-live-temp]').forEach((el) => {
      const k = el.dataset.liveTemp;
      const id = k === 'cpu' ? draft.safety.cpuSensorId : k === 'gpu' ? draft.safety.gpuSensorId : draft[k];
      const v = temp(id)?.value;
      el.textContent = v != null ? fmt(v, 1) + ' °C' : '';
    });
    const hint = document.getElementById('wzHint');
    if (hint && stepIndex === 5) hint.textContent = state.identifying ? `Test en cours : ${headerNumber(state.identifying) ? 'prise #' + headerNumber(state.identifying) : ''} à fond` : '';
  }

  return { open, tick, isOpen: () => dialog?.open };
})();
