# WordWilds pour Dell Axim X5 (Pocket PC 2003 / Windows CE 4.20)

Portage en C (Win32/GDI pur) du prototype HTML `ref/wordwilds.html`.
Un seul exécutable ARM qui ne dépend que de `coredll.dll`, rendu dans un tampon
240×320 en 16 bits, sans calcul flottant ni allocation dans la boucle de jeu.

## Copier sur la carte mémoire

Le dossier `dist/WordWilds/` contient tout ce qu'il faut. Copiez ces 5 fichiers
dans un même dossier de la carte (par exemple `\Storage Card\WordWilds\`) :

| Fichier | Rôle |
|---|---|
| `wordwilds.exe` | le jeu (ARM, Windows CE) |
| `words.csv` | 20 mots A1 (anglais, français) |
| `sentences.csv` | 12 phrases A2 et 12 phrases B1 |
| `creatures.csv` | les 6 créatures (couleurs, mot, phrase, traduction) |
| `dialog.txt` | les répliques de Prof. Lexi |

Lancez `wordwilds.exe` depuis l'Explorateur de fichiers. Le jeu crée `save.dat`
dans le même dossier. Facultatif : un sous-dossier `voice\` avec des WAV (voir
plus bas) fait apparaître le bouton « Listen ».

## Commandes

| Action | Stylet | Boutons |
|---|---|---|
| Titre : niveau, mode, Start | toucher les boutons | haut/bas : ligne, gauche/droite : choix, centre : Start |
| Marcher | maintenir le stylet sur la carte : le joueur avance case par case vers lui | D-pad (répétition toutes les 110 ms) |
| Parler à Prof. Lexi | marcher vers elle | centre (A) à côté d'elle |
| Dialogue | toucher la boîte, bouton FR | A : suite, gauche/droite : FR |
| Wordex | bouton « Wordex n/6 » en haut | A loin de Prof. Lexi ; flèches : fiche ; A : fermer |
| Répondre | toucher la réponse | flèches + A, ou touches 1 à 4 |
| Indice (Easy) | bouton Hint | flèche haut jusqu'à Hint, puis A (ou touche H) |
| Passer l'attente | — | A |
| Son, effacer la progression, quitter | boutons en haut de l'écran titre | haut depuis la ligne Level |
| Quitter (avec sauvegarde) | bouton Exit du titre | Échap (clavier) |

## Compiler

```sh
sudo tools/install-cegcc.sh   # une fois : cegcc 0.59.1 + bibliothèques i386
./build.sh                    # ce + pc + sim
tests/run_all.sh              # tous les tests du harnais PC
tools/compare.sh build/compare  # captures HTML / natif côte à côte
tools/wine_test.sh build/wine   # le build Win32 sous Wine, piloté au clavier/souris
```

* `build/ce/wordwilds.exe` : Windows CE ARM. `build.sh` vérifie après chaque
  build que c'est un `PE32 executable (Windows CE) ARM` (`file`), au format
  `pei-arm-wince-little` (`objdump`), qu'il n'importe que `COREDLL`, et qu'aucune
  routine flottante (`__adddf3`, `__aeabi_d*`…) n'est liée. objdump affiche le
  sous-système 9 avec l'étiquette « Wince CUI » : la valeur 9 est bien
  `IMAGE_SUBSYSTEM_WINDOWS_CE_GUI`.
* `build/pc/wordwilds-pc.exe` : le même `main.c` pour Windows de bureau
  (`wordwilds-pc.exe -2` pour une fenêtre agrandie).
* `build/sim/wwsim` : harnais Linux (`src/sim.c`) qui remplace la couche Win32 :
  temps simulé, entrées scriptées (`tests/*.txt`), captures PPM, vérifications d'état.

Sous Windows : installez WSL (Ubuntu) et lancez les mêmes commandes dans WSL.

### Plan B : eMbedded Visual C++ 4.0 (si cegcc ne pouvait pas être utilisé)

1. Installer eMbedded Visual C++ 4.0, puis son SP4, puis le *Pocket PC 2003 SDK*.
2. Nouveau projet « WCE Pocket PC 2003 Application » vide, plateforme
   *POCKET PC 2003*, processeur *ARMV4*.
3. Ajouter `src/main.c` et les 8 fichiers du cœur (`render.c font.c sprites.c
   data.c save.c sound.c game.c battle.c`), pas `sim.c`.
4. Définitions : `UNICODE,_UNICODE,_WIN32_WCE=0x420`. Bibliothèque : `coredll.lib`
   (déjà présente par défaut). Compiler en Release.
   Visual Studio 2005/2008 + SDK Pocket PC 2003 : même démarche avec un projet
   « Smart Device / Win32 Smart Device Project ».

## Données

Les fichiers sont générés depuis le HTML par `tools/extract_data.py`, en UTF-8,
CSV standard (guillemets si une valeur contient une virgule). Les lignes vides et
celles qui commencent par `#` sont ignorées. Si un fichier manque ou est abîmé
(colonnes, couleur, UTF-8 invalide, phrase sans `___`…), le jeu affiche à
l'écran le fichier, la ligne et la cause, puis se ferme au toucher.

`save.dat` (texte) : niveau, mode, son, créatures du Wordex (par identifiant) et
questions ratées de chaque niveau. Une sauvegarde abîmée est ignorée en partie
(valeurs bornées, entrées inconnues rejetées), jamais bloquante.

Sons de voix facultatifs (dossier `voice\` à côté de l'exe) :
`w_<mot anglais>.wav` (mots A1 et mot de la créature), `a2_<n>.wav`, `b1_<n>.wav`
(n = numéro de la phrase dans son niveau, à partir de 1), `c_<id>.wav` (phrase de
la créature). Le bouton « Listen » n'apparaît que si le fichier existe.

## Ce qui diffère du HTML, et pourquoi

1. **Police** : Pixelify Sans n'existe pas sur l'Axim. Police pixel 5×7
   proportionnelle intégrée (`font.c`, accents français, ♥ ✓ ✗ ▸ “ ” – ·),
   agrandie ×2/×3 pour les titres. Les textes sont donc un peu plus petits ou plus
   gros selon l'élément, et les retours à la ligne tombent parfois ailleurs.
2. **Couleurs en 16 bits (RGB565)** : l'écran de l'Axim est en 65 536 couleurs ;
   chaque couleur est arrondie au plus proche, et le dégradé du titre est en bandes.
3. **Boutons tactiles d'au moins 24 px** : Hint, Listen, FR, Close et Continue
   sont dessinés en 24 px de haut (17 à 22 px dans le HTML) ; la boîte de dialogue
   remonte donc de 7 px et la grille du Wordex est 7 px plus basse. Seul le bouton
   « Wordex n/6 » de la barre du haut garde son dessin de 17 px (la barre fait
   16 px), mais sa zone tactile fait 26 px.
4. **Contrôles hors écran du HTML ramenés dans l'écran** : le D-pad, le bouton A
   et le bouton Wordex du boîtier dessiné par la page n'existent plus (ce sont les
   vrais boutons de l'Axim). Au stylet, on marche en maintenant le stylet sur la
   carte. Les liens « Son » et « Effacer la progression » de la page deviennent
   les boutons « Sound » et « Reset » en haut du titre ; Reset demande une
   confirmation (« Sure? ») pour éviter un effacement d'un coup de stylet ; un
   bouton « Exit » a été ajouté car l'Axim n'a pas de touche Échap.
5. **Jouable aux boutons seuls** : dans le HTML, il faut un clavier (1 à 4) ou
   une souris pour répondre. Ajouts : curseur de sélection (anneau blanc, comme
   `:focus-visible`) déplacé au D-pad, sur le titre, les réponses, Hint, Listen et
   Continue ; le premier appui sur A pendant une question montre le curseur sans
   répondre, pour éviter une réponse accidentelle en voulant passer l'attente ;
   A loin de Prof. Lexi ouvre le Wordex ; gauche/droite bascule FR dans le
   dialogue ; dans le Wordex, les flèches choisissent la fiche.
6. **Le Wordex se ferme avec A, mais les flèches y servent à choisir** (dans le
   HTML les flèches ne font rien dans le Wordex).
7. **Synthèse vocale absente** : « Listen » et la lecture automatique du mot à
   la capture ne marchent que si un WAV existe (voir Données) ; sinon le bouton
   n'est pas affiché.
8. **Sons** : mêmes bips (fréquences, durées, formes d'onde, enveloppe
   exponentielle), générés au démarrage en 22 050 Hz 16 bits et joués par
   `waveOut` sans bloquer. Volume plus fort que le gain 0,04 du HTML, car le
   haut-parleur de l'Axim est faible. Deux sons qui se chevauchent sont mélangés
   dans un seul tampon.
9. **20 images par seconde** au lieu de 60 : le lissage du déplacement (×0,3 par
   image), la décroissance de la secousse (×0,9) et les animations ont été
   recalculés pour garder les mêmes durées ; les animations restent un peu moins
   fluides.
10. **Option « réduire les animations » du navigateur** non reprise (pas
    d'équivalent sur Windows CE) : le clignotement et le zoom sont toujours joués.
11. **Petits défauts du HTML non reproduits** : appuyer sur A pendant les 800 ms
    qui précèdent la fiche de capture pouvait cliquer le bouton Continue d'une
    fiche précédente cachée et terminer le combat ; ici A ne fait rien tant que la
    fiche n'est pas affichée. Les touches 1 à 4 ne peuvent pas choisir une réponse
    grisée par l'indice (dans le HTML, `click()` y répondait quand même).
12. **Sauvegarde** : `save.dat` au lieu de `localStorage`, et elle conserve en plus
    les questions ratées et le réglage du son (demandé pour l'Axim). Le jeu
    sauvegarde aussi quand il passe en arrière-plan ou se ferme.
13. **Plein écran** : la barre des tâches de Pocket PC est masquée pendant le jeu
    et réaffichée en arrière-plan ou à la fermeture. Une seule instance du jeu
    (relancer l'exe ramène la fenêtre existante).
14. **Message d'erreur des données** : écran ajouté (le HTML n'a pas de fichiers
    externes).
15. **Toast** : le fondu est linéaire (le HTML utilise la courbe CSS « ease »).

## Fichiers source

| Fichier | Contenu |
|---|---|
| `src/main.c` | couche Win32 / Windows CE : fenêtre, DIB 16 bits, minuterie, stylet, touches, fichiers, waveOut |
| `src/render.c` | rectangle, ellipse `E()`, sprites à l'échelle, opacité, sinus entier, `hh()` exact |
| `src/font.c` | police pixel et mise en page du texte |
| `src/sprites.c` | créatures, carte, décor du combat, joueur |
| `src/data.c` | lecture des CSV et de dialog.txt, validation |
| `src/save.c` | save.dat |
| `src/sound.c` | génération des bips |
| `src/game.c` | titre, carte, dialogue, Wordex, toast, entrées |
| `src/battle.c` | combat, questions, niveau adaptatif, capture, fuite |
| `src/sim.c` | harnais de test PC |
