/* =========================================================
   FIFI RÉGUL — js/state.js
   Synchronisation de la configuration partagée entre TOUS les agents
   (data/app-state.json) : options de recherche actives, et
   réinitialisations CGU globale / individuelle.

   PRINCIPE (cohérent avec le reste de l'app, sans serveur) :
   - L'administrateur modifie un réglage ou déclenche une RAZ CGU.
   - L'app propose le téléchargement d'un app-state.json à jour.
   - L'administrateur dépose ce fichier dans /data.
   - Au chargement suivant, CHAQUE agent récupère ce fichier et applique
     automatiquement les changements sur son propre appareil :
       - nouveaux réglages d'options si "toggleVersion" a augmenté,
       - RAZ de ses propres CGU si "globalCguResetAt" est plus récent que
         la dernière fois qu'il l'a vu, ou si son matricule apparaît dans
         "userCguResetAt" avec une date plus récente que la dernière fois
         qu'il l'a vue.
   C'est la même logique de propagation "édition + redépôt de fichier"
   déjà utilisée pour la base des arrêts et les matricules.
========================================================= */

const FifiState = (function () {

  const SEEN_VERSION_KEY = 'fifi_seen_toggle_version_v1';
  const SEEN_GLOBAL_RESET_KEY = 'fifi_seen_global_cgu_reset_v1';
  const SEEN_USER_RESET_KEY = 'fifi_seen_user_cgu_reset_v1';

  let state = null;

  async function init() {
    try {
      state = await fetch('data/app-state.json').then(r => r.json());
    } catch (e) {
      state = { toggles: null, toggleVersion: 0, globalCguResetAt: null, userCguResetAt: {} };
    }
    return state;
  }

  function getRemoteToggles() { return state && state.toggles; }
  function getRemoteToggleVersion() { return (state && state.toggleVersion) || 0; }

  // Retourne true si les réglages distants sont plus récents que ceux déjà
  // vus sur cet appareil (auquel cas ils doivent être adoptés).
  function hasNewerToggles() {
    const seen = parseInt(localStorage.getItem(SEEN_VERSION_KEY) || '0', 10);
    return getRemoteToggleVersion() > seen;
  }
  function markTogglesSeen() {
    try { localStorage.setItem(SEEN_VERSION_KEY, String(getRemoteToggleVersion())); } catch (e) {}
  }

  // RAZ CGU globale : true si une réinitialisation globale plus récente que
  // la dernière vue par cet appareil a eu lieu.
  function hasNewerGlobalReset() {
    const remote = state && state.globalCguResetAt;
    if (!remote) return false;
    const seen = localStorage.getItem(SEEN_GLOBAL_RESET_KEY) || '';
    return remote > seen;
  }
  function markGlobalResetSeen() {
    try { localStorage.setItem(SEEN_GLOBAL_RESET_KEY, (state && state.globalCguResetAt) || ''); } catch (e) {}
  }

  // RAZ CGU individuelle : true si le matricule de l'utilisateur qui vient
  // de se connecter a une date de réinitialisation plus récente que la
  // dernière vue par cet appareil pour CE matricule précis.
  function hasNewerUserReset(matricule) {
    if (!matricule || !state || !state.userCguResetAt) return false;
    const remote = state.userCguResetAt[String(matricule)];
    if (!remote) return false;
    let seenMap = {};
    try { seenMap = JSON.parse(localStorage.getItem(SEEN_USER_RESET_KEY) || '{}'); } catch (e) {}
    const seen = seenMap[String(matricule)] || '';
    return remote > seen;
  }
  function markUserResetSeen(matricule) {
    if (!matricule || !state || !state.userCguResetAt) return;
    const remote = state.userCguResetAt[String(matricule)];
    if (!remote) return;
    let seenMap = {};
    try { seenMap = JSON.parse(localStorage.getItem(SEEN_USER_RESET_KEY) || '{}'); } catch (e) {}
    seenMap[String(matricule)] = remote;
    try { localStorage.setItem(SEEN_USER_RESET_KEY, JSON.stringify(seenMap)); } catch (e) {}
  }

  // Construit un app-state.json à jour pour export (utilisé par la
  // Rubrique Administrateur avant téléchargement).
  function buildExport({ toggles, bumpToggleVersion, triggerGlobalReset, triggerUserResetMatricule }) {
    const next = {
      toggles: toggles || (state && state.toggles) || {},
      toggleVersion: getRemoteToggleVersion() + (bumpToggleVersion ? 1 : 0),
      globalCguResetAt: (state && state.globalCguResetAt) || null,
      userCguResetAt: { ...(state && state.userCguResetAt || {}) }
    };
    if (triggerGlobalReset) {
      next.globalCguResetAt = new Date().toISOString();
    }
    if (triggerUserResetMatricule) {
      next.userCguResetAt[String(triggerUserResetMatricule)] = new Date().toISOString();
    }
    state = next;
    return next;
  }

  return {
    init, getRemoteToggles, getRemoteToggleVersion,
    hasNewerToggles, markTogglesSeen,
    hasNewerGlobalReset, markGlobalResetSeen,
    hasNewerUserReset, markUserResetSeen,
    buildExport
  };
})();
