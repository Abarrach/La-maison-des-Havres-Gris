'use strict';
// ============================================================
// planner_mesh.js — Rendu d'une pièce en Three.js : vrai mesh .glb (matériau "argile")
// avec fallback boîte dérivée des sockets. Réutilisable par le proto et base_planner.
//
// Les meshes FModel sont déjà en MÈTRES, Y-up, même repère que nos sockets
// (UE.x→x, UE.z→y, UE.y→z) → scale 1.0, aucune rotation.
// Les boîtes fallback sont construites en cm × SCALE pour coexister dans le même groupe.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MESH_TUNE = { scale: 1.0, rotX: 0, rotY: 0, rotZ: 0 };

// Boîte englobante (cm) dérivée des sockets, avec épaisseurs minimales.
export function pieceBox(sockets) {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const k of (sockets || [])) {
    mnx = Math.min(mnx, k.lx); mxx = Math.max(mxx, k.lx);
    mny = Math.min(mny, k.ly); mxy = Math.max(mxy, k.ly);
    mnz = Math.min(mnz, k.lz); mxz = Math.max(mxz, k.lz);
  }
  if (!isFinite(mnx)) { mnx = mny = mnz = -128; mxx = mxy = mxz = 128; }
  if (mnz < 0) mnz = 0;
  const ex = Math.max(mxx - mnx, 40), ey = Math.max(mxy - mny, 40), ez = Math.max(mxz - mnz, 30);
  return { ex, ey, ez, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, cz: (mnz + mxz) / 2 };
}

/**
 * Fabrique de meshes liée à un catalogue.
 * @param {object} opts
 * @param {(type:string)=>object} opts.getPiece  pièce (avec .sockets, .mesh)
 * @param {string} [opts.modelsBase='models/']   préfixe d'URL des .glb
 * @param {number} [opts.scale=0.01]             cm→unités monde (pour les boîtes fallback)
 */
export function createMeshFactory({ getPiece, modelsBase = 'models/', scale = 0.01 }) {
  const SCALE = scale;
  const loader = new GLTFLoader();
  const cache = new Map();                       // basename -> Promise<Object3D|null>
  let useReal = true;

  function loadModel(basename) {
    if (!basename) return Promise.resolve(null);
    if (cache.has(basename)) return cache.get(basename);
    const p = new Promise(res => loader.load(
      modelsBase + basename + '.glb',
      g => res(g.scene),
      undefined,
      () => res(null)));
    cache.set(basename, p);
    return p;
  }

  function clayMaterial(color, opacity) {
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity,
    });
  }
  function tint(obj, color, opacity) {
    obj.traverse(o => { if (o.isMesh) o.material = clayMaterial(color, opacity); });
  }

  // Boîte fallback (visible immédiatement)
  function makeBox(piece, color, opacity) {
    const { ex, ey, ez, cx, cy, cz } = pieceBox(piece.sockets);
    const geo = new THREE.BoxGeometry(ex * SCALE, ez * SCALE, ey * SCALE);
    const mat = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, metalness: 0.1, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx * SCALE, cz * SCALE, cy * SCALE);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: opacity < 1 ? 0.4 : 0.22 }));
    edges.position.copy(mesh.position);
    const g = new THREE.Group(); g.add(mesh); g.add(edges);
    return g;
  }

  /**
   * Construit l'objet d'une pièce : boîte immédiate, remplacée async par le vrai mesh.
   * @param {string} type  templateId
   * @param {object} opts  { color, opacity, role }  role='ghost'|'placed'
   * @returns {THREE.Group}
   */
  function buildObject(type, { color = 0xcfc6b4, opacity = 1 } = {}) {
    const piece = getPiece(type);
    const g = makeBox(piece || { sockets: [] }, color, opacity);
    if (useReal && piece && piece.mesh) {
      loadModel(piece.mesh).then(scene => {
        if (!scene || g.userData.swapped || g.userData.disposed) return;
        g.userData.swapped = true;
        while (g.children.length) g.remove(g.children[0]);
        const m = scene.clone(true);
        // Le mesh FModel est en MÈTRES ; le monde est en cm×SCALE.
        // 1 m = 100 cm = 100×SCALE unités monde → échelle mesh = 100×SCALE.
        m.scale.setScalar(100 * SCALE * MESH_TUNE.scale);
        m.rotation.set(MESH_TUNE.rotX, MESH_TUNE.rotY, MESH_TUNE.rotZ);
        // Pièce posée → argile clair ; ghost → couleur demandée (doré/vert/rouge).
        tint(m, opacity < 1 ? color : 0xcfc6b4, opacity);
        g.add(m);
      });
    }
    return g;
  }

  return {
    buildObject, loadModel, pieceBox, clayMaterial,
    setUseReal(v) { useReal = v; },
    get SCALE() { return SCALE; },
  };
}
