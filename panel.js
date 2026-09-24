/*
 * AutoFill Admin — logique du panneau (fenêtre indépendante).
 *
 * Flux principal : ajouter des documents -> « Lire » -> « Remplir le formulaire ».
 * Le panneau orchestre ; les appels API passent par le service worker
 * (background.js) et l'écriture dans la page par content.js.
 */
'use strict';

const U = window.AFU;
const $ = (id) => document.getElementById(id);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const REGLAGES_DEFAUT = {
  modele: 'claude-sonnet-5',
  formatDate: 'JJ/MM/AAAA',
  seulementVides: true,
  conserver: false,
  chiffrer: false
};

const TAILLE_MAX_IMAGE = 1568;          // grand côté, en pixels
const PDF_AVERTISSEMENT = 20 * 1024 * 1024;

const etat = {
  reglages: { ...REGLAGES_DEFAUT },
  donnees: donneesVides(),
  cleEnregistree: false,
  phrase: null,          // phrase secrète, en mémoire seulement
  coffreVerrouille: false, // dossier chiffré non ouvert : on n'écrase pas le coffre
  docs: [],              // documents de la session (jamais conservés)
  cible: null,
  cibleEpinglee: null,   // id d'onglet choisi à la main, sinon automatique
  page: null,            // { tabId, url, traites:Set } — champs déjà traités sur la page
  occupe: false
};

function donneesVides() {
  return { profils: { moi: { nom: 'Moi', dossier: [] } }, profilActif: 'moi', memoire: {} };
}

function normaliserDonnees(d) {
  const res = { ...donneesVides(), ...(d || {}) };
  if (!res.profils || !Object.keys(res.profils).length) res.profils = donneesVides().profils;
  if (!res.profils[res.profilActif]) res.profilActif = Object.keys(res.profils)[0];
  res.memoire = res.memoire || {};
  return res;
}

function profil() { return etat.donnees.profils[etat.donnees.profilActif]; }

/* ==================================================================== */
/* Stockage                                                              */
/* ==================================================================== */

async function charger() {
  const { reglages, coffre, cleApi } = await chrome.storage.local.get(['reglages', 'coffre', 'cleApi']);
  etat.reglages = { ...REGLAGES_DEFAUT, ...(reglages || {}) };
  etat.cleEnregistree = !!cleApi;

  if (etat.reglages.conserver && coffre) {
    if (coffre.chiffre) {
      etat.coffreVerrouille = true;
      const phrase = await demanderPhrase({
        titre: 'Dossier chiffré',
        texte: 'Saisissez votre phrase secrète pour ouvrir le dossier conservé.',
        ok: 'Déverrouiller',
        annuler: 'Continuer sans le dossier conservé',
        verifier: async (p) => { etat.donnees = normaliserDonnees(await U.dechiffrer(coffre.chiffre, p)); }
      });
      if (phrase) {
        etat.phrase = phrase;
        etat.coffreVerrouille = false;
      } else {
        statut('Dossier conservé non ouvert : vos modifications ne l’écraseront pas.', 'erreur');
      }
    } else if (coffre.clair) {
      etat.donnees = normaliserDonnees(coffre.clair);
    }
  } else {
    const { donnees } = await chrome.storage.session.get('donnees');
    if (donnees) etat.donnees = normaliserDonnees(donnees);
  }
}

let minuterieSauvegarde = null;
function sauvegarder() {
  clearTimeout(minuterieSauvegarde);
  minuterieSauvegarde = setTimeout(() => sauvegarderMaintenant().catch((e) => statut('Enregistrement impossible : ' + e.message, 'erreur')), 300);
}

async function sauvegarderMaintenant() {
  const d = etat.donnees;
  if (etat.reglages.conserver) {
    if (etat.coffreVerrouille) { await chrome.storage.session.set({ donnees: d }); return; }
    if (etat.reglages.chiffrer && etat.phrase) {
      await chrome.storage.local.set({ coffre: { chiffre: await U.chiffrer(d, etat.phrase) } });
    } else {
      await chrome.storage.local.set({ coffre: { clair: d } });
    }
    await chrome.storage.session.remove('donnees');
  } else {
    // Mémoire de session uniquement : effacée à la fermeture de Chrome.
    await chrome.storage.session.set({ donnees: d });
  }
}

function sauvegarderReglages() {
  return chrome.storage.local.set({ reglages: etat.reglages });
}

/* ==================================================================== */
/* Boîte « phrase secrète »                                              */
/* ==================================================================== */

/**
 * Demande une phrase secrète. Résout avec la phrase, ou null si annulé.
 * @param {{titre, texte, ok, annuler, confirmer?:boolean, verifier?:Function}} o
 */
function demanderPhrase(o) {
  return new Promise((resoudre) => {
    const modal = $('modal');
    $('titreModal').textContent = o.titre;
    $('texteModal').textContent = o.texte;
    $('btnModalOk').textContent = o.ok || 'Valider';
    $('btnModalAnnuler').textContent = o.annuler || 'Annuler';
    $('phrase1').value = '';
    $('phrase2').value = '';
    $('phrase2').hidden = !o.confirmer;
    $('erreurModal').hidden = true;
    modal.hidden = false;
    $('phrase1').focus();

    const fin = (valeur) => {
      modal.hidden = true;
      $('formModal').onsubmit = null;
      $('btnModalAnnuler').onclick = null;
      resoudre(valeur);
    };
    const erreur = (m) => { $('erreurModal').textContent = m; $('erreurModal').hidden = false; };

    $('formModal').onsubmit = async (e) => {
      e.preventDefault();
      const p = $('phrase1').value;
      if (p.length < 8) return erreur('Au moins 8 caractères.');
      if (o.confirmer && p !== $('phrase2').value) return erreur('Les deux saisies diffèrent.');
      if (o.verifier) {
        try { await o.verifier(p); } catch (err) { return erreur(err.message); }
      }
      fin(p);
    };
    $('btnModalAnnuler').onclick = () => fin(null);
  });
}

/* ==================================================================== */
/* Affichage : état, profils, documents, dossier                         */
/* ==================================================================== */

function statut(message, type) {
  const el = $('etat');
  el.textContent = message || '';
  el.className = 'etat' + (type ? ' ' + type : '');
}

function occupe(oui, message) {
  etat.occupe = oui;
  for (const id of ['btnLire', 'btnRemplir', 'btnReanalyser', 'btnAnnuler', 'btnVision']) $(id).disabled = oui;
  if (!oui) majBoutonLire();
  if (message) statut(message, oui ? 'occupe' : '');
}

function el(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants) if (e != null) n.append(e);
  return n;
}

function afficherProfils() {
  const sel = $('selProfil');
  sel.innerHTML = '';
  for (const [id, p] of Object.entries(etat.donnees.profils)) {
    sel.append(el('option', { value: id }, p.nom));
  }
  sel.value = etat.donnees.profilActif;
  const nbSites = Object.keys(etat.donnees.memoire || {}).length;
  $('infoMemoire').textContent = nbSites ? `${nbSites} site(s) mémorisé(s)` : '';
}

function afficherDocs() {
  const ul = $('listeDocs');
  ul.innerHTML = '';
  for (const d of etat.docs) {
    const libelles = { attente: 'à lire', lecture: 'lecture…', lu: 'lu', erreur: 'erreur' };
    ul.append(el('li', {},
      d.apercu ? el('img', { src: d.apercu, alt: '' }) : el('span', { class: 'pdf' }, 'PDF'),
      el('div', { class: 'nom', title: d.nom }, d.nom,
        el('div', { class: 'statut ' + d.statut }, libelles[d.statut] + (d.message ? ' — ' + d.message : ''))),
      el('button', { class: 'suppr', title: 'Retirer ce document', onclick: () => retirerDoc(d.id), disabled: d.statut === 'lecture' }, '×')
    ));
  }
  majBoutonLire();
}

function majBoutonLire() {
  const n = etat.docs.filter((d) => d.statut === 'attente' || d.statut === 'erreur').length;
  $('btnLire').disabled = etat.occupe || n === 0;
  $('btnLire').textContent = n > 1 ? `Lire les ${n} documents` : 'Lire';
}

function retirerDoc(id) {
  const d = etat.docs.find((x) => x.id === id);
  if (d && d.apercu) URL.revokeObjectURL(d.apercu);
  etat.docs = etat.docs.filter((x) => x.id !== id);
  afficherDocs();
}

function classeConfiance(r) {
  if (!r.valeur) return 'basse';
  if (r.confiance >= 0.8) return 'haute';
  if (r.confiance >= 0.5) return 'moyenne';
  return 'basse';
}

function afficherDossier() {
  const lignes = profil().dossier;
  const tb = $('tableDossier').tBodies[0];
  tb.innerHTML = '';
  $('tableDossier').hidden = !lignes.length;
  $('dossierVide').hidden = !!lignes.length;
  const nbConflits = lignes.filter((r) => r.conflits && r.conflits.length).length;
  $('nbDonnees').textContent = lignes.length
    ? `(${lignes.length}${nbConflits ? ` · ${nbConflits} conflit${nbConflits > 1 ? 's' : ''}` : ''})` : '';

  for (const r of lignes) {
    const pastille = el('span', { class: 'pastille ' + classeConfiance(r), title: r.valeur ? `Confiance : ${Math.round(r.confiance * 100)} %` : 'Illisible ou absent' });

    const celluleLibelle = r.manuel
      ? el('td', {}, el('input', {
        class: 'libre', value: r.libelle, 'aria-label': 'Nom de la donnée',
        onchange: (e) => { r.libelle = e.target.value.trim() || 'Donnée'; r.cle = U.normaliserCle(r.libelle); sauvegarder(); }
      }))
      : el('td', { title: 'Clé : ' + r.cle }, el('div', { class: 'libelle' }, r.libelle), el('div', { class: 'source' }, r.source));

    const saisie = el('input', {
      value: r.valeur, class: r.valeur ? '' : 'vide', placeholder: 'illisible / absent', 'aria-label': r.libelle,
      onchange: (e) => {
        r.valeur = e.target.value.trim();
        r.confiance = r.valeur ? 1 : 0;
        if (!/corrigé/.test(r.source)) r.source = (r.source ? r.source + ' ' : '') + '(corrigé)';
        sauvegarder();
        afficherDossier();
      }
    });
    const celluleValeur = el('td', {}, saisie);
    for (const alt of r.conflits || []) {
      celluleValeur.append(el('div', { class: 'conflit' },
        '⚠ Autre valeur : ', el('strong', {}, alt.valeur), ` (${alt.source}) `,
        el('button', {
          onclick: () => {
            r.conflits = r.conflits.filter((x) => x !== alt).concat([{ valeur: r.valeur, source: r.source, confiance: r.confiance }]);
            Object.assign(r, { valeur: alt.valeur, source: alt.source, confiance: alt.confiance });
            r.conflits = r.conflits.filter((x) => x.valeur);
            sauvegarder(); afficherDossier();
          }
        }, 'Utiliser'),
        ' ',
        el('button', { onclick: () => { r.conflits = r.conflits.filter((x) => x !== alt); sauvegarder(); afficherDossier(); } }, 'Ignorer')
      ));
    }

    tb.append(el('tr', {},
      celluleLibelle,
      celluleValeur,
      el('td', {}, pastille),
      el('td', {}, el('button', {
        class: 'suppr', title: 'Supprimer cette ligne',
        onclick: () => { profil().dossier = profil().dossier.filter((x) => x !== r); sauvegarder(); afficherDossier(); }
      }, '×'))
    ));
  }
}

/* ==================================================================== */
/* Cible                                                                 */
/* ==================================================================== */

async function determinerCible() {
  let tab = null;
  if (etat.cibleEpinglee) {
    try { tab = await chrome.tabs.get(etat.cibleEpinglee); } catch (_) { etat.cibleEpinglee = null; }
  }
  if (!tab) {
    const { derniereFenetre } = await chrome.storage.session.get('derniereFenetre');
    let onglets = [];
    if (derniereFenetre) {
      try { onglets = await chrome.tabs.query({ active: true, windowId: derniereFenetre }); } catch (_) { onglets = []; }
    }
    if (!onglets.length) {
      try {
        const f = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        if (f) onglets = await chrome.tabs.query({ active: true, windowId: f.id });
      } catch (_) { /* aucune fenêtre */ }
    }
    tab = onglets[0] || null;
  }

  if (!tab) {
    etat.cible = null;
  } else {
    const url = tab.url || tab.pendingUrl || '';
    let verif = url ? U.verifierCible(url)
      : { ok: false, raison: 'Page protégée (page interne de Chrome ou non autorisée) : impossible d’y écrire.' };
    if (verif.ok && url.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
      verif = { ok: false, raison: 'Fichier local : activez « Autoriser l’accès aux URL de fichiers » pour AutoFill Admin dans chrome://extensions.' };
    }
    etat.cible = { tabId: tab.id, windowId: tab.windowId, titre: tab.title || url, url, domaine: U.domaineDe(url), verif };
  }
  afficherCible();
}

let minuterieCible = null;
function planifierCible() {
  clearTimeout(minuterieCible);
  minuterieCible = setTimeout(determinerCible, 150);
}

function afficherCible() {
  const c = etat.cible;
  $('cibleTitre').textContent = c ? c.titre : 'Aucun onglet';
  $('cibleTitre').title = c ? c.titre : '';
  $('cibleDomaine').textContent = c ? c.domaine + (etat.cibleEpinglee ? ' · choisie manuellement' : '') : '';
  const ko = !c || !c.verif.ok;
  $('carteCible').classList.toggle('ko', ko);
  $('cibleErreur').hidden = !ko;
  $('cibleErreur').textContent = !c ? 'Cliquez dans la fenêtre Chrome du formulaire, puis revenez ici.' : (c.verif.raison || '');
}

async function remplirListeOnglets() {
  const sel = $('selOnglet');
  sel.innerHTML = '';
  sel.append(el('option', { value: '' }, 'Automatique : onglet actif de la dernière fenêtre utilisée'));
  const onglets = await chrome.tabs.query({ windowType: 'normal' });
  for (const t of onglets) {
    const url = t.url || '';
    const ok = url && U.verifierCible(url).ok;
    sel.append(el('option', { value: String(t.id), disabled: !ok },
      `${(t.title || url || 'Onglet').slice(0, 70)} — ${U.domaineDe(url) || 'protégé'}${ok ? '' : ' (non accessible)'}`));
  }
  sel.value = etat.cibleEpinglee ? String(etat.cibleEpinglee) : '';
}

/* ==================================================================== */
/* Page cible : injection et exécution                                   */
/* ==================================================================== */

function messageInjection(e) {
  const m = String(e && e.message || e);
  if (/gallery|webstore/i.test(m)) return 'Le Chrome Web Store est protégé : aucune extension ne peut y écrire.';
  if (/chrome:\/\/|Cannot access|cannot be scripted|permission/i.test(m)) return 'Chrome interdit l’accès à cette page. Choisissez un autre onglet.';
  if (/error page/i.test(m)) return 'L’onglet affiche une page d’erreur. Rechargez-le.';
  if (/No tab with id/i.test(m)) return 'L’onglet cible a été fermé.';
  return 'Impossible d’accéder à la page : ' + m;
}

async function injecter(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['lib/utils.js', 'content.js'] });
  } catch (e) {
    throw new Error(messageInjection(e));
  }
}

/** Appelle window.__afa[methode](...args) dans les cadres visés. */
async function executer(tabId, methode, args, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  try {
    return await chrome.scripting.executeScript({
      target,
      func: (m, a) => (window.__afa && window.__afa[m] ? window.__afa[m](...a) : null),
      args: [methode, args || []]
    });
  } catch (e) {
    throw new Error(messageInjection(e));
  }
}

/** Analyse tous les cadres ; les ids deviennent « frameId:idLocal ». */
async function analyserPage(tabId) {
  await injecter(tabId);
  const resultats = await executer(tabId, 'analyser', []);
  const champs = [];
  let interdits = 0;
  for (const r of resultats) {
    if (!r || !r.result) continue;
    interdits += r.result.interdits || 0;
    for (const c of r.result.champs) champs.push({ ...c, id: r.frameId + ':' + c.id });
  }
  return { champs, interdits };
}

function pageCourante(cible) {
  if (!etat.page || etat.page.tabId !== cible.tabId || etat.page.url !== cible.url) {
    etat.page = { tabId: cible.tabId, url: cible.url, traites: new Set() };
  }
  return etat.page;
}

async function cibleValide() {
  await determinerCible();
  const c = etat.cible;
  if (!c) { statut('Aucun onglet cible : cliquez dans la fenêtre du formulaire puis revenez.', 'erreur'); return null; }
  if (!c.verif.ok) { statut(c.verif.raison, 'erreur'); return null; }
  return c;
}

/* ==================================================================== */
/* Appels au service worker                                              */
/* ==================================================================== */

async function envoyer(type, donnees) {
  let rep;
  try {
    rep = await chrome.runtime.sendMessage({ type, donnees });
  } catch (e) {
    throw new Error('Le service de l’extension ne répond pas. Réessayez.');
  }
  if (!rep) throw new Error('Pas de réponse du service de l’extension. Réessayez.');
  if (!rep.ok) throw new Error(rep.erreur || 'Erreur inconnue');
  return rep;
}

/* ==================================================================== */
/* Documents                                                             */
/* ==================================================================== */

function lireBase64(blob) {
  return new Promise((resoudre, rejeter) => {
    const r = new FileReader();
    r.onload = () => resoudre(String(r.result).split(',')[1] || '');
    r.onerror = () => rejeter(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(blob);
  });
}

/** Réduit une image à 1568 px max (grand côté) et la convertit en JPEG. */
async function preparerImage(blob, tailleMax = TAILLE_MAX_IMAGE) {
  const bmp = await createImageBitmap(blob);
  const echelle = Math.min(1, tailleMax / Math.max(bmp.width, bmp.height));
  const largeur = Math.max(1, Math.round(bmp.width * echelle));
  const hauteur = Math.max(1, Math.round(bmp.height * echelle));
  const toile = new OffscreenCanvas(largeur, hauteur);
  const ctx = toile.getContext('2d');
  ctx.fillStyle = '#ffffff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.drawImage(bmp, 0, 0, largeur, hauteur);
  bmp.close();
  const sortie = await toile.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return { base64: await lireBase64(sortie), blob: sortie, largeur, hauteur };
}

function nomCapture() {
  const d = new Date();
  return `Capture ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

async function ajouterFichier(fichier) {
  const type = fichier.type || '';
  let nom = fichier.name || nomCapture();
  if (/^image\.(png|jpe?g)$/i.test(nom)) nom = nomCapture(); // capture collée
  try {
    if (type === 'application/pdf' || /\.pdf$/i.test(nom)) {
      if (fichier.size > PDF_AVERTISSEMENT) {
        const mo = (fichier.size / 1024 / 1024).toFixed(1);
        if (!confirm(`« ${nom} » fait ${mo} Mo. Au-delà de 20 Mo, l’API risque de le refuser (32 Mo maximum par requête). L’ajouter quand même ?`)) return;
      }
      etat.docs.push({ id: crypto.randomUUID(), nom, mediaType: 'application/pdf', base64: await lireBase64(fichier), apercu: null, statut: 'attente' });
    } else if (/^image\/(png|jpeg|webp|gif|bmp)$/.test(type)) {
      const img = await preparerImage(fichier);
      etat.docs.push({ id: crypto.randomUUID(), nom, mediaType: 'image/jpeg', base64: img.base64, apercu: URL.createObjectURL(img.blob), statut: 'attente' });
    } else {
      statut(`Format non pris en charge : ${nom} (PNG, JPG, WEBP ou PDF).`, 'erreur');
      return;
    }
    afficherDocs();
    statut(`« ${nom} » ajouté. Cliquez sur « Lire » quand tous vos documents sont là.`);
  } catch (e) {
    statut(`Impossible d’ajouter « ${nom} » : ${e.message}`, 'erreur');
  }
}

async function lirePressePapiers() {
  try {
    const elements = await navigator.clipboard.read();
    let n = 0;
    for (const it of elements) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await it.getType(type);
      await ajouterFichier(new File([blob], nomCapture(), { type }));
      n++;
    }
    if (!n) statut('Le presse-papiers ne contient pas d’image. Faites une capture avec Win+Maj+S puis réessayez.', 'erreur');
  } catch (e) {
    statut('Lecture du presse-papiers impossible (' + e.message + '). Cliquez dans cette fenêtre puis faites Ctrl+V.', 'erreur');
  }
}

async function lireDocuments() {
  const aLire = etat.docs.filter((d) => d.statut === 'attente' || d.statut === 'erreur');
  if (!aLire.length || etat.occupe) return;
  if (!etat.cleEnregistree) return demanderCle();
  occupe(true);
  let nbLus = 0;
  for (const doc of aLire) {
    if (!doc.base64) { doc.statut = 'erreur'; doc.message = 'document à ajouter de nouveau'; continue; }
    doc.statut = 'lecture';
    doc.message = '';
    afficherDocs();
    statut(`Lecture de « ${doc.nom} »…`, 'occupe');
    try {
      const rep = await envoyer('extraire', {
        doc: { nom: doc.nom, mediaType: doc.mediaType, base64: doc.base64 },
        clesExistantes: profil().dossier.map((r) => r.cle)
      });
      profil().dossier = U.fusionnerDossier(profil().dossier, rep.champs, doc.nom);
      doc.statut = 'lu';
      doc.message = `${rep.champs.filter((c) => c.valeur).length} donnée(s)`;
      doc.base64 = null; // le document n'est plus jamais renvoyé : on réutilise le dossier
      nbLus++;
    } catch (e) {
      doc.statut = 'erreur';
      doc.message = e.message;
      if (/clé api|réseau/i.test(e.message)) { afficherDocs(); break; }
    }
    afficherDocs();
    afficherDossier();
    sauvegarder();
  }
  occupe(false);
  const erreurs = etat.docs.filter((d) => d.statut === 'erreur');
  const conflits = profil().dossier.filter((r) => r.conflits && r.conflits.length).length;
  if (erreurs.length) statut(erreurs[0].message, 'erreur');
  else statut(`${nbLus} document(s) lu(s).` + (conflits ? ` ${conflits} conflit(s) à arbitrer dans le dossier.` : ' Vérifiez le dossier puis « Remplir le formulaire ».'), 'succes');
}

function demanderCle() {
  $('reglages').open = true;
  $('cleApi').focus();
  statut('Saisissez d’abord votre clé API dans les réglages.', 'erreur');
}

/* ==================================================================== */
/* Correspondance (mémoire par site + API)                               */
/* ==================================================================== */

/** Ne garde que ce qui aide le modèle (texte seulement, jamais de valeur saisie). */
function champPourApi(c) {
  const garder = ['type', 'typeHtml', 'libelle', 'name', 'placeholder', 'autocomplete', 'aide', 'options',
    'suggestions', 'requis', 'section', 'groupe', 'maxlength', 'pattern'];
  const o = {};
  for (const k of garder) {
    const v = c[k];
    if (v === '' || v == null || v === false || (Array.isArray(v) && !v.length)) continue;
    o[k] = v;
  }
  if (!o.libelle && c.idAttr) o.idHtml = c.idAttr;
  return o;
}

async function obtenirRemplissages(champs, cible) {
  const dossier = profil().dossier.filter((r) => r.valeur);
  const domaine = cible.domaine || 'inconnu';
  const memoire = { ...(etat.donnees.memoire[domaine] || {}) };
  // Empreinte du dossier : un champ « sans donnée » le reste tant que le dossier ne change pas.
  const emp = U.empreinte(dossier.map((r) => r.cle + '=' + U.normaliser(r.valeur)).sort().join('|'));
  const resultat = [];
  const aDemander = [];

  // 1. Mémoire du site : mêmes champs, mêmes données -> aucun appel API.
  for (const c of champs) {
    const m = memoire[U.signatureChamp(c)];
    if (m && m.aucune) {
      if (m.empreinte === emp) continue; // déjà demandé : aucune donnée pour ce champ
      aDemander.push(c);
      continue;
    }
    const ligne = m && dossier.find((r) => r.cle === m.cle);
    if (ligne && U.normaliser(ligne.valeur) === U.normaliser(m.src) && (!c.options || c.options.includes(m.out))) {
      resultat.push({ id: c.id, valeur: m.out, confiance: Math.min(0.95, ligne.confiance), source: `${ligne.libelle} (mémoire du site)` });
    } else {
      aDemander.push(c);
    }
  }

  // 2. Le reste : un seul appel, en texte seulement.
  let appelApi = false;
  if (aDemander.length && dossier.length) {
    if (!etat.cleEnregistree) { demanderCle(); throw new Error('Clé API manquante.'); }
    const rep = await envoyer('correspondre', {
      page: { titre: cible.titre, domaine },
      champs: aDemander.map((c, i) => ({ id: String(i + 1), ...champPourApi(c) })),
      dossier: dossier.map((r) => ({ cle: r.cle, libelle: r.libelle, valeur: r.valeur })),
      formatDate: etat.reglages.formatDate,
      aujourdhui: new Date().toISOString().slice(0, 10)
    });
    appelApi = true;
    for (const r of rep.remplissages) {
      const c = aDemander[Number(r.id) - 1];
      const valeur = String(r.valeur == null ? '' : r.valeur).trim();
      if (!c || !valeur) continue;
      const ligne = dossier.find((x) => x.cle === r.cle);
      let confiance = Number(r.confiance);
      if (!Number.isFinite(confiance)) confiance = 0.7;
      if (ligne) confiance = Math.min(confiance, ligne.confiance);
      resultat.push({ id: c.id, valeur, confiance, source: ligne ? `${ligne.libelle} — ${ligne.source}` : 'dossier' });
      if (ligne) memoire[U.signatureChamp(c)] = { cle: ligne.cle, src: ligne.valeur, out: valeur };
    }
    for (const c of aDemander) {
      if (!resultat.some((r) => r.id === c.id)) memoire[U.signatureChamp(c)] = { aucune: true, empreinte: emp };
    }
    // Mémoire limitée à 400 champs par site.
    const cles = Object.keys(memoire);
    for (const k of cles.slice(0, Math.max(0, cles.length - 400))) delete memoire[k];
    etat.donnees.memoire[domaine] = memoire;
    sauvegarder();
    afficherProfils();
  }
  return { remplissages: resultat, appelApi };
}

async function executerRemplissages(tabId, remplissages) {
  const parCadre = new Map();
  for (const r of remplissages) {
    const i = r.id.indexOf(':');
    const cadre = Number(r.id.slice(0, i));
    if (!parCadre.has(cadre)) parCadre.set(cadre, []);
    parCadre.get(cadre).push({ ...r, id: r.id.slice(i + 1) });
  }
  const rapports = [];
  for (const [cadre, liste] of parCadre) {
    const res = await executer(tabId, 'remplir', [liste, { seulementVides: etat.reglages.seulementVides }], [cadre]);
    for (const x of (res[0] && res[0].result) || []) rapports.push({ ...x, id: cadre + ':' + x.id });
  }
  return rapports;
}

/* ==================================================================== */
/* Remplissage                                                           */
/* ==================================================================== */

function nomChamp(c) {
  return c.libelle || c.placeholder || c.name || c.idAttr || '(sans libellé)';
}

async function remplirFormulaire({ nouveauxSeulement = false } = {}) {
  if (etat.occupe) return;
  const cible = await cibleValide();
  if (!cible) return;
  if (!profil().dossier.some((r) => r.valeur)) {
    statut('Le dossier est vide : ajoutez un document et cliquez sur « Lire ».', 'erreur');
    return;
  }
  occupe(true, 'Analyse de la page…');
  const page = pageCourante(cible);
  const bilan = { ok: [], verifier: [], sansDonnee: [], echecs: [], dejaRemplis: 0 };
  let premierScan = null;
  try {
    let scan = await analyserPage(cible.tabId);
    premierScan = scan;
    const aTraiter = (s, seulementNouveaux) => s.champs.filter((c) =>
      (!seulementNouveaux || !page.traites.has(c.id)) && (!etat.reglages.seulementVides || c.vide));
    let lot = aTraiter(scan, nouveauxSeulement);
    if (etat.reglages.seulementVides) bilan.dejaRemplis = scan.champs.filter((c) => !c.vide).length;

    // Jusqu'à 3 passes : les champs qui apparaissent après une saisie
    // (champs conditionnels, étape suivante déjà affichée) sont complétés.
    for (let passe = 0; passe < 3 && lot.length; passe++) {
      statut(passe === 0 ? `Correspondance de ${lot.length} champ(s)…` : `${lot.length} nouveau(x) champ(s) apparu(s)…`, 'occupe');
      lot.forEach((c) => page.traites.add(c.id));
      const { remplissages } = await obtenirRemplissages(lot, cible);
      statut('Remplissage…', 'occupe');
      const rapports = await executerRemplissages(cible.tabId, remplissages);

      for (const c of lot) {
        const r = remplissages.find((x) => x.id === c.id);
        if (!r) { bilan.sansDonnee.push(nomChamp(c)); continue; }
        const rap = rapports.find((x) => x.id === c.id);
        if (!rap) continue;
        if (rap.ok) (rap.niveau === 'ok' ? bilan.ok : bilan.verifier).push(`${nomChamp(c)} : ${r.valeur}${rap.note ? ` (${rap.note})` : ''}`);
        else if (rap.raison === 'déjà rempli') bilan.dejaRemplis++;
        else bilan.echecs.push(`${nomChamp(c)} : ${rap.raison}`);
      }

      await attendre(700);
      scan = await analyserPage(cible.tabId);
      lot = aTraiter(scan, true);
    }
    afficherBilan(bilan, premierScan);
  } catch (e) {
    statut(e.message, 'erreur');
    if (premierScan) afficherBilan(bilan, premierScan);
  } finally {
    occupe(false);
  }
}

function afficherBilan(b, scan) {
  $('carteResultat').hidden = false;
  const resume = $('resume');
  resume.innerHTML = '';
  const chiffres = el('div', { class: 'chiffres' },
    el('span', { class: 'ok' }, `✔ ${b.ok.length} rempli${b.ok.length > 1 ? 's' : ''}`),
    el('span', { class: 'verif' }, `⚠ ${b.verifier.length + b.echecs.length} à vérifier`),
    el('span', { class: 'sans' }, `○ ${b.sansDonnee.length} sans donnée`));
  resume.append(chiffres);
  const details = [];
  if (b.dejaRemplis) details.push(`${b.dejaRemplis} champ(s) déjà rempli(s) laissé(s) tel(s) quel(s)`);
  if (scan.interdits) details.push(`${scan.interdits} champ(s) protégé(s) ignoré(s) (mot de passe, carte, code…)`);
  if (details.length) resume.append(el('div', { class: 'discret' }, details.join(' · ')));
  if (b.verifier.length || b.echecs.length) {
    resume.append(el('ul', { class: 'liste-simple' },
      ...b.verifier.map((t) => el('li', {}, '⚠ ' + t)),
      ...b.echecs.map((t) => el('li', {}, '✖ ' + t))));
  }
  $('listeSansDonnee').innerHTML = '';
  b.sansDonnee.forEach((t) => $('listeSansDonnee').append(el('li', {}, t)));
  $('detailsSansDonnee').hidden = !b.sansDonnee.length;

  const peuDeChamps = scan.champs.length < 3;
  $('propositionVision').hidden = !peuDeChamps;
  $('listeVision').innerHTML = '';

  const total = b.ok.length + b.verifier.length;
  if (!scan.champs.length) statut('Aucun champ modifiable détecté dans la page.', 'erreur');
  else if (total) statut(`${total} champ(s) rempli(s). Vérifiez chaque champ avant de valider.`, 'succes');
  else statut('Aucun champ rempli.', b.echecs.length ? 'erreur' : '');
}

/* ==================================================================== */
/* Repli vision (capture d'écran)                                        */
/* ==================================================================== */

async function analyserParCapture() {
  if (etat.occupe) return;
  const cible = await cibleValide();
  if (!cible) return;
  if (!etat.cleEnregistree) return demanderCle();
  const dossier = profil().dossier.filter((r) => r.valeur).map((r) => ({ cle: r.cle, libelle: r.libelle, valeur: r.valeur }));
  if (!dossier.length) { statut('Le dossier est vide.', 'erreur'); return; }
  if (!confirm(`Une capture de la partie visible de l’onglet « ${cible.titre} » va être envoyée à l’API Anthropic (api.anthropic.com) pour repérer les champs.\n\nVérifiez qu’aucune information sans rapport avec la démarche n’est affichée. Continuer ?`)) return;

  occupe(true, 'Capture de l’onglet…');
  try {
    const tab = await chrome.tabs.get(cible.tabId);
    if (!tab.active) { await chrome.tabs.update(tab.id, { active: true }); await attendre(400); }
    const dataUrl = await chrome.tabs.captureVisibleTab(cible.windowId, { format: 'jpeg', quality: 85 });
    const img = await preparerImage(await (await fetch(dataUrl)).blob());

    await injecter(cible.tabId);
    const [info] = await executer(cible.tabId, 'infos', [], [0]);
    const vp = info && info.result;
    if (!vp) throw new Error('Page cible inaccessible.');

    statut('Analyse de la capture…', 'occupe');
    const rep = await envoyer('vision', { image: img.base64, dossier, largeur: img.largeur, hauteur: img.hauteur });
    const ex = vp.largeur / img.largeur;
    const ey = vp.hauteur / img.hauteur;

    const ul = $('listeVision');
    ul.innerHTML = '';
    let nbOk = 0;
    for (const z of rep.zones) {
      const valeur = String(z.valeur == null ? '' : z.valeur).trim();
      if (!valeur || !Number.isFinite(+z.x) || !Number.isFinite(+z.y)) continue;
      const info2 = `AutoFill Admin (capture) : « ${valeur} »\n⚠ À vérifier`;
      const [res] = await executer(cible.tabId, 'remplirAuPoint', [z.x * ex, z.y * ey, valeur, info2], [0]);
      const r = (res && res.result) || { ok: false, raison: 'inaccessible' };
      if (r.ok) nbOk++;
      ul.append(el('li', {},
        `${r.ok ? '✔' : '✖'} ${z.libelle || 'Champ'} : `, el('strong', {}, valeur),
        r.ok ? '' : el('span', { class: 'discret' }, ` — ${r.raison} `),
        r.ok ? '' : el('button', { onclick: () => navigator.clipboard.writeText(valeur).then(() => statut('Copié : collez-le dans le champ (Ctrl+V).', 'succes')) }, 'Copier')));
    }
    statut(rep.zones.length
      ? `${nbOk} champ(s) rempli(s) par capture, ${rep.zones.length - nbOk} à copier à la main. Tout est à vérifier.`
      : 'Aucune zone à remplir reconnue sur la capture.', nbOk ? 'succes' : '');
  } catch (e) {
    statut(e.message, 'erreur');
  } finally {
    occupe(false);
  }
}

/* ==================================================================== */
/* Autres actions                                                        */
/* ==================================================================== */

async function surTousLesCadres(methode, messageSucces) {
  const cible = await cibleValide();
  if (!cible) return;
  try {
    const res = await executer(cible.tabId, methode, []);
    const n = res.reduce((s, r) => s + (Number(r && r.result) || 0), 0);
    statut(messageSucces(n), 'succes');
  } catch (e) {
    statut(e.message, 'erreur');
  }
}

async function annulerRemplissage() {
  await surTousLesCadres('annuler', (n) => n ? `${n} champ(s) restauré(s) à leur valeur d’origine.` : 'Rien à annuler sur cette page.');
  if (etat.page) etat.page.traites.clear();
}

function reinitialiserDossier() {
  if (!confirm(`Effacer toutes les données du profil « ${profil().nom} » et les documents de la session ?`)) return;
  profil().dossier = [];
  etat.docs.forEach((d) => d.apercu && URL.revokeObjectURL(d.apercu));
  etat.docs = [];
  etat.page = null;
  $('carteResultat').hidden = true;
  sauvegarder();
  afficherDocs();
  afficherDossier();
  statut('Dossier réinitialisé.');
}

function ajouterLigne() {
  profil().dossier.push({ id: 'm' + Date.now(), cle: 'donnee_' + Date.now().toString(36), libelle: 'Nouvelle donnée', valeur: '', confiance: 1, source: 'saisie manuelle', conflits: [], manuel: true });
  afficherDossier();
  const saisies = $('tableDossier').querySelectorAll('input.libre');
  if (saisies.length) { saisies[saisies.length - 1].focus(); saisies[saisies.length - 1].select(); }
}

/* ---------- Profils ---------- */

function nouveauProfil() {
  const nom = (prompt('Nom du nouveau profil (ex. Conjoint, Enfant) :') || '').trim();
  if (!nom) return;
  const id = 'p' + Date.now().toString(36);
  etat.donnees.profils[id] = { nom, dossier: [] };
  etat.donnees.profilActif = id;
  changerDeProfil();
}

function renommerProfil() {
  const nom = (prompt('Nouveau nom du profil :', profil().nom) || '').trim();
  if (!nom) return;
  profil().nom = nom;
  sauvegarder();
  afficherProfils();
}

function supprimerProfil() {
  const ids = Object.keys(etat.donnees.profils);
  if (ids.length < 2) { statut('Impossible de supprimer le dernier profil. Utilisez « Réinitialiser le dossier ».', 'erreur'); return; }
  if (!confirm(`Supprimer le profil « ${profil().nom} » et son dossier ?`)) return;
  delete etat.donnees.profils[etat.donnees.profilActif];
  etat.donnees.profilActif = Object.keys(etat.donnees.profils)[0];
  changerDeProfil();
}

function changerDeProfil() {
  etat.page = null; // les correspondances dépendent du profil
  sauvegarder();
  afficherProfils();
  afficherDossier();
  statut(`Profil actif : ${profil().nom}.`);
}

/* ---------- Réglages ---------- */

function appliquerReglagesUI() {
  const r = etat.reglages;
  $('modele').value = r.modele;
  $('formatDate').value = r.formatDate;
  $('seulementVides').checked = r.seulementVides;
  $('conserver').checked = r.conserver;
  $('chiffrer').checked = r.chiffrer;
  $('ligneChiffrer').hidden = !r.conserver;
  $('cleApi').value = '';
  $('cleApi').placeholder = etat.cleEnregistree ? 'Clé enregistrée — saisissez-en une autre pour la remplacer' : 'sk-ant-...';
  $('etatCle').textContent = etat.cleEnregistree ? 'Clé enregistrée.' : 'Aucune clé.';
}

async function enregistrerCleSaisie() {
  const v = $('cleApi').value.trim();
  if (!v) return;
  await chrome.storage.local.set({ cleApi: v });
  etat.cleEnregistree = true;
  appliquerReglagesUI();
}

async function testerCle() {
  await enregistrerCleSaisie();
  $('etatCle').textContent = 'Test en cours…';
  try {
    const rep = await envoyer('testerCle', {});
    $('etatCle').textContent = rep.message;
  } catch (e) {
    $('etatCle').textContent = e.message;
  }
}

async function basculerConserver() {
  const coche = $('conserver').checked;
  if (coche) {
    etat.reglages.conserver = true;
    etat.coffreVerrouille = false;
    await sauvegarderReglages();
    await sauvegarderMaintenant();
    statut('Le dossier sera conservé sur ce PC.', 'succes');
  } else {
    if (!confirm('Le dossier conservé sur ce PC va être supprimé (il reste disponible jusqu’à la fermeture de Chrome). Continuer ?')) {
      $('conserver').checked = true;
      return;
    }
    Object.assign(etat.reglages, { conserver: false, chiffrer: false });
    etat.phrase = null;
    await chrome.storage.local.remove('coffre');
    await sauvegarderReglages();
    await sauvegarderMaintenant();
    statut('Dossier conservé supprimé du disque.', 'succes');
  }
  appliquerReglagesUI();
}

async function basculerChiffrer() {
  if ($('chiffrer').checked) {
    const phrase = await demanderPhrase({
      titre: 'Choisir une phrase secrète',
      texte: 'Elle n’est enregistrée nulle part : si vous l’oubliez, le dossier conservé sera perdu. Elle sera demandée à chaque ouverture du panneau.',
      ok: 'Chiffrer', confirmer: true
    });
    if (!phrase) { $('chiffrer').checked = false; return; }
    etat.phrase = phrase;
    etat.reglages.chiffrer = true;
    statut('Dossier conservé chiffré.', 'succes');
  } else {
    if (!confirm('Enregistrer le dossier conservé en clair (non chiffré) sur ce PC ?')) { $('chiffrer').checked = true; return; }
    etat.reglages.chiffrer = false;
    etat.phrase = null;
  }
  await sauvegarderReglages();
  await sauvegarderMaintenant();
}

async function toutSupprimer() {
  if (!confirm('Supprimer définitivement tous les profils, la mémoire des sites et la clé API de ce PC ?')) return;
  await chrome.storage.local.remove(['coffre', 'cleApi']);
  await chrome.storage.session.remove('donnees');
  Object.assign(etat.reglages, { conserver: false, chiffrer: false });
  await sauvegarderReglages();
  etat.donnees = donneesVides();
  etat.phrase = null;
  etat.coffreVerrouille = false;
  etat.cleEnregistree = false;
  etat.docs.forEach((d) => d.apercu && URL.revokeObjectURL(d.apercu));
  etat.docs = [];
  etat.page = null;
  $('carteResultat').hidden = true;
  appliquerReglagesUI();
  afficherProfils();
  afficherDocs();
  afficherDossier();
  statut('Toutes les données ont été supprimées.', 'succes');
}

/* ==================================================================== */
/* Événements                                                            */
/* ==================================================================== */

function brancherEvenements() {
  // Documents
  $('btnPressePapiers').onclick = lirePressePapiers;
  $('btnFichier').onclick = () => $('inputFichier').click();
  $('inputFichier').onchange = async (e) => {
    for (const f of e.target.files) await ajouterFichier(f);
    e.target.value = '';
  };
  $('btnLire').onclick = lireDocuments;

  document.addEventListener('paste', async (e) => {
    const fichiers = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (!fichiers.length) return; // collage de texte dans un champ : comportement normal
    e.preventDefault();
    for (const f of fichiers) await ajouterFichier(f);
  });
  const zone = $('zoneDepot');
  document.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('survol'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) zone.classList.remove('survol'); });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('survol');
    for (const f of (e.dataTransfer && e.dataTransfer.files) || []) await ajouterFichier(f);
  });

  // Dossier
  $('btnAjouterLigne').onclick = ajouterLigne;
  $('btnReinitialiser').onclick = reinitialiserDossier;

  // Cible
  $('btnChangerCible').onclick = async () => {
    const bloc = $('choixCible');
    bloc.hidden = !bloc.hidden;
    if (!bloc.hidden) await remplirListeOnglets();
  };
  $('selOnglet').onchange = (e) => {
    etat.cibleEpinglee = e.target.value ? Number(e.target.value) : null;
    $('choixCible').hidden = true;
    determinerCible();
  };
  chrome.tabs.onActivated.addListener(planifierCible);
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.title || info.status === 'complete') planifierCible(); });
  chrome.tabs.onRemoved.addListener(planifierCible);
  chrome.windows.onFocusChanged.addListener(planifierCible);
  chrome.storage.onChanged.addListener((changes, zoneStockage) => {
    if (zoneStockage === 'session' && changes.derniereFenetre) planifierCible();
  });

  // Actions
  $('btnRemplir').onclick = () => remplirFormulaire();
  $('btnReanalyser').onclick = () => remplirFormulaire({ nouveauxSeulement: true });
  $('btnAnnuler').onclick = annulerRemplissage;
  $('btnEffacer').onclick = () => surTousLesCadres('effacerSurlignages', (n) => n ? 'Surlignages effacés.' : 'Aucun surlignage.');
  $('btnVision').onclick = analyserParCapture;

  // Profils
  $('selProfil').onchange = (e) => { etat.donnees.profilActif = e.target.value; changerDeProfil(); };
  $('btnNouveauProfil').onclick = nouveauProfil;
  $('btnRenommerProfil').onclick = renommerProfil;
  $('btnSupprimerProfil').onclick = supprimerProfil;

  // Réglages
  $('cleApi').onchange = enregistrerCleSaisie;
  $('btnTesterCle').onclick = testerCle;
  $('btnEffacerCle').onclick = async () => {
    await chrome.storage.local.remove('cleApi');
    etat.cleEnregistree = false;
    appliquerReglagesUI();
  };
  $('modele').onchange = (e) => { etat.reglages.modele = e.target.value; sauvegarderReglages(); };
  $('formatDate').onchange = (e) => { etat.reglages.formatDate = e.target.value; sauvegarderReglages(); };
  $('seulementVides').onchange = (e) => { etat.reglages.seulementVides = e.target.checked; sauvegarderReglages(); };
  $('conserver').onchange = basculerConserver;
  $('chiffrer').onchange = basculerChiffrer;
  $('btnOublierMemoire').onclick = () => {
    etat.donnees.memoire = {};
    sauvegarder();
    afficherProfils();
    statut('Mémoire des sites effacée.', 'succes');
  };
  $('btnToutSupprimer').onclick = toutSupprimer;

  // Raccourci clavier global (Alt+Maj+F) relayé par le service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'commande' && msg.action === 'remplir') remplirFormulaire();
  });

  // Enregistre le dossier avant fermeture de la fenêtre.
  window.addEventListener('pagehide', () => { clearTimeout(minuterieSauvegarde); sauvegarderMaintenant(); });
}

/* ==================================================================== */
/* Démarrage                                                             */
/* ==================================================================== */

(async function demarrer() {
  brancherEvenements();
  await charger();
  appliquerReglagesUI();
  afficherProfils();
  afficherDocs();
  afficherDossier();
  await determinerCible();
  if (!etat.cleEnregistree) demanderCle();
  else if (!etat.coffreVerrouille && !$('etat').textContent) statut('Prêt. Ajoutez vos documents, puis « Lire ».');
})();
