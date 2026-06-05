'use strict';
// ============================================================
// planner_socket_engine.js — Moteur d'accrochage par sockets (SANS dépendance Three).
// Port du prototype validé. Travaille en espace Unreal (cm, X/Y horizontal, Z up).
//
// Données attendues d'une pièce (via getPiece(type)) :
//   { sockets: [{lx,ly,lz,yawDeg,cost,types[],targetTypes[]}], socketProfile, isFoundation, isPillar, snapRotation }
//
// Usage :
//   import { createEngine } from './planner_socket_engine.js';
//   const eng = createEngine(type => catalogMap.get(type));
//   const r = eng.snapPiece(cursorCm, type, placedList, eng.occSet(placedList));
//   // r = { pos:{x,y,z}, rotation } en cm, ou null
// ============================================================

// ---- Constantes du jeu (extraites de PieceManager) ----
export const W_C = {
  FOUNDATION_SIZE: 512, FLOOR_HEIGHT: 384, HALF_HEIGHT: 192, WALL_OFFSET: 256,
  WEDGE_APOTHEM: 147.80167, WEDGE_CIRCUMRADIUS: 295.60333, WEDGE_FACE_SNAP: 403.80167,
};
export const G  = W_C.FOUNDATION_SIZE * 0.8;                       // rayon de snap (409.6)
const V  = W_C.FOUNDATION_SIZE / 2;                                // 256
const ie = [{ x: V, y: V }, { x: -V, y: V }, { x: -V, y: -V }, { x: V, y: -V }];   // emprise carrée
const B  = [{ x: 256, y: 147.8 }, { x: -256, y: 147.8 }, { x: 0, y: -295.6 }];      // emprise wedge
const U  = 10;                                                     // tolérance overlap (SAT)

// ---- Helpers géométriques purs ----
export function j(x, y, deg) { const r = deg * Math.PI / 180;
  return { rx: x * Math.cos(r) + y * Math.sin(r), ry: -x * Math.sin(r) + y * Math.cos(r) }; }
export function M(p, lx, ly, lz) { const { rx, ry } = j(lx, ly, p.rotation);
  return { x: p.x + rx, y: p.y + ry, z: p.z + lz }; }
export function q(d) { return ((d % 360) + 540) % 360 - 180; }
export function K(a, b) { if (!a || !b || !a.length || !b.length) return false; const s = new Set(b); return a.some(e => s.has(e)); }
export const keyOf = (x, y, z) => `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

// Compatibilité de "cost" (socket posé b vs socket de la pièce en cours a).
const COST_OK = {
  Up:              new Set(['Down', 'Foundation_Edge', 'Up']),
  Down:            new Set(['Up', 'Foundation_Edge']),
  Sideways:        new Set(['Sideways']),
  Foundation_Edge: new Set(['Down', 'Up', 'Foundation_Edge']),
};
const costMatch = (a, b) => COST_OK[a]?.has(b) ?? false;
function typeMatch(a, b) {
  if (K(a.types, b.types)) return true;
  return K(a.targetTypes, b.types) && K(b.targetTypes, a.types);
}

/**
 * Crée un moteur lié à un catalogue.
 * @param {(type:string)=>object} getPiece  retourne la pièce (avec .sockets, .socketProfile, .isFoundation…)
 */
export function createEngine(getPiece) {
  const occHas = (occ, x, y, z) => occ.has(keyOf(x, y, z));
  function occSet(placed) { const s = new Set(); for (const p of placed) s.add(keyOf(p.x, p.y, p.z)); return s; }

  // emprise (corners monde) pour SAT
  function H(type, x, y, rot) {
    const prof = getPiece(type)?.socketProfile;
    const base = (prof === 'Foundation_Wedge' || prof === 'Floor_Wedge') ? B : ie;
    return base.map(c => { const { rx, ry } = j(c.x, c.y, rot); return { x: x + rx, y: y + ry }; });
  }
  // SAT : true = overlap, false = séparé
  function overlap(a, b) {
    for (const poly of [a, b]) for (let r = 0; r < poly.length; r++) {
      const i = (r + 1) % poly.length;
      const ax = -(poly[i].y - poly[r].y), ay = poly[i].x - poly[r].x;
      let s = Infinity, c = -Infinity; for (const t of a) { const e = t.x * ax + t.y * ay; if (e < s) s = e; if (e > c) c = e; }
      let l = Infinity, u = -Infinity; for (const t of b) { const e = t.x * ax + t.y * ay; if (e < l) l = e; if (e > u) u = e; }
      if (c <= l + U || u <= s + U) return false;
    }
    return true;
  }
  function isBig(type) {                       // pièce "grande/tuilable" (sol, fondation)
    const p = getPiece(type); if (!p) return false;
    if (p.sockets.some(k => k.cost === 'Down')) return false;
    return p.sockets.some(k => k.cost === 'Up' && k.types.includes('BP_DuneBuildingSocket_C') && (Math.abs(k.lx) > 1 || Math.abs(k.ly) > 1));
  }
  // collision d'emprise entre fondations / grandes pièces
  function footprintBlocked(type, x, y, z, rot, list) {
    if (!getPiece(type)?.isFoundation && !isBig(type)) return false;
    const o = H(type, x, y, rot);
    for (const e of list) {
      if (!getPiece(e.building_type)?.isFoundation && !isBig(e.building_type)) continue;
      if (Math.abs(e.z - z) > 10) continue;
      if (overlap(o, H(e.building_type, e.x, e.y, e.rotation))) return true;
    }
    return false;
  }

  // Matcher de sockets généralisé : chaque socket ACTIF vs chaque socket posé.
  //
  // Un socket est "actif" (peut initier une connexion) si :
  //   - cost ≠ 'No_Cost'
  //   - PAS (cost='Up' ET lx≈0 ET ly≈0) → sockets verticaux purs (lx=ly=0, sommet de
  //     triangle, dessus de mur…) = récepteurs PASSIFS. Les utiliser comme actifs crée
  //     des connexions pointe-à-pointe invalides. On les laisse au rôle de cible (b).
  //
  // Les sockets latéraux des demi-rampes/escaliers (lx/ly≠0, cost=Up) restent actifs,
  // ce qui corrige l'impossibilité de les poser à côté d'une fondation.
  const IS_PASSIVE = s => s.cost === 'Up' && Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1;

  // opts.zHint : hauteur cm attendue (étage courant) ; opts.zTol : tolérance.
  // Permet de ne s'accrocher qu'aux sockets proches de la hauteur de l'étage courant
  // (sinon depuis N1 on s'accroche aux fondations RDC au sol).
  function snapPiece(cur, type, list, occ, opts) {
    // Guard NaN : coordonnées invalides → pas de snap (évite que NaN>G=false ne passe tout)
    if (!cur || !isFinite(cur.x) || !isFinite(cur.y)) return null;
    const me = getPiece(type); if (!me || !me.sockets.length) return null;
    if (!occ) occ = occSet(list);
    const zHint = opts && opts.zHint, zTol = (opts && opts.zTol) != null ? opts.zTol : Infinity;
    const activeSockets = me.sockets.filter(s => s.cost !== 'No_Cost' && !IS_PASSIVE(s));
    if (!activeSockets.length) return null;
    let best = null;
    for (const a of activeSockets) {
      for (const it of list) {
        const other = getPiece(it.building_type); if (!other) continue;
        for (const b of other.sockets) {
          if (b.cost === 'No_Cost') continue;
          if (!costMatch(a.cost, b.cost)) continue;
          // Connexions latérales (mur↔mur) : exiger la même hauteur locale, sinon
          // un mur peut s'accrocher de travers (ex: socket lz=192 sur lz=384).
          if (a.cost === 'Sideways' && b.cost === 'Sideways' && Math.abs(a.lz - b.lz) > 1) continue;
          if (!typeMatch(a, b)) continue;
          const wp = M(it, b.lx, b.ly, b.lz);
          const rot = q(a.yawDeg - b.yawDeg + it.rotation - 180);
          const { rx, ry } = j(a.lx, a.ly, rot);
          const fx = wp.x - rx, fy = wp.y - ry, fz = wp.z - a.lz;
          if (zHint != null && Math.abs(fz - zHint) > zTol) continue;   // filtre hauteur étage
          if (occHas(occ, fx, fy, fz)) continue;
          if (footprintBlocked(type, fx, fy, fz, rot, list)) continue;
          const dWp = Math.hypot(cur.x - wp.x, cur.y - wp.y);
          const dOr = Math.hypot(cur.x - fx, cur.y - fy);
          const metric = Math.min(dWp, dOr);
          if (metric > G) continue;
          const score = metric * 1000 + dOr;
          if (!best || score < best.score) best = { score, pos: { x: fx, y: fy, z: fz }, rotation: rot };
        }
      }
    }
    return best ? { pos: best.pos, rotation: best.rotation } : null;
  }

  // Snap grille pur (fallback quand aucun socket compatible).
  // Décalage d'une DEMI-fondation : les pièces sont centrées sur leur origine, donc
  // pour qu'une fondation REMPLISSE une case (et non chevauche 4 cases au croisement),
  // son centre doit tomber au centre d'une case → n×512 + 256.
  const HALF_F = W_C.FOUNDATION_SIZE / 2;
  function gridSnap(x, y, z) {
    return {
      x: Math.round((x - HALF_F) / W_C.FOUNDATION_SIZE) * W_C.FOUNDATION_SIZE + HALF_F,
      y: Math.round((y - HALF_F) / W_C.FOUNDATION_SIZE) * W_C.FOUNDATION_SIZE + HALF_F,
      z: Math.round(z / W_C.FLOOR_HEIGHT) * W_C.FLOOR_HEIGHT,
    };
  }

  return { snapPiece, gridSnap, occSet, isBig };
}
