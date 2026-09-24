# AutoFill Admin

Extension Chrome (Manifest V3, JavaScript pur, sans build ni dépendance) qui **pré-remplit vos formulaires administratifs** (impôts, CAF, assurance maladie, préfecture, mutuelle, banque, candidatures…) à partir de vos documents : capture d’écran, photo, scan ou PDF.

Le flux tient en trois gestes : **ajouter des documents → « Lire » → « Remplir le formulaire »**. Vous vérifiez et vous validez vous-même.

> Usage strictement personnel, en local, sur un seul PC.

## Ce que l’extension ne fait jamais

- Elle **ne soumet jamais** un formulaire et **ne clique jamais** sur un bouton d’envoi, de validation, de paiement ou « Étape suivante ». Un garde-fou refuse tout clic sur un bouton `submit`, un lien de navigation ou un libellé du type *Envoyer / Valider / Payer / Suivant*. Elle ne simule jamais la touche Entrée.
- Elle **ne touche jamais** aux champs mot de passe, code de sécurité, code reçu par SMS, CAPTCHA, ni aux champs de carte bancaire (`autocomplete="cc-*"`, cryptogramme…).
- Elle **n’invente rien** : une information absente ou illisible reste vide et est signalée (pastille rouge dans le dossier, « sans donnée » dans le résultat).
- Elle ne coche pas les consentements, attestations sur l’honneur ni les CGU.
- Aucune donnée n’est envoyée ailleurs qu’à `api.anthropic.com`. Aucune télémétrie.

## Installation (mode développeur)

1. Téléchargez ou clonez ce dossier sur votre PC (par ex. `C:\Outils\AutoFill-Admin`).
2. Ouvrez `chrome://extensions`.
3. Activez **Mode développeur** (en haut à droite).
4. Cliquez **Charger l’extension non empaquetée** et choisissez le dossier (celui qui contient `manifest.json`).
5. Épinglez l’icône (pièce de puzzle → punaise).
6. Facultatif, pour tester `test/formulaire-test.html` ouvert directement depuis le disque : dans les détails de l’extension, activez **Autoriser l’accès aux URL de fichiers**.

Chrome 121 ou plus récent est requis.

## Créer et saisir la clé API

1. Créez un compte sur <https://console.anthropic.com>, ajoutez un moyen de paiement ou des crédits.
2. Menu **API Keys** → **Create Key** → copiez la clé (`sk-ant-…`). Conseil : fixez une limite de dépense mensuelle dans la console.
3. **Au premier lancement, un assistant s’ouvre tout seul** (juste après l’installation de l’extension) : collez la clé et cliquez **Vérifier et enregistrer**. La clé est testée auprès d’Anthropic *avant* d’être enregistrée (ce test ne consomme aucun jeton) ; une clé mal copiée ou refusée n’est pas conservée. Vous pourrez la changer plus tard dans **Réglages**.

## Lancer l’outil au quotidien

- **Icône épinglée** : pièce de puzzle en haut à droite de Chrome → punaise à côté d’AutoFill Admin. Un clic ouvre le panneau, ou le ramène devant s’il est déjà ouvert.
- **Raccourci clavier** : <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>A</kbd> ouvre le panneau, <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>F</kbd> remplit le formulaire.
- **Raccourci utilisable depuis n’importe quelle application** : `chrome://extensions/shortcuts` (bouton « Ouvrir les raccourcis » de l’assistant) → à côté du raccourci, choisissez la portée **Global**. Chrome doit être ouvert.
- La fenêtre du panneau reste où vous l’avez posée (par exemple sur le second écran).

La clé est enregistrée dans `chrome.storage.local` uniquement. Elle n’est lue que par le service worker, n’est jamais réaffichée, jamais transmise à la page ni journalisée, et ne fait pas partie du dépôt Git (voir `.gitignore`).

## Utilisation avec deux écrans

1. Ouvrez le formulaire administratif dans une fenêtre Chrome (par exemple sur l’écran 2).
2. Cliquez sur l’icône AutoFill Admin (ou <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>A</kbd>) : une **fenêtre indépendante** s’ouvre. Elle ne se ferme pas quand vous cliquez ailleurs ; placez-la où vous voulez. Un nouveau clic sur l’icône la ramène au premier plan.
3. **Cible** : en haut du panneau, le titre et le domaine de l’onglet visé. Par défaut, c’est l’onglet actif de la dernière fenêtre Chrome utilisée (le panneau lui-même est ignoré). Cliquez simplement dans la fenêtre du formulaire puis revenez. « Changer de cible » permet de choisir un onglet précis.
4. **Ajoutez vos documents** :
   - capture <kbd>Win</kbd>+<kbd>Maj</kbd>+<kbd>S</kbd> puis **Lire le presse-papiers** ou <kbd>Ctrl</kbd>+<kbd>V</kbd> dans le panneau ;
   - glisser-déposer ;
   - **Charger un fichier** (PNG, JPG, WEBP, PDF).
   Vous pouvez en ajouter plusieurs (pièce d’identité + bulletin de salaire + RIB…) : les données sont **fusionnées dans un seul dossier**.
5. **Lire** : chaque document est lu une seule fois. Le dossier affiche chaque donnée, sa **provenance** et une **pastille de confiance** (vert ≥ 80 %, orange, rouge = illisible). Tout est modifiable ; × supprime une ligne. Si deux documents se contredisent, rien n’est tranché : un encart « ⚠ Autre valeur » vous laisse choisir.
6. **Remplir le formulaire** : les champs remplis sont entourés en **vert** (sûr) ou **orange** (à vérifier) ; survolez-les pour voir la valeur et sa source. Le résumé indique *X remplis, Y à vérifier, Z sans donnée*.
7. **Formulaire en plusieurs étapes** : passez vous-même à l’étape suivante, puis cliquez **Analyser la page à nouveau**. Seuls les nouveaux champs sont traités. Les champs qui apparaissent pendant le remplissage (ex. « nom du conjoint » après « Marié(e) ») sont complétés automatiquement.
8. **Annuler le remplissage** restaure les valeurs d’origine ; **Effacer les surlignages** retire les contours.

**Vérifiez toujours chaque champ avant de valider.**

### Repli par capture d’écran

Si la page ne présente presque aucun champ exploitable (formulaire dessiné dans un `canvas`, composants opaques), le résultat propose **Analyser par capture d’écran**. Après **votre confirmation explicite**, une capture de la partie visible de l’onglet cible est envoyée à l’API, qui repère les zones à remplir. Les zones correspondant à de vrais champs sont remplies ; pour les zones dessinées (canvas), la valeur est affichée avec un bouton **Copier** : collez-la vous-même.

## Réglages

| Réglage | Par défaut | Rôle |
|---|---|---|
| Clé API | — | Champ masqué, « Tester la clé », « Supprimer la clé » |
| Modèle | Claude Sonnet 5 | Haiku 4.5 pour économiser, Opus 5.5 pour les écritures manuscrites ou scans difficiles |
| Format de date | JJ/MM/AAAA | Pour les champs texte ; les champs `type="date"` reçoivent toujours le format ISO attendu |
| Ne remplir que les champs vides | coché | Ne remplace jamais ce qui est déjà saisi |
| Conserver le dossier entre les sessions | décoché | Sinon, le dossier vit en mémoire de session et disparaît à la fermeture de Chrome |
| Chiffrer avec une phrase secrète | décoché | Optionnel (AES-GCM 256, clé dérivée PBKDF2) ; la phrase n’est stockée nulle part et est demandée à l’ouverture du panneau |
| Tout supprimer | — | Efface dossiers, profils, mémoire des sites et clé API |

## Améliorations ajoutées

1. **Profils multiples (moi, conjoint, enfant…)** — un sélecteur en haut du panneau. Chaque profil a son propre dossier ; on bascule en un clic pour remplir le dossier d’un proche sans mélanger les données. Gestion (nouveau, renommer, supprimer) dans les réglages.
2. **Mémoire des formulaires par site** — après un premier remplissage, l’extension retient pour ce domaine quel champ correspond à quelle donnée et sous quel format. Les fois suivantes (déclaration trimestrielle CAF, actualisation, formulaire refait après une erreur…), le remplissage est **instantané et sans appel API** tant que les données du dossier n’ont pas changé. Elle suit le réglage « Conserver le dossier » (et son chiffrement) ; « Oublier la mémoire des sites » la vide.
3. **Raccourci clavier global** — <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>F</kbd> remplit l’onglet cible sans quitter la fenêtre du formulaire (le panneau doit être ouvert) ; <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>A</kbd> ouvre ou ramène le panneau. Modifiables dans `chrome://extensions/shortcuts`.

Le chiffrement optionnel du dossier conservé est proposé en plus, désactivé par défaut.

## Confidentialité : conseils

- Les images et PDF ne sont **jamais enregistrés** ; ils restent en mémoire du panneau le temps d’être lus, puis ne sont plus jamais renvoyés. Pour un second formulaire, seul le dossier (texte) est réutilisé.
- L’étape de correspondance n’envoie **que du texte** : la description des champs (libellé, type, options) et les données utiles du dossier, jamais les valeurs déjà saisies dans la page.
- La capture de l’onglet (repli vision) n’est envoyée qu’après confirmation. Fermez avant les onglets ou fenêtres superflus visibles dans la page.
- Pour les documents sensibles, préférez recadrer la capture sur les informations utiles.
- Laissez « Conserver le dossier » décoché sur un PC partagé ; sinon activez le chiffrement.
- Les données envoyées à l’API Anthropic sont soumises à ses conditions (par défaut, elles ne servent pas à entraîner les modèles). Consultez <https://www.anthropic.com/legal>.
- Pour tout effacer : **Réglages → Tout supprimer**, puis retirez l’extension si besoin.

## Tests

```
node test/run-tests.js
```

Tests sans dépendance des fonctions pures (`lib/utils.js`) : parsing JSON robuste, dates, normalisation des accents, correspondance des options, formats (IBAN, nombres), garde-fous de sécurité, fusion du dossier et détection des conflits, chiffrement.

Pour un test manuel complet : ouvrez `test/formulaire-test.html` (formulaire en 2 étapes avec radios, cases, select, liste déroulante personnalisée, autocomplétion d’adresse simulée, champ en Shadow DOM, champ dans un iframe, champ conditionnel, composant « contrôlé », et des champs mot de passe / CAPTCHA / carte qui doivent rester vides). Capturez `test/document-exemple.html` (bulletin de salaire **fictif**) comme document source. Le bandeau rouge « formulaire SOUMIS » ne doit jamais apparaître.

Pour régénérer les icônes : `node icons/generer-icones.js`.

## Dépannage

| Symptôme | Solution |
|---|---|
| « Page interne du navigateur » / « Chrome Web Store » | Chrome interdit aux extensions d’écrire sur `chrome://…`, le Web Store, la visionneuse PDF. Choisissez l’onglet du formulaire. |
| « Aucun onglet cible » | Cliquez une fois dans la fenêtre du formulaire, puis revenez au panneau (ou « Changer de cible »). |
| Fichier local refusé | `chrome://extensions` → AutoFill Admin → **Autoriser l’accès aux URL de fichiers**. |
| « Clé API invalide » (401) | Recopiez la clé, vérifiez qu’elle n’a pas été révoquée ; « Tester la clé ». |
| « Limite de débit » (429) / « surchargée » (529) | Une nouvelle tentative est faite automatiquement ; sinon patientez une minute. |
| « Modèle introuvable » | Choisissez un autre modèle dans les réglages. |
| « Lire le presse-papiers » échoue | Cliquez dans le panneau puis <kbd>Ctrl</kbd>+<kbd>V</kbd>. |
| Un champ n’est pas rempli | Vérifiez qu’il est visible (onglet ou section déplié), que la donnée existe dans le dossier, et que « Ne remplir que les champs vides » ne l’exclut pas. Ajoutez la donnée à la main (« + Ajouter une donnée ») si besoin. |
| La page a changé (étape suivante) | **Analyser la page à nouveau**. |
| Valeur mal formatée | Corrigez-la dans le dossier : la mémoire du site sera mise à jour au prochain remplissage. |
| La page semble ne pas « voir » la valeur | Cliquez dans le champ puis ailleurs ; certaines pages ne valident qu’après une vraie frappe. |

## Limites connues

- Iframes d’une autre origine : remplies si Chrome autorise l’injection (cas général) ; les iframes `sandbox` sans scripts ne le sont pas.
- Shadow DOM **fermé** : inaccessible (seuls les Shadow DOM ouverts sont parcourus).
- Formulaires dessinés dans un `canvas` : le repli vision montre les valeurs à copier, sans les saisir (cliquer à l’aveugle dans un canvas risquerait d’actionner un bouton d’envoi).
- Sélecteurs de date purement graphiques (calendrier sans champ texte) : non pilotés ; les champs texte ou `type="date"` le sont.
- Listes personnalisées très exotiques (options rendues hors du DOM, virtualisées au-delà de l’écran) : la valeur peut ne pas être trouvée ; elle est alors signalée « à vérifier ».
- Autocomplétion d’adresse : l’extension tape l’adresse et choisit la suggestion la plus proche ; vérifiez-la toujours.
- « Annuler » ne peut pas désélectionner une option de liste personnalisée ; il restaure les champs classiques, cases, radios et selects.
- Champs protégés par un masque de saisie inhabituel : la valeur peut être reformatée par la page (signalé « à vérifier »).
- Documents : 1 568 px maximum sur le grand côté pour les images ; PDF jusqu’à 32 Mo par requête (avertissement au-delà de 20 Mo). La qualité de lecture dépend de la netteté du document.
- Le modèle peut se tromper : c’est pourquoi rien n’est jamais validé à votre place.

## Structure

```
manifest.json       déclaration MV3 (permissions : storage, scripting, clipboardRead ; hôtes : <all_urls>)
background.js       service worker : fenêtre du panneau, suivi de la cible, SEUL appel à l’API Claude
panel.html/.css/.js fenêtre indépendante : documents, dossier, actions, réglages
content.js          injecté à la demande : détection des champs, remplissage, surlignage, annulation
lib/utils.js        fonctions pures partagées (panneau, service worker, page, tests)
icons/              icônes générées (+ generer-icones.js)
test/               formulaire de test, document fictif, tests node
```

`<all_urls>` est nécessaire pour injecter le script dans n’importe quel site administratif, ses iframes, et pour la capture d’onglet du repli vision ; l’injection n’a lieu que quand vous cliquez sur une action.
