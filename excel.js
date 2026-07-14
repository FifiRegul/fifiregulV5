/* =========================================================
   FIFI RÉGUL — js/excel.js
   Conversion "API_arrets_TBM2.xlsx" -> structure JSON identique à
   data/svarrettbm.json, et conversion "matriculesAM.xlsx" ->
   data/matricules.json, exécutées entièrement dans le navigateur
   (SheetJS), déclenchées depuis la Rubrique Administrateur.

   IMPORTANT (limite technique honnête) :
   Une application 100% cliente (sans serveur) ne peut pas réécrire seule
   un fichier sur OneDrive/GitHub/Free. Chaque bouton "Mise à jour" :
     1) recalcule le JSON en mémoire et l'applique immédiatement à la
        session en cours (transparent pour l'administrateur qui vient
        de cliquer),
     2) propose le téléchargement du nouveau fichier JSON.
   Il faut ensuite déposer ce fichier téléchargé au même endroit sur
   l'hébergement (Free ou GitHub) pour que TOUS les agents en
   bénéficient au prochain chargement.
========================================================= */

const FifiExcel = (function () {

  function findColumn(row, ...candidates) {
    const keys = Object.keys(row);
    const normKeys = keys.map(k => k.toLowerCase().replace(/\s+/g, ''));
    for (const cand of candidates) {
      const cn = cand.toLowerCase().replace(/\s+/g, '');
      const i = normKeys.indexOf(cn);
      if (i !== -1) return keys[i];
    }
    return null;
  }

  function splitCommune(raw) {
    if (!raw) return { nom: "", cp: "" };
    const s = String(raw).trim();
    const m = s.match(/^(.*\S)\s+(\d{5})$/);
    if (m) return { nom: titleCommune(m[1].trim()), cp: m[2] };
    return { nom: titleCommune(s), cp: "" };
  }

  function titleCommune(nom) {
    if (!nom) return nom;
    return nom.split(' ').map(w =>
      w.split('-').map(p => p ? (p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()) : p).join('-')
    ).join(' ');
  }

  function parseGeo(raw) {
    if (!raw) return { lat: null, lon: null };
    const parts = String(raw).split(',');
    if (parts.length !== 2) return { lat: null, lon: null };
    const lat = parseFloat(parts[0].trim());
    const lon = parseFloat(parts[1].trim());
    return { lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon };
  }

  function convertWorkbookToStops(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const stops = [];
    const communesMap = {};
    const lignesSet = new Set();
    const terminusSet = new Set();
    const vehiculesSet = new Set();

    if (!rows.length) return { stops, communes: [], menu: { lignes: [], terminus: [], vehicules: [] } };

    const cols = {
      libelle: findColumn(rows[0], 'LIBELLE'),
      vehicule: findColumn(rows[0], 'VEHICULE'),
      commune: findColumn(rows[0], 'COMMUNE', 'CUMMUNE'),
      nomLigne: findColumn(rows[0], 'NOM DE LIGNE'),
      geo: findColumn(rows[0], 'GEO POINT'),
      numordre: findColumn(rows[0], 'NUMORDRE'),
      numero: findColumn(rows[0], 'NUMERO'),
      arretihm: findColumn(rows[0], 'Arrêt IHM', 'ARRET IHM'),
      terminus: findColumn(rows[0], 'Départ & Terminus Ligne', 'DEPART & TERMINUS LIGNE')
    };

    rows.forEach((row, i) => {
      const libelle = cols.libelle ? row[cols.libelle] : null;
      if (!libelle) return;
      const vehicule = cols.vehicule ? row[cols.vehicule] : null;
      const communeRaw = cols.commune ? row[cols.commune] : null;
      const nomLigneRaw = cols.nomLigne ? row[cols.nomLigne] : null;
      const geoPoint = cols.geo ? row[cols.geo] : null;
      const numordre = cols.numordre ? row[cols.numordre] : null;
      const numero = cols.numero ? row[cols.numero] : null;
      const arretihmRaw = cols.arretihm ? row[cols.arretihm] : null;
      const terminusRaw = cols.terminus ? row[cols.terminus] : null;

      const { nom: communeNom, cp } = splitCommune(communeRaw);
      const { lat, lon } = parseGeo(geoPoint);
      const nomLigne = (nomLigneRaw === null || String(nomLigneRaw).trim() === '') ? null : String(nomLigneRaw).trim();
      const sens = (numordre === null || String(numordre).trim() === '') ? null : String(numordre).trim();
      const terminus = (terminusRaw === null || String(terminusRaw).trim() === '') ? null : String(terminusRaw).trim();
      const arretIHM = (arretihmRaw === null || String(arretihmRaw).trim() === '') ? null : String(arretihmRaw).trim();

      stops.push({
        id: i,
        libelle: String(libelle).trim(),
        vehicule, commune: communeNom, cp,
        nomLigne, sens, arretIHM, terminus, lat, lon, numero
      });

      if (communeNom) communesMap[communeNom] = cp;
      if (nomLigne) lignesSet.add(nomLigne);
      if (terminus) terminusSet.add(terminus);
      if (vehicule) vehiculesSet.add(vehicule);
    });

    const communes = Object.keys(communesMap).sort().map(nom => ({ nom, cp: communesMap[nom] }));

    return {
      stops,
      communes,
      menu: {
        lignes: [...lignesSet].sort(),
        terminus: [...terminusSet].sort(),
        vehicules: [...vehiculesSet].sort()
      }
    };
  }

  function convertWorkbookToMatricules(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (!rows.length) return [];

    const cols = {
      matricule: findColumn(rows[0], 'Matricule'),
      code: findColumn(rows[0], 'Code de connexion', 'Code de Connexion'),
      prenom: findColumn(rows[0], 'Prenom utilisateur', 'Prénom utilisateur')
    };

    return rows
      .filter(r => cols.matricule && r[cols.matricule] != null && cols.code && r[cols.code] != null)
      .map(r => ({
        matricule: String(r[cols.matricule]).trim(),
        code: String(r[cols.code]).trim().toUpperCase(),
        prenom: cols.prenom && r[cols.prenom] ? String(r[cols.prenom]).trim() : '',
        banni: false
      }));
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          resolve(XLSX.read(data, { type: 'array' }));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
      reader.readAsArrayBuffer(file);
    });
  }

  async function processFile(file) {
    const wb = await readWorkbook(file);
    return convertWorkbookToStops(wb);
  }

  async function processMatriculesFile(file) {
    const wb = await readWorkbook(file);
    return convertWorkbookToMatricules(wb);
  }

  return { processFile, processMatriculesFile, downloadJSON };
})();
