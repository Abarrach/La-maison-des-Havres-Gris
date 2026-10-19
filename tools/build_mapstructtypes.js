#!/usr/bin/env node
'use strict';
/**
 * build_mapstructtypes.js — Régénère `mapstructtypes.json` à partir d'un `.usmap`.
 *
 * ── Pourquoi ce fichier existe ──────────────────────────────────────────────
 * Un `.usmap` décrit les propriétés du jeu, mais pour une `TMap` il ne dit PAS quel
 * type de struct vit dans la clé et dans la valeur. Sans cette information, FModel et
 * CUE4Parse sortent des maps VIDES — et c'est ce qui nous a fait conclure à tort,
 * pendant des semaines, que les recettes de craft étaient « server-side ». Elles sont
 * dans le client ; il manquait juste la table des types.
 *
 * Cette table nous avait été donnée par Adain (dune.gaming.tools) en juin 2026, et
 * c'était notre dernière dépendance à quelqu'un d'extérieur : un nouveau `.usmap`
 * sans table à jour, et les nouvelles `TMap` redeviennent vides. Ce script la
 * reconstruit, donc la dépendance disparaît.
 *
 * ── Ce qu'il lit, ce qu'il écrit ────────────────────────────────────────────
 * Entrée : un `.usmap` (format Unreal mappings, magic 0x30C4). Lecture seule.
 * Sortie : `tools/mapstructtypes.json`, même forme que le fichier d'Adain —
 *          { "<nom de propriété>": { "Key": "<type ou null>", "Value": "<type ou null>" } }
 *
 * ⚠ Ce script ne touche NI au jeu, NI à aucun processus : il décompresse un fichier et
 * lit des octets. Il est sans risque même jeu lancé.
 *
 * ── Limite assumée du format ────────────────────────────────────────────────
 * La table est indexée par le seul NOM de propriété, alors qu'un même nom peut porter
 * des types différents selon la classe (`Map`, `m_Groups`, `DeviceOverrideData`…).
 * C'est une limite du format lui-même, pas du script : le fichier d'Adain a exactement
 * le même défaut. On tranche donc ainsi, dans l'ordre :
 *   1. le choix déjà fait dans le fichier de base (--base), pour rester stable ;
 *   2. sinon le type le plus fréquent dans le .usmap.
 * Les noms ambigus sont listés en fin d'exécution : c'est une information, pas une erreur.
 *
 * Usage :
 *   node tools/build_mapstructtypes.js <fichier.usmap> [--out=<sortie.json>]
 *                                      [--base=<ancien.json>] [--quiet]
 *   (sans argument : prend le .usmap configuré dans FModel)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const valOf = (n) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const QUIET = args.includes('--quiet');

// ── Format .usmap ───────────────────────────────────────────────────────────
const MAGIC = 0x30C4;
// Versions du format, dans l'ordre (cf. EUsmapVersion de CUE4Parse). Le jeu est en 4 :
// EXPLICIT_ENUM_VALUES, qui fait passer chaque entrée d'enum de 4 à 12 octets — c'est
// exactement ce qui faisait dérailler le décodage quand on supposait l'ancien format.
const V = { INITIAL: 0, PACKAGE_VERSIONING: 1, LONG_FNAME: 2, LARGE_ENUMS: 3, EXPLICIT_ENUM_VALUES: 4 };
// Ordre exact de EPropertyType (CUE4Parse / UnrealMappingsDumper) : l'indice EST la valeur
// sérialisée, donc toute insertion dans cette liste décalerait tout le décodage.
const TYPES = [
  'ByteProperty', 'BoolProperty', 'IntProperty', 'FloatProperty', 'ObjectProperty', 'NameProperty',
  'DelegateProperty', 'DoubleProperty', 'ArrayProperty', 'StructProperty', 'StrProperty',
  'TextProperty', 'InterfaceProperty', 'MulticastDelegateProperty', 'WeakObjectProperty',
  'LazyObjectProperty', 'AssetObjectProperty', 'SoftObjectProperty', 'UInt64Property',
  'UInt32Property', 'UInt16Property', 'Int64Property', 'Int16Property', 'Int8Property',
  'MapProperty', 'SetProperty', 'EnumProperty', 'FieldPathProperty', 'OptionalProperty',
  'Utf8StrProperty', 'AnsiStrProperty', 'ClassProperty', 'MulticastInlineDelegateProperty',
];

/** Petit lecteur séquentiel : le format est entièrement positionnel, pas de garde-fou interne. */
class Lecteur {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  str(long) { const n = long ? this.u16() : this.u8(); const s = this.b.toString('utf8', this.o, this.o + n); this.o += n; return s; }
  get reste() { return this.b.length - this.o; }
}

function decompresser(methode, charge, tailleAttendue) {
  switch (methode) {
    case 0: return charge;                                   // aucune
    case 2: return zlib.brotliDecompressSync(charge);
    case 3: return zlib.zstdDecompressSync(charge);          // Node ≥ 22.15
    case 1: throw new Error('usmap compressé en Oodle : non supporté (ni Node ni zlib ne le décodent). '
      + 'Re-dumper sans compression, ou passer par FModel.');
    default: throw new Error('méthode de compression inconnue : ' + methode);
  }
}

function lireUsmap(fichier) {
  const brut = fs.readFileSync(fichier);
  const l = new Lecteur(brut);
  const magic = l.u16();
  if (magic !== MAGIC) throw new Error(`ce n'est pas un .usmap (magic 0x${magic.toString(16)} au lieu de 0x30c4)`);
  const version = l.u8();
  if (version >= V.PACKAGE_VERSIONING) {
    const versionne = l.i32();
    // En-tête de versionnage optionnel. On ne l'exploite pas : on le SAUTE proprement
    // plutôt que de le deviner, sinon tout le reste du décodage glisse d'un octet.
    if (versionne) {
      l.i32(); l.i32();                       // FPackageFileVersion (UE4 + UE5)
      const nbCustom = l.i32();
      l.o += nbCustom * 20;                   // { FGuid (16 o), int32 version }
      l.u32();                                // version licensee
    }
  }
  const methode = l.u8();
  const tailleCompressee = l.u32();
  const tailleDecompressee = l.u32();
  const corps = decompresser(methode, brut.subarray(l.o, l.o + tailleCompressee), tailleDecompressee);

  const c = new Lecteur(corps);
  const longNoms = version >= V.LONG_FNAME;
  const noms = new Array(c.u32());
  for (let i = 0; i < noms.length; i++) noms[i] = c.str(longNoms);
  const nom = (i) => (i >= 0 && i < noms.length ? noms[i] : null);

  // On ne garde rien des enums (seuls leurs NOMS nous intéressent, et ils arrivent par
  // les propriétés) : on les traverse juste pour arriver à la section des structs.
  const nbEnums = c.u32();
  for (let i = 0; i < nbEnums; i++) {
    c.i32();                                                   // nom de l'enum
    const n = version >= V.LARGE_ENUMS ? c.u16() : c.u8();     // nombre d'entrées
    for (let j = 0; j < n; j++) {
      if (version >= V.EXPLICIT_ENUM_VALUES) c.o += 8;         // valeur numérique (u64)
      c.i32();                                                 // nom de l'entrée
    }
  }

  /** Décode une propriété, récursivement (une TMap contient deux sous-propriétés). */
  const lirePropriete = () => {
    const t = TYPES[c.u8()];
    switch (t) {
      case 'EnumProperty': { const inner = lirePropriete(); return { t, inner, nom: nom(c.i32()) }; }
      case 'StructProperty': return { t, nom: nom(c.i32()) };
      case 'SetProperty': case 'ArrayProperty': case 'OptionalProperty':
        return { t, inner: lirePropriete() };
      case 'MapProperty': { const k = lirePropriete(); const v = lirePropriete(); return { t, k, v }; }
      default: return { t };
    }
  };

  const maps = [];   // { propriete, cle, valeur, struct }
  const nbStructs = c.u32();
  for (let i = 0; i < nbStructs; i++) {
    const nomStruct = nom(c.i32());
    c.i32();                       // super
    c.u16();                       // nombre total de propriétés
    const nbSerialisees = c.u16();
    for (let j = 0; j < nbSerialisees; j++) {
      c.u16();                     // index de schéma
      c.u8();                      // dimension du tableau
      const nomProp = nom(c.i32());
      const p = lirePropriete();
      if (p.t === 'MapProperty') maps.push({ propriete: nomProp, cle: typeNomme(p.k), valeur: typeNomme(p.v), struct: nomStruct });
    }
  }
  return { version, methode, noms: noms.length, enums: nbEnums, structs: nbStructs, maps };
}

/** Seuls un enum ou une struct ont un NOM exploitable ; le reste n'en a pas besoin. */
function typeNomme(p) {
  if (!p) return null;
  if (p.t === 'EnumProperty') return p.nom || null;
  if (p.t === 'StructProperty') return p.nom || null;
  return null;
}

// ── Construction de la table ────────────────────────────────────────────────
function construire(maps, base) {
  const parNom = new Map();      // propriété → Map("Key|Value" → occurrences)
  for (const m of maps) {
    if (!m.propriete) continue;
    if (!m.cle && !m.valeur) continue;        // aucune info à apporter : on n'encombre pas
    const clef = JSON.stringify({ Key: m.cle, Value: m.valeur });
    const variantes = parNom.get(m.propriete) || new Map();
    variantes.set(clef, (variantes.get(clef) || 0) + 1);
    parNom.set(m.propriete, variantes);
  }

  const sortie = {}, ambigus = [];
  for (const [prop, variantes] of parNom) {
    const triees = [...variantes.entries()].sort((a, b) => b[1] - a[1]);
    let retenue = triees[0][0];
    if (triees.length > 1) {
      // Stabilité d'abord : si le fichier de base avait déjà tranché, on garde SON choix,
      // sinon le fichier changerait au gré des recompilations du jeu sans raison réelle.
      const choixBase = base && base[prop] ? JSON.stringify({ Key: base[prop].Key ?? null, Value: base[prop].Value ?? null }) : null;
      if (choixBase && variantes.has(choixBase)) retenue = choixBase;
      ambigus.push({ prop, variantes: triees.length, suivi: choixBase === retenue ? 'base' : 'le plus fréquent' });
    }
    sortie[prop] = JSON.parse(retenue);
  }

  // Entrées de l'ancien fichier absentes du nouveau .usmap : on les CONSERVE.
  // Elles ne gênent pas la lecture des fichiers récents (une propriété inconnue est
  // ignorée) et elles restent utiles pour relire un vieil export.
  const heritees = [];
  if (base) for (const [k, v] of Object.entries(base)) if (!(k in sortie)) { sortie[k] = v; heritees.push(k); }

  const ordonnee = {};
  for (const k of Object.keys(sortie).sort((a, b) => a.localeCompare(b, 'en'))) ordonnee[k] = sortie[k];
  return { table: ordonnee, ambigus, heritees };
}

// ── Découverte du .usmap par défaut (réglages FModel) ───────────────────────
function usmapDeFModel() {
  const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData/Roaming');
  try {
    const s = JSON.parse(fs.readFileSync(path.join(appdata, 'FModel', 'AppSettings.json'), 'utf8'));
    const e = Object.entries(s.PerDirectory || {}).find(([k]) => /dune/i.test(k));
    const chemins = ((e && e[1].Endpoints) || []).map(x => x && x.FilePath).filter(Boolean);
    return chemins.length ? chemins[chemins.length - 1] : null;
  } catch (err) { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────────
const entree = args.find(a => !a.startsWith('--')) || usmapDeFModel();
if (!entree || !fs.existsSync(entree)) {
  console.error('Usage : node tools/build_mapstructtypes.js <fichier.usmap> [--out=…] [--base=…]');
  console.error(entree ? `Introuvable : ${entree}` : 'Aucun .usmap trouvé (ni en argument, ni dans les réglages FModel).');
  process.exit(1);
}
const sortieFichier = valOf('out') || path.join(__dirname, 'mapstructtypes.json');
const baseFichier = valOf('base') || (fs.existsSync(sortieFichier) ? sortieFichier : null);
let base = null;
if (baseFichier) { try { base = JSON.parse(fs.readFileSync(baseFichier, 'utf8')); } catch (e) { base = null; } }

const u = lireUsmap(entree);
const { table, ambigus, heritees } = construire(u.maps, base);

const nouvelles = base ? Object.keys(table).filter(k => !(k in base)) : [];
const modifiees = base ? Object.keys(table).filter(k => k in base
  && JSON.stringify(table[k]) !== JSON.stringify({ Key: base[k].Key ?? null, Value: base[k].Value ?? null })) : [];

fs.writeFileSync(sortieFichier, JSON.stringify(table, null, 2) + '\n');

if (!QUIET) {
  console.log(`usmap  : ${entree}`);
  console.log(`         version ${u.version}, compression ${['aucune', 'Oodle', 'Brotli', 'ZStandard'][u.methode]}`);
  console.log(`         ${u.noms} noms · ${u.enums} enums · ${u.structs} structs · ${u.maps.length} TMap rencontrées`);
  console.log(`sortie : ${sortieFichier}`);
  console.log(`         ${Object.keys(table).length} entrées`
    + (base ? ` (base : ${Object.keys(base).length}, +${nouvelles.length} nouvelles, ~${modifiees.length} modifiées, ${heritees.length} héritées)` : ''));
  if (nouvelles.length) console.log('  nouvelles : ' + nouvelles.slice(0, 10).join(', ') + (nouvelles.length > 10 ? `, … (+${nouvelles.length - 10})` : ''));
  if (modifiees.length) console.log('  modifiées : ' + modifiees.slice(0, 10).join(', ') + (modifiees.length > 10 ? `, … (+${modifiees.length - 10})` : ''));
  if (ambigus.length) console.log(`  ${ambigus.length} noms ambigus (limite du format, pas une erreur) : `
    + ambigus.slice(0, 8).map(a => a.prop).join(', ') + (ambigus.length > 8 ? `, …` : ''));
  console.log('\nÀ charger dans FModel : Settings → Advanced → MapStructTypes → ce fichier,');
  console.log('en même temps que le .usmap correspondant dans Mapping. Les deux vont ensemble.');
}
