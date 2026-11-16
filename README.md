# Générateur de fiches (pages de titre A4)

Application web 100 % locale (aucun serveur, aucun CDN) qui génère des PDF reprenant la mise
en page InDesign « Cartographie de son équipe ».

## Utilisation

- **+ Nouvelle fiche** : une ligne par fiche dans le tableau (= un PDF).
- **Modifier** : formulaire + aperçu PDF en direct. Enregistrement automatique.
  - Listes : une ligne = une puce. `//` force un retour à la ligne dans une puce.
  - `**texte**` = demi-gras (ex. `**45-90’** de préparation`).
  - Étapes-clé : numérotation automatique.
  - Image du carré en haut à droite : depuis le Finder (recadrée au carré, centrée).
  - Logo : choix entre `logo-1` et `logo-2`.
  - PDF annexé : ajouté à la suite de la page de titre.
- Cases à cocher + **Générer la sélection** / **Générer tout** (ZIP ou fichiers séparés), ou **PDF** sur une ligne.
- **Sauvegarder la base** : fichier `.json` contenant tout (fiches, images, PDF annexés).
  **Restaurer…** pour le recharger (remplacer ou ajouter).

Stockage : les fiches (et leurs images, compressées) sont dans le `localStorage` ;
les PDF annexés et les polices chargées dans l'IndexedDB du navigateur (trop lourds pour le localStorage).

## Fichiers à fournir

| Dossier | Contenu |
|---|---|
| `assets/fonts/` | `ZeitungPro-Regular.otf`, `ZeitungPro-Semibold.otf`, `ZeitungPro-Bold.otf` (voir LISEZMOI) |
| `assets/logos/` | `logo-1.png` et `logo-2.png` (ou .jpg) |
| `assets/pictos/` | pictos Implication / Matériel / Temps (fixes) |

## Mise en ligne (GitHub Pages)

Settings → Pages → *Deploy from a branch* → choisir la branche et `/ (root)`.

En local : ouvrir via un petit serveur (le navigateur bloque la lecture des fichiers en `file://`) :

```bash
python3 -m http.server 8000
```

puis http://localhost:8000

## Librairies embarquées (`vendor/`)

pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, JSZip 3.10.1 (licences MIT).
