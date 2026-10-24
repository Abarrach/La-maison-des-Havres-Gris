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

  // ── Textures des couches (2026-10-24) ─────────────────────────────────────────
  // Toutes les pièces puisent dans la même bibliothèque d'une centaine de textures (béton,
  // métaux, bronze…) : une seule texture-tableau 256 px, chargée une fois. Chaque sommet porte
  // le n° de sa couche dans l'alpha de COLOR_0 (local à la primitive, table dans les extras) et
  // ses coordonnées de couche dans TEXCOORD_0. Sans couches.json : couleurs moyennes.
  const TAILLE_COUCHE = 256;
  let couchesP = null;
  function chargerCouches() {
    if (couchesP) return couchesP;
    couchesP = fetch(modelsBase + 'couches.json').then(r => r.ok ? r.json() : null).then(async liste => {
      const noms = (liste && liste.textures) || [];
      if (!noms.length) return null;
      const n = noms.length, data = new Uint8Array(TAILLE_COUCHE * TAILLE_COUCHE * 4 * n);
      const toile = document.createElement('canvas');
      toile.width = toile.height = TAILLE_COUCHE;
      const ctx = toile.getContext('2d', { willReadFrequently: true });
      const index = new Map();
      await Promise.all(noms.map((nom, i) => new Promise(res => {
        const img = new Image();
        img.onload = () => {
          // Séquentiel sur la toile : chaque image est dessinée puis lue dans la même tâche.
          ctx.clearRect(0, 0, TAILLE_COUCHE, TAILLE_COUCHE);
          ctx.drawImage(img, 0, 0, TAILLE_COUCHE, TAILLE_COUCHE);      // 64/128 px agrandies
          data.set(ctx.getImageData(0, 0, TAILLE_COUCHE, TAILLE_COUCHE).data, i * TAILLE_COUCHE * TAILLE_COUCHE * 4);
          index.set(nom, i);
          res();
        };
        img.onerror = () => res();
        img.src = modelsBase + 'couches/' + nom + '.jpg';
      })));
      if (!index.size) return null;
      const tex = new THREE.DataArrayTexture(data, TAILLE_COUCHE, TAILLE_COUCHE, n);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      tex.colorSpace = THREE.NoColorSpace;     // sRGB décodé dans le shader
      tex.needsUpdate = true;
      return { tex, index };
    }).catch(() => null);
    return couchesP;
  }
  let couches = null;                           // { tex, index } une fois chargées

  // Prépare une géométrie à couches : le n° de couche part dans son propre attribut, et la
  // couleur moyenne retrouve un alpha plein (sinon l'estompage des étages, qui rend les
  // matériaux transparents, multiplierait l'opacité par n°/255).
  function preparerCouches(geo) {
    if (!geo.userData.couches || geo.attributes.couleurCouche || !geo.attributes.color) return;
    const src = geo.attributes.color;
    geo.setAttribute('couleurCouche', src);
    const plein = new THREE.BufferAttribute(new Uint8Array(src.array), src.itemSize, src.normalized);
    for (let i = 3; i < plein.array.length; i += 4) plein.array[i] = 255;
    geo.setAttribute('color', plein);
    if (geo.attributes.uv) geo.setAttribute('uvCouche', geo.attributes.uv);
  }

  function loadModel(basename) {
    if (!basename) return Promise.resolve(null);
    if (cache.has(basename)) return cache.get(basename);
    const modele = new Promise(res => loader.load(
      modelsBase + basename + '.glb',
      g => {
        // Modèle coloré par tools/build_colored_models.js (ou le tank) : couleurs de sommets
        // à afficher telles quelles. Les anciens modèles ont aussi un COLOR_0 (celui du jeu,
        // sans rapport avec la couleur) : c'est le générateur qui fait foi, pas l'attribut.
        g.scene.userData.couleurs = /^DuneMap/.test((g.asset && g.asset.generator) || '');
        if (g.scene.userData.couleurs) g.scene.traverse(o => { if (o.isMesh) preparerCouches(o.geometry); });
        res(g.scene);
      },
      undefined,
      () => res(null)));
    // Les textures arrivent avec le premier modèle : les pièces naissent texturées.
    const p = Promise.all([modele, chargerCouches()]).then(([scene, c]) => { if (c) couches = c; return scene; });
    cache.set(basename, p);
    return p;
  }

  function clayMaterial(color, opacity) {
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity,
    });
  }
  // Matériaux PARTAGÉS des modèles colorés (la couleur est dans les sommets), un par opacité :
  // l'estompage des étages inférieurs ne doit pas estomper toutes les pièces colorées.
  const materiauxCouleurs = new Map();
  function materiauCouleurs(opacity) {
    if (!materiauxCouleurs.has(opacity)) materiauxCouleurs.set(opacity, new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.1, roughness: 0.85, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity }));
    return materiauxCouleurs.get(opacity);
  }
  // Matériau texturé d'une primitive : sa table de couches (texture + teinte) en uniforms,
  // partagé par toutes les copies de la pièce (rangé sur la géométrie, qui l'est aussi).
  const MAX_COUCHES = 16;
  function materiauCouches(geo, opacity) {
    const mats = geo.userData.materiaux || (geo.userData.materiaux = new Map());
    if (mats.has(opacity)) return mats.get(opacity);
    const texs = new Float32Array(MAX_COUCHES).fill(-1), teintes = [];
    geo.userData.couches.forEach((c, i) => {
      if (i >= MAX_COUCHES) return;
      texs[i] = c.t && couches.index.has(c.t) ? couches.index.get(c.t) : -1;
    });
    for (let i = 0; i < MAX_COUCHES; i++) {
      const c = geo.userData.couches[i];
      teintes.push(new THREE.Vector3(...((c && c.c) || [1, 1, 1])));
    }
    const m = new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.85, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity });
    m.onBeforeCompile = sh => {
      sh.uniforms.uCouches = { value: couches.tex };
      sh.uniforms.uTexCouche = { value: texs };
      sh.uniforms.uTeinte = { value: teintes };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 uvCouche;
attribute vec4 couleurCouche;
uniform float uTexCouche[${MAX_COUCHES}];
uniform vec3 uTeinte[${MAX_COUCHES}];
varying vec2 vUvCouche;
flat varying float vTexCouche;
varying vec3 vTeinteCouche;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
int nc = int(couleurCouche.a * 255.0 + 0.5);
vUvCouche = uvCouche;
vTexCouche = -1.0;
vTeinteCouche = couleurCouche.rgb;              // pas de couche : couleur moyenne/unie
if (nc < ${MAX_COUCHES}) {
  vTexCouche = uTexCouche[nc];
  if (vTexCouche >= 0.0) vTeinteCouche = uTeinte[nc];
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uCouches;
varying vec2 vUvCouche;
flat varying float vTexCouche;
varying vec3 vTeinteCouche;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 couleurCouche = vTeinteCouche;
if (vTexCouche >= 0.0) {
  vec3 s = texture(uCouches, vec3(vUvCouche, vTexCouche)).rgb;
  s = mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(0.04045, s));   // sRGB → linéaire
  couleurCouche *= s;
}
diffuseColor.rgb *= couleurCouche;`);
    };
    m.customProgramCacheKey = () => 'couches_' + MAX_COUCHES;
    mats.set(opacity, m);
    return m;
  }
  // Couleurs propres de la pièce : textures des couches si elles sont chargées, sinon couleur
  // moyenne par sommet. (Nom historique : appelé partout où la pièce quitte l'argile.)
  function couleursDesSommets(obj, opacity = 1) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.material = (couches && o.geometry.userData.couches && o.geometry.attributes.uvCouche)
        ? materiauCouches(o.geometry, opacity) : materiauCouleurs(opacity);
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
        // Véhicules : leur modèle n'est pas centré sur son origine (ornis décalés de 2 à 8 m
        // vers l'arrière) alors que l'emprise l'est → on recentre (centre en mètres, mesuré
        // par tools/build_planner_pieces.js). Enfant du groupe : suit la rotation de la pièce.
        if (piece.mesh_center_m) {
          m.position.x -= piece.mesh_center_m.x * 100 * SCALE;
          m.position.y -= (piece.mesh_center_m.y || 0) * 100 * SCALE;   // point le plus bas au sol
          m.position.z -= piece.mesh_center_m.z * 100 * SCALE;
        }
        // Pièce posée → argile clair ; ghost → couleur demandée (doré/vert/rouge).
        // Si une teinte de stabilité est active sur le groupe, elle prime (sinon le
        // swap async écraserait le vert/jaune/rouge par l'argile).
        const body = (g.userData.stabilityTint != null) ? g.userData.stabilityTint
                   : (opacity < 1 ? color : 0xcfc6b4);
        // Modèle coloré (tank recomposé) : ses couleurs de sommets, sauf en fantôme ou en vue
        // stabilité, où la teinte porte l'information.
        // Retenu sur le groupe : la vue stabilité doit savoir rendre ses couleurs à la pièce.
        g.userData.couleurs = !!(scene.userData.couleurs || piece.mesh_colors) && opacity === 1;
        if (g.userData.couleurs && g.userData.stabilityTint == null) couleursDesSommets(m);
        else tint(m, body, opacity);
        // Ombres portées et reçues : c'est ce qui donne le relief (murs sur le sol, débords).
        // Pas pour le fantôme : une pièce pas encore posée ne doit pas assombrir le plan.
        if (opacity === 1) m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.add(m);
      });
    }
    return g;
  }

  return {
    buildObject, loadModel, pieceBox, clayMaterial, couleursDesSommets,
    setUseReal(v) { useReal = v; },
    get SCALE() { return SCALE; },
  };
}
