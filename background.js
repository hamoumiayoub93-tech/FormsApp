/*
 * AutoFill Admin — service worker.
 *
 * Rôles :
 *   1. ouvrir / ramener au premier plan la fenêtre indépendante du panneau ;
 *   2. mémoriser la dernière fenêtre « normale » ayant eu le focus (= cible) ;
 *   3. SEUL endroit qui appelle l'API Claude (la clé ne quitte jamais ce contexte
 *      et chrome.storage.local ; elle n'est jamais journalisée).
 */
importScripts('lib/utils.js');
const U = self.AFU;

const URL_API = 'https://api.anthropic.com/v1/messages';
const MODELE_PAR_DEFAUT = 'claude-sonnet-5';
const PANNEAU = 'panel.html';

/* ==================================================================== */
/* Fenêtre du panneau                                                    */
/* ==================================================================== */

async function idFenetrePanneau() {
  const { fenetrePanneau } = await chrome.storage.session.get('fenetrePanneau');
  if (!fenetrePanneau) return null;
  try {
    await chrome.windows.get(fenetrePanneau);
    return fenetrePanneau;
  } catch (_) {
    return null; // fermée entre-temps
  }
}

async function ouvrirPanneau() {
  const id = await idFenetrePanneau();
  if (id) {
    await chrome.windows.update(id, { focused: true, drawAttention: true });
    return id;
  }
  // Mémorise la fenêtre courante comme cible avant que le panneau ne prenne le focus.
  try {
    const courante = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (courante) await chrome.storage.session.set({ derniereFenetre: courante.id });
  } catch (_) { /* aucune fenêtre normale */ }
  const f = await chrome.windows.create({ url: PANNEAU, type: 'popup', width: 440, height: 720, focused: true });
  await chrome.storage.session.set({ fenetrePanneau: f.id });
  return f.id;
}

chrome.action.onClicked.addListener(() => { ouvrirPanneau(); });

chrome.windows.onRemoved.addListener(async (id) => {
  const { fenetrePanneau } = await chrome.storage.session.get('fenetrePanneau');
  if (id === fenetrePanneau) await chrome.storage.session.remove('fenetrePanneau');
});

/* Cible par défaut : onglet actif de la dernière fenêtre normale ayant eu le focus. */
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const f = await chrome.windows.get(windowId);
    if (f.type !== 'normal') return; // ignore le panneau (type popup) et les autres fenêtres
    await chrome.storage.session.set({ derniereFenetre: windowId });
  } catch (_) { /* fenêtre disparue */ }
});

/* Raccourci clavier global « remplir la cible ». */
chrome.commands.onCommand.addListener(async (commande) => {
  if (commande !== 'remplir-cible') return;
  const id = await idFenetrePanneau();
  if (!id) { await ouvrirPanneau(); return; }
  chrome.runtime.sendMessage({ type: 'commande', action: 'remplir' }).catch(() => {});
});

/* ==================================================================== */
/* Appels à l'API Claude                                                 */
/* ==================================================================== */

const SYSTEME = 'Tu es un assistant de saisie administrative, rigoureux et prudent. ' +
  'Tu réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans balises Markdown. ' +
  "Tu n'inventes jamais une information : ce qui est absent ou illisible reste vide ou est omis.";

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function lireReglages() {
  const { cleApi, reglages } = await chrome.storage.local.get(['cleApi', 'reglages']);
  return { cleApi: cleApi || '', modele: (reglages && reglages.modele) || MODELE_PAR_DEFAUT };
}

function entetes(cleApi) {
  return {
    'x-api-key': cleApi,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true'
  };
}

async function lireDetailErreur(rep) {
  try {
    const j = await rep.json();
    return (j && j.error && j.error.message) || '';
  } catch (_) {
    return '';
  }
}

/**
 * Appel unique à /v1/messages, avec une nouvelle tentative simple sur 429/529.
 * @param {Array} contenu blocs de contenu du message utilisateur (image/document AVANT le texte)
 * @returns {Promise<object>} JSON analysé de la réponse du modèle
 */
async function appelerClaude(contenu, maxTokens = 16000) {
  const { cleApi, modele } = await lireReglages();
  if (!cleApi) throw new Error('Aucune clé API : renseignez-la dans « Réglages ».');

  const corps = JSON.stringify({
    model: modele,
    max_tokens: maxTokens,
    system: SYSTEME,
    messages: [{ role: 'user', content: contenu }]
  });

  // Garde le service worker éveillé pendant un appel long.
  const maintien = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    for (let tentative = 0; tentative < 2; tentative++) {
      let rep;
      try {
        rep = await fetch(URL_API, { method: 'POST', headers: entetes(cleApi), body: corps });
      } catch (_) {
        throw new Error('Erreur réseau : impossible de joindre api.anthropic.com. Vérifiez votre connexion.');
      }
      if ((rep.status === 429 || rep.status === 529) && tentative === 0) {
        const apres = Number(rep.headers.get('retry-after'));
        await attendre(Number.isFinite(apres) && apres > 0 ? Math.min(apres, 30) * 1000 : 4000);
        continue;
      }
      if (!rep.ok) throw new Error(U.messageErreurHttp(rep.status, await lireDetailErreur(rep)));

      const json = await rep.json();
      if (json.stop_reason === 'refusal') {
        throw new Error('Le modèle a refusé de traiter cette demande. Essayez un autre document ou un autre modèle.');
      }
      const texte = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        return U.parseJsonRobuste(texte);
      } catch (_) {
        if (json.stop_reason === 'max_tokens') {
          throw new Error('Réponse tronquée (document très long). Découpez le document ou réessayez.');
        }
        throw new Error('Réponse illisible du modèle (JSON invalide). Réessayez.');
      }
    }
    throw new Error(U.messageErreurHttp(529));
  } finally {
    clearInterval(maintien);
  }
}

/* ---------- Étape A : extraction ---------- */

const CLES_STANDARD = [
  'civilite', 'sexe', 'nom_naissance', 'nom_usage', 'prenom', 'autres_prenoms', 'date_naissance',
  'lieu_naissance', 'departement_naissance', 'pays_naissance', 'nationalite', 'situation_familiale',
  'adresse_complete', 'adresse_numero', 'adresse_voie', 'adresse_complement', 'code_postal', 'ville', 'pays',
  'telephone', 'telephone_mobile', 'email', 'nir', 'numero_fiscal', 'numero_allocataire_caf',
  'numero_piece_identite', 'type_piece_identite', 'date_delivrance_piece', 'date_expiration_piece',
  'autorite_delivrance', 'iban', 'bic', 'titulaire_compte', 'banque', 'employeur', 'employeur_siret',
  'employeur_adresse', 'emploi', 'date_embauche', 'type_contrat', 'salaire_brut_mensuel', 'salaire_net_mensuel',
  'net_imposable', 'periode_paie', 'revenu_fiscal_reference', 'revenus_salaires_annuels', 'nombre_parts',
  'impot_net', 'annee_revenus', 'reference_avis', 'siret', 'siren', 'numero_dossier', 'numero_client',
  'numero_contrat', 'fournisseur', 'date_document', 'montant_total', 'date_echeance'
];

function promptExtraction(nomDocument, clesExistantes) {
  return `Document fourni : « ${nomDocument} ».
Extrais TOUTES les informations lisibles utiles pour une démarche administrative française (état civil, adresse, contacts, identifiants, banque, emploi, revenus, montants, dates, références).

Réponds avec exactement ce format :
{"champs":[{"cle":"...","libelle":"...","valeur":"...","confiance":0.0,"source":"..."}]}

Règles :
- "cle" : identifiant en snake_case. Utilise de préférence ces clés standard : ${CLES_STANDARD.join(', ')}.
  Pour une autre information, crée une clé explicite (ex. "numero_permis_conduire").
${clesExistantes.length ? `- Clés déjà présentes dans le dossier (réutilise-les si c'est la même information) : ${clesExistantes.join(', ')}.\n` : ''}- Si le document concerne une autre personne que le titulaire principal (conjoint, enfant, employeur...), préfixe la clé (ex. "conjoint_prenom", "enfant1_date_naissance").
- "libelle" : intitulé court en français (ex. "Date de naissance").
- Dates : format ISO AAAA-MM-JJ. Montants : nombre avec point décimal, sans espace ni symbole (indique la devise et la période dans le libellé).
- Nom : distingue "nom_naissance" et "nom_usage" (nom d'époux(se)) quand le document le permet ; sinon utilise "nom_naissance".
- Adresse : donne "adresse_complete" ET sa décomposition (adresse_numero, adresse_voie, adresse_complement, code_postal, ville, pays).
- IBAN sans espaces, en majuscules. Numéro de sécurité sociale (nir) : 13 chiffres + clé, sans espaces.
- Téléphone : tel qu'écrit sur le document.
- N'invente rien. Information attendue mais illisible : "valeur":"" et "confiance":0.
- Si le document contient deux valeurs contradictoires pour la même information, donne les deux avec des clés distinctes et signale-le dans le libellé.
- "confiance" : 1 = parfaitement lisible et certain ; 0.5 = doute sur un caractère ; 0 = illisible.
- "source" : type de document et zone (ex. "Carte d'identité, recto").`;
}

async function extraire({ doc, clesExistantes }) {
  const bloc = doc.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 } };
  const json = await appelerClaude([bloc, { type: 'text', text: promptExtraction(doc.nom, clesExistantes || []) }]);
  const champs = Array.isArray(json.champs) ? json.champs : [];
  return { champs };
}

/* ---------- Étape B : correspondance (texte seulement) ---------- */

function promptCorrespondance({ page, champs, dossier, formatDate, aujourdhui }) {
  return `Tu dois pré-remplir un formulaire web à partir du dossier d'une personne.

PAGE : ${page.titre || ''} (${page.domaine || ''})

CHAMPS DU FORMULAIRE (JSON) :
${JSON.stringify(champs)}

DOSSIER (JSON, clé / libellé / valeur) :
${JSON.stringify(dossier)}

Date du jour : ${aujourdhui}. Format de date préféré pour les champs texte : ${formatDate}.

Réponds avec exactement ce format :
{"remplissages":[{"id":"...","valeur":"...","confiance":0.0,"cle":"clé du dossier utilisée"}]}

Règles :
- N'inclus un champ QUE si le dossier contient l'information. En cas de doute, omets le champ. N'invente jamais.
- Ne remplis jamais : consentements, cases « j'accepte », attestations sur l'honneur, signatures, choix de préférence personnelle absents du dossier.
- Type "texte" avec typeHtml "date" : AAAA-MM-JJ ; "month" : AAAA-MM. Autre champ texte de date : format préféré, sauf si le placeholder, l'aide ou le pattern imposent un autre format (ex. jj.mm.aaaa).
- Champs de date découpés (jour / mois / année séparés) : répartis la valeur (le mois peut être un nom si les options sont des noms).
- "select", "radio" et "liste" avec options : "valeur" = texte EXACT de l'une des options proposées. Sans option adaptée, omets.
- "liste" sans options connues : donne le libellé le plus probable de l'option (ex. "France").
- "checkbox" : "true" ou "false", seulement si le dossier le détermine clairement.
- "autocompletion" (adresse, commune...) : donne le texte à taper, le plus complet et standard possible (ex. "12 rue de la Paix 75002 Paris" pour une adresse, "Paris" pour une commune).
- Civilité, pays, nationalité : adapte au vocabulaire du formulaire (M./Mme, Monsieur/Madame, Mr/Mrs, France/FR...).
- Téléphone : respecte le format attendu ; si un champ d'indicatif est séparé, ne mets que le numéro national dans le champ numéro ; en international, +33 sans le 0.
- IBAN : sans espaces, sauf si le placeholder ou le maxlength montrent des espaces ; IBAN découpé en blocs : répartis-le.
- Nombres : pour typeHtml "number", point décimal sans espace ni symbole ; pour du texte, format français (virgule).
- Nom : « nom » ou « nom de famille » = nom de naissance, sauf si le libellé parle de nom d'usage/marital (utilise alors nom_usage s'il existe).
- Respecte maxlength : si la valeur est trop longue, omets le champ plutôt que de la couper, sauf pour un complément d'adresse.
- Formulaire dans une autre langue : comprends les libellés et adapte les valeurs.
- "confiance" : 1 = certain ; moins de 0.8 = adaptation incertaine à faire vérifier.
- "id" : recopie exactement l'id du champ.`;
}

async function correspondre(params) {
  const json = await appelerClaude([{ type: 'text', text: promptCorrespondance(params) }]);
  return { remplissages: Array.isArray(json.remplissages) ? json.remplissages : [] };
}

/* ---------- Repli vision ---------- */

function promptVision({ dossier, largeur, hauteur }) {
  return `L'image est une capture (${largeur}×${hauteur} pixels) d'un formulaire web dont la structure n'est pas lisible autrement.
Repère les zones de saisie (champs texte, listes, cases) visibles et indique ce qu'il faut y saisir à partir du dossier.

DOSSIER (JSON) :
${JSON.stringify(dossier)}

Réponds avec exactement ce format :
{"zones":[{"libelle":"libellé visible du champ","valeur":"...","x":0,"y":0,"confiance":0.0,"cle":"clé du dossier"}]}

Règles :
- x, y : coordonnées en pixels, dans l'image, du CENTRE de la zone de saisie (pas du libellé).
- Uniquement des zones de saisie. JAMAIS de bouton (envoyer, valider, suivant, payer...), de lien, ni de champ mot de passe, code de sécurité, CAPTCHA ou carte bancaire.
- N'inclus une zone que si le dossier contient l'information. N'invente rien.
- Dates au format visible dans le champ (sinon JJ/MM/AAAA).`;
}

async function vision({ image, dossier, largeur, hauteur }) {
  const json = await appelerClaude([
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
    { type: 'text', text: promptVision({ dossier, largeur, hauteur }) }
  ]);
  return { zones: Array.isArray(json.zones) ? json.zones : [] };
}

/* ---------- Test de la clé (sans consommer de jetons) ---------- */

async function testerCle() {
  const { cleApi, modele } = await lireReglages();
  if (!cleApi) throw new Error('Aucune clé API enregistrée.');
  let rep;
  try {
    rep = await fetch('https://api.anthropic.com/v1/models/' + encodeURIComponent(modele), { headers: entetes(cleApi) });
  } catch (_) {
    throw new Error('Erreur réseau : impossible de joindre api.anthropic.com.');
  }
  if (!rep.ok) throw new Error(U.messageErreurHttp(rep.status, await lireDetailErreur(rep)));
  const j = await rep.json();
  return { message: `Clé valide. Modèle disponible : ${j.display_name || modele}.` };
}

/* ==================================================================== */
/* Messages du panneau                                                   */
/* ==================================================================== */

const ACTIONS = { extraire, correspondre, vision, testerCle };

chrome.runtime.onMessage.addListener((msg, expediteur, repondre) => {
  // N'accepte que les pages de l'extension (jamais un content script).
  if (expediteur.id !== chrome.runtime.id || !String(expediteur.url || '').startsWith(chrome.runtime.getURL(''))) return false;
  const action = msg && ACTIONS[msg.type];
  if (!action) return false;
  action(msg.donnees || {})
    .then((res) => repondre({ ok: true, ...res }))
    .catch((e) => repondre({ ok: false, erreur: e.message || String(e) }));
  return true; // réponse asynchrone
});
