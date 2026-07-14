/* =========================================================
   FIFI RÉGUL — js/app.js  (v5.0)
   Contrôleur principal : authentification, navigation entre vues, GPS,
   recherche, affichage résultats, rubrique Administrateur, signalement
   d'erreur, installation PWA, enregistrement du Service Worker.
========================================================= */

// ---- Configuration à adapter par l'administrateur ----------------------
const ADMIN_CODE = "11222AM*";
// Adresses à renseigner/confirmer ultérieurement :
const ADMIN_EMAILS = ["fifiregul@free.fr", "prenom.nom2@keolis.com"];
const RESULT_LIMIT = 8;
// --------------------------------------------------------------------------

const TOGGLE_KEY = 'fifi_feature_toggles_v1';
const DEFAULT_TOGGLES = { arret: true, vehicule: true, commune: true, cp: true, ligne: true, terminus: true, gps: true };

let toggles = { ...DEFAULT_TOGGLES };
let userMiniMap = null, userMarker = null;
let resultMaps = []; // pour nettoyage entre recherches
let currentReportStop = null;
let adminUnlocked = false;
let currentUser = null;
let deferredInstallPrompt = null;
let splashMinDelayPromise = null;

function toast(msg, duration = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* =========================================================
   AUTHENTIFICATION (code de connexion + CGU)
========================================================= */
function showAuthStep(id) {
  ['auth-step-login', 'auth-step-cgu', 'auth-step-remember', 'auth-step-welcome'].forEach(s => {
    document.getElementById(s).style.display = (s === id) ? '' : 'none';
  });
}

function setupAuth() {
  const codeInput = document.getElementById('auth-code');
  const errorEl = document.getElementById('auth-error');
  const unknownBlock = document.getElementById('auth-unknown-block');

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  document.getElementById('btn-auth-validate').addEventListener('click', () => {
    const result = FifiAuth.attemptLogin(codeInput.value);
    errorEl.style.display = 'none';
    unknownBlock.style.display = 'none';

    if (result.status === 'empty') {
      errorEl.textContent = "Merci de saisir votre code de connexion.";
      errorEl.style.display = '';
      return;
    }
    if (result.status === 'unknown') {
      errorEl.textContent = "Code non reconnu. Une demande d'accès doit être validée par l'administrateur.";
      errorEl.style.display = '';
      unknownBlock.style.display = '';
      return;
    }
    if (result.status === 'banned') {
      errorEl.textContent = "Ce code n'est plus autorisé (compte désactivé). Contactez l'administrateur.";
      errorEl.style.display = '';
      return;
    }

    currentUser = result.user;
    if (FifiAuth.hasAcceptedCGU(currentUser.code)) {
      showWelcomeThenApp();
    } else {
      showAuthStep('auth-step-cgu');
    }
  });

  // CGU
  const cguCheckbox = document.getElementById('auth-cgu-checkbox');
  const cguContinueBtn = document.getElementById('btn-cgu-continue');
  cguCheckbox.addEventListener('change', () => {
    cguContinueBtn.disabled = !cguCheckbox.checked;
  });
  cguContinueBtn.addEventListener('click', () => {
    FifiAuth.recordCGUAcceptance(currentUser);
    document.getElementById('auth-code-reminder-value').textContent = currentUser.code;
    showAuthStep('auth-step-remember');
  });
  document.getElementById('btn-remember-ack').addEventListener('click', () => {
    showWelcomeThenApp();
  });

  // Demande d'accès (code inconnu)
  document.getElementById('btn-request-access').addEventListener('click', () => {
    const matricule = document.getElementById('auth-req-matricule').value.trim();
    const nom = document.getElementById('auth-req-nom').value.trim();
    const poste = document.getElementById('auth-req-poste').value.trim();
    if (!matricule || !nom) {
      toast("Merci de renseigner au moins votre matricule et votre nom.");
      return;
    }
    const subject = "Demande d'accès à FIFI REGUL";
    const body =
`Bonjour,

Je souhaite obtenir un accès à l'application FIFI Régul.

Matricule : ${matricule}
Nom, prénom : ${nom}
Poste occupé (TBM) : ${poste || '(non renseigné)'}

Je recevrai dans les meilleurs délais mon code de connexion unique.

Merci d'avance,
Cordialement.`;
    window.location.href = `mailto:fifiregul@free.fr?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast("Ouverture de votre messagerie (Outlook)...");
  });
}

function showWelcomeThenApp() {
  showAuthStep('auth-step-welcome');
  document.getElementById('auth-welcome-text').textContent =
    `Bonjour, ${currentUser.prenom || ''} excellente journée`.replace(/\s+/g, ' ').trim();
  setTimeout(() => {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').style.display = '';
    afterLoginBoot();
  }, 3000);
}

/* =========================================================
   TOGGLES ADMIN (options de recherche)
========================================================= */
function loadToggles() {
  try {
    const raw = localStorage.getItem(TOGGLE_KEY);
    toggles = raw ? { ...DEFAULT_TOGGLES, ...JSON.parse(raw) } : { ...DEFAULT_TOGGLES };
  } catch (e) { toggles = { ...DEFAULT_TOGGLES }; }
}
function saveToggles() {
  localStorage.setItem(TOGGLE_KEY, JSON.stringify(toggles));
}

function applyToggleVisibility() {
  const map = {
    arret: 'field-arret',
    vehicule: 'field-vehicule',
    commune: 'field-commune',
    ligne: 'field-nomligne',
    terminus: 'field-terminus'
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('disabled', !toggles[key]);
  });
  const gpsBadge = document.getElementById('gps-badge');
  const gpsMap = document.getElementById('user-mini-map');
  const show = toggles.gps;
  gpsBadge.style.display = show ? '' : 'none';
  gpsMap.style.display = show ? '' : 'none';
  if (show) {
    initUserMap();
    if (userMiniMap) setTimeout(() => { try { userMiniMap.invalidateSize(); } catch (e) {} }, 150);
  } else {
    stopUserGps();
  }
}

/* ---------------------------- Navigation vues ---------------------------- */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------- GPS utilisateur ---------------------------- */
function initUserMap() {
  if (userMiniMap || !toggles.gps) return;
  const el = document.getElementById('user-mini-map');
  userMiniMap = L.map(el, { zoomControl: false, attributionControl: false }).setView([44.8378, -0.5792], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(userMiniMap);

  FifiGPS.startWatching(
    (pos) => {
      document.getElementById('gps-dot').classList.remove('off');
      document.getElementById('gps-text').textContent =
        `Position détectée (précision ±${Math.round(pos.accuracy)} m)`;
      const latlng = [pos.lat, pos.lon];
      userMiniMap.setView(latlng, 15);
      if (!userMarker) {
        userMarker = L.marker(latlng).addTo(userMiniMap);
      } else {
        userMarker.setLatLng(latlng);
      }
    },
    (err) => {
      document.getElementById('gps-text').textContent = "Position GPS indisponible (autorisation refusée ou signal absent)";
    }
  );
}
function stopUserGps() {
  FifiGPS.stopWatching();
}

/* ---------------------------- Menus dynamiques (Véhicule / Sens / listes) ---------------------------- */
function populateStaticSelects() {
  const selVeh = document.getElementById('sel-vehicule');
  const vehicules = FifiData.getVehiculeOptions();
  selVeh.innerHTML = '<option value="">Tous</option>' +
    vehicules.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

  const selSens = document.getElementById('sel-sens');
  const sensOptions = FifiData.getSensOptions();
  const currentSens = selSens.value;
  selSens.innerHTML = '<option value="">Indifférent</option>' +
    sensOptions.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (sensOptions.includes(currentSens)) selSens.value = currentSens;
}

/* ---------------------------- Autocomplétion recherche (filtres liés) ---------------------------- */
let acArret, acCommune, acLigne, acTerminus;

function currentSearchContext() {
  return {
    arret: document.getElementById('input-arret').value,
    commune: document.getElementById('input-commune').value,
    ligne: document.getElementById('input-nomligne').value,
    terminus: document.getElementById('input-terminus').value,
    vehicule: document.getElementById('sel-vehicule').value
  };
}

function refreshLinkedAutocompletes(exclude) {
  if (exclude !== 'arret') acArret && acArret.refresh();
  if (exclude !== 'commune') acCommune && acCommune.refresh();
  if (exclude !== 'ligne') acLigne && acLigne.refresh();
  if (exclude !== 'terminus') acTerminus && acTerminus.refresh();
}

function setupAutocompletes() {
  acArret = attachAutocomplete(
    document.getElementById('input-arret'),
    document.getElementById('list-arret'),
    (q) => FifiData.suggestArrets(q, currentSearchContext()),
    () => refreshLinkedAutocompletes('arret')
  );
  acCommune = attachAutocomplete(
    document.getElementById('input-commune'),
    document.getElementById('list-commune'),
    (q) => FifiData.suggestCommunes(q, currentSearchContext()),
    () => refreshLinkedAutocompletes('commune')
  );
  acLigne = attachAutocomplete(
    document.getElementById('input-nomligne'),
    document.getElementById('list-nomligne'),
    (q) => FifiData.suggestLignes(q, currentSearchContext()),
    () => refreshLinkedAutocompletes('ligne')
  );
  acTerminus = attachAutocomplete(
    document.getElementById('input-terminus'),
    document.getElementById('list-terminus'),
    (q) => FifiData.suggestTerminus(q, currentSearchContext()),
    () => refreshLinkedAutocompletes('terminus')
  );

  document.getElementById('input-arret').addEventListener('input', () => refreshLinkedAutocompletes('arret'));
  document.getElementById('input-commune').addEventListener('input', () => refreshLinkedAutocompletes('commune'));
  document.getElementById('input-nomligne').addEventListener('input', () => refreshLinkedAutocompletes('ligne'));
  document.getElementById('input-terminus').addEventListener('input', () => refreshLinkedAutocompletes('terminus'));
  document.getElementById('sel-vehicule').addEventListener('change', () => refreshLinkedAutocompletes(null));
}

/* ---------------------------- Recherche + résultats ---------------------------- */
function runSearch() {
  const criteria = {
    arret: toggles.arret ? document.getElementById('input-arret').value : '',
    commune: toggles.commune ? document.getElementById('input-commune').value : '',
    vehicule: toggles.vehicule ? document.getElementById('sel-vehicule').value : '',
    sens: document.getElementById('sel-sens').value,
    ligne: toggles.ligne ? document.getElementById('input-nomligne').value : '',
    terminus: toggles.terminus ? document.getElementById('input-terminus').value : ''
  };
  const hasAny = Object.values(criteria).some(v => v && String(v).trim());
  if (!hasAny) {
    toast("Renseignez au moins un critère de recherche.");
    return;
  }
  const results = FifiData.search(criteria);
  showView('view-resultats');
  renderResults(results);
}

function cleanupResultMaps() {
  resultMaps.forEach(m => { try { m.remove(); } catch (e) {} });
  resultMaps = [];
}

function renderResults(results) {
  cleanupResultMaps();
  const list = document.getElementById('resultats-list');
  const countEl = document.getElementById('resultats-count');
  const shown = results.slice(0, RESULT_LIMIT);
  countEl.textContent = `${results.length} résultat${results.length > 1 ? 's' : ''}` +
    (results.length > RESULT_LIMIT ? ` (${RESULT_LIMIT} premiers affichés)` : '');

  if (!shown.length) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">🔎</div>Aucun arrêt ne correspond à ces critères.</div>`;
    return;
  }

  list.innerHTML = shown.map((s, i) => `
    <div class="result-card" data-i="${i}">
      <button class="report-fab" data-report-i="${i}" title="Signaler une erreur de géolocalisation">⚠️</button>
      <div class="result-head">
        <span>${escapeHtml(s.libelle)}</span>
        <span class="badge-veh">${escapeHtml(s.vehicule || '')}</span>
      </div>
      <div class="result-body">
        <div class="result-row"><span class="k">Nom de l'arrêt</span><span class="v">${escapeHtml(s.libelle)}</span></div>
        <div class="result-row"><span class="k">Véhicule</span><span class="v">${escapeHtml(s.vehicule || '—')}</span></div>
        <div class="result-row"><span class="k">Sens ligne</span><span class="v">${escapeHtml(s.sens || '—')}</span></div>
        <div class="result-row"><span class="k">Commune</span><span class="v">${escapeHtml(s.commune || '—')}${toggles.cp && s.cp ? ' ' + s.cp : ''}</span></div>
        <div class="result-row"><span class="k">Nom de la ligne</span><span class="v">${escapeHtml(s.nomLigne || 'Non renseigné')}</span></div>
        <div class="result-row"><span class="k">INFO • Nom Arrêt IHM</span><span class="v">${escapeHtml(s.arretIHM || '—')}</span></div>
        <div class="result-row"><span class="k">INFO • N° Arrêt</span><span class="v">${escapeHtml(s.numero != null ? String(s.numero) : '—')}</span></div>
        <div class="result-row"><span class="k">INFO • Départ &amp; Terminus</span><span class="v">${escapeHtml(s.terminus || '—')}</span></div>

        <div class="result-map" id="result-map-${i}"></div>

        <div class="result-actions">
          <div class="nav-label">Naviguer vers</div>
          <div class="nav-buttons">
            <a class="nav-btn nav-gmaps" target="_blank" rel="noopener"
               href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}">
              <span class="nav-icon">G</span>Google Maps
            </a>
            <a class="nav-btn nav-waze" target="_blank" rel="noopener"
               href="https://waze.com/ul?ll=${s.lat},${s.lon}&navigate=yes">
              <span class="nav-icon">W</span>Waze
            </a>
            <a class="nav-btn nav-plan" target="_blank" rel="noopener"
               href="https://maps.apple.com/?daddr=${s.lat},${s.lon}">
              <span class="nav-icon">P</span>Plan
            </a>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  shown.forEach((s, i) => {
    if (s.lat == null || s.lon == null) return;
    const mapEl = document.getElementById(`result-map-${i}`);
    const m = L.map(mapEl, { zoomControl: false, attributionControl: false }).setView([s.lat, s.lon], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    L.marker([s.lat, s.lon]).addTo(m);
    resultMaps.push(m);
    setTimeout(() => { try { m.invalidateSize(); m.setView([s.lat, s.lon], 16); } catch (e) {} }, 150);
  });

  list.querySelectorAll('[data-report-i]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.reportI, 10);
      openReportModal(shown[i]);
    });
  });
}

/* ---------------------------- Signalement d'erreur ---------------------------- */
function openReportModal(stop) {
  currentReportStop = stop;
  document.getElementById('modal-report').classList.add('open');
  document.getElementById('report-ack-banner').style.display = '';
  document.getElementById('report-form-body').style.display = 'none';
  document.getElementById('report-arret').value = stop.libelle || '';
  document.getElementById('report-numero').value = stop.numero != null ? String(stop.numero) : '';
  document.getElementById('report-ville').value = `${stop.commune || ''} ${stop.cp || ''}`.trim();
  document.getElementById('report-gps').value = '';
  document.getElementById('report-comment').value = '';
  document.getElementById('report-comment-count').textContent = '0';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function setupReportModal() {
  document.getElementById('btn-ack-report').addEventListener('click', () => {
    document.getElementById('report-ack-banner').style.display = 'none';
    document.getElementById('report-form-body').style.display = '';
  });

  document.getElementById('btn-capture-gps').addEventListener('click', async () => {
    const btn = document.getElementById('btn-capture-gps');
    btn.disabled = true; btn.textContent = '…';
    try {
      const pos = await FifiGPS.getOnce();
      document.getElementById('report-gps').value = FifiGPS.formatLikeSource(pos.lat, pos.lon);
      toast("Position GPS capturée.");
    } catch (e) {
      toast("Impossible de capter la position GPS.");
    } finally {
      btn.disabled = false; btn.textContent = '📍 Capter';
    }
  });

  document.getElementById('report-comment').addEventListener('input', (e) => {
    document.getElementById('report-comment-count').textContent = e.target.value.length;
  });

  document.getElementById('btn-send-report').addEventListener('click', () => {
    if (!currentReportStop) return;
    const arret = document.getElementById('report-arret').value;
    const numero = document.getElementById('report-numero').value;
    const ville = document.getElementById('report-ville').value;
    const gps = document.getElementById('report-gps').value || '(non renseignée)';
    const comment = document.getElementById('report-comment').value;

    const subject = "Signaler une erreur sur FIFI REGUL";
    const body =
`Nom de l'arrêt : ${arret}
N° de l'arrêt : ${numero}
Ville : ${ville}
Nouvelle position GPS : ${gps}

Commentaire :
${comment}`;

    const mailto = `mailto:${ADMIN_EMAILS.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    closeModal('modal-report');
    toast("Ouverture de votre messagerie (Outlook)...");
  });
}

/* ---------------------------- Rubrique Administrateur ---------------------------- */
function setupAdmin() {
  document.getElementById('btn-open-admin').addEventListener('click', () => {
    document.getElementById('modal-admin').classList.add('open');
    if (adminUnlocked) {
      document.getElementById('admin-lock-screen').style.display = 'none';
      document.getElementById('admin-panel').style.display = '';
    } else {
      document.getElementById('admin-lock-screen').style.display = '';
      document.getElementById('admin-panel').style.display = 'none';
      document.getElementById('admin-code-input').value = '';
      document.getElementById('admin-error').style.display = 'none';
    }
  });

  document.getElementById('btn-admin-unlock').addEventListener('click', () => {
    const val = document.getElementById('admin-code-input').value;
    if (val === ADMIN_CODE) {
      adminUnlocked = true;
      document.getElementById('admin-lock-screen').style.display = 'none';
      document.getElementById('admin-panel').style.display = '';
      renderToggleSwitches();
    } else {
      document.getElementById('admin-error').style.display = '';
    }
  });

  document.getElementById('btn-admin-lock-again').addEventListener('click', () => {
    adminUnlocked = false;
    closeModal('modal-admin');
  });

  document.querySelectorAll('[data-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.toggle;
      toggles[key] = input.checked;
      saveToggles();
      applyToggleVisibility();
    });
  });

  // Mise à jour Base arrêts
  document.getElementById('btn-update-base').addEventListener('click', async () => {
    const fileInput = document.getElementById('admin-file-xlsx');
    const status = document.getElementById('admin-update-status');
    if (!fileInput.files.length) {
      status.textContent = "Sélectionnez d'abord un fichier .xlsx.";
      status.style.color = 'var(--danger)';
      return;
    }
    status.textContent = "Conversion en cours...";
    status.style.color = '';
    try {
      const { stops, communes, menu } = await FifiExcel.processFile(fileInput.files[0]);
      FifiData.replaceDataset(stops);
      FifiExcel.downloadJSON(stops, 'svarrettbm.json');
      FifiExcel.downloadJSON(communes, 'communes.json');
      const currentMenu = FifiData.getMenuLists() || {};
      const mergedMenu = { ...currentMenu, lignes: menu.lignes, terminus: menu.terminus, vehicules: menu.vehicules };
      FifiExcel.downloadJSON(mergedMenu, 'menu-lists.json');
      populateStaticSelects();
      status.textContent =
        `Base mise à jour pour cette session (${stops.length} arrêts). ` +
        `3 fichiers téléchargés (svarrettbm.json, communes.json, menu-lists.json) : replacez-les dans /data.`;
      status.style.color = 'var(--success)';
      toast("Base rechargée en mémoire.");
    } catch (err) {
      status.textContent = "Erreur de conversion : " + err.message;
      status.style.color = 'var(--danger)';
    }
  });

  // Rectification géolocalisation
  const rectifInput = document.getElementById('rectif-search');
  const rectifList = document.getElementById('rectif-list');
  let rectifSelected = null;
  attachAutocomplete(rectifInput, rectifList, (q) => {
    const norm = FifiData.normalize(q);
    return FifiData.all()
      .filter(s => FifiData.normalize(s.libelle).includes(norm))
      .slice(0, 8)
      .map(s => `${s.libelle} — ${s.commune} ${s.cp}`.trim());
  }, (picked) => {
    const libelle = picked.split(' — ')[0];
    rectifSelected = FifiData.all().find(s => s.libelle === libelle);
    if (rectifSelected) {
      document.getElementById('rectif-detail').style.display = '';
      document.getElementById('rectif-gps').value =
        (rectifSelected.lat != null && rectifSelected.lon != null)
          ? `${rectifSelected.lat}, ${rectifSelected.lon}` : '';
    }
  });

  document.getElementById('btn-rectif-save').addEventListener('click', () => {
    if (!rectifSelected) return;
    const raw = document.getElementById('rectif-gps').value;
    const parts = raw.split(',');
    if (parts.length !== 2) { toast("Format attendu : latitude, longitude"); return; }
    const lat = parseFloat(parts[0].trim());
    const lon = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lon)) { toast("Coordonnées invalides."); return; }
    FifiData.saveCorrection(rectifSelected, lat, lon);
    toast(`Position corrigée pour "${rectifSelected.libelle}".`);
  });

  // Mise à jour des matricules
  document.getElementById('btn-update-matricules').addEventListener('click', async () => {
    const fileInput = document.getElementById('admin-file-matricules');
    const status = document.getElementById('admin-matricules-status');
    if (!fileInput.files.length) {
      status.textContent = "Sélectionnez d'abord un fichier .xlsx.";
      status.style.color = 'var(--danger)';
      return;
    }
    try {
      const newUsers = await FifiExcel.processMatriculesFile(fileInput.files[0]);
      FifiAuth.replaceUsers(newUsers);
      FifiExcel.downloadJSON(newUsers, 'matricules.json');
      status.textContent = `${newUsers.length} matricules chargés pour cette session. Fichier téléchargé : déposez-le dans /data/matricules.json.`;
      status.style.color = 'var(--success)';
    } catch (err) {
      status.textContent = "Erreur de conversion : " + err.message;
      status.style.color = 'var(--danger)';
    }
  });

  // Bannissement d'un matricule
  const banInput = document.getElementById('ban-search');
  const banList = document.getElementById('ban-list');
  let banSelected = null;
  attachAutocomplete(banInput, banList, (q) => {
    if (!q.trim()) return [];
    return FifiAuth.findUser(q).slice(0, 8).map(u => `${u.matricule} — ${u.prenom}${u.banni ? ' (banni)' : ''}`);
  }, (picked) => {
    const matricule = picked.split(' — ')[0];
    banSelected = FifiAuth.getAllUsers().find(u => String(u.matricule) === matricule);
    const statusEl = document.getElementById('ban-status');
    if (banSelected) {
      statusEl.textContent = banSelected.banni
        ? `${banSelected.prenom} (matricule ${banSelected.matricule}) est actuellement banni.`
        : `${banSelected.prenom} (matricule ${banSelected.matricule}) est actif.`;
    }
  });

  // Un simple clic sur la suggestion sélectionne ; on ajoute 2 boutons dynamiques
  const banCard = banInput.closest('.card');
  const banActionsDiv = document.createElement('div');
  banActionsDiv.style.display = 'flex';
  banActionsDiv.style.gap = '8px';
  banActionsDiv.style.marginTop = '8px';
  banActionsDiv.innerHTML = `
    <button class="btn btn-danger btn-sm" id="btn-ban-user" type="button">🚫 Bannir (départ du service)</button>
    <button class="btn btn-outline btn-sm" id="btn-unban-user" type="button">✅ Réactiver</button>
  `;
  document.getElementById('ban-status').after(banActionsDiv);

  document.getElementById('btn-ban-user').addEventListener('click', () => {
    if (!banSelected) { toast("Sélectionnez d'abord un utilisateur."); return; }
    FifiAuth.toggleBan(banSelected.matricule, true);
    FifiExcel.downloadJSON(FifiAuth.getAllUsers(), 'matricules.json');
    document.getElementById('ban-status').textContent =
      `${banSelected.prenom} (matricule ${banSelected.matricule}) banni. Fichier matricules.json téléchargé : déposez-le dans /data.`;
    toast("Utilisateur banni pour cette session — déposez le fichier téléchargé pour appliquer partout.");
  });
  document.getElementById('btn-unban-user').addEventListener('click', () => {
    if (!banSelected) { toast("Sélectionnez d'abord un utilisateur."); return; }
    FifiAuth.toggleBan(banSelected.matricule, false);
    FifiExcel.downloadJSON(FifiAuth.getAllUsers(), 'matricules.json');
    document.getElementById('ban-status').textContent =
      `${banSelected.prenom} (matricule ${banSelected.matricule}) réactivé. Fichier matricules.json téléchargé : déposez-le dans /data.`;
    toast("Utilisateur réactivé pour cette session — déposez le fichier téléchargé pour appliquer partout.");
  });

  // Réinitialisation CGU sur cet appareil
  document.getElementById('btn-reset-cgu-device').addEventListener('click', () => {
    FifiAuth.resetDeviceCGU();
    toast("Validations CGU réinitialisées sur cet appareil.");
  });
}

function renderToggleSwitches() {
  document.querySelectorAll('[data-toggle]').forEach(input => {
    input.checked = !!toggles[input.dataset.toggle];
  });
}

/* ---------------------------- Modales génériques ---------------------------- */
function setupModalClosers() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

/* ---------------------------- Installation PWA ---------------------------- */
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!localStorage.getItem('fifi_install_dismissed')) {
      document.getElementById('install-banner').style.display = 'flex';
    }
  });

  document.getElementById('btn-install-app').addEventListener('click', async () => {
    document.getElementById('install-banner').style.display = 'none';
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  document.getElementById('btn-dismiss-install').addEventListener('click', () => {
    document.getElementById('install-banner').style.display = 'none';
    try { localStorage.setItem('fifi_install_dismissed', '1'); } catch (e) {}
  });
}

/* ---------------------------- Démarrage ---------------------------- */
function startSplashMinDelay() {
  // Le cahier des charges impose un affichage de l'image de fond durant au
  // moins 3 secondes avant toute autre vue, pour un effet de chargement réel.
  splashMinDelayPromise = new Promise(resolve => setTimeout(resolve, 3000));
}

async function boot() {
  startSplashMinDelay();

  setupAuth();

  try {
    await Promise.all([FifiData.init(), FifiAuth.init()]);
  } catch (e) {
    toast("Erreur de chargement des données.", 5000);
  }

  await splashMinDelayPromise;
  const splash = document.getElementById('bus-bg-splash');
  splash.classList.add('hidden');
  setTimeout(() => splash.remove(), 600);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // Hébergement en file:// ou sans HTTPS : le Service Worker ne pourra
      // pas s'enregistrer. L'app reste utilisable normalement.
    });
  }
}

// Suite du démarrage après connexion réussie (code + CGU validés)
function afterLoginBoot() {
  loadToggles();
  populateStaticSelects();
  setupAutocompletes();
  setupReportModal();
  setupAdmin();
  setupModalClosers();
  setupInstallPrompt();

  document.getElementById('btn-search').addEventListener('click', runSearch);
  document.getElementById('btn-back-search').addEventListener('click', () => showView('view-recherche'));

  applyToggleVisibility();
}

document.addEventListener('DOMContentLoaded', boot);
