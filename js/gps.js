/* =========================================================
   FIFI RÉGUL — js/gps.js
   Gestion de la géolocalisation utilisateur + capture de coordonnées
   pour le signalement d'erreur (même format que le fichier source :
   "lat, lon" en degrés décimaux).
========================================================= */

const FifiGPS = (function () {

  let lastPosition = null; // {lat, lon, accuracy}
  let watchId = null;

  function formatLikeSource(lat, lon) {
    // Reproduit le format observé dans API_arrets_TBM.xlsx : "44.85359, -0.634545"
    const r = (n) => Math.round(n * 1e6) / 1e6;
    return `${r(lat)}, ${r(lon)}`;
  }

  function startWatching(onUpdate, onError) {
    if (!('geolocation' in navigator)) {
      onError && onError(new Error("Géolocalisation non disponible sur cet appareil/navigateur."));
      return;
    }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        onUpdate && onUpdate(lastPosition);
      },
      (err) => { onError && onError(err); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  function stopWatching() {
    if (watchId !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function getOnce() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error("Géolocalisation non disponible sur cet appareil/navigateur."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          lastPosition = p;
          resolve(p);
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  function getLast() {
    return lastPosition;
  }

  return {
    startWatching,
    stopWatching,
    getOnce,
    getLast,
    formatLikeSource
  };
})();
