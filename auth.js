/* =========================================================
   FIFI RÉGUL — js/auth.js
   Authentification par "Code de connexion" (data/matricules.json),
   gestion des CGU (acceptation conservée sur l'appareil), et gestion
   des comptes bannis (motif : départ du service).

   IMPORTANT (limite technique honnête, à connaître) :
   FIFI Régul est une application 100% cliente (HTML + JS + JSON, sans
   serveur). Cela a 2 conséquences directes sur cette rubrique :
   - Le journal d'acceptation des CGU (équivalent de cgu_validations.log)
     ne peut pas être écrit automatiquement sur le serveur d'hébergement :
     il est conservé dans le navigateur de chaque agent (localStorage) et
     peut être exporté en .txt à la demande depuis la Rubrique
     Administrateur, sur l'appareil consulté.
   - Bannir un matricule ou réinitialiser ses CGU à distance sur TOUS ses
     appareils n'est pas possible sans serveur central : le bannissement
     se fait via la liste `matricules.json` (comme pour la base arrêts,
     par export + redépôt du fichier), ce qui bloque bien la connexion
     partout dès la prochaine synchronisation. La réinitialisation CGU en
     revanche n'agit que sur l'appareil utilisé au moment du clic.
========================================================= */

const FifiAuth = (function () {

  let users = []; // [{matricule, code, prenom, banni}]

  const CGU_KEY = 'fifi_cgu_accepted_v1';
  const LOG_KEY = 'fifi_cgu_log_v1';

  async function init() {
    try {
      users = await fetch('data/matricules.json').then(r => r.json());
    } catch (e) {
      users = [];
    }
    return users;
  }

  function normalizeCode(code) {
    return (code || '').toString().trim().toUpperCase();
  }

  function attemptLogin(codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) return { status: 'empty' };
    const user = users.find(u => normalizeCode(u.code) === code);
    if (!user) return { status: 'unknown', code };
    if (user.banni) return { status: 'banned', user };
    return { status: 'ok', user };
  }

  function loadCguMap() {
    try {
      const raw = localStorage.getItem(CGU_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveCguMap(map) {
    try { localStorage.setItem(CGU_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ }
  }

  function hasAcceptedCGU(code) {
    const map = loadCguMap();
    return !!map[normalizeCode(code)];
  }

  function recordCGUAcceptance(user) {
    const map = loadCguMap();
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace('T', ' ');
    map[normalizeCode(user.code)] = { matricule: user.matricule, prenom: user.prenom, ts };
    saveCguMap(map);

    let log = [];
    try { log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { log = []; }
    log.push(`[${ts}] - Matricule: ${user.matricule} - CGU acceptées`);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { /* ignore */ }
  }

  function resetDeviceCGU() {
    try {
      localStorage.removeItem(CGU_KEY);
      localStorage.removeItem(LOG_KEY);
    } catch (e) { /* ignore */ }
  }

  function exportCguLogText() {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { log = []; }
    return log.join('\n') + (log.length ? '\n' : '');
  }

  function getAllUsers() { return users; }

  function findUser(matriculeOrPrenom) {
    const q = FifiData.normalize(matriculeOrPrenom);
    return users.filter(u =>
      FifiData.normalize(u.matricule).includes(q) || FifiData.normalize(u.prenom).includes(q)
    );
  }

  function toggleBan(matricule, banni) {
    const u = users.find(x => String(x.matricule) === String(matricule));
    if (u) u.banni = banni;
    return u;
  }

  function replaceUsers(newUsers) {
    users = newUsers;
  }

  return {
    init, attemptLogin, hasAcceptedCGU, recordCGUAcceptance, resetDeviceCGU,
    exportCguLogText, getAllUsers, findUser, toggleBan, replaceUsers, normalizeCode
  };
})();
