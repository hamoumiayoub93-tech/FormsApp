/*
 * AutoFill Admin — script injecté dans la page cible (chaque cadre).
 *
 * Il est injecté à la demande par le panneau (chrome.scripting.executeScript,
 * allFrames: true), après lib/utils.js. Il expose window.__afa avec :
 *   analyser(), remplir(), annuler(), effacerSurlignages(), remplirAuPoint(), infos()
 *
 * Règles absolues appliquées ici :
 *   - aucun formulaire n'est soumis, aucun bouton d'envoi n'est cliqué ;
 *   - les champs mot de passe / code de sécurité / CAPTCHA / carte bancaire sont ignorés ;
 *   - aucune donnée ne sort de la page (pas de réseau, pas d'accès à la clé API).
 */
(function () {
  'use strict';
  if (window.__afa) return;
  const U = globalThis.AFU;

  const VERT = '#16a34a';
  const ORANGE = '#f59e0b';

  const etat = {
    // Jeton propre à ce chargement de page : les identifiants ne se confondent
    // pas avec ceux d'une page précédente (formulaires en plusieurs pages).
    jeton: Math.random().toString(36).slice(2, 6),
    compteur: 0,
    parId: new Map(),        // id -> descripteur { id, type, el, radios? }
    idParEl: new WeakMap(),  // élément (ou 1er bouton radio d'un groupe) -> id
    originaux: new Map(),    // id -> instantané de la valeur avant remplissage
    surlignes: new Map()     // élément -> styles d'origine
  };

  /* ================================================================== */
  /* Outils DOM                                                          */
  /* ================================================================== */

  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  function texteDe(n) {
    if (!n) return '';
    return (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** Texte d'un libellé sans le texte des contrôles qu'il contient (options d'un select...). */
  function texteLibelle(label) {
    const copie = label.cloneNode(true);
    copie.querySelectorAll('input, select, textarea, option, button, script, style').forEach((x) => x.remove());
    return (copie.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function vue(el) { return el.ownerDocument.defaultView || window; }

  function estVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' &&
        !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = vue(el).getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  /** Élément « visible par l'utilisateur » : lui-même, ou son libellé pour les cases stylées. */
  function elementAffiche(el) {
    if (estVisible(el)) return el;
    const lab = (el.labels && el.labels[0]) || el.closest('label');
    return lab && estVisible(lab) ? lab : null;
  }

  function getById(el, id) {
    const rn = el.getRootNode();
    return (rn && rn.getElementById ? rn.getElementById(id) : null) || el.ownerDocument.getElementById(id);
  }

  /**
   * Toutes les racines à parcourir : le document, les Shadow DOM ouverts, et
   * les iframes de même origine où Chrome n'a pas injecté le script
   * (about:blank, srcdoc...). Les iframes d'une autre origine sont traitées par
   * leur propre instance du script (allFrames).
   */
  function collecterRacines(racine, res) {
    res.push(racine);
    const tous = racine.querySelectorAll('*');
    for (const el of tous) {
      if (el.shadowRoot) collecterRacines(el.shadowRoot, res);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try {
          const w = el.contentWindow;
          const d = el.contentDocument;
          if (d && w && !w.__afa && d.documentElement) collecterRacines(d, res);
        } catch (_) { /* autre origine : ignorée ici */ }
      }
    }
    return res;
  }

  function racines() { return collecterRacines(document, []); }

  /** Parcourt toutes les racines avec un sélecteur. */
  function toutSelectionner(selecteur) {
    const res = [];
    for (const r of racines()) r.querySelectorAll(selecteur).forEach((e) => res.push(e));
    return res;
  }

  /* ================================================================== */
  /* Libellés et contexte                                                */
  /* ================================================================== */

  function libelleDe(el) {
    // 1. aria-labelledby (plusieurs ids possibles)
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => texteDe(getById(el, id))).filter(Boolean).join(' ');
      if (t) return t;
    }
    // 2. <label for> et label parent (el.labels couvre les deux)
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map(texteLibelle).filter(Boolean).join(' ');
      if (t) return t;
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const t = texteLibelle(parentLabel);
      if (t) return t;
    }
    // 3. aria-label, title
    const al = el.getAttribute('aria-label') || el.getAttribute('title');
    if (al) return al.trim();
    // 4. texte voisin : frères précédents, puis ceux du parent (2 niveaux)
    let n = el;
    for (let niveau = 0; niveau < 3 && n; niveau++) {
      let p = n.previousElementSibling;
      for (let i = 0; i < 3 && p; i++, p = p.previousElementSibling) {
        if (p.matches('input, select, textarea, button')) break;
        const t = texteDe(p);
        if (t && t.length <= 120) return t;
      }
      // texte brut juste avant (ex. « Nom : <input> »)
      const prev = n.previousSibling;
      if (prev && prev.nodeType === 3 && prev.textContent.trim()) return prev.textContent.trim().slice(0, 120);
      n = n.parentElement;
      if (n && n.matches('form, fieldset, section, body')) break;
    }
    // 5. cellule de tableau à gauche
    const td = el.closest('td');
    if (td && td.previousElementSibling) {
      const t = texteDe(td.previousElementSibling);
      if (t) return t.slice(0, 120);
    }
    return '';
  }

  function aideDe(el) {
    const db = el.getAttribute('aria-describedby');
    if (!db) return '';
    return db.split(/\s+/).map((id) => texteDe(getById(el, id))).filter(Boolean).join(' ').slice(0, 160);
  }

  /** Section / étape : légende de fieldset, ou titre le plus proche. */
  function sectionDe(el) {
    const fs = el.closest('fieldset');
    const lg = fs && fs.querySelector('legend');
    if (lg && texteDe(lg)) return texteDe(lg).slice(0, 80);
    let n = el.parentElement;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      const h = n.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > header h1, :scope > header h2, :scope > header h3');
      if (h && texteDe(h)) return texteDe(h).slice(0, 80);
      if (n.getAttribute('aria-label') && /^(section|fieldset|form|div)$/i.test(n.tagName) && n.getAttribute('role')) {
        return n.getAttribute('aria-label').slice(0, 80);
      }
    }
    return '';
  }

  function estRequis(el) {
    return !!(el.required || el.getAttribute('aria-required') === 'true');
  }

  /* ================================================================== */
  /* Détection des champs                                                */
  /* ================================================================== */

  const TYPES_TEXTE = new Set(['', 'text', 'email', 'tel', 'number', 'date', 'month', 'week', 'time',
    'datetime-local', 'url', 'search']);

  function identifiant(cleEl) {
    let id = etat.idParEl.get(cleEl);
    if (!id) {
      id = etat.jeton + (++etat.compteur);
      etat.idParEl.set(cleEl, id);
    }
    return id;
  }

  /** Champ de saisie avec liste de suggestions (combobox ARIA, react-select, adresse...). */
  function estAutocompletion(el) {
    const role = el.getAttribute('role');
    const aa = el.getAttribute('aria-autocomplete');
    return role === 'combobox' || aa === 'list' || aa === 'both' ||
      el.getAttribute('aria-haspopup') === 'listbox' ||
      /\b(pac-target-input|select2-search__field|react-select|autocomplete|typeahead|choices__input)\b/i.test(el.className || '') ||
      !!el.closest('[class*="react-select"], [class*="-select__control"], .v-autocomplete, .mat-mdc-autocomplete-trigger');
  }

  function optionsSelect(el) {
    return [...el.options].slice(0, 400).map((o, i) => {
      const texte = (o.label || o.textContent || '').replace(/\s+/g, ' ').trim();
      const ignorer = o.disabled || (i === 0 && (!o.value || /^(-+|choisi|selectionn|veuillez|select|--)/i.test(U.normaliser(texte) || '-')));
      return { valeur: o.value, texte, ignorer };
    });
  }

  function estVideEl(d) {
    const el = d.el;
    switch (d.type) {
      case 'radio': return !d.radios.some((r) => estCoche(r));
      case 'checkbox': return !estCoche(el);
      case 'select': {
        if (el.selectedIndex < 0) return true;
        const o = optionsSelect(el)[el.selectedIndex];
        return !o || o.ignorer || !o.valeur;
      }
      case 'editable': return !texteDe(el);
      case 'liste': {
        const t = texteDe(el);
        return !t || /^(choisi|selectionn|veuillez|select|--)/i.test(U.normaliser(t)) || t === el.getAttribute('aria-placeholder');
      }
      default: return !String(el.value || '').trim();
    }
  }

  function estCoche(el) {
    if (el.tagName === 'INPUT') return el.checked;
    return el.getAttribute('aria-checked') === 'true';
  }

  /** Libellé d'un bouton radio individuel. */
  function libelleRadio(r) {
    if (r.labels && r.labels.length) return texteLibelle(r.labels[0]);
    const l = r.closest('label');
    if (l) return texteLibelle(l);
    return r.getAttribute('aria-label') || texteDe(r) || r.value || '';
  }

  /** Plus petit ancêtre commun d'une liste d'éléments. */
  function ancetreCommun(els) {
    let a = els[0].parentElement;
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a;
  }

  /**
   * Libellé d'un groupe de boutons radio : radiogroup ARIA, puis texte qui
   * précède le groupe (« Vous êtes : »), puis légende du fieldset.
   */
  function libelleGroupeRadio(radios) {
    const rg = radios[0].closest('[role="radiogroup"]');
    if (rg) {
      const lb = rg.getAttribute('aria-labelledby');
      const t = lb ? lb.split(/\s+/).map((id) => texteDe(getById(rg, id))).filter(Boolean).join(' ') : rg.getAttribute('aria-label');
      if (t) return t;
    }
    const commun = ancetreCommun(radios);
    if (commun) {
      // Si l'ancêtre commun englobe aussi les libellés des radios, on regarde ce qui le précède.
      const fs = commun.closest('fieldset');
      const lg = fs && fs.querySelector(':scope > legend');
      if (fs && lg && (commun === fs || fs.querySelectorAll('input, select, textarea').length <= radios.length + 1)) return texteDe(lg);
      const avant = libelleDe(commun.tagName === 'LABEL' ? commun.parentElement : commun);
      if (avant) return avant;
      if (lg) return texteDe(lg);
    }
    return '';
  }

  /** Construit la description d'un champ (envoyée au modèle en texte seulement). */
  function decrire(d) {
    const el = d.el;
    const base = {
      id: d.id,
      type: d.type,
      libelle: '',
      name: el.getAttribute('name') || '',
      idAttr: el.id || '',
      placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      aide: aideDe(el),
      requis: estRequis(el),
      section: sectionDe(el),
      vide: estVideEl(d)
    };
    if (el.tagName === 'INPUT' && d.type !== 'radio' && d.type !== 'checkbox') base.typeHtml = (el.type || 'text').toLowerCase();
    if (el.maxLength > 0 && el.maxLength < 1000) base.maxlength = el.maxLength;
    if (el.pattern) base.pattern = el.pattern.slice(0, 80);

    if (d.type === 'radio') {
      base.libelle = libelleGroupeRadio(d.radios) || base.name;
      base.options = d.radios.map((r) => libelleRadio(r));
      base.requis = d.radios.some(estRequis);
    } else {
      base.libelle = libelleDe(el);
      if (d.type === 'select') base.options = optionsSelect(el).filter((o) => !o.ignorer).map((o) => o.texte);
      if (d.type === 'checkbox') {
        const fs = el.closest('fieldset');
        const lg = fs && fs.querySelector('legend');
        if (lg && texteDe(lg) && !base.libelle.includes(texteDe(lg))) base.groupe = texteDe(lg).slice(0, 80);
      }
      if (d.type === 'texte' && el.list && el.list.options) {
        base.suggestions = [...el.list.options].slice(0, 100).map((o) => o.value);
      }
      if (d.type === 'liste') {
        const lb = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        const box = lb && getById(el, lb.split(/\s+/)[0]);
        if (box) base.options = [...box.querySelectorAll('[role="option"]')].slice(0, 300).map(texteDe).filter(Boolean);
        if (!base.libelle) base.libelle = texteDe(el).slice(0, 80);
      }
    }
    base.libelle = String(base.libelle || '').slice(0, 160);
    if (base.options && !base.options.length) delete base.options;
    return base;
  }

  /**
   * Analyse le cadre : renvoie la liste des champs visibles et modifiables.
   * Les champs interdits (mot de passe, carte bancaire...) sont comptés mais
   * jamais décrits ni remplis.
   */
  function analyser() {
    const champs = [];
    let interdits = 0;
    const groupesRadio = new Map();
    const vus = new Set();

    const ajouter = (d) => {
      const desc = decrire(d);
      const cible = d.type === 'radio' ? d.radios[0] : d.el;
      if (U.estChampInterdit({ ...desc, type: cible.type || desc.typeHtml, id: desc.idAttr, classes: cible.className })) {
        interdits++;
        return;
      }
      etat.parId.set(d.id, d);
      champs.push(desc);
    };

    const selecteur = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], ' +
      '[role="combobox"], [role="checkbox"], [role="radio"], [role="textbox"], [aria-haspopup="listbox"]';

    for (const racine of racines()) {
      for (const el of racine.querySelectorAll(selecteur)) {
        if (vus.has(el)) continue;
        vus.add(el);
        if (el.closest('[aria-hidden="true"], [inert]')) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const tag = el.tagName;
        const type = (el.type || '').toLowerCase();

        // Boutons radio (natifs ou ARIA) : regroupés
        if ((tag === 'INPUT' && type === 'radio') || el.getAttribute('role') === 'radio') {
          if (!elementAffiche(el)) continue;
          const conteneur = el.closest('[role="radiogroup"]');
          const nom = tag === 'INPUT' && el.name ? el.name : null;
          const cle = nom ? (el.form || el.getRootNode()) : (conteneur || el.parentElement);
          let groupes = groupesRadio.get(cle);
          if (!groupes) { groupes = new Map(); groupesRadio.set(cle, groupes); }
          const k = nom || '__sans_nom';
          if (!groupes.has(k)) groupes.set(k, []);
          groupes.get(k).push(el);
          continue;
        }

        if (tag === 'INPUT') {
          if (type === 'checkbox') {
            if (!elementAffiche(el)) continue;
            ajouter({ id: identifiant(el), type: 'checkbox', el });
            continue;
          }
          if (type === 'password') { if (estVisible(el)) interdits++; continue; }
          if (!TYPES_TEXTE.has(type)) continue; // hidden, file, submit, button, image...
          if (!estVisible(el)) continue;
          // Lecture seule : acceptée seulement pour les sélecteurs de date
          if (el.readOnly && !/date|naiss|jour|birth|calend/i.test(el.name + el.id + el.className + libelleDe(el))) continue;
          ajouter({ id: identifiant(el), type: estAutocompletion(el) ? 'autocompletion' : 'texte', el });
        } else if (tag === 'SELECT') {
          if (el.multiple || !estVisible(el)) continue;
          ajouter({ id: identifiant(el), type: 'select', el });
        } else if (tag === 'TEXTAREA') {
          if (el.readOnly || !estVisible(el)) continue;
          ajouter({ id: identifiant(el), type: 'texte', el });
        } else if (el.getAttribute('role') === 'checkbox') {
          if (!estVisible(el)) continue;
          ajouter({ id: identifiant(el), type: 'checkbox', el });
        } else if (el.isContentEditable && el.getAttribute('role') !== 'combobox') {
          // éditeur riche : seulement l'élément racine éditable
          if (el.parentElement && el.parentElement.isContentEditable) continue;
          if (!estVisible(el)) continue;
          ajouter({ id: identifiant(el), type: 'editable', el });
        } else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') {
          // liste déroulante personnalisée (div/bouton) ; un champ de saisie interne éventuel est traité à part
          if (!estVisible(el)) continue;
          if (el.querySelector('input:not([type="hidden"])')) continue;
          ajouter({ id: identifiant(el), type: 'liste', el });
        } else if (el.getAttribute('role') === 'textbox') {
          if (!estVisible(el)) continue;
          ajouter({ id: identifiant(el), type: 'editable', el });
        }
      }
    }

    for (const groupes of groupesRadio.values()) {
      for (const radios of groupes.values()) {
        ajouter({ id: identifiant(radios[0]), type: 'radio', el: radios[0], radios });
      }
    }

    return {
      url: location.href,
      titre: document.title,
      estPrincipal: window === window.top,
      champs,
      interdits
    };
  }

  /* ================================================================== */
  /* Écriture compatible avec les frameworks                             */
  /* ================================================================== */

  function declencher(el, type, init) {
    const w = vue(el);
    let ev;
    if (type === 'input' || type === 'beforeinput') {
      ev = new w.InputEvent(type, { bubbles: true, composed: true, cancelable: type === 'beforeinput', inputType: 'insertText', data: init && init.data });
    } else if (/^(key)/.test(type)) {
      ev = new w.KeyboardEvent(type, { bubbles: true, composed: true, cancelable: true, ...init });
    } else if (/^(pointer)/.test(type)) {
      ev = new w.PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', isPrimary: true, ...init });
    } else if (/^(mouse|click)/.test(type)) {
      ev = new w.MouseEvent(type, { bubbles: true, composed: true, cancelable: true, view: w, button: 0, ...init });
    } else if (type === 'focus' || type === 'blur') {
      ev = new w.FocusEvent(type, { bubbles: false, composed: true });
    } else if (type === 'focusin' || type === 'focusout') {
      ev = new w.FocusEvent(type, { bubbles: true, composed: true });
    } else {
      ev = new w.Event(type, { bubbles: true, composed: true });
    }
    el.dispatchEvent(ev);
  }

  /**
   * Écrit une valeur dans un input/textarea comme le ferait une saisie :
   * setter natif (contourne le suivi de valeur de React), puis input/change.
   */
  function ecrireValeur(el, valeur, { sansBlur = false } = {}) {
    const w = vue(el);
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    declencher(el, 'focusin');
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    declencher(el, 'beforeinput', { data: valeur });
    setter.call(el, valeur);
    declencher(el, 'input', { data: valeur });

    // Si un masque de saisie a refusé la valeur, on retente comme une vraie frappe.
    if (!el.value && valeur && el.type !== 'date') {
      try {
        el.select && el.select();
        el.ownerDocument.execCommand('insertText', false, valeur);
      } catch (_) { /* ignore */ }
    }
    if (!sansBlur) {
      declencher(el, 'change');
      declencher(el, 'blur');
      declencher(el, 'focusout');
    }
  }

  function ecrireSelect(el, index) {
    const w = vue(el);
    const setter = Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set;
    try { el.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    setter.call(el, el.options[index].value);
    el.selectedIndex = index;
    declencher(el, 'input');
    declencher(el, 'change');
    declencher(el, 'blur');
    declencher(el, 'focusout');
  }

  /**
   * Garde-fou : refuse de cliquer sur tout ce qui ressemble à un bouton
   * d'envoi, de validation, de paiement ou de navigation.
   */
  function estBoutonEnvoi(el) {
    const b = el.closest('button, input[type="submit"], input[type="image"], input[type="reset"], input[type="button"], a[href], [role="button"], [role="link"]');
    if (!b) return false;
    if (b.tagName === 'INPUT') {
      if (['submit', 'image', 'reset'].includes(b.type)) return true;
      return U.estLibelleEnvoi(b.value + ' ' + (b.getAttribute('aria-label') || ''));
    }
    if (b.tagName === 'BUTTON') {
      const t = (b.getAttribute('type') || 'submit').toLowerCase();
      if (t === 'reset') return true;
      if (t === 'submit' && (b.form || b.closest('form'))) return true;
    }
    if (b.tagName === 'A') {
      const href = b.getAttribute('href') || '';
      if (b.getAttribute('role') !== 'option' && !/^(#|javascript:)/i.test(href)) return true;
    }
    return U.estLibelleEnvoi(texteDe(b) + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || ''));
  }

  function cliquer(el, { sequenceComplete = true } = {}) {
    if (estBoutonEnvoi(el)) throw new Error('Clic refusé : élément de type envoi/validation');
    const r = el.getBoundingClientRect();
    const pos = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    if (sequenceComplete) {
      declencher(el, 'pointerdown', pos);
      declencher(el, 'mousedown', pos);
      declencher(el, 'pointerup', pos);
      declencher(el, 'mouseup', pos);
    }
    el.click();
  }

  /* ================================================================== */
  /* Listes personnalisées et autocomplétion                             */
  /* ================================================================== */

  const SELECTEUR_OPTIONS = [
    '[role="option"]', '.pac-item', '.ui-menu-item', '.autocomplete-suggestion', '.select2-results__option',
    '[class*="__option"]', '.mat-option', 'mat-option', '.mat-mdc-option', '.v-list-item', '.choices__item--choice',
    '.dropdown-item', '[data-option-index]', '.tt-suggestion', '.suggestion-item', '.ng-option'
  ].join(', ');

  function optionsVisibles(ancre) {
    let res = [];
    const ids = [ancre.getAttribute('aria-controls'), ancre.getAttribute('aria-owns')].filter(Boolean).join(' ');
    for (const id of ids.split(/\s+/).filter(Boolean)) {
      const lb = getById(ancre, id);
      if (lb) res.push(...lb.querySelectorAll('[role="option"], li'));
    }
    if (!res.length) res = toutSelectionner(SELECTEUR_OPTIONS);
    return res.filter((o) => o !== ancre && o.tagName !== 'OPTION' && estVisible(o) &&
      o.getAttribute('aria-disabled') !== 'true' && texteDe(o));
  }

  /**
   * Attend l'apparition d'options (MutationObserver + délai maximal).
   * Résout dès que la liste est stable depuis 200 ms.
   */
  function attendreOptions(ancre, delaiMax = 3000) {
    return new Promise((resoudre) => {
      const debut = Date.now();
      let dernierNb = -1;
      let stableDepuis = Date.now();
      let fini = false;
      const obs = new MutationObserver(() => verifier());
      const docs = new Set([ancre.ownerDocument, document]);
      docs.forEach((d) => obs.observe(d.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-expanded', 'hidden'] }));
      const minuterie = setInterval(() => verifier(), 120);
      function finir(v) {
        if (fini) return;
        fini = true;
        obs.disconnect();
        clearInterval(minuterie);
        resoudre(v);
      }
      function verifier() {
        const opts = optionsVisibles(ancre);
        if (opts.length !== dernierNb) { dernierNb = opts.length; stableDepuis = Date.now(); }
        if (opts.length && Date.now() - stableDepuis >= 200) return finir(opts);
        if (Date.now() - debut > delaiMax) finir(opts);
      }
    });
  }

  function choisirOption(valeur, opts, seuil) {
    const m = U.meilleureOption(valeur, opts.map((o) => ({ texte: texteDe(o), valeur: o.getAttribute('data-value') || '' })), seuil);
    return m ? { el: opts[m.index], score: m.score } : null;
  }

  function fermerListe(el) {
    declencher(el, 'keydown', { key: 'Escape', code: 'Escape', keyCode: 27 });
  }

  /** Champ de saisie avec suggestions : taper, attendre, cliquer la meilleure suggestion. */
  async function remplirAutocompletion(el, valeur) {
    try { cliquer(el, { sequenceComplete: true }); } catch (_) { el.focus(); }
    ecrireValeur(el, valeur, { sansBlur: true });
    const dernier = valeur.slice(-1);
    declencher(el, 'keydown', { key: dernier });
    declencher(el, 'keyup', { key: dernier });
    const opts = await attendreOptions(el, 3500);
    if (!opts.length) {
      declencher(el, 'change');
      return { exact: false, note: 'aucune suggestion' };
    }
    const choix = choisirOption(valeur, opts, 0.5);
    if (!choix) {
      fermerListe(el);
      return { exact: false, note: 'aucune suggestion ne correspond' };
    }
    cliquer(choix.el);
    await attendre(150);
    return { exact: choix.score >= 0.85, note: choix.score >= 0.85 ? '' : 'suggestion approchante choisie' };
  }

  /** Liste déroulante personnalisée (div/bouton role=combobox, select2, mat-select...). */
  async function remplirListe(el, valeur) {
    cliquer(el);
    let opts = await attendreOptions(el, 2500);
    // Certaines listes ouvrent un champ de recherche : on y tape la valeur.
    const actif = el.ownerDocument.activeElement;
    const recherche = actif && actif !== el && actif.tagName === 'INPUT' ? actif : null;
    if (recherche && !U.estChampInterdit({ type: recherche.type, name: recherche.name })) {
      ecrireValeur(recherche, valeur, { sansBlur: true });
      await attendre(100);
      opts = await attendreOptions(recherche, 2500);
    }
    const choix = opts.length ? choisirOption(valeur, opts, 0.72) : null;
    if (!choix) {
      fermerListe(recherche || el);
      throw new Error('option introuvable dans la liste');
    }
    cliquer(choix.el);
    await attendre(150);
    return { exact: choix.score >= 0.9 };
  }

  /* ================================================================== */
  /* Remplissage d'un champ                                              */
  /* ================================================================== */

  function instantane(d) {
    const el = d.el;
    switch (d.type) {
      case 'radio': return { coches: d.radios.map(estCoche) };
      case 'checkbox': return { coche: estCoche(el) };
      case 'select': return { index: el.selectedIndex };
      case 'editable': return { html: el.innerHTML };
      case 'liste': return { texte: texteDe(el) };
      default: return { valeur: el.value };
    }
  }

  async function remplirChamp(d, valeurBrute) {
    const el = d.el;
    let valeur = String(valeurBrute == null ? '' : valeurBrute).trim();
    if (!valeur) throw new Error('valeur vide');

    switch (d.type) {
      case 'texte':
      case 'autocompletion': {
        const t = (el.type || '').toLowerCase();
        if (['date', 'month', 'datetime-local'].includes(t)) valeur = U.dateSelonChamp(valeur, t, 'AAAA-MM-JJ');
        if (t === 'number') valeur = U.versNombre(valeur) || valeur;
        if (d.type === 'autocompletion') return remplirAutocompletion(el, valeur);
        ecrireValeur(el, valeur);
        if (!el.value) throw new Error('valeur refusée par le champ');
        const exact = U.normaliser(el.value) === U.normaliser(valeur);
        return { exact, note: exact ? '' : 'valeur reformatée par la page' };
      }
      case 'select': {
        const opts = optionsSelect(el);
        const m = U.meilleureOption(valeur, opts, 0.72);
        if (!m) throw new Error('option introuvable');
        ecrireSelect(el, m.index);
        return { exact: m.score >= 0.9 };
      }
      case 'radio': {
        const opts = d.radios.map((r) => ({ texte: libelleRadio(r), valeur: r.value || r.getAttribute('data-value') || '' }));
        const m = U.meilleureOption(valeur, opts, 0.72);
        if (!m) throw new Error('choix introuvable');
        const r = d.radios[m.index];
        if (!estCoche(r)) {
          const cible = r.tagName === 'INPUT' && !estVisible(r) ? (elementAffiche(r) || r) : r;
          cliquer(cible, { sequenceComplete: false });
          await attendre(30);
          if (r.tagName === 'INPUT' && !r.checked) { // dernier recours
            r.checked = true;
            declencher(r, 'input');
            declencher(r, 'change');
          }
        }
        return { exact: m.score >= 0.9 };
      }
      case 'checkbox': {
        const voulu = U.versBooleen(valeur);
        if (voulu === null) throw new Error('valeur de case à cocher ambiguë');
        if (estCoche(el) !== voulu) {
          const cible = el.tagName === 'INPUT' && !estVisible(el) ? (elementAffiche(el) || el) : el;
          cliquer(cible, { sequenceComplete: false });
          await attendre(30);
          if (el.tagName === 'INPUT' && el.checked !== voulu) {
            el.checked = voulu;
            declencher(el, 'input');
            declencher(el, 'change');
          }
        }
        return { exact: true };
      }
      case 'editable': {
        el.focus();
        const doc = el.ownerDocument;
        const sel = vue(el).getSelection();
        const plage = doc.createRange();
        plage.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(plage);
        let ok = false;
        try { ok = doc.execCommand('insertText', false, valeur); } catch (_) { ok = false; }
        if (!ok || !texteDe(el)) {
          el.textContent = valeur;
          declencher(el, 'input', { data: valeur });
        }
        declencher(el, 'blur');
        return { exact: true };
      }
      case 'liste':
        return remplirListe(el, valeur);
      default:
        throw new Error('type de champ non géré');
    }
  }

  /* ================================================================== */
  /* Surlignage                                                          */
  /* ================================================================== */

  function elementASurligner(d, valeur) {
    if (d.type === 'radio') {
      const conteneur = d.radios[0].closest('fieldset, [role="radiogroup"]');
      if (conteneur && estVisible(conteneur)) return conteneur;
      const coche = d.radios.find(estCoche) || d.radios[0];
      return elementAffiche(coche) || coche;
    }
    if (d.type === 'checkbox') return elementAffiche(d.el) || d.el;
    const el = d.el;
    const r = el.getBoundingClientRect();
    if (r.width < 40 && el.parentElement) {
      return el.closest('[class*="control"], [class*="container"]') || el.parentElement; // react-select & co
    }
    return el;
  }

  function surligner(el, niveau, info) {
    if (!el) return;
    if (!etat.surlignes.has(el)) {
      etat.surlignes.set(el, {
        outline: el.style.getPropertyValue('outline'),
        outlinePrio: el.style.getPropertyPriority('outline'),
        offset: el.style.getPropertyValue('outline-offset'),
        title: el.getAttribute('title')
      });
    }
    el.style.setProperty('outline', `3px solid ${niveau === 'ok' ? VERT : ORANGE}`, 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
    el.setAttribute('title', info);
  }

  function effacerSurlignages() {
    for (const [el, o] of etat.surlignes) {
      if (!el.isConnected) continue;
      if (o.outline) el.style.setProperty('outline', o.outline, o.outlinePrio); else el.style.removeProperty('outline');
      if (o.offset) el.style.setProperty('outline-offset', o.offset); else el.style.removeProperty('outline-offset');
      if (o.title == null) el.removeAttribute('title'); else el.setAttribute('title', o.title);
    }
    const n = etat.surlignes.size;
    etat.surlignes.clear();
    return n;
  }

  /* ================================================================== */
  /* API exposée au panneau                                              */
  /* ================================================================== */

  /**
   * Remplit une liste de champs.
   * @param {Array<{id, valeur, confiance, source}>} remplissages
   * @param {{seulementVides:boolean}} options
   * @returns {Promise<Array<{id, ok, niveau?, raison?, note?}>>}
   */
  async function remplir(remplissages, options) {
    const rapports = [];
    for (const r of remplissages || []) {
      const d = etat.parId.get(r.id);
      if (!d || !d.el.isConnected) { rapports.push({ id: r.id, ok: false, raison: 'champ disparu' }); continue; }
      if (options && options.seulementVides && !estVideEl(d)) { rapports.push({ id: r.id, ok: false, raison: 'déjà rempli' }); continue; }
      const avant = instantane(d);
      try {
        const res = await remplirChamp(d, r.valeur);
        if (!etat.originaux.has(r.id)) etat.originaux.set(r.id, avant);
        const confiance = Number(r.confiance);
        const niveau = res.exact && (!Number.isFinite(confiance) || confiance >= 0.8) ? 'ok' : 'verifier';
        const info = `AutoFill Admin : « ${r.valeur} »` + (r.source ? `\nSource : ${r.source}` : '') +
          (niveau === 'verifier' ? '\n⚠ À vérifier' + (res.note ? ` (${res.note})` : '') : '');
        surligner(elementASurligner(d, r.valeur), niveau, info);
        rapports.push({ id: r.id, ok: true, niveau, note: res.note || '' });
      } catch (e) {
        rapports.push({ id: r.id, ok: false, raison: e.message || String(e) });
      }
      await attendre(40); // laisse la page réagir (champs dépendants)
    }
    return rapports;
  }

  /** Restaure les valeurs d'avant le remplissage. */
  async function annuler() {
    let n = 0;
    for (const [id, avant] of etat.originaux) {
      const d = etat.parId.get(id);
      if (!d || !d.el.isConnected) continue;
      const el = d.el;
      try {
        switch (d.type) {
          case 'radio':
            d.radios.forEach((r, i) => {
              if (r.tagName === 'INPUT') { r.checked = avant.coches[i]; declencher(r, 'change'); }
              else if (estCoche(r) !== avant.coches[i] && avant.coches[i]) cliquer(r, { sequenceComplete: false });
            });
            break;
          case 'checkbox':
            if (estCoche(el) !== avant.coche) cliquer(elementAffiche(el) || el, { sequenceComplete: false });
            break;
          case 'select': ecrireSelect(el, Math.max(0, avant.index)); break;
          case 'editable': el.innerHTML = avant.html; declencher(el, 'input'); break;
          case 'liste': break; // impossible de « désélectionner » de façon générique
          default: ecrireValeur(el, avant.valeur);
        }
        n++;
      } catch (_) { /* on continue */ }
    }
    etat.originaux.clear();
    effacerSurlignages();
    return n;
  }

  /** Élément le plus profond sous un point, en traversant Shadow DOM et iframes de même origine. */
  function elementAuPoint(x, y) {
    let doc = document;
    let el = doc.elementFromPoint(x, y);
    for (let i = 0; i < 10 && el; i++) {
      if (el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (inner && inner !== el) { el = inner; continue; }
      }
      if (el.tagName === 'IFRAME') {
        try {
          const r = el.getBoundingClientRect();
          const d = el.contentDocument;
          if (d) { x -= r.left; y -= r.top; doc = d; el = d.elementFromPoint(x, y); continue; }
        } catch (_) { /* autre origine */ }
      }
      break;
    }
    return el;
  }

  /** Repli vision : remplit le champ situé à des coordonnées (pixels CSS de la fenêtre). */
  async function remplirAuPoint(x, y, valeur, info) {
    let el = elementAuPoint(x, y);
    if (!el) return { ok: false, raison: 'rien à cet endroit' };
    if (el.tagName === 'CANVAS') return { ok: false, raison: 'zone dessinée (canvas) : copiez la valeur' };
    if (el.tagName === 'LABEL' && el.control) el = el.control;
    if (!el.matches('input, select, textarea, [contenteditable="true"], [contenteditable=""], [role="combobox"]')) {
      const interne = el.querySelector && el.querySelector('input:not([type="hidden"]), select, textarea, [contenteditable="true"]');
      if (!interne) return { ok: false, raison: 'aucun champ modifiable à cet endroit' };
      el = interne;
    }
    const type = (el.type || '').toLowerCase();
    if (U.estChampInterdit({ type, name: el.name, id: el.id, autocomplete: el.getAttribute('autocomplete'), libelle: libelleDe(el) })) {
      return { ok: false, raison: 'champ protégé (ignoré)' };
    }
    let d;
    if (el.tagName === 'SELECT') d = { type: 'select', el };
    else if (el.tagName === 'INPUT' && type === 'checkbox') d = { type: 'checkbox', el };
    else if (el.tagName === 'INPUT' && type === 'radio') d = { type: 'radio', el, radios: [el] };
    else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') d = { type: estAutocompletion(el) ? 'autocompletion' : 'texte', el };
    else if (el.getAttribute('role') === 'combobox') d = { type: 'liste', el };
    else d = { type: 'editable', el };
    d.id = identifiant(d.type === 'radio' ? el : el);
    etat.parId.set(d.id, d);
    const avant = instantane(d);
    try {
      const res = await remplirChamp(d, valeur);
      if (!etat.originaux.has(d.id)) etat.originaux.set(d.id, avant);
      surligner(elementASurligner(d, valeur), 'verifier', info || `AutoFill Admin (capture) : « ${valeur} »\n⚠ À vérifier`);
      return { ok: true, note: res.note || '' };
    } catch (e) {
      return { ok: false, raison: e.message };
    }
  }

  function infos() {
    return { largeur: window.innerWidth, hauteur: window.innerHeight, dpr: window.devicePixelRatio };
  }

  window.__afa = { analyser, remplir, annuler, effacerSurlignages, remplirAuPoint, infos };
})();
