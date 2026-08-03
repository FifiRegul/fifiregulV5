# FIFI RÉGUL — Notice ADMINISTRATEUR (v5.2)

⚠️ **Document confidentiel — ne pas diffuser aux utilisateurs.** Il contient le
code d'accès à la Rubrique Administrateur. Voir aussi `SECURITY-NOTES.md` pour
le détail des protections mises en place et leurs limites avant mise en
production.

## 1. Accès à la Rubrique Administrateur

Dans l'application, appuyez sur le cadenas 🔒 en haut à droite de l'écran, puis
saisissez le code :

```
11222AM*
```

> Ce code n'est plus stocké en clair dans le code source : `js/app.js` ne
> contient que son empreinte SHA-256 (voir `SECURITY-NOTES.md`). Pour changer
> ce code, demandez-moi de recalculer la nouvelle empreinte — ne modifiez pas
> la valeur dans `js/app.js` sans cela, la saisie ne serait alors plus jamais
> reconnue.

## 2. Écran de connexion à 2 étapes

- **Première Identification** (nouvel agent, ou tout nouvel appareil) :
  saisie du **matricule**. S'il est reconnu, l'agent passe par les CGU puis se
  voit rappeler son Code de connexion.
- **Connexion** (appareil déjà utilisé) : saisie directe du **Code de
  connexion**, à chaque ouverture de l'application.

Un lien permet de basculer manuellement entre les deux écrans (utile sur un
appareil partagé entre plusieurs agents). Un rafraîchissement accidentel de
la page (ex. geste de scroll sur smartphone) ne déconnecte plus l'agent : la
session reste active tant que l'onglet/l'application n'est pas réellement
fermé(e).

## 3. Options de recherche (activation/désactivation)

Chaque interrupteur active ou désactive l'affichage d'un champ de recherche côté
utilisateur (Nom de l'arrêt, Véhicule, Commune, Nom de la ligne, Départ &
Terminus ligne, position GPS permanente). **Le moteur de recherche interne
reste pleinement fonctionnel même si un champ est masqué** : seul l'affichage
change. Le code postal n'est plus une option : il s'affiche désormais
systématiquement à côté de la commune.

Après toute modification, cliquez sur **📤 Publier ces réglages pour tous les
agents** puis déposez le fichier `app-state.json` téléchargé dans `/data` :
chaque agent adoptera automatiquement les nouveaux réglages à sa prochaine
ouverture de l'application (voir §6).

## 4. Mise à jour de la base des arrêts

1. Remplacez le fichier `API_arrets_TBM2.xlsx` à la racine du projet par la
   nouvelle version (mêmes colonnes : LIBELLE, VEHICULE, COMMUNE, NOM DE LIGNE,
   GEO POINT, NUMORDRE, NUMERO, Arrêt IHM, Départ & Terminus Ligne).
2. Dans la Rubrique Administrateur → **Mise à jour Base arrêts** → sélectionnez
   ce fichier → cliquez sur le bouton.
3. Trois fichiers sont automatiquement proposés au téléchargement :
   `svarrettbm.json`, `communes.json`, `menu-lists.json`.
4. Déposez ces 3 fichiers dans le dossier `/data` de votre hébergement (Free ou
   GitHub) pour que la mise à jour s'applique à tous les agents.

> Une application sans serveur ne peut pas réécrire seule un fichier sur son
> propre hébergement : cette étape manuelle de dépose est nécessaire.

## 5. Gestion des utilisateurs (matricules)

### Ajouter / modifier des agents

1. Mettez à jour `matriculesAM.xlsx` (colonnes : Matricule, Code de connexion,
   Prénom utilisateur).
2. Rubrique Administrateur → **Gestion des utilisateurs** → sélectionnez le
   fichier → **Mettre à jour les matricules**.
3. Déposez le fichier `matricules.json` téléchargé dans `/data`.

### Bannir un agent (motif : départ du service)

1. Dans le champ **Bannir un matricule**, recherchez par matricule ou prénom et
   sélectionnez l'agent.
2. Cliquez sur **🚫 Bannir (départ du service)**.
3. Déposez le fichier `matricules.json` téléchargé dans `/data` : l'agent ne
   pourra plus se connecter sur aucun appareil dès que son navigateur aura
   rechargé les données (généralement à sa prochaine ouverture de l'app).
4. Le bouton **✅ Réactiver** fait l'inverse si besoin.

## 6. Réinitialisation des CGU (globale, individuelle, ou locale)

Trois niveaux, du plus large au plus ciblé :

- **🌐 Réinitialiser les CGU pour TOUS les agents** : déclenche une RAZ CGU
  globale. Déposez le fichier `app-state.json` téléchargé dans `/data` : à sa
  prochaine connexion, **chaque agent** devra revalider les CGU, quel que soit
  son appareil.
- **RAZ CGU individuelle (matricule d'un agent)** : ne réinitialise que
  l'agent concerné. Même principe : déposez `app-state.json` dans `/data`.
  L'agent visé devra revalider les CGU à sa prochaine connexion, sur
  n'importe quel appareil.
- **🔄 Réinitialiser CGU sur cet appareil** : action locale et immédiate, sans
  fichier à redéposer — n'affecte que l'appareil utilisé au moment du clic
  (pratique pour vos propres tests).

### Comment ça fonctionne techniquement (transparence)

FIFI Régul reste une application **100 % cliente** (HTML + JavaScript + JSON,
sans serveur), conformément au cahier des charges — il n'y a donc pas de vrai
serveur central qui "pousse" une notification aux agents en temps réel. La
RAZ globale et individuelle fonctionnent malgré tout pour **tous les
appareils**, via le même principe que la mise à jour de la base ou des
matricules : le fichier partagé `data/app-state.json` contient une date de
réinitialisation ; chaque agent le récupère à chaque ouverture de
l'application et compare cette date à la dernière qu'il a lui-même vue. Si
elle est plus récente, ses CGU locales sont effacées automatiquement — sans
action de sa part. Le délai réel dépend donc uniquement du moment où l'agent
rouvre l'application après votre dépôt du fichier, pas d'une limite du
mécanisme lui-même.

Il n'existe en revanche toujours pas de fichier `cgu_validations.log` unique
et consultable à distance : chaque acceptation reste physiquement enregistrée
sur l'appareil de l'agent concerné. Si vous avez besoin d'une traçabilité
centralisée et exhaustive de toutes les acceptations (ex. obligation
interne), la seule solution fiable est d'ajouter un petit service serveur
(par exemple un simple formulaire Google Forms, ou un script PHP léger sur
l'hébergement Free) qui reçoit un appel à chaque acceptation — dites-le moi si
vous voulez que je l'ajoute.

Le bannissement, lui, a toujours fonctionné pour tous les appareils dès que
`matricules.json` est mis à jour (§5), car il est vérifié à chaque connexion
depuis le fichier de données, pas depuis le stockage local de l'agent.

## 7. Adresses e-mail utilisées

Définie en haut de `js/app.js` :

```js
const ADMIN_EMAILS = ["fifiregul@free.fr"];
```

Cette adresse reçoit les e-mails de signalement d'erreur de géolocalisation.
Les demandes d'accès (matricule inconnu) sont envoyées également à
`fifiregul@free.fr`. Si une deuxième adresse (ex. une adresse @keolis.com)
doit être ajoutée en copie plus tard, dites-le-moi : il suffit de rajouter
une entrée dans ce tableau.

## 8. Remplacer les visuels

Les vraies images TBM sont déjà en place :

| Élément | Chemin |
|---|---|
| Logo TBM | `images/imagelogoTBM/logo.png` |
| Image de fond (écran de chargement, 3 s obligatoires) | `images/imagefond/bus-bg.png` |
| Icône "FIFI Recherche" | `images/FIFIRecherche.png` |
| Icône "FIFI Résultat(s)" | `images/FIFIResultat.png` |
| Icônes d'installation PWA | `icons/icon-192.png`, `icons/icon-512.png` |

## 9. Rappel copyright — logos Google Maps / Waze / Plans

Les boutons "Naviguer vers" pointent bien vers Google Maps, Waze et Apple
Plans, mais utilisent des pastilles génériques (lettres G / W / P) plutôt que
les logos officiels de ces marques : je ne peux pas reproduire des logos de
marques déposées. Si vous disposez d'icônes sous licence libre ou d'un accord
d'utilisation, transmettez-les-moi et je les intègre à la place.

## 10. Sécurité avant mise en production

Voir `SECURITY-NOTES.md` pour le détail complet : ce qui a été renforcé
(code admin haché, échappement anti-injection, en-têtes CSP, anti-indexation)
et surtout ce qui **ne peut pas** être réellement protégé sans un minimum de
serveur — en particulier l'exposition de `data/matricules.json`, à lire
avant toute mise en production réelle avec des données d'agents.
