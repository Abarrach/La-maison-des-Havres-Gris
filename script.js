// === CONFIGURATION DES CARTES ===
const mapConfig = {
  hagga: {
    name: "Bassin de Hagga",
    image: "map.jpg",
    maxBases: 1,
    bounds: [[0, 0], [2556, 2556]]
  },
  deep_desert: {
    name: "Deep Desert",
    image: "deep_desert.jpg?v=1", // J'ai passé le v=4 pour forcer les navigateurs à recharger ta nouvelle image
    maxBases: 2,
    bounds: [[0, 0], [6120, 6144]] 
  }
};

// === GLOBALES ===
let map, currentLayer;
let currentMapId = 'hagga';
let currentUser = null;
let isAdmin = false;
let markers = []; 
let selectedCoords = null;
let timerInterval = null;

const iconSet = {
  guilde: L.icon({ iconUrl: 'icons/guilde.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] }),
  landsraad: L.icon({ iconUrl: 'icons/landsraad.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] }),
  joueur: L.icon({ iconUrl: 'icons/joueur.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] }),
  ressource: L.icon({ iconUrl: 'icons/ressource.png', iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48] })
};

// === INITIALISATION ===
document.addEventListener("DOMContentLoaded", async () => {
  currentUser = localStorage.getItem("user");
  const role = localStorage.getItem("role");
  isAdmin = (role === "admin");

  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  const userInfo = document.getElementById("user-info");
  if (userInfo) userInfo.innerText = `[${currentUser}] ${isAdmin ? 'Admin' : ''}`;

  await checkDeepDesertWipe();
  setupMapSwitcher();
  initMap();
  startStormTimer();

  if (isAdmin) createAdminPanel();
});

// === MODALES ===
function showCustomConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const inputEl = document.getElementById('modal-input');
    const btnConf = document.getElementById('modal-btn-confirm');
    const btnCanc = document.getElementById('modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'none'; 
    overlay.style.display = 'flex';

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnConf.addEventListener('click', () => { overlay.style.display = 'none'; if(onConfirm) onConfirm(); });
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
}

function showCustomPrompt(title, message, existingText, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const inputEl = document.getElementById('modal-input');
    const btnConf = document.getElementById('modal-btn-confirm');
    const btnCanc = document.getElementById('modal-btn-cancel');

    titleEl.innerText = title;
    msgEl.innerText = message;
    msgEl.style.display = 'block';
    inputEl.style.display = 'block'; 
    inputEl.value = existingText || ""; 
    overlay.style.display = 'flex';
    inputEl.focus(); 

    const newBtnConf = btnConf.cloneNode(true);
    btnConf.parentNode.replaceChild(newBtnConf, btnConf);
    const newBtnCanc = btnCanc.cloneNode(true);
    btnCanc.parentNode.replaceChild(newBtnCanc, btnCanc);

    newBtnConf.addEventListener('click', () => {
        const val = inputEl.value.trim();
        overlay.style.display = 'none';
        if(onConfirm) onConfirm(val);
    });
    newBtnCanc.addEventListener('click', () => { overlay.style.display = 'none'; });
    inputEl.onkeydown = function(e) { if(e.key === 'Enter') newBtnConf.click(); };
}

// === LOGIQUE ===
async function checkDeepDesertWipe() {
    try {
        const res = await fetch("save.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "checkWipe" })
        });
        const json = await res.json();
        if (json.ok && json.message.includes("effectué")) console.log("Wipe Deep Desert appliqué.");
    } catch (e) {}
}

function startStormTimer() { updateTimer(); timerInterval = setInterval(updateTimer, 1000); }
function updateTimer() {
    const now = new Date();
    const day = now.getDay(); 
    const hour = now.getHours();
    let target = new Date(now);
    target.setHours(5, 0, 0, 0);
    if (day === 2 && hour < 5) {} 
    else {
        let daysToAdd = (2 - day + 7) % 7;
        if (daysToAdd === 0 && (day !== 2 || hour >= 5)) daysToAdd = 7;
        target.setDate(now.getDate() + daysToAdd);
    }
    const diff = target - now;
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    const timerText = document.getElementById("timer-text");
    if (timerText) timerText.innerText = "Tempête : " + (d > 0 ? `${d}j ` : "") + `${h}h ${m}m ${s}s`;
}

function initMap() {
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -5, maxZoom: 2, zoomControl: false, attributionControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  loadMapLayer(currentMapId);
  map.on("click", (e) => {
    selectedCoords = e.latlng;
    if (isAdmin) {
      const d = document.getElementById("coordDisplay");
      if(d) d.innerText = `Coords : ${selectedCoords.lat.toFixed(0)}, ${selectedCoords.lng.toFixed(0)}`;
    } else {
      addOrReplaceOwnBase(selectedCoords.lat, selectedCoords.lng);
    }
  });
}

function setupMapSwitcher() {
  document.querySelectorAll('.map-switch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.map-switch-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const newMapId = e.target.dataset.map;
      if (newMapId !== currentMapId) {
        currentMapId = newMapId;
        loadMapLayer(currentMapId);
        if(document.getElementById("player-panel").classList.contains("visible")) togglePlayerPanel();
      }
    });
  });
}

async function loadMapLayer(mapId) {
  const config = mapConfig[mapId];
  const timerDiv = document.getElementById("storm-timer");
  if (timerDiv) {
      if (mapId === 'deep_desert') timerDiv.classList.add('visible');
      else timerDiv.classList.remove('visible');
  }
  
  if (currentLayer) map.removeLayer(currentLayer);
  
  if (config.image) {
      currentLayer = L.imageOverlay(config.image, config.bounds, { zIndex: 1 }).addTo(map);
      map.fitBounds(config.bounds);
  }
  
  markers.forEach(m => map.removeLayer(m.marker));
  markers = [];
  await fetchAndDisplayBases();
}

async function fetchAndDisplayBases() {
  try {
      const response = await fetch("bases.json?ts=" + Date.now());
      const allBases = await response.json();
      const currentMapBases = allBases.filter(b => {
        const baseMap = b.map || 'hagga';
        return baseMap === currentMapId;
      });
      currentMapBases.forEach(b => addMarker(b.user, b.x, b.y, b.type, b.note));
      
      // --- NOUVEAU : Auto-focus depuis l'URL ---
      const urlParams = new URLSearchParams(window.location.search);
      const focusUser = urlParams.get('focus');
      if (focusUser) {
          // On attend 500ms que la carte soit bien dessinée avant de faire le zoom
          setTimeout(() => {
              highlightBase(focusUser);
          }, 500);
          
          // Optionnel : on nettoie l'adresse web pour éviter que ça re-zoome à chaque rafraîchissement
          window.history.replaceState({}, document.title, window.location.pathname);
      }
      // ----------------------------------------
      
  } catch (e) { console.error("Erreur chargement bases:", e); }
}
function addMarker(user, x, y, type = "joueur", note = "") {
  const icon = iconSet[type] || iconSet.joueur;
  const isOwner = (user === currentUser);
  const canEdit = isOwner || isAdmin; 
  const deleteBtn = canEdit ? `<br><button class="delete-btn" onclick="removeBasePrompt('${user}', ${x}, ${y})">🗑 Supprimer</button>` : "";
  let popupContent = `<b>${user}</b><br><small>${type}</small>`;
  const safeUser = user.replace(/'/g, "\\'"); 
  const safeNote = note ? note.replace(/'/g, "&apos;") : "";

  if (note) {
      const clickAction = canEdit ? `onclick="editBaseNote('${safeUser}', ${x}, ${y}, '${safeNote}')"` : "";
      const classEditable = canEdit ? "editable-note" : "";
      const titleAttr = canEdit ? "title='Cliquez pour modifier'" : "";
      popupContent += `<br><span class="base-note ${classEditable}" ${clickAction} ${titleAttr}>Note : ${note}</span>`;
  } else if (canEdit) {
      popupContent += `<br><span class="base-note-add" onclick="editBaseNote('${safeUser}', ${x}, ${y}, '')">+ Ajouter une note</span>`;
  }
  popupContent += deleteBtn;

  let tooltipContent = `<div>${user}</div>`;
  if (note && note.trim() !== "") tooltipContent += `<div class="tooltip-subtext">${note}</div>`;

  const m = L.marker([x, y], { icon }).addTo(map)
    .bindPopup(popupContent)
    .bindTooltip(tooltipContent, { permanent: false, direction: 'top', offset: [0, -40], className: 'base-tooltip' });

  attachHoverSound(m);
  markers.push({ user, x, y, type, map: currentMapId, marker: m });
}

window.editBaseNote = function(user, x, y, currentNote) {
    showCustomPrompt("NOTE", "Modifier la note :", currentNote, async function(newNote) {
        if (newNote.trim() === currentNote) return; 
        const payload = { action: "updateNote", user: user, x: x, y: y, note: newNote.trim() };
        try {
            const res = await fetch("save.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const json = await res.json();
            if (json.ok) loadMapLayer(currentMapId);
            else alert("Erreur : " + (json.error || "Inconnue"));
        } catch (e) { alert("Erreur réseau."); }
    });
};

async function addOrReplaceOwnBase(x, y) {
  const res = await fetch("bases.json?ts=" + Date.now());
  const all = await res.json();
  const myBases = all.filter(b => b.user === currentUser && (b.map || 'hagga') === currentMapId);
  const limit = mapConfig[currentMapId].maxBases;

  if (myBases.length >= limit) {
    if (limit === 1) {
        showCustomConfirm("DÉPLACEMENT", "Vous avez déjà une base.<br>Voulez-vous la déplacer ici ?", async () => {
            await removeBase(currentUser, myBases[0].x, myBases[0].y);
            showCustomPrompt("NOTE", "Ajouter une note ? (Optionnel)", "", (note) => { saveBase(currentUser, x, y, "joueur", note); });
        });
    } else if (limit > 1) {
      showCustomConfirm("LIMITE ATTEINTE", `Vous avez atteint la limite de ${limit} bases sur cette carte.`, null);
    }
    return;
  }
  showCustomConfirm("NOUVELLE BASE", "Placer votre base ici ?", () => {
      showCustomPrompt("NOTE", "Ajouter une note ? (Optionnel)", "", (note) => { saveBase(currentUser, x, y, "joueur", note); });
  });
}

async function saveBase(user, x, y, type, note = "") {
  const payload = { action: "add", user, x, y, type, mapId: currentMapId, note: note };
  const res = await fetch("save.php", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  const json = await res.json();
  if(json.ok) loadMapLayer(currentMapId);
  else alert("Erreur: " + json.error);
}

function removeBasePrompt(u, x, y) { showCustomConfirm("SUPPRESSION", "Voulez-vous vraiment supprimer cette base ?", () => { removeBase(u, x, y); }); }
async function removeBase(u, x, y) {
  await fetch("save.php", { method: "POST", body: JSON.stringify({ action: "remove", user: u, x, y }) });
  loadMapLayer(currentMapId);
}

// === ADMIN PANEL ===
function createAdminPanel() {
  const toggleBtn = document.getElementById("admin-toggle");
  if(toggleBtn) {
      toggleBtn.style.display = "flex";
      toggleBtn.onclick = () => {
          const panel = document.querySelector(".admin-panel");
          if(panel) panel.classList.toggle("visible");
      };
  }

  const p = document.createElement("div");
  p.className = "admin-panel"; 
  p.innerHTML = `
    <h3>Gestion Admin</h3>
    <div class="admin-row"><input type="text" id="baseName" placeholder="Nom (Joueur/POI)"></div>
    <div class="admin-row">
      <select id="baseType">
        <option value="joueur">🏠 Joueur</option>
        <option value="guilde">🏯 Guilde</option>
        <option value="landsraad">🏛 Landsraad</option>
        <option value="ressource">💧 Ressource</option>
      </select>
    </div>
    <div class="admin-row"><input type="text" id="baseNote" placeholder="Note (ex: Petit gisement)"></div>
    
    <button id="addBaseBtn">Ajouter Base</button>
    <div style="margin:10px 0; border-top:1px solid #5c4025;"></div>
    <button id="manageUsersBtn">👥 Gérer Utilisateurs</button>
    <p id="coordDisplay" style="margin-top:10px;font-size:11px;color:#d3b46f;text-align:center;">Cliquez sur la carte...</p>
  `;
  document.body.appendChild(p);
  
  document.getElementById("addBaseBtn").onclick = () => {
    if(!selectedCoords) return alert("Cliquez sur la carte !");
    const n = document.getElementById("baseName").value.trim();
    const type = document.getElementById("baseType").value;
    const note = document.getElementById("baseNote").value.trim();
    if(n) saveBase(n, selectedCoords.lat, selectedCoords.lng, type, note);
  };
  document.getElementById("manageUsersBtn").onclick = openUserManager;
}

// === USER MANAGER ===
let userPanel;
async function openUserManager() {
  if(userPanel) { userPanel.remove(); userPanel=null; return; }
  try {
      const res = await fetch("get_users.php?ts=" + Date.now());
      if (!res.ok) throw new Error("Erreur accès (403/404)");
      const users = await res.json();
      users.sort((a, b) => {
          if (a.role === 'admin' && b.role !== 'admin') return -1;
          if (a.role !== 'admin' && b.role === 'admin') return 1;
          return a.user.localeCompare(b.user, undefined, { sensitivity: 'base' });
      });
      userPanel = document.createElement("div");
      userPanel.className = "admin-panel visible"; 
      userPanel.style.right = "340px";
      userPanel.style.zIndex = "1100";
      userPanel.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px;"><h3 style="margin:0;border:none;">Utilisateurs</h3><button class="small-btn" style="width:20px;background:#a83b3b;" onclick="closeUserManager()">X</button></div>`;
      if (!users || users.length === 0) {
          userPanel.innerHTML += "<div style='padding:10px; font-style:italic;'>Aucun utilisateur trouvé ou accès refusé.</div>";
      } else {
          users.forEach(u => {
            const isAdmin = u.role === 'admin';
            const safe = u.user.replace(/'/g, "\\'");
            userPanel.innerHTML += `
              <div class="user-row">
                <div style="display:flex;justify-content:space-between;font-size:13px;">
                  <span style="font-weight:bold;color:${isAdmin?'#f3c44f':'#f5deb3'}">${u.user}</span>
                  <span>${u.role}</span>
                </div>
                <div style="display:flex;gap:5px;margin-top:4px;">
                  <button class="small-btn" onclick="toggleRole('${safe}','${u.role}')" style="flex:1;background:${isAdmin?'#8b6e3b':'#4a6b3b'}">${isAdmin?'Rétrograder':'Promouvoir'}</button>
                  <button class="small-btn" onclick="deleteUser('${safe}')" style="background:#a83b3b;width:30px;">🗑</button>
                </div>
              </div>`;
          });
      }
      document.body.appendChild(userPanel);
  } catch (e) { console.error(e); alert("Erreur : Impossible de charger la liste des utilisateurs."); }
}

window.closeUserManager = () => { if(userPanel) userPanel.remove(); userPanel=null; };
window.toggleRole = async (t, r) => {
  const nr = r === 'admin' ? 'user' : 'admin';
  const res = await fetch("save.php", { method:"POST", body:JSON.stringify({action:"updateRole", target:t, role:nr}) });
  const j = await res.json();
  if(j.ok) { closeUserManager(); openUserManager(); } else alert(j.error);
};
window.deleteUser = async (t) => {
  showCustomConfirm("ADMIN", "Supprimer l'utilisateur "+t+" ?", async () => {
      const res = await fetch("save.php", { method:"POST", body:JSON.stringify({action:"deleteUser", target:t}) });
      const j = await res.json();
      if(j.ok) { closeUserManager(); openUserManager(); loadMapLayer(currentMapId); } else alert(j.error);
  });
};

// === LISTE JOUEURS ===
async function togglePlayerPanel() {
  const p = document.getElementById("player-panel");
  if(p.classList.contains("visible")) { p.classList.remove("visible"); return; }
  const res = await fetch("bases.json?ts=" + Date.now());
  const allBases = await res.json();
  const mapBases = allBases.filter(b => (b.map || 'hagga') === currentMapId);
  const list = document.getElementById("player-list");
  list.innerHTML = "";
  if (mapBases.length === 0) {
      list.innerHTML = "<div style='font-style:italic; padding:5px;'>Aucune base...</div>";
      p.classList.add("visible");
      return;
  }
  const categories = [ { id: 'guilde', label: 'Bases Guilde' }, { id: 'landsraad', label: 'Bases Landsraad' }, { id: 'joueur', label: 'Bases Joueurs' }, { id: 'ressource', label: 'Ressources' } ];
  categories.forEach(cat => {
      const items = mapBases.filter(b => b.type === cat.id);
      if (items.length > 0) {
          const header = document.createElement("div");
          header.className = "category-header";
          header.innerText = cat.label;
          list.appendChild(header);
          const uniqueNames = [...new Set(items.map(b => b.user))];
          uniqueNames.sort((a, b) => a.localeCompare(b));
          uniqueNames.forEach(name => {
              const d = document.createElement("div");
              d.innerText = name;
              d.className = "player-item";
              d.onclick = () => highlightBase(name);
              list.appendChild(d);
          });
      }
  });
  p.classList.add("visible");
}

function highlightBase(user) {
  const entry = markers.find(m => m.user === user);
  if (entry) {
    map.flyTo(entry.marker.getLatLng(), map.getZoom(), { duration: 0.5 });
    setTimeout(() => entry.marker.openPopup(), 600);
  } else {
      showCustomConfirm("INFO", "Ce joueur n'a pas de base visible sur cette carte.", null);
  }
}

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("toggle-players");
    if(btn) btn.addEventListener("click", togglePlayerPanel);
});

let audioUnlocked = false;
const hoverSound = new Audio("sounds/sand_hover.mp3"); hoverSound.volume = 0.5;
window.addEventListener("pointerdown", () => { if(!audioUnlocked) { hoverSound.muted=true; hoverSound.play().catch(()=>{}); audioUnlocked=true; } }, {once:true});
function attachHoverSound(marker) {
  let cd = false;
  marker.on("mouseover", () => { if(audioUnlocked && !cd) { cd=true; hoverSound.currentTime=0; hoverSound.muted=false; hoverSound.play().catch(()=>{}); setTimeout(()=>cd=false,180); } });
}