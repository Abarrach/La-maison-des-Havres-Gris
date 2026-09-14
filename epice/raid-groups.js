// Répartition des rôles tactiques en groupes de quatre, sans doublon ni joueur perdu.
(function (root) {
  'use strict';
  const directions = ['nord', 'sud', 'est', 'ouest'];
  const name = v => typeof v === 'string' ? v.trim() : '';
  const key = v => name(v).toLocaleLowerCase('fr');
  const named = a => (a || []).map(p => name(p.nom)).filter(Boolean);
  function patrol(c) { return named(c.distance && c.distance.pilotes); }
  function assaults(c) {
    return (c.defense || []).flatMap(s => directions.filter(k => s[k] && s[k].assaut && name(s[k].nom)).map(k => name(s[k].nom)));
  }
  function issues(c, includeGroups) {
    const warnings = [], seen = new Set();
    function check(n) {
      if (!name(n)) return;
      if (seen.has(key(n))) warnings.push(name(n) + ' occupe plusieurs rôles tactiques.');
      seen.add(key(n));
    }
    (c.recolte || []).forEach(r => [r.transporteur, r.moissonneur, r.defenseur_cac].forEach(check));
    (c.defense || []).forEach(s => {
      directions.forEach(k => { if (s[k]) { check(s[k].nom); check(s[k].passager); } });
      named(s.assauts).forEach(n => { if (!seen.has(key(n))) check(n); }); // anciens rôles conservés
    });
    patrol(c).forEach(check);
    named(c.recon && c.recon.scouts).forEach(check);
    const b = c.base_avancee || {};
    if (b.active) {
      [b.constructeur, b.buggy].forEach(check);
      if (!name(b.constructeur) || !name(b.buggy)) warnings.push('Base avancée : affecter un constructeur/pilote et un second pilote de buggy.');
      if (!b.sous_fief) warnings.push('Base avancée : confirmer le sous-fief disponible du constructeur.');
      const partners = (b.patrouilleurs || []).map(name).filter(Boolean);
      const available = new Set(patrol(c).map(key));
      if (partners.length !== 2 || new Set(partners.map(key)).size !== 2 || partners.some(n => !available.has(key(n)))) warnings.push('Base avancée : choisir deux patrouilleurs distincts dans la patrouille.');
      const team = [b.constructeur, b.buggy, ...partners].map(key);
      if (!name(c.commandement && c.commandement.cb) || !team.includes(key(c.commandement.cb))) warnings.push('Chef de base : désigner un membre du groupe Base avancée.');
    }
    if (!assaults(c).length) warnings.push('Défense rapprochée : marquer au moins un défenseur cardinal Assaut.');
    if (!named(c.recon && c.recon.scouts).length) warnings.push('Récolte : affecter un scout pour le groupe du transporteur.');
    if (includeGroups) {
      const grouped = new Set();
      (c.ingame || []).forEach(g => {
        const members = (g.membres || []).map(name).filter(Boolean);
        if (members.length > 4) warnings.push('Un groupe en jeu dépasse quatre joueurs.');
        members.forEach(n => {
          if (grouped.has(key(n))) warnings.push(n + ' apparaît dans plusieurs groupes en jeu.');
          grouped.add(key(n));
        });
      });
      seen.forEach(n => { if (!grouped.has(n)) warnings.push('Joueur affecté sans groupe en jeu : ' + n + '.'); });
      function together(values) {
        const wanted = values.map(key).filter(Boolean);
        return wanted.length === 4 && (c.ingame || []).some(g => wanted.every(n => (g.membres || []).some(m => key(m) === n)));
      }
      if (b.active && !together([b.constructeur,b.buggy,...(b.patrouilleurs || [])])) warnings.push('Groupe Base avancée : réunir les deux buggys et les deux patrouilleurs choisis.');
      const first = (c.recolte || [])[0];
      if (first && !((c.ingame || []).some(g => {
        const names = (g.membres || []).map(key);
        return names.includes(key(first.transporteur)) && names.includes(key(first.moissonneur)) && assaults(c).some(n => names.includes(key(n))) && named(c.recon && c.recon.scouts).some(n => names.includes(key(n)));
      }))) warnings.push('Groupe Récolte : réunir transporteur, moissonneur, scout et assaut cardinal.');
    }
    return [...new Set(warnings)];
  }
  function build(c) {
    const groups = [], used = new Set();
    function add(label, values) {
      const fresh = [];
      values.map(name).filter(Boolean).forEach(n => {
        if (!used.has(key(n))) { used.add(key(n)); fresh.push(n); }
      });
      for (let i = 0; i < fresh.length; i += 4) groups.push({label: label + (fresh.length > 4 ? ' — ' + (1 + i / 4) : ''), membres:fresh.slice(i, i + 4)});
    }
    const assauts = assaults(c), scouts = named(c.recon && c.recon.scouts);
    (c.recolte || []).forEach((r, i) => {
      const escort = assauts.find(n => !used.has(key(n)));
      const scout = scouts.find(n => !used.has(key(n)));
      add('Récolte' + (c.recolte.length > 1 ? ' — ' + (i + 1) : '') + ' · transporteur, moissonneur, scout, assaut', [r.transporteur, r.moissonneur, scout, escort]);
    });
    const b = c.base_avancee || {};
    if (b.active) add('Base avancée · 2 buggys + 2 patrouilleurs', [b.constructeur, b.buggy, ...(b.patrouilleurs || [])]);
    (c.defense || []).forEach((s, i) => add('Défense rapprochée' + (c.defense.length > 1 ? ' — ' + (i + 1) : ''), directions.map(k => s[k] && s[k].nom)));
    add('Patrouille', patrol(c));
    add('Repérage — scouts supplémentaires', scouts);
    // Ne jamais supprimer les participants historiques lors d'un nouveau préremplissage.
    add('Renforts — anciens rôles', (c.recolte || []).map(r => r.defenseur_cac).concat((c.defense || []).flatMap(s => named(s.assauts))));
    return groups;
  }
  const baseSop = `<div class="sop-section" data-sop-block="base-avancee">
    <div class="sop-section-title">🏗️ Base avancée — génie, stockage et appui lourd</div>
    <div class="info-box"><strong>Dispositif optionnel, sous la conduite du Chef de base (CB).</strong>
    <ul>
      <li><strong>Deux équipiers :</strong> un constructeur également pilote de buggy, avec un sous-fief disponible, et un second pilote de buggy. Deux buggys équipés de roquettes sont à fournir.</li>
      <li><strong>Groupe en jeu :</strong> les deux équipiers de base et deux patrouilleurs. Ceux-ci conservent leur mission aérienne ; leur aide est essentielle pour éloigner les ornis ennemis de la récolte et les attirer vers l'appui des buggys à l'avant-poste, en coordination avec les chefs de groupe.</li>
      <li><strong>Déploiement :</strong> repérer un îlot rocheux proche du champ, construire le point d'appui et préparer les buggys. Le constructeur assure aussi le démontage à la fin de l'opération.</li>
      <li><strong>Récolte :</strong> sécuriser un stock intermédiaire pour enchaîner les cycles, puis rapatrier l'épice sous escorte vers la base principale.</li>
      <li><strong>En cas d'attaque :</strong> la base sert de point d'appui au combat pour casser la poursuite et couvrir le décrochage. Les destinations de stockage et de repli sont précisées au briefing ; si le transporteur ne peut plus charger, l'évacuation individuelle de l'épice dans les assauts est le plan de secours.</li>
      <li><strong>Protection du transporteur :</strong> l'assaut est l'un des quatre défenseurs cardinaux. Il reste groupé en jeu avec le transporteur, le moissonneur et le scout ; il intervient lors du retrait suite à une attaque pour s'interposer entre les tirs et le transporteur. Assaut et CaC sont cumulables.</li>
    </ul></div>
  </div>`;
  function withBaseSop(html) {
    // Ajout seul : aucune réécriture du manuel personnalisé, aucune sauvegarde automatique.
    return /data-sop-block\s*=\s*["']base-avancee["']/.test(html) ? html : html + '\n' + baseSop;
  }
  const api = {build, issues, assaults, patrol, withBaseSop};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RaidGroups = api;
})(typeof window !== 'undefined' ? window : this);
