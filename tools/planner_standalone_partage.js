  // === ÉDITION PUBLIQUE (planner-standalone, généré par tools/build_planner_standalone.js) ===
  // Pas de compte ni de serveur : les boutons Sauvegarder / Mes plans / Partager du site sont
  // remplacés par Partager le lien / Exporter / Importer.

  // Export : télécharge le plan courant en .json
  document.getElementById('btn-export-plan')?.addEventListener('click', function() {
    if (typeof window.bpSerializePlanData !== 'function') {
      alert('Module non chargé — recharge la page (Ctrl+F5).');
      return;
    }
    var data    = window.bpSerializePlanData();
    var payload = { app: 'dunemap-base-planner', format: 1, exported_at: new Date().toISOString(), data: data };
    var blob    = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url     = URL.createObjectURL(blob);
    var a       = document.createElement('a');
    a.href = url;
    a.download = 'plan-base-dune-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  });

  // Import : ouvre le sélecteur de fichier
  document.getElementById('btn-import-plan')?.addEventListener('click', function() {
    document.getElementById('import-file-input')?.click();
  });
  document.getElementById('import-file-input')?.addEventListener('change', function() {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var parsed = JSON.parse(e.target.result);
        var data   = (parsed && parsed.data) ? parsed.data : parsed; // accepte {data:…} ou data brut
        if (typeof window.bpApplyPlanData !== 'function') {
          alert('Module non chargé — recharge la page (Ctrl+F5).');
          return;
        }
        window.bpApplyPlanData(data);
      } catch (err) {
        alert('Fichier de plan invalide : ' + err.message);
      }
    };
    reader.readAsText(file);
    this.value = ''; // permet de réimporter le même fichier
  });

  // === PARTAGE PAR LIEN AUTO-PORTEUR (100 % statique, sans backend) ===
  // Le plan est sérialisé, compressé en gzip (CompressionStream natif), encodé en
  // base64url et placé dans le hash de l'URL (#p=…). Le lien contient tout le plan.
  function b64urlFromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64url(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async function encodePlanToHash(obj) {
    var cs   = new CompressionStream('gzip');
    var blob = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(cs)).blob();
    return b64urlFromBytes(new Uint8Array(await blob.arrayBuffer()));
  }
  async function decodePlanFromHash(enc) {
    var ds   = new DecompressionStream('gzip');
    var blob = await new Response(new Blob([bytesFromB64url(enc)]).stream().pipeThrough(ds)).blob();
    return JSON.parse(await blob.text());
  }

  document.getElementById('btn-share-link')?.addEventListener('click', async function() {
    if (typeof window.bpSerializePlanData !== 'function') {
      alert('Module non chargé — recharge la page (Ctrl+F5).');
      return;
    }
    var btn = this;
    try {
      var data = window.bpSerializePlanData();
      if (!data || !data.item_count) {
        if (!confirm('Le plan semble vide. Générer quand même un lien ?')) return;
      }
      var enc = await encodePlanToHash(data);
      var url = location.origin + location.pathname + '#p=' + enc;
      try { await navigator.clipboard.writeText(url); } catch (e) {}
      try { history.replaceState(null, '', '#p=' + enc); } catch (e) {}
      var old = btn.textContent;
      btn.textContent = '✓ Lien copié';
      setTimeout(function () { btn.textContent = old; }, 1800);
      if (url.length > 30000) {
        alert('Lien généré et copié, mais il est très long (' + url.length + ' caractères). Pour un très gros plan, préfère l\'export .json.');
      }
    } catch (err) {
      alert('Impossible de générer le lien : ' + err.message);
    }
  });

  // Auto-chargement : si l'URL contient #p=…, on applique le plan une fois le constructeur
  // prêt (pièces chargées), en sondant l'état exposé par base_planner.js (window.__bp).
  (function autoLoadFromHash() {
    var m = /[#&]p=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var ready = typeof window.bpApplyPlanData === 'function'
        && window.__bp && window.__bp.state
        && window.__bp.state.piecesById && window.__bp.state.piecesById.size > 0;
      if (ready) {
        clearInterval(timer);
        decodePlanFromHash(m[1])
          .then(function (data) { window.bpApplyPlanData(data); })
          .catch(function (e) { console.warn('[partage] lien illisible :', e); });
      } else if (tries > 300) {   // ~30 s
        clearInterval(timer);
        console.warn('[partage] constructeur non prêt — abandon du chargement du lien.');
      }
    }, 100);
  })();

