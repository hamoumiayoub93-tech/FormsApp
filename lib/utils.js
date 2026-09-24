/*
 * AutoFill Admin — fonctions pures partagées.
 *
 * Ce fichier est chargé à quatre endroits :
 *   - le panneau (panel.html, balise <script>),
 *   - le service worker (importScripts),
 *   - la page cible (chrome.scripting.executeScript, avant content.js),
 *   - les tests node (require).
 * Il ne doit donc dépendre ni du DOM ni des API chrome.*.
 */
(function (racine) {
  'use strict';
  if (racine.AFU) return; // déjà chargé (ré-injection dans la même page)

  /* ------------------------------------------------------------------ */
  /* Texte                                                               */
  /* ------------------------------------------------------------------ */

  /** Minuscules, sans accents ni ponctuation, espaces simples. « Élodie-Marie » -> « elodie marie ». */
  function normaliser(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** Clé de dossier : snake_case normalisé. « Date de naissance » -> « date_de_naissance ». */
  function normaliserCle(s) {
    return normaliser(s).replace(/ /g, '_');
  }

  /** Coefficient de Dice sur les bigrammes (0 à 1), espaces ignorés. */
  function dice(a, b) {
    a = String(a).replace(/ /g, '');
    b = String(b).replace(/ /g, '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrammes = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const g = a.slice(i, i + 2);
      bigrammes.set(g, (bigrammes.get(g) || 0) + 1);
    }
    let communs = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const g = b.slice(i, i + 2);
      const n = bigrammes.get(g) || 0;
      if (n > 0) { communs++; bigrammes.set(g, n - 1); }
    }
    return (2 * communs) / (a.length + b.length - 2);
  }

  /* ------------------------------------------------------------------ */
  /* Correspondance des options (select, radios, listes personnalisées)  */
  /* ------------------------------------------------------------------ */

  // Groupes d'équivalences (formes normalisées). Sert surtout pour civilité,
  // oui/non, situation familiale et quelques pays fréquents.
  const SYNONYMES = [
    ['m', 'mr', 'monsieur', 'homme', 'masculin', 'male', 'h', 'sir', 'herr', 'senor', 'sr'],
    ['mme', 'madame', 'femme', 'feminin', 'female', 'f', 'mrs', 'ms', 'frau', 'senora', 'sra'],
    ['mlle', 'mademoiselle', 'miss'],
    ['oui', 'yes', 'true', 'vrai', '1', 'o', 'y', 'si', 'ja'],
    ['non', 'no', 'false', 'faux', '0', 'n', 'nein'],
    ['celibataire', 'single'],
    ['marie', 'mariee', 'marie e', 'married'],
    ['pacse', 'pacsee', 'pacse e', 'pacs', 'civil partnership'],
    ['divorce', 'divorcee', 'divorce e', 'divorced'],
    ['veuf', 'veuve', 'veuf ve', 'widowed', 'widow', 'widower'],
    ['separe', 'separee', 'separe e', 'separated'],
    ['concubinage', 'union libre', 'vie maritale', 'cohabitation'],
    ['france', 'fr', 'fra', 'francaise', 'francais', 'french', 'france metropolitaine'],
    ['allemagne', 'de', 'deu', 'germany', 'deutschland', 'allemande', 'allemand', 'german'],
    ['belgique', 'be', 'bel', 'belgium', 'belge', 'belgian'],
    ['espagne', 'es', 'esp', 'spain', 'espana', 'espagnole', 'espagnol', 'spanish'],
    ['italie', 'it', 'ita', 'italy', 'italia', 'italienne', 'italien', 'italian'],
    ['portugal', 'pt', 'prt', 'portugaise', 'portugais', 'portuguese'],
    ['suisse', 'ch', 'che', 'switzerland', 'swiss'],
    ['royaume uni', 'uk', 'gb', 'gbr', 'united kingdom', 'grande bretagne', 'britannique', 'british'],
    ['etats unis', 'us', 'usa', 'united states', 'etats unis d amerique', 'americaine', 'americain', 'american'],
    ['maroc', 'ma', 'mar', 'morocco', 'marocaine', 'marocain', 'moroccan'],
    ['algerie', 'dz', 'dza', 'algeria', 'algerienne', 'algerien', 'algerian'],
    ['tunisie', 'tn', 'tun', 'tunisia', 'tunisienne', 'tunisien', 'tunisian'],
    ['luxembourg', 'lu', 'lux', 'luxembourgeoise', 'luxembourgeois'],
    ['canada', 'ca', 'can', 'canadienne', 'canadien', 'canadian']
  ];

  /** Formes équivalentes d'une valeur normalisée (elle-même incluse). */
  function variantes(v) {
    const res = new Set([v]);
    for (const groupe of SYNONYMES) {
      if (groupe.includes(v)) groupe.forEach((x) => res.add(x));
    }
    return [...res];
  }

  /** Score de ressemblance entre deux libellés normalisés (0 à 1). */
  function scoreLibelles(c, x) {
    if (!c || !x) return 0;
    if (c === x) return 1;
    // Les codes d'une ou deux lettres (« M », « F », « FR ») ne valent que s'ils sont exacts.
    if (c.length <= 2 || x.length <= 2) return 0;
    const [court, long] = c.length <= x.length ? [c, x] : [x, c];
    // Inclusion en mots entiers : « france » dans « france metropolitaine ».
    if ((' ' + long + ' ').includes(' ' + court + ' ')) {
      return 0.8 + 0.2 * (court.length / long.length);
    }
    return dice(c, x);
  }

  /**
   * Choisit l'option qui correspond le mieux à une valeur, sans tenir compte
   * de la casse ni des accents.
   * @param {string} valeur
   * @param {Array<{valeur?:string, texte?:string, ignorer?:boolean}>} options
   * @param {number} seuil score minimal accepté
   * @returns {{index:number, score:number}|null}
   */
  function meilleureOption(valeur, options, seuil) {
    if (seuil == null) seuil = 0.72;
    const v = normaliser(valeur);
    if (!v || !Array.isArray(options)) return null;
    const vs = variantes(v);
    let meilleur = null;
    options.forEach((o, index) => {
      if (!o || o.ignorer) return;
      const candidats = [normaliser(o.texte), normaliser(o.valeur)].filter(Boolean);
      let score = 0;
      for (const c of candidats) {
        for (const x of vs) {
          // Une équivalence exacte via synonyme vaut presque un exact.
          const s = x === v ? scoreLibelles(c, x) : (c === x ? 0.98 : 0);
          if (s > score) score = s;
        }
      }
      if (!meilleur || score > meilleur.score) meilleur = { index, score };
    });
    return meilleur && meilleur.score >= seuil ? meilleur : null;
  }

  /** Interprète une valeur de case à cocher. Renvoie true, false ou null (indéterminé). */
  function versBooleen(valeur) {
    if (typeof valeur === 'boolean') return valeur;
    const v = normaliser(valeur);
    if (['true', 'vrai', 'oui', 'yes', '1', 'x', 'coche', 'checked', 'on'].includes(v)) return true;
    if (['false', 'faux', 'non', 'no', '0', 'decoche', 'unchecked', 'off'].includes(v)) return false;
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* JSON                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Analyse la réponse du modèle de façon tolérante : retire les balises ```,
   * isole l'objet JSON, répare les virgules finales.
   * @throws {Error} si aucun JSON exploitable n'est trouvé.
   */
  function parseJsonRobuste(texte) {
    if (texte == null) throw new Error('Réponse vide');
    let t = String(texte).replace(/^﻿/, '').trim();
    if (!t) throw new Error('Réponse vide');
    const bloc = t.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
    if (bloc) t = bloc[1].trim();
    try { return JSON.parse(t); } catch (_) { /* on continue */ }

    const debut = t.search(/[{[]/);
    if (debut >= 0) {
      const fermant = t[debut] === '{' ? '}' : ']';
      const fin = t.lastIndexOf(fermant);
      if (fin > debut) {
        let extrait = t.slice(debut, fin + 1);
        try { return JSON.parse(extrait); } catch (_) { /* on répare */ }
        extrait = extrait.replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(extrait); } catch (_) { /* dernier recours */ }
        extrait = extrait.replace(/[“”]/g, '"');
        try { return JSON.parse(extrait); } catch (_) { /* échec */ }
      }
    }
    throw new Error('JSON invalide');
  }

  /* ------------------------------------------------------------------ */
  /* Dates                                                               */
  /* ------------------------------------------------------------------ */

  const MOIS = {
    janvier: 1, janv: 1, jan: 1, january: 1,
    fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2,
    mars: 3, mar: 3, march: 3,
    avril: 4, avr: 4, apr: 4, april: 4,
    mai: 5, may: 5,
    juin: 6, jun: 6, june: 6,
    juillet: 7, juil: 7, jul: 7, july: 7,
    aout: 8, aug: 8, august: 8,
    septembre: 9, sept: 9, sep: 9, september: 9,
    octobre: 10, oct: 10, october: 10,
    novembre: 11, nov: 11, november: 11,
    decembre: 12, dec: 12, december: 12
  };

  function deuxChiffres(n) { return String(n).padStart(2, '0'); }

  function dateValide(a, m, j) {
    if (!(a >= 1000 && a <= 9999 && m >= 1 && m <= 12 && j >= 1 && j <= 31)) return false;
    const d = new Date(Date.UTC(a, m - 1, j));
    return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
  }

  function iso(a, m, j) {
    return dateValide(a, m, j) ? `${a}-${deuxChiffres(m)}-${deuxChiffres(j)}` : '';
  }

  /** Année sur 2 chiffres -> 4 chiffres (fenêtre glissante sur l'année courante). */
  function annee4(a, anneeCourante) {
    if (a >= 100) return a;
    const cc = (anneeCourante || new Date().getFullYear()) % 100;
    return a > cc ? 1900 + a : 2000 + a;
  }

  /**
   * Convertit une date écrite de façon courante en ISO AAAA-MM-JJ.
   * Ordre jour/mois à la française pour les formats numériques ambigus.
   * Renvoie '' si la date est invalide ou non reconnue.
   */
  function versIso(s, anneeCourante) {
    const t = String(s == null ? '' : s).trim();
    if (!t) return '';
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
    if (m) return iso(annee4(+m[3], anneeCourante), +m[2], +m[1]);
    m = t.match(/^(\d{2})(\d{2})(\d{4})$/); // JJMMAAAA
    if (m) return iso(+m[3], +m[2], +m[1]);
    const n = normaliser(t).replace(/\b1er\b/, '1');
    m = n.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
    if (m && MOIS[m[2]]) return iso(+m[3], MOIS[m[2]], +m[1]);
    m = n.match(/^([a-z]+) (\d{1,2}) (\d{4})$/); // « March 5 2024 »
    if (m && MOIS[m[1]]) return iso(+m[3], MOIS[m[1]], +m[2]);
    return '';
  }

  /** Formate une date ISO selon un modèle (JJ/MM/AAAA, AAAA-MM-JJ, MM/JJ/AAAA, JJ.MM.AAAA...). */
  function formaterDate(dateIso, format) {
    const m = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return String(format || 'JJ/MM/AAAA')
      .replace('AAAA', m[1]).replace('AA', m[1].slice(2))
      .replace('MM', m[2])
      .replace('JJ', m[3]);
  }

  /**
   * Adapte une valeur de date au type du champ HTML.
   * Si la valeur n'est pas une date reconnue, elle est renvoyée telle quelle.
   */
  function dateSelonChamp(valeur, typeChamp, format) {
    const d = versIso(valeur);
    if (!d) return valeur;
    switch (typeChamp) {
      case 'date': return d;
      case 'month': return d.slice(0, 7);
      case 'datetime-local': return d + 'T00:00';
      default: return formaterDate(d, format);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Divers formats                                                      */
  /* ------------------------------------------------------------------ */

  /** IBAN en majuscules, avec ou sans espaces tous les 4 caractères. */
  function formaterIban(iban, avecEspaces) {
    const brut = String(iban || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
    return avecEspaces ? brut.replace(/(.{4})(?=.)/g, '$1 ') : brut;
  }

  /** Nombre « 1 234,56 € » -> « 1234.56 » (pour <input type="number">). */
  function versNombre(valeur) {
    let t = String(valeur == null ? '' : valeur).replace(/[\s  €$£]/g, '');
    // Virgule décimale (usage français) si c'est le dernier séparateur.
    if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? t : '';
  }

  /* ------------------------------------------------------------------ */
  /* Sécurité                                                            */
  /* ------------------------------------------------------------------ */

  const RE_INTERDIT = new RegExp(
    '\\b(' + [
      'captcha', 'recaptcha', 'hcaptcha', 'g recaptcha', 'cvv', 'cvc', 'cvv2', 'cvc2', 'cryptogramme',
      'code de securite', 'code securite', 'security code', 'securitycode', 'card security',
      'mot de passe', 'password', 'passwd', 'pwd', 'passcode', 'code secret', 'code confidentiel',
      'code pin', 'otp', 'one time', 'code de verification', 'code verification', 'verification code',
      'code recu par sms', 'numero de carte bancaire', 'carte bancaire', 'card number', 'cardnumber',
      'credit card', 'carte de credit', 'ccnum', 'cc num', 'cc number', 'cc exp', 'cc csc', 'ccv'
    ].join('|') + ')\\b'
  );

  /**
   * Vrai si le champ ne doit JAMAIS être touché : mot de passe, code de
   * sécurité, CAPTCHA, carte bancaire (autocomplete cc-*).
   */
  function estChampInterdit(c) {
    if (!c) return true;
    const type = String(c.type || '').toLowerCase();
    if (type === 'password' || type === 'hidden' || type === 'file') return true;
    const ac = String(c.autocomplete || '').toLowerCase();
    if (/(^|\s)(cc-[a-z-]+|one-time-code|current-password|new-password)(\s|$)/.test(ac)) return true;
    const texte = normaliser([c.name, c.id, c.libelle, c.placeholder, c.classes].filter(Boolean).join(' '));
    return RE_INTERDIT.test(texte);
  }

  const RE_ENVOI = /\b(envoyer|envoi|valider|validation|soumettre|submit|send|payer|paiement|pay|payment|checkout|commander|confirmer|confirmation|signer|transmettre|deposer|finaliser|terminer|enregistrer|sauvegarder|save|continuer|suivant|next|etape suivante|se connecter|connexion|login|sign in|s inscrire|creer mon compte|register|supprimer|delete|annuler ma demande)\b/;

  /** Vrai si un texte de bouton ressemble à une action d'envoi / de validation / de navigation. */
  function estLibelleEnvoi(texte) {
    return RE_ENVOI.test(normaliser(texte));
  }

  /**
   * Indique si une URL d'onglet peut recevoir le script de remplissage.
   * @returns {{ok:boolean, raison?:string}}
   */
  function verifierCible(url) {
    const u = String(url || '');
    if (!u) return { ok: false, raison: "Onglet sans adresse (page en cours de chargement ?)." };
    if (/^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|chrome-search|chrome-untrusted|devtools|view-source|data|blob|javascript):/i.test(u)) {
      return { ok: false, raison: 'Page interne du navigateur : Chrome interdit aux extensions d’y écrire.' };
    }
    if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(u)) {
      return { ok: false, raison: 'Le Chrome Web Store est protégé : aucune extension ne peut y écrire.' };
    }
    if (/^https?:\/\/[^?#]*\.pdf([?#]|$)/i.test(u)) {
      return { ok: false, raison: 'Visionneuse PDF : ce n’est pas un formulaire web. Enregistrez le PDF et ajoutez-le comme document.' };
    }
    if (/^(https?|file):/i.test(u)) return { ok: true };
    return { ok: false, raison: 'Type de page non pris en charge.' };
  }

  /* ------------------------------------------------------------------ */
  /* Erreurs de l'API                                                    */
  /* ------------------------------------------------------------------ */

  /** Message d'erreur en français pour un code HTTP de l'API Anthropic. */
  function messageErreurHttp(statut, detail) {
    const d = detail ? ` (${String(detail).slice(0, 200)})` : '';
    switch (statut) {
      case 400: return `Requête refusée par l’API${d}.`;
      case 401: return 'Clé API invalide ou révoquée. Vérifiez-la dans les réglages.';
      case 403: return `Accès refusé : cette clé n’a pas les droits nécessaires${d}.`;
      case 404: return 'Modèle introuvable : choisissez un autre modèle dans les réglages.';
      case 413: return 'Document trop volumineux pour l’API. Réduisez sa taille ou découpez le PDF.';
      case 429: return 'Limite de débit atteinte (429). Patientez une minute puis réessayez.';
      case 500: return 'Erreur interne de l’API Anthropic. Réessayez dans un instant.';
      case 529: return 'L’API Anthropic est surchargée (529). Réessayez dans quelques minutes.';
      default: return `Erreur de l’API (HTTP ${statut})${d}.`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dossier                                                             */
  /* ------------------------------------------------------------------ */

  let compteurId = 0;
  function nouvelId() {
    compteurId++;
    return 'd' + Date.now().toString(36) + compteurId.toString(36);
  }

  /** Deux valeurs sont-elles « les mêmes » (casse, accents, espaces, format de date) ? */
  function memeValeur(a, b) {
    const na = normaliser(a), nb = normaliser(b);
    if (na === nb) return true;
    if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return true;
    const da = versIso(a), db = versIso(b);
    return !!da && da === db;
  }

  /**
   * Fusionne les champs extraits d'un document dans le dossier.
   * - clé nouvelle : ajout ;
   * - même clé, valeur vide : remplacée ;
   * - même clé, même valeur : la provenance est complétée ;
   * - même clé, valeur différente : on NE tranche PAS, la valeur est ajoutée
   *   à la liste des conflits de la ligne (l'utilisateur choisit).
   * @returns {Array} nouveau dossier (le paramètre n'est pas modifié)
   */
  function fusionnerDossier(dossier, champs, source) {
    const res = (dossier || []).map((r) => ({ ...r, conflits: [...(r.conflits || [])] }));
    for (const c of champs || []) {
      if (!c) continue;
      const cle = normaliserCle(c.cle || c.libelle);
      if (!cle) continue;
      const valeur = String(c.valeur == null ? '' : c.valeur).trim();
      let confiance = Number(c.confiance);
      if (!Number.isFinite(confiance)) confiance = valeur ? 0.7 : 0;
      confiance = Math.max(0, Math.min(1, confiance));
      const provenance = [source, c.source].filter(Boolean).join(' — ') || 'document';
      const existant = res.find((r) => r.cle === cle);
      if (!existant) {
        res.push({
          id: nouvelId(), cle, libelle: String(c.libelle || cle), valeur,
          confiance, source: provenance, conflits: []
        });
      } else if (!valeur) {
        continue; // rien de neuf
      } else if (!existant.valeur) {
        Object.assign(existant, { valeur, confiance, source: provenance });
      } else if (memeValeur(existant.valeur, valeur)) {
        if (!existant.source.includes(source)) existant.source += ' + ' + source;
        existant.confiance = Math.max(existant.confiance, confiance);
      } else if (!existant.conflits.some((x) => memeValeur(x.valeur, valeur))) {
        existant.conflits.push({ valeur, source: provenance, confiance });
      }
    }
    return res;
  }

  /** Signature stable d'un champ de formulaire, pour la mémoire par site. */
  function signatureChamp(c) {
    return normaliser([c.type, c.libelle, c.name, c.idAttr].filter(Boolean).join(' | ')).slice(0, 160);
  }

  /** Empreinte courte (FNV-1a 32 bits) d'un texte : sert à savoir si le dossier a changé. */
  function empreinte(texte) {
    let h = 0x811c9dc5;
    const t = String(texte);
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  /** Domaine lisible d'une URL (sans « www. »). */
  function domaineDe(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'file:') return 'fichier local';
      return u.hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Chiffrement optionnel du dossier conservé (WebCrypto)               */
  /* ------------------------------------------------------------------ */

  function versBase64(octets) {
    let s = '';
    const t = new Uint8Array(octets);
    for (let i = 0; i < t.length; i += 0x8000) s += String.fromCharCode.apply(null, t.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function depuisBase64(b64) {
    const s = atob(b64);
    const t = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) t[i] = s.charCodeAt(i);
    return t;
  }

  async function deriverCle(phrase, sel) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sel, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  /** Chiffre un objet JSON avec une phrase secrète (PBKDF2 + AES-GCM 256). */
  async function chiffrer(objet, phrase) {
    const sel = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cle = await deriverCle(phrase, sel);
    const clair = new TextEncoder().encode(JSON.stringify(objet));
    const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, clair);
    return { v: 1, sel: versBase64(sel), iv: versBase64(iv), donnees: versBase64(chiffre) };
  }

  /** Déchiffre ; lève une erreur si la phrase secrète est fausse. */
  async function dechiffrer(bloc, phrase) {
    const cle = await deriverCle(phrase, depuisBase64(bloc.sel));
    try {
      const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: depuisBase64(bloc.iv) }, cle, depuisBase64(bloc.donnees));
      return JSON.parse(new TextDecoder().decode(clair));
    } catch (_) {
      throw new Error('Phrase secrète incorrecte.');
    }
  }

  const AFU = {
    normaliser, normaliserCle, dice, variantes, meilleureOption, versBooleen,
    parseJsonRobuste, versIso, formaterDate, dateSelonChamp, formaterIban, versNombre,
    estChampInterdit, estLibelleEnvoi, verifierCible, messageErreurHttp,
    memeValeur, fusionnerDossier, signatureChamp, empreinte, domaineDe,
    chiffrer, dechiffrer, versBase64, depuisBase64
  };

  racine.AFU = AFU;
  if (typeof module !== 'undefined' && module.exports) module.exports = AFU;
})(typeof globalThis !== 'undefined' ? globalThis : this);
