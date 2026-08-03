/* =========================================================
   FIFI RÉGUL — js/search.js
   Chargement des données (data/svarrettbm.json + data/menu-lists.json
   + data/communes.json), index de recherche, recherche multicritère,
   et logique d'autocomplétion générique.
========================================================= */

const FifiData = (function () {

  let stops = [];           // tableau des arrêts (svarrettbm.json)
  let menuLists = null;      // {arrets, vehicules, lignes, terminus, sens}
  let communes = [];         // [{nom, cp}]
  let localCorrections = {}; // corrections GPS appliquées localement (rectification admin)

  const CORR_KEY = 'fifi_local_corrections_v1';

  function loadCorrections() {
    try {
      const raw = localStorage.getItem(CORR_KEY);
      localCorrections = raw ? JSON.parse(raw) : {};
    } catch (e) {
      localCorrections = {};
    }
  }

  function saveCorrections() {
    try {
      localStorage.setItem(CORR_KEY, JSON.stringify(localCorrections));
    } catch (e) { /* ignore quota errors */ }
  }

  // Clé stable pour une correction locale : le fichier v5 n'a plus de
  // colonne GID, on retient donc un identifiant "id" (position d'origine
  // dans le fichier source) déjà présent dans chaque enregistrement.
  function stopKey(stop) {
    return stop && stop.id != null ? String(stop.id) : null;
  }

  function applyCorrections() {
    stops.forEach(s => {
      const key = stopKey(s);
      if (key && localCorrections[key]) {
        s.lat = localCorrections[key].lat;
        s.lon = localCorrections[key].lon;
      }
    });
  }

  async function init() {
    loadCorrections();
    const [stopsRes, menuRes, communesRes] = await Promise.all([
      fetch('data/svarrettbm.json').then(r => r.json()),
      fetch('data/menu-lists.json').then(r => r.json()).catch(() => null),
      fetch('data/communes.json').then(r => r.json()).catch(() => [])
    ]);
    stops = stopsRes;
    menuLists = menuRes || { arrets: [], vehicules: [], lignes: [], terminus: [], sens: [] };
    communes = communesRes || [];
    applyCorrections();
    return { total: stops.length };
  }

  function getStopKey(stop) { return stopKey(stop); }

  function saveCorrection(stop, lat, lon) {
    const key = stopKey(stop);
    if (!key) return;
    localCorrections[key] = { lat, lon };
    stop.lat = lat;
    stop.lon = lon;
    saveCorrections();
  }

  function normalize(str) {
    if (!str) return '';
    return str.toString()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
      .trim();
  }

  // Filtre le jeu d'arrêts selon les critères déjà saisis (hors le champ
  // pour lequel on calcule les suggestions). C'est ce qui permet les
  // "filtres liés entre eux" : ex. COMMUNE = Cenon 33150 -> la liste des
  // "Nom de l'arrêt" proposée ne contient plus que les arrêts de Cenon.
  function baseFilteredStops(context) {
    const qArret = normalize(context.arret);
    const qCommune = normalize(context.commune);
    const qVehicule = normalize(context.vehicule);
    const qLigne = normalize(context.ligne);
    const qTerminus = normalize(context.terminus);
    return stops.filter(s => {
      if (qArret && !normalize(s.libelle).includes(qArret)) return false;
      if (qCommune && !normalize(`${s.commune} ${s.cp}`).includes(qCommune)) return false;
      if (qVehicule && normalize(s.vehicule) !== qVehicule) return false;
      if (qLigne && !(s.nomLigne && normalize(s.nomLigne).includes(qLigne))) return false;
      if (qTerminus && !(s.terminus && normalize(s.terminus).includes(qTerminus))) return false;
      return true;
    });
  }

  function hasActiveContext(context, excluding) {
    return Object.entries(context)
      .some(([k, v]) => k !== excluding && v && String(v).trim());
  }

  function suggestArrets(query, context = {}, limit = 8) {
    const q = normalize(query);
    if (!q) return [];
    let source;
    if (hasActiveContext(context, 'arret')) {
      const ctx = { ...context, arret: '' };
      source = [...new Set(baseFilteredStops(ctx).map(s => s.libelle))];
    } else {
      source = (menuLists && menuLists.arrets && menuLists.arrets.length)
        ? menuLists.arrets
        : [...new Set(stops.map(s => s.libelle))];
    }
    return source.filter(a => normalize(a).includes(q)).sort().slice(0, limit);
  }

  function suggestCommunes(query, context = {}, limit = 8) {
    const q = normalize(query);
    if (!q) return [];
    let source;
    if (hasActiveContext(context, 'commune')) {
      const ctx = { ...context, commune: '' };
      const subset = baseFilteredStops(ctx);
      const map = {};
      subset.forEach(s => { if (s.commune) map[s.commune] = s.cp; });
      source = Object.keys(map).sort().map(nom => `${nom} ${map[nom]}`.trim());
    } else {
      source = communes.map(c => `${c.nom} ${c.cp}`.trim());
    }
    return source.filter(c => normalize(c).includes(q)).slice(0, limit);
  }

  function suggestLignes(query, context = {}, limit = 8) {
    const q = normalize(query);
    if (!q) return [];
    let source;
    if (hasActiveContext(context, 'ligne')) {
      const ctx = { ...context, ligne: '' };
      const subset = baseFilteredStops(ctx);
      source = [...new Set(subset.map(s => s.nomLigne).filter(Boolean))];
    } else {
      const ref = (menuLists && menuLists.lignes) ? menuLists.lignes.map(String) : [];
      const fromStops = [...new Set(stops.map(s => s.nomLigne).filter(Boolean))];
      source = [...new Set([...ref, ...fromStops])];
    }
    return source.filter(l => normalize(l).includes(q)).slice(0, limit);
  }

  function suggestTerminus(query, context = {}, limit = 8) {
    const q = normalize(query);
    if (!q) return [];
    let source;
    if (hasActiveContext(context, 'terminus')) {
      const ctx = { ...context, terminus: '' };
      const subset = baseFilteredStops(ctx);
      source = [...new Set(subset.map(s => s.terminus).filter(Boolean))];
    } else {
      source = (menuLists && menuLists.terminus) ? menuLists.terminus : [];
    }
    return source.filter(t => normalize(t).includes(q)).slice(0, limit);
  }

  // Recherche multicritère : tous les critères renseignés doivent correspondre (ET),
  // chaque critère non renseigné est ignoré.
  function search(criteria) {
    const qArret = normalize(criteria.arret);
    const qCommune = normalize(criteria.commune);
    const qVehicule = normalize(criteria.vehicule);
    const qSens = normalize(criteria.sens);
    const qLigne = normalize(criteria.ligne);
    const qTerminus = normalize(criteria.terminus);

    return stops.filter(s => {
      if (qArret && !normalize(s.libelle).includes(qArret)) return false;
      if (qCommune && !normalize(`${s.commune} ${s.cp}`).includes(qCommune)) return false;
      if (qVehicule && normalize(s.vehicule) !== qVehicule) return false;
      if (qSens && normalize(s.sens) !== qSens) return false;
      if (qLigne && !(s.nomLigne && normalize(s.nomLigne).includes(qLigne))) return false;
      if (qTerminus && !(s.terminus && normalize(s.terminus).includes(qTerminus))) return false;
      return true;
    });
  }

  function getSensOptions() {
    const fromData = [...new Set(stops.map(s => s.sens).filter(Boolean))];
    // "Aller" / "Retour" toujours proposés en premier si présents.
    return fromData.sort((a, b) => {
      const rank = v => (v === 'Aller' ? 0 : v === 'Retour' ? 1 : 2);
      const r = rank(a) - rank(b);
      return r !== 0 ? r : a.localeCompare(b);
    });
  }

  function getVehiculeOptions() {
    if (menuLists && menuLists.vehicules && menuLists.vehicules.length) return menuLists.vehicules;
    return [...new Set(stops.map(s => s.vehicule).filter(Boolean))].sort();
  }

  function all() { return stops; }
  function getMenuLists() { return menuLists; }
  function getCommunes() { return communes; }

  function replaceDataset(newStops) {
    stops = newStops;
    localCorrections = {};
    saveCorrections();
    applyCorrections();
  }

  return {
    init, search, suggestArrets, suggestCommunes, suggestLignes, suggestTerminus,
    all, getMenuLists, getCommunes, saveCorrection, getStopKey,
    replaceDataset, normalize, getSensOptions, getVehiculeOptions
  };
})();


/* ---------------------------------------------------------
   Autocomplétion générique attachée à un <input> + une <div class="autocomplete-list">
--------------------------------------------------------- */
function escapeHtmlAC(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function attachAutocomplete(inputEl, listEl, suggestFn, onPick) {
  let activeIndex = -1;
  let currentItems = [];

  function render(items) {
    currentItems = items;
    activeIndex = -1;
    if (!items.length) {
      listEl.innerHTML = inputEl.value.trim()
        ? '<div class="empty">Aucune correspondance</div>'
        : '';
      listEl.classList.toggle('open', !!inputEl.value.trim());
      return;
    }
    // Les valeurs affichées sont échappées (défense en profondeur si une
    // donnée source contenait des caractères HTML) ; la sélection au clic
    // ou au clavier utilise toujours la valeur brute via currentItems[i].
    listEl.innerHTML = items.map((it, i) => `<div data-i="${i}">${escapeHtmlAC(it)}</div>`).join('');
    listEl.classList.add('open');
  }

  inputEl.addEventListener('input', () => {
    const items = suggestFn(inputEl.value);
    render(items);
  });

  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim()) render(suggestFn(inputEl.value));
  });

  inputEl.addEventListener('keydown', (e) => {
    if (!listEl.classList.contains('open')) return;
    const opts = listEl.querySelectorAll('div[data-i]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, opts.length - 1);
      opts.forEach(o => o.classList.remove('active-opt'));
      if (opts[activeIndex]) opts[activeIndex].classList.add('active-opt');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      opts.forEach(o => o.classList.remove('active-opt'));
      if (opts[activeIndex]) opts[activeIndex].classList.add('active-opt');
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && currentItems[activeIndex]) {
        e.preventDefault();
        inputEl.value = currentItems[activeIndex];
        listEl.classList.remove('open');
        onPick && onPick(currentItems[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      listEl.classList.remove('open');
    }
  });

  listEl.addEventListener('click', (e) => {
    const div = e.target.closest('div[data-i]');
    if (!div) return;
    const i = parseInt(div.dataset.i, 10);
    inputEl.value = currentItems[i];
    listEl.classList.remove('open');
    onPick && onPick(currentItems[i]);
  });

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !listEl.contains(e.target)) {
      listEl.classList.remove('open');
    }
  });

  // Permet à un champ "lié" de forcer le recalcul des suggestions d'un
  // autre champ dès qu'il change, sans attendre que l'utilisateur retape.
  function refresh() {
    if (listEl.classList.contains('open') && inputEl.value.trim()) {
      render(suggestFn(inputEl.value));
    }
  }

  return { refresh };
}
