/* =========================================================
   FIFI RÉGUL — js/auth.js
   Authentification par "Code de connexion", vérifiée par hachage
   PBKDF2-SHA256 salé (data/matricules.json ne contient plus AUCUN code
   en clair — voir SECURITY-NOTES.md), gestion des CGU (acceptation
   conservée sur l'appareil), et gestion des comptes bannis (motif :
   départ du service).

   CONSÉQUENCE IMPORTANTE DU HACHAGE (à connaître) :
   Un hachage ne peut pas être "déhaché" pour être réaffiché en clair —
   c'est justement ce qui le rend sûr. L'application ne peut donc plus
   rappeler son code à un agent lors de sa première identification :
   ce code doit lui être communiqué directement par l'administrateur
   (comme son matricule), avant sa première connexion.

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

// Nombre d'itérations PBKDF2. Un nombre élevé ralentit délibérément le
// calcul du hash pour rendre une attaque par force brute hors-ligne (sur
// un fichier matricules.json récupéré) beaucoup plus coûteuse, tout en
// restant quasi instantané pour une seule vérification de connexion.
const FIFI_PBKDF2_ITERATIONS = 100000;

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calcule un hash PBKDF2-SHA256 (256 bits) d'un texte avec un sel donné
// (hexadécimal). Utilisé aussi bien pour les codes agents que pour le code
// administrateur (voir js/app.js).
async function pbkdf2Hex(text, saltHex, iterations = FIFI_PBKDF2_ITERATIONS) {
  const enc = new TextEncoder().encode(text);
  const keyMaterial = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits']);
  const salt = hexToBytes(saltHex);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}

const FifiAuth = (function () {

  let users = []; // [{matricule, salt, codeHash, prenom, banni}]

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

  // Vérifie le code saisi en le hachant avec le sel de CHAQUE agent et en
  // comparant au hash stocké (aucun code n'est jamais conservé en clair,
  // même en mémoire au-delà du temps de calcul du hash).
  async function attemptLogin(codeInput) {
    const code = normalizeCode(codeInput);
    if (!code) return { status: 'empty' };
    for (const u of users) {
      if (!u.salt || !u.codeHash) continue;
      const hash = await pbkdf2Hex(code, u.salt);
      if (hash === u.codeHash) {
        if (u.banni) return { status: 'banned', user: u };
        return { status: 'ok', user: u };
      }
    }
    return { status: 'unknown' };
  }

  // Première identification : recherche par MATRICULE (colonne A), et non
  // par code de connexion, pour un nouvel agent qui ne connaît pas encore
  // s'il a déjà utilisé l'application sur cet appareil. Le matricule n'est
  // pas un secret (il figure déjà sur son badge/ses documents RH), il reste
  // donc en clair et consultable directement, contrairement au code.
  function attemptFirstIdentification(matriculeInput) {
    const matricule = (matriculeInput || '').toString().trim();
    if (!matricule) return { status: 'empty' };
    const user = users.find(u => String(u.matricule).trim() === matricule);
    if (!user) return { status: 'unknown', matricule };
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

  // La validation CGU est indexée par MATRICULE (et non plus par code,
  // puisque le code n'existe plus en clair côté application).
  function hasAcceptedCGU(matricule) {
    const map = loadCguMap();
    return !!map[String(matricule)];
  }

  // Un appareil est considéré comme "déjà utilisé" (donc on lui propose
  // directement l'écran Connexion plutôt que Première Identification) dès
  // qu'au moins une acceptation CGU y a été enregistrée, peu importe
  // l'agent concerné.
  function hasAnyAcceptedCGU() {
    const map = loadCguMap();
    return Object.keys(map).length > 0;
  }

  // RAZ ciblée : n'efface que l'acceptation CGU d'un seul agent, sans
  // toucher aux autres éventuelles acceptations présentes sur cet appareil
  // partagé. Utilisée quand une RAZ individuelle distante (par matricule)
  // est détectée pour l'utilisateur qui vient de se connecter.
  function clearSpecificCGU(matricule) {
    const map = loadCguMap();
    delete map[String(matricule)];
    saveCguMap(map);
  }

  function recordCGUAcceptance(user) {
    const map = loadCguMap();
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace('T', ' ');
    map[String(user.matricule)] = { prenom: user.prenom, ts };
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
    init, attemptLogin, attemptFirstIdentification, hasAcceptedCGU, hasAnyAcceptedCGU,
    recordCGUAcceptance, resetDeviceCGU, clearSpecificCGU,
    exportCguLogText, getAllUsers, findUser, toggleBan, replaceUsers, normalizeCode
  };
})();
