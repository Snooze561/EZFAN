'use strict';
// Builds the side view of any case from its library entry and the user's layout:
// where every fan slot, the radiator, the motherboard, the CPU and the GPU go.
// Front on the left, seen through the glass panel. View box is always 1000 x 900.

const GEO = (() => {
  const W = 1000, H = 900;

  // Default layout of a case: every zone filled with its 120 mm maximum.
  function defaultLayout(caseDef) {
    const zones = {};
    for (const z of ZONES) {
      const spec = caseDef[z];
      zones[z] = { count: spec ? spec[120] ?? spec[140] ?? 0 : 0, size: spec && spec[120] == null ? 140 : 120 };
    }
    if (caseDef.id === 'generic') { zones.side.count = 0; zones.bottom.count = 0; zones.top.count = 2; }
    return { caseId: caseDef.id, zones };
  }

  function build(layout, cooler) {
    const def = caseById(layout.caseId);
    const s = Math.min(800 / def.h, 840 / def.d);
    const cw = def.d * s, ch = def.h * s;
    const ox = (W - cw) / 2, oy = (H - ch) / 2 - 12;
    const pt = 22 * s;
    const IN = { x0: ox + pt, x1: ox + cw - pt, y0: oy + pt, y1: oy + ch - pt };
    const t = 25 * s;                 // fan thickness
    const radT = 27 * s;              // radiator thickness
    const z = (name) => layout.zones[name] ?? { count: 0, size: 120 };
    const aio = cooler?.type === 'Aio' ? cooler : null;
    const radIn = (name) => (aio && aio.zone === name ? radT : 0);
    const slots = {};

    const front = z('front'), top = z('top'), rear = z('rear'), side = z('side'), bottom = z('bottom');
    const frontDepth = front.count ? t + radIn('front') : 0;

    for (let i = 0; i < front.count; i++) {
      const f = front.size * s;
      slots[`front-${i + 1}`] = { zone: 'front', kind: 'edge', x: IN.x0 + radIn('front'), y: IN.y0 + 6 * s + i * f, w: t, h: f, inward: [1, 0], size: front.size };
    }

    const shroudH = def.dual ? 0 : 95 * s;
    const SHROUD = def.dual ? null : { x0: IN.x0 + (frontDepth ? frontDepth + 55 * s : 90 * s), x1: IN.x1, y0: IN.y1 - shroudH, y1: IN.y1 };

    {
      const f = top.size * s;
      let x = IN.x0 + (frontDepth ? frontDepth + 10 * s : 30 * s);
      x = Math.min(x, IN.x1 - top.count * f - 8 * s);
      for (let i = 0; i < top.count; i++)
        slots[`top-${i + 1}`] = { zone: 'top', kind: 'edge', x: x + i * f, y: IN.y0 + radIn('top'), w: f, h: t, inward: [0, 1], size: top.size };
    }

    for (let i = 0; i < rear.count; i++) {
      const f = rear.size * s;
      slots[`rear-${i + 1}`] = { zone: 'rear', kind: 'edge', x: IN.x1 - radIn('rear') - t, y: IN.y0 + 40 * s + i * f, w: t, h: f, inward: [-1, 0], size: rear.size };
    }

    {
      const f = bottom.size * s;
      const y = (SHROUD ? SHROUD.y0 : IN.y1) - radIn('bottom') - t;
      let x = IN.x0 + (frontDepth ? frontDepth + 20 * s : 40 * s);
      x = Math.min(x, IN.x1 - bottom.count * f - 8 * s);
      for (let i = 0; i < bottom.count; i++)
        slots[`bottom-${i + 1}`] = { zone: 'bottom', kind: 'edge', x: x + i * f, y, w: f, h: t, inward: [0, -1], size: bottom.size };
    }

    {
      // Side-panel fans face the viewer; they sit in a column near the front.
      const f = side.size * s;
      const cx = IN.x0 + (frontDepth ? frontDepth + 18 * s : 14 * s) + f / 2;
      for (let i = 0; i < side.count; i++)
        slots[`side-${i + 1}`] = { zone: 'side', kind: 'face', cx, cy: IN.y0 + 8 * s + f / 2 + i * f, r: f / 2 - 3, size: side.size };
    }

    // ATX board against the rear, CPU socket near its top, GPU in the first slot.
    const MOBO = { x1: IN.x1 - 8 * s, y0: IN.y0 + 26 * s };
    MOBO.x0 = MOBO.x1 - 244 * s;
    MOBO.y1 = Math.min(MOBO.y0 + 305 * s, (SHROUD ? SHROUD.y0 : IN.y1) - 4 * s);
    const CPU = { x: MOBO.x1 - 100 * s, y: MOBO.y0 + 80 * s, r: 34 * s };
    const GPU = { x1: MOBO.x1 + 6 * s, y0: MOBO.y0 + 150 * s, y1: MOBO.y0 + 205 * s };
    GPU.x0 = Math.max(GPU.x1 - 300 * s, IN.x0 + frontDepth + 12 * s);

    let RAD = null;
    if (aio) {
      const list = Object.values(slots).filter((sl) => sl.zone === aio.zone);
      const len = (aio.size + 35) * s;
      if (aio.zone === 'front') {
        const y = list[0]?.y ?? IN.y0 + 6 * s;
        RAD = { x: IN.x0, y, w: radT, h: len, vertical: true };
      } else if (aio.zone === 'top') {
        const x = list[0]?.x ?? IN.x0 + 30 * s;
        RAD = { x: x - 15 * s, y: IN.y0, w: len, h: radT, vertical: false };
      } else if (aio.zone === 'bottom') {
        const x = list[0]?.x ?? IN.x0 + 40 * s;
        RAD = { x: x - 15 * s, y: (SHROUD ? SHROUD.y0 : IN.y1) - radT, w: len, h: radT, vertical: false };
      } else if (aio.zone === 'side') {
        const sl = list[0];
        const cx = sl?.cx ?? IN.x0 + 90 * s, cy0 = (sl?.cy ?? IN.y0 + 70 * s) - (sl?.r ?? 60 * s);
        RAD = { x: cx - (aio.size > 300 ? 70 : 62) * s, y: cy0 - 15 * s, w: (aio.size > 300 ? 140 : 124) * s, h: len, vertical: true, face: true };
      } else if (aio.zone === 'rear') {
        RAD = { x: IN.x1 - radT, y: list[0]?.y ?? IN.y0 + 40 * s, w: radT, h: len, vertical: true };
      }
    }

    return { W, H, s, def, ox, oy, cw, ch, IN, SHROUD, MOBO, CPU, GPU, RAD, slots, aio, t };
  }

  const center = (sl) => (sl.kind === 'face' ? [sl.cx, sl.cy] : [sl.x + sl.w / 2, sl.y + sl.h / 2]);

  function defs() {
    return `<defs>
      <pattern id="mesh" width="14" height="12" patternUnits="userSpaceOnUse">
        <rect width="14" height="12" fill="#141618"/><path d="M1 11 L7 1 L13 11 Z" fill="#050606"/>
      </pattern>
      <pattern id="vent" width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="#1b1e21"/><circle cx="5" cy="5" r="2.2" fill="#0a0b0c"/>
      </pattern>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".07"/><stop offset=".35" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".7" stop-color="#ffffff" stop-opacity=".03"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="glassFront" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#9fb4c8" stop-opacity=".18"/><stop offset="1" stop-color="#9fb4c8" stop-opacity=".05"/>
      </linearGradient>
      <radialGradient id="rgb" cx=".5" cy=".5" r=".5">
        <stop offset=".72" stop-color="#ffffff" stop-opacity="0"/><stop offset=".9" stop-color="#ffffff" stop-opacity=".22"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
  }

  // Everything that does not move: chassis, board, CPU, GPU, shroud, radiator. `labels` adds names and temperatures.
  function chassis(g, labels = {}) {
    const { IN, s, ox, oy, cw, ch, SHROUD, MOBO, CPU, GPU, RAD, def } = g;
    const pt = 22 * s;
    let o = `<rect x="${ox}" y="${oy}" width="${cw}" height="${ch}" rx="${16 * s}" fill="#0b0c0d" stroke="#2a2e33" stroke-width="2"/>
      <rect x="${IN.x0}" y="${IN.y0}" width="${IN.x1 - IN.x0}" height="${IN.y1 - IN.y0}" fill="#101214"/>
      <rect x="${ox + 3}" y="${oy + 3}" width="${pt - 3}" height="${ch - 6}" rx="${12 * s}" fill="${def.dual ? 'url(#glassFront)' : 'url(#mesh)'}" stroke="#24282c"/>
      <rect x="${IN.x0}" y="${oy + 3}" width="${IN.x1 - IN.x0}" height="${pt - 4}" fill="url(#mesh)" stroke="#24282c"/>
      <rect x="${IN.x1 + 2}" y="${oy + 3}" width="${pt - 5}" height="${ch - 6}" rx="4" fill="#0e1011" stroke="#24282c"/>
      <rect x="${IN.x1 + 5}" y="${MOBO.y0}" width="${pt - 11}" height="${60 * s}" rx="3" fill="#1a1d20"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${IN.x1 + 5}" y="${GPU.y0 - 6 * s + i * 20 * s}" width="${pt - 11}" height="${12 * s}" rx="2" fill="#1a1d20"/>`).join('')}
      <rect x="${MOBO.x0}" y="${MOBO.y0}" width="${MOBO.x1 - MOBO.x0}" height="${MOBO.y1 - MOBO.y0}" rx="8" fill="#16191c" stroke="#262a2f"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${CPU.x + CPU.r + 18 * s + i * 9 * s}" y="${MOBO.y0 + 30 * s}" width="${5 * s}" height="${130 * s}" rx="2" fill="#2a2f35"/>`).join('')}`;
    if (labels.board) o += `<text x="${(MOBO.x0 + MOBO.x1) / 2}" y="${MOBO.y1 - 14}" class="case-label" text-anchor="middle">${esc(labels.board)}</text>`;

    if (RAD) {
      const { x, y, w, h, vertical } = RAD;
      o += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#1a1c1f" stroke="#2c3035" ${RAD.face ? 'opacity=".75"' : ''}/>`;
      const n = Math.floor((vertical ? h : w) / 20);
      for (let i = 1; i < n; i++)
        o += vertical
          ? `<line x1="${x + 3}" x2="${x + w - 3}" y1="${y + i * 20}" y2="${y + i * 20}" stroke="#2a2d31" stroke-width="5" ${RAD.face ? 'opacity=".6"' : ''}/>`
          : `<line y1="${y + 3}" y2="${y + h - 3}" x1="${x + i * 20}" x2="${x + i * 20}" stroke="#2a2d31" stroke-width="5"/>`;
      // Tubes from the radiator end to the CPU block.
      const ex = vertical ? x + w / 2 : x + 10, ey = vertical ? y + 30 * s : y + h / 2;
      o += `<path d="M ${CPU.x - CPU.r * 0.6} ${CPU.y - CPU.r * 0.5} C ${CPU.x - 120 * s} ${CPU.y - 60 * s}, ${ex + 60 * s} ${ey}, ${ex} ${ey}" class="tube"/>
            <path d="M ${CPU.x - CPU.r * 0.6} ${CPU.y + CPU.r * 0.4} C ${CPU.x - 120 * s} ${CPU.y + 40 * s}, ${ex + 60 * s} ${ey + 50 * s}, ${ex} ${ey + 45 * s}" class="tube"/>`;
    }

    o += `<circle cx="${CPU.x}" cy="${CPU.y}" r="${CPU.r}" fill="#0c0d0f" stroke="#30353b" stroke-width="3"/>
      <circle cx="${CPU.x}" cy="${CPU.y}" r="${CPU.r}" fill="url(#rgb)"/>`;
    if (g.aio == null) {
      // Air cooler: a tower of fins with its fan.
      o += `<rect x="${CPU.x - 38 * s}" y="${CPU.y - 75 * s}" width="${76 * s}" height="${150 * s}" rx="6" fill="#1b1e22" stroke="#33383e"/>
            ${Array.from({ length: 12 }, (_, i) => `<line x1="${CPU.x - 34 * s}" x2="${CPU.x + 34 * s}" y1="${CPU.y - 68 * s + i * 12 * s}" y2="${CPU.y - 68 * s + i * 12 * s}" stroke="#2b3036" stroke-width="3"/>`).join('')}`;
    }
    if (labels.cpu) o += `<text x="${CPU.x}" y="${CPU.y + CPU.r + 24}" class="case-label" text-anchor="middle">${esc(labels.cpu)}</text>`;
    if (labels.temps) o += `<text x="${CPU.x}" y="${CPU.y + 8}" class="case-temp" id="cpuTemp" text-anchor="middle">-</text>`;

    o += `<rect x="${GPU.x0}" y="${GPU.y0}" width="${GPU.x1 - GPU.x0}" height="${GPU.y1 - GPU.y0}" rx="8" fill="#1c1f23" stroke="#33383e"/>
      <rect x="${GPU.x0 + 8}" y="${GPU.y1 - 12}" width="${GPU.x1 - GPU.x0 - 16}" height="6" rx="3" fill="#3a3f45"/>`;
    if (labels.gpu) o += `<text x="${GPU.x0 + 16}" y="${GPU.y0 + 28}" class="case-label">${esc(labels.gpu)}</text>`;
    if (labels.temps) o += `<text x="${GPU.x1 - 18}" y="${GPU.y0 + 32}" class="case-temp" id="gpuTemp" text-anchor="end">-</text>`;

    if (SHROUD) {
      o += `<rect x="${SHROUD.x0}" y="${SHROUD.y0}" width="${SHROUD.x1 - SHROUD.x0}" height="${SHROUD.y1 - SHROUD.y0}" fill="#0d0f10" stroke="#24282c"/>
        <text x="${SHROUD.x1 - 24}" y="${SHROUD.y1 - 22}" class="case-label" text-anchor="end">Alimentation</text>`;
    }
    if (labels.temps) {
      o += `<g class="case-sensor"><circle cx="${MOBO.x0 + 50 * s}" cy="${MOBO.y1 - 50 * s}" r="5"/><text x="${MOBO.x0 + 50 * s + 12}" y="${MOBO.y1 - 50 * s + 4}" id="caseTempIn"></text></g>
        <g class="case-sensor"><circle cx="${MOBO.x1 - 30 * s}" cy="${MOBO.y0 + 20 * s}" r="5"/><text x="${MOBO.x1 - 42 * s}" y="${MOBO.y0 + 24 * s}" text-anchor="end" id="caseTempOut"></text></g>`;
    }
    o += `<text x="${ox + pt / 2}" y="${oy + ch + 26}" class="case-label" text-anchor="middle">AVANT</text>
      <text x="${ox + cw - pt / 2}" y="${oy + ch + 26}" class="case-label" text-anchor="middle">ARRIÈRE</text>`;
    if (labels.name) o += `<text x="${ox + cw / 2}" y="${oy + ch + 26}" class="case-label" text-anchor="middle">${esc(labels.name)}</text>`;
    return o;
  }

  function glass(g) {
    const { IN } = g;
    return `<rect x="${IN.x0}" y="${IN.y0}" width="${IN.x1 - IN.x0}" height="${IN.y1 - IN.y0}" fill="url(#glass)" pointer-events="none"/>`;
  }

  const STRIPE = 16;

  function stripes(sl) {
    let d = '';
    const horizontal = sl.w > sl.h;
    const len = horizontal ? sl.w : sl.h;
    for (let i = -STRIPE; i < len + STRIPE; i += STRIPE)
      d += horizontal
        ? `<line x1="${sl.x + i}" y1="${sl.y}" x2="${sl.x + i + 10}" y2="${sl.y + sl.h}"/>`
        : `<line x1="${sl.x}" y1="${sl.y + i}" x2="${sl.x + sl.w}" y2="${sl.y + i + 10}"/>`;
    return d;
  }

  function blades(cx, cy, r) {
    let d = '';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, hub = r * 0.24;
      const x1 = cx + Math.cos(a) * hub, y1 = cy + Math.sin(a) * hub;
      const x2 = cx + Math.cos(a + 0.5) * r, y2 = cy + Math.sin(a + 0.5) * r;
      const x3 = cx + Math.cos(a + 0.95) * (r * 0.6), y3 = cy + Math.sin(a + 0.95) * (r * 0.6);
      d += `<path d="M${x1},${y1} Q${x2},${y2} ${x3},${y3} Z"/>`;
    }
    return d;
  }

  function arrow(sl, direction) {
    const [cx, cy] = center(sl);
    let [dx, dy] = sl.inward;
    if (direction === 'Out') { dx = -dx; dy = -dy; }
    const len = Math.min(26, (sl.w > sl.h ? sl.h : sl.w) * 0.9);
    const tipX = cx + dx * len, tipY = cy + dy * len, px = -dy, py = dx;
    return `<path class="arrow" d="M${cx - dx * len},${cy - dy * len} L${tipX},${tipY} M${tipX - dx * 12 + px * 10},${tipY - dy * 12 + py * 10} L${tipX},${tipY} L${tipX - dx * 12 - px * 10},${tipY - dy * 12 - py * 10}"/>`;
  }

  // status(id) -> { filled, direction, highlight, text }
  function slotsSvg(g, status, selected) {
    let o = '';
    for (const [id, sl] of Object.entries(g.slots)) {
      const st = status(id);
      const dir = st.direction === 'Out' ? 'out' : 'in';
      const cls = `slot ${st.filled ? 'filled ' + dir : 'empty'} ${selected === id ? 'sel' : ''} ${st.highlight ? 'hl' : ''}`;
      if (sl.kind === 'face') {
        o += `<g class="${cls} face" data-slot="${id}">
          <circle cx="${sl.cx}" cy="${sl.cy}" r="${sl.r}" class="frame"/>
          ${st.filled ? `<g class="blades" id="blades-${id}">${blades(sl.cx, sl.cy, sl.r - 10)}</g><circle cx="${sl.cx}" cy="${sl.cy}" r="${sl.r * 0.22}" class="hub"/>
            ${st.direction ? `<text x="${sl.cx}" y="${sl.cy + sl.r + 18}" text-anchor="middle" class="face-dir">${st.direction === 'Out' ? 'sortie' : 'entrée'}</text>` : ''}`
            : `<text x="${sl.cx}" y="${sl.cy + 9}" text-anchor="middle" class="plus">+</text>`}
          ${st.text ? `<text x="${sl.cx}" y="${sl.cy + 6}" text-anchor="middle" class="slot-text">${esc(st.text)}</text>` : ''}
        </g>`;
      } else {
        o += `<g class="${cls}" data-slot="${id}">
          <rect x="${sl.x}" y="${sl.y}" width="${sl.w}" height="${sl.h}" rx="6" class="frame"/>
          ${st.filled ? `<clipPath id="clip-${id}"><rect x="${sl.x + 4}" y="${sl.y + 4}" width="${sl.w - 8}" height="${sl.h - 8}" rx="4"/></clipPath>
             <g clip-path="url(#clip-${id})"><g class="stripes" id="stripes-${id}">${stripes(sl)}</g></g>${st.direction ? arrow(sl, st.direction) : ''}`
            : `<text x="${sl.x + sl.w / 2}" y="${sl.y + sl.h / 2 + 9}" text-anchor="middle" class="plus">+</text>`}
          ${st.text ? `<text x="${sl.x + sl.w / 2}" y="${sl.y + sl.h / 2 + 5}" text-anchor="middle" class="slot-text">${esc(st.text)}</text>` : ''}
        </g>`;
      }
    }
    return o;
  }

  // Small static silhouette for the case picker.
  function thumbnail(caseDef) {
    const g = build(defaultLayout(caseDef), null);
    const st = () => ({ filled: false });
    return `<svg viewBox="0 0 ${W} ${H}" class="thumb">${defs()}${chassis(g)}${slotsSvg(g, st)}</svg>`;
  }

  return { W, H, STRIPE, defaultLayout, build, center, defs, chassis, glass, slotsSvg, thumbnail };
})();
