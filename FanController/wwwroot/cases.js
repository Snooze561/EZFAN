'use strict';
// Case library. Sizes in mm (h = height, d = depth front to back).
// Each zone gives how many fans fit per size: { 120: n, 140: n }. Specs are the makers' published
// maximums, rounded; the wizard lets the user add or remove a slot when their case differs.
// dual = dual-chamber case: glass front, PSU behind the motherboard, no shroud.

const CASES = [
  { id: 'corsair-4000d', brand: 'Corsair', model: '4000D Airflow', h: 466, d: 453, front: { 120: 3, 140: 2 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 } },
  { id: 'corsair-frame-4000d', brand: 'Corsair', model: 'FRAME 4000D', h: 487, d: 484, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 }, side: { 120: 3 } },
  { id: 'corsair-3000d', brand: 'Corsair', model: '3000D Airflow', h: 466, d: 462, front: { 120: 3, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1 } },
  { id: 'corsair-5000d', brand: 'Corsair', model: '5000D Airflow', h: 520, d: 520, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 }, side: { 120: 3, 140: 2 } },
  { id: 'corsair-6500x', brand: 'Corsair', model: '6500X / 6500D', h: 485, d: 510, dual: true, top: { 120: 3, 140: 3 }, rear: { 120: 1 }, side: { 120: 3 }, bottom: { 120: 3 } },
  { id: 'lianli-o11-evo', brand: 'Lian Li', model: 'O11 Dynamic EVO', h: 465, d: 459, dual: true, top: { 120: 3, 140: 3 }, rear: { 120: 1 }, side: { 120: 3 }, bottom: { 120: 3, 140: 3 } },
  { id: 'lianli-o11-vision', brand: 'Lian Li', model: 'O11 Vision', h: 464, d: 466, dual: true, top: { 120: 3, 140: 3 }, rear: { 120: 1 }, side: { 120: 3 }, bottom: { 120: 3, 140: 3 } },
  { id: 'lianli-lancool-216', brand: 'Lian Li', model: 'Lancool 216', h: 491, d: 480, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 2 }, rear: { 120: 1, 140: 1 }, bottom: { 120: 2 } },
  { id: 'lianli-lancool-207', brand: 'Lian Li', model: 'Lancool 207', h: 460, d: 458, front: { 120: 3, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1 }, bottom: { 120: 2 } },
  { id: 'nzxt-h5-flow', brand: 'NZXT', model: 'H5 Flow', h: 464, d: 440, front: { 120: 2, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1 }, bottom: { 120: 1 } },
  { id: 'nzxt-h7-flow', brand: 'NZXT', model: 'H7 Flow', h: 505, d: 480, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 3 }, rear: { 120: 1, 140: 1 } },
  { id: 'nzxt-h9-flow', brand: 'NZXT', model: 'H9 Flow', h: 495, d: 466, dual: true, top: { 120: 3, 140: 3 }, rear: { 120: 1 }, side: { 120: 3 }, bottom: { 120: 3 } },
  { id: 'fractal-north', brand: 'Fractal Design', model: 'North', h: 469, d: 447, front: { 120: 3, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1, 140: 1 } },
  { id: 'fractal-meshify-2c', brand: 'Fractal Design', model: 'Meshify 2 Compact', h: 475, d: 427, front: { 120: 3, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1 } },
  { id: 'fractal-meshify-2', brand: 'Fractal Design', model: 'Meshify 2', h: 542, d: 474, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 3 }, rear: { 120: 1, 140: 1 }, bottom: { 120: 2, 140: 2 } },
  { id: 'fractal-pop-air', brand: 'Fractal Design', model: 'Pop Air', h: 474, d: 465, front: { 120: 3, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1 } },
  { id: 'fractal-torrent', brand: 'Fractal Design', model: 'Torrent', h: 530, d: 544, front: { 140: 3 }, rear: { 120: 1, 140: 1 }, bottom: { 140: 3 } },
  { id: 'bequiet-500dx', brand: 'be quiet!', model: 'Pure Base 500DX', h: 463, d: 450, front: { 120: 3, 140: 3 }, top: { 120: 2, 140: 2 }, rear: { 120: 1, 140: 1 } },
  { id: 'bequiet-shadow-800dx', brand: 'be quiet!', model: 'Shadow Base 800 DX', h: 520, d: 499, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 3 }, rear: { 120: 1, 140: 1 } },
  { id: 'phanteks-g360a', brand: 'Phanteks', model: 'Eclipse G360A', h: 475, d: 450, front: { 120: 3, 140: 2 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 } },
  { id: 'phanteks-nv5', brand: 'Phanteks', model: 'NV5', h: 485, d: 470, dual: true, top: { 120: 3, 140: 2 }, rear: { 120: 1 }, side: { 120: 3 }, bottom: { 120: 3 } },
  { id: 'montech-air903', brand: 'Montech', model: 'AIR 903 MAX', h: 503, d: 490, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 3 }, rear: { 120: 1, 140: 1 } },
  { id: 'montech-king95', brand: 'Montech', model: 'KING 95 PRO', h: 482, d: 470, dual: true, top: { 120: 3, 140: 3 }, rear: { 120: 1 }, side: { 120: 3 }, bottom: { 120: 3 } },
  { id: 'antec-c8', brand: 'Antec', model: 'C8', h: 481, d: 486, dual: true, top: { 120: 3, 140: 3 }, rear: { 120: 1, 140: 1 }, side: { 120: 3 }, bottom: { 120: 3, 140: 3 } },
  { id: 'deepcool-ch560', brand: 'DeepCool', model: 'CH560', h: 471, d: 452, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 } },
  { id: 'coolermaster-td500', brand: 'Cooler Master', model: 'MasterBox TD500 Mesh', h: 499, d: 493, front: { 120: 3, 140: 2 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 } },
  { id: 'hyte-y60', brand: 'HYTE', model: 'Y60', h: 456, d: 462, dual: true, top: { 120: 3 }, rear: { 120: 1 }, side: { 120: 2 }, bottom: { 120: 3 } },
  { id: 'generic', brand: 'Autre', model: 'Boîtier générique', h: 470, d: 460, front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 3 }, rear: { 120: 1, 140: 1 }, side: { 120: 3, 140: 3 }, bottom: { 120: 3, 140: 3 } },
];

const ZONES = ['front', 'top', 'rear', 'side', 'bottom'];
const ZONE_NAMES = { front: 'Façade', top: 'Dessus', rear: 'Arrière', side: 'Côté', bottom: 'Dessous' };

const caseById = (id) => CASES.find((c) => c.id === id) ?? CASES[0];
