/*
 * Tests des fonctions pures (lib/utils.js), sans dépendance.
 * Lancer : node test/run-tests.js
 */
'use strict';
const assert = require('assert/strict');
const U = require('../lib/utils.js');

// Les tests sont enregistrés puis exécutés dans l'ordre (certains sont asynchrones).
const file = [];
const test = (nom, fn) => file.push({ nom, fn });
const section = (titre) => file.push({ titre });

/* ---------------- JSON robuste ---------------- */
section('Parsing JSON');
test('JSON simple', () => assert.deepEqual(U.parseJsonRobuste('{"a":1}'), { a: 1 }));
test('bloc ```json', () => assert.deepEqual(U.parseJsonRobuste('```json\n{"champs":[]}\n```'), { champs: [] }));
test('bloc ``` sans langue', () => assert.deepEqual(U.parseJsonRobuste('```\n{"a":"b"}\n```'), { a: 'b' }));
test('texte avant et après', () => assert.deepEqual(U.parseJsonRobuste('Voici :\n{"a":[1,2]}\nBonne journée'), { a: [1, 2] }));
test('virgules finales', () => assert.deepEqual(U.parseJsonRobuste('{"a":[1,2,],"b":3,}'), { a: [1, 2], b: 3 }));
test('bloc ``` non fermé', () => assert.deepEqual(U.parseJsonRobuste('```json\n{"x":true}'), { x: true }));
test('BOM initial', () => assert.deepEqual(U.parseJsonRobuste('\uFEFF{"a":1}'), { a: 1 }));
test('accolades dans une chaîne', () => assert.deepEqual(U.parseJsonRobuste('{"v":"a}b"}'), { v: 'a}b' }));
test('vide -> erreur', () => assert.throws(() => U.parseJsonRobuste('   '), /vide/));
test('pas de JSON -> erreur', () => assert.throws(() => U.parseJsonRobuste('Désolé, je ne peux pas.'), /JSON invalide/));

/* ---------------- Dates ---------------- */
section('Dates');
test('ISO', () => assert.equal(U.versIso('1985-03-14'), '1985-03-14'));
test('JJ/MM/AAAA', () => assert.equal(U.versIso('14/03/1985'), '1985-03-14'));
test('J/M/AAAA', () => assert.equal(U.versIso('4/3/1985'), '1985-03-04'));
test('JJ.MM.AAAA', () => assert.equal(U.versIso('14.03.1985'), '1985-03-14'));
test('JJ-MM-AA (fenêtre glissante)', () => {
  assert.equal(U.versIso('14-03-85', 2026), '1985-03-14');
  assert.equal(U.versIso('14-03-24', 2026), '2024-03-14');
});
test('JJMMAAAA', () => assert.equal(U.versIso('14031985'), '1985-03-14'));
test('« 1er mars 2024 »', () => assert.equal(U.versIso('1er mars 2024'), '2024-03-01'));
test('« 14 février 1985 » (accent)', () => assert.equal(U.versIso('14 Février 1985'), '1985-02-14'));
test('« 5 août 2020 »', () => assert.equal(U.versIso('5 août 2020'), '2020-08-05'));
test('anglais « March 5, 2024 »', () => assert.equal(U.versIso('March 5, 2024'), '2024-03-05'));
test('date impossible -> vide', () => {
  assert.equal(U.versIso('31/02/2020'), '');
  assert.equal(U.versIso('2023-13-01'), '');
});
test('29 février bissextile', () => assert.equal(U.versIso('29/02/2024'), '2024-02-29'));
test('non-date -> vide', () => assert.equal(U.versIso('Paris'), ''));
test('formaterDate JJ/MM/AAAA', () => assert.equal(U.formaterDate('1985-03-14', 'JJ/MM/AAAA'), '14/03/1985'));
test('formaterDate MM/JJ/AAAA', () => assert.equal(U.formaterDate('1985-03-14', 'MM/JJ/AAAA'), '03/14/1985'));
test('formaterDate JJ.MM.AAAA', () => assert.equal(U.formaterDate('1985-03-14', 'JJ.MM.AAAA'), '14.03.1985'));
test('formaterDate entrée invalide', () => assert.equal(U.formaterDate('14/03/1985', 'JJ/MM/AAAA'), ''));
test('dateSelonChamp type=date', () => assert.equal(U.dateSelonChamp('14/03/1985', 'date', 'JJ/MM/AAAA'), '1985-03-14'));
test('dateSelonChamp type=month', () => assert.equal(U.dateSelonChamp('1985-03-14', 'month'), '1985-03'));
test('dateSelonChamp type=datetime-local', () => assert.equal(U.dateSelonChamp('1985-03-14', 'datetime-local'), '1985-03-14T00:00'));
test('dateSelonChamp texte', () => assert.equal(U.dateSelonChamp('1985-03-14', 'text', 'JJ/MM/AAAA'), '14/03/1985'));
test('dateSelonChamp non-date inchangée', () => assert.equal(U.dateSelonChamp('Lyon', 'text', 'JJ/MM/AAAA'), 'Lyon'));

/* ---------------- Normalisation ---------------- */
section('Normalisation des accents');
test('accents et casse', () => assert.equal(U.normaliser('Élodie-Marie ÇA'), 'elodie marie ca'));
test('ligatures', () => assert.equal(U.normaliser('Œuvre Cæsar'), 'oeuvre caesar'));
test('apostrophes et ponctuation', () => assert.equal(U.normaliser("  Nom d’usage : "), 'nom d usage'));
test('null / undefined', () => { assert.equal(U.normaliser(null), ''); assert.equal(U.normaliser(undefined), ''); });
test('normaliserCle', () => assert.equal(U.normaliserCle('Date de naissance'), 'date_de_naissance'));
test('dice identiques / différents', () => {
  assert.equal(U.dice('abc', 'abc'), 1);
  assert.ok(U.dice('marseille', 'paris') < 0.3);
});

/* ---------------- Correspondance des options ---------------- */
section('Correspondance des options');
const opt = (...t) => t.map((x) => ({ texte: x, valeur: x }));
test('exacte insensible casse/accents', () => assert.equal(U.meilleureOption('francaise', opt('Allemande', 'Française')).index, 1));
test('par valeur', () => assert.equal(U.meilleureOption('FR', [{ valeur: 'DE', texte: 'Allemagne' }, { valeur: 'FR', texte: 'France' }]).index, 1));
test('civilité : Madame -> Mme', () => assert.equal(U.meilleureOption('Madame', opt('M.', 'Mme')).index, 1));
test('civilité : M. -> Monsieur', () => assert.equal(U.meilleureOption('M.', opt('Madame', 'Monsieur')).index, 1));
test('civilité anglaise : Monsieur -> Mr', () => assert.equal(U.meilleureOption('Monsieur', opt('Mrs', 'Mr', 'Ms')).index, 1));
test('Marié -> Marié(e)', () => assert.equal(U.meilleureOption('Marié', opt('Célibataire', 'Marié(e)', 'Pacsé(e)')).index, 1));
test('inclusion : France -> France métropolitaine', () => assert.equal(U.meilleureOption('France', opt('Belgique', 'France métropolitaine')).index, 1));
test('pays anglais : France -> FR (code)', () => assert.equal(U.meilleureOption('France', [{ valeur: 'BE', texte: 'BE' }, { valeur: 'FR', texte: 'FR' }]).index, 1));
test('oui/non : true -> Oui', () => assert.equal(U.meilleureOption('true', opt('Non', 'Oui')).index, 1));
test('placeholder ignoré', () => assert.equal(U.meilleureOption('Choisir', [{ texte: 'Choisir', ignorer: true }, { texte: 'France' }]), null));
test('aucune correspondance -> null', () => assert.equal(U.meilleureOption('Japon', opt('France', 'Belgique')), null));
test('code court non exact -> null', () => assert.equal(U.meilleureOption('F', opt('Fr', 'Fi')), null));
test('adresse proche avec seuil bas', () => {
  const m = U.meilleureOption('12 rue de la Paix 75002 Paris',
    opt('12 Rue de la Paix 13001 Marseille', '12 Rue de la Paix 75002 Paris'), 0.5);
  assert.equal(m.index, 1);
});
test('versBooleen', () => {
  assert.equal(U.versBooleen('Oui'), true);
  assert.equal(U.versBooleen('false'), false);
  assert.equal(U.versBooleen('coché'), true);
  assert.equal(U.versBooleen('peut-être'), null);
});

/* ---------------- Formats divers ---------------- */
section('Formats');
test('IBAN sans espaces', () => assert.equal(U.formaterIban('fr76 3000 6000 0112 3456 7890 189', false), 'FR7630006000011234567890189'));
test('IBAN avec espaces', () => assert.equal(U.formaterIban('FR7630006000011234567890189', true), 'FR76 3000 6000 0112 3456 7890 189'));
test('nombre français', () => assert.equal(U.versNombre('2 150,40 €'), '2150.40'));
test('nombre avec milliers en point', () => assert.equal(U.versNombre('1.234,5'), '1234.5'));
test('nombre anglais', () => assert.equal(U.versNombre('1,234.50'), '1234.50'));
test('non nombre', () => assert.equal(U.versNombre('abc'), ''));

/* ---------------- Sécurité ---------------- */
section('Sécurité');
test('mot de passe interdit', () => assert.ok(U.estChampInterdit({ type: 'password' })));
test('autocomplete cc-number interdit', () => assert.ok(U.estChampInterdit({ type: 'text', autocomplete: 'cc-number' })));
test('cc-csc interdit', () => assert.ok(U.estChampInterdit({ type: 'text', autocomplete: 'billing cc-csc' })));
test('CAPTCHA interdit', () => assert.ok(U.estChampInterdit({ type: 'text', libelle: 'Recopiez le code (CAPTCHA)' })));
test('cryptogramme interdit', () => assert.ok(U.estChampInterdit({ type: 'text', libelle: 'Cryptogramme visuel' })));
test('code de sécurité interdit', () => assert.ok(U.estChampInterdit({ type: 'tel', libelle: 'Code de sécurité' })));
test('name cardnumber interdit', () => assert.ok(U.estChampInterdit({ type: 'text', name: 'cardnumber' })));
test('carte Vitale autorisée', () => assert.ok(!U.estChampInterdit({ type: 'text', libelle: 'Numéro de carte Vitale' })));
test('date d’expiration de la pièce autorisée', () => assert.ok(!U.estChampInterdit({ type: 'date', libelle: 'Date d’expiration de la carte d’identité' })));
test('nom autorisé', () => assert.ok(!U.estChampInterdit({ type: 'text', libelle: 'Nom de naissance', autocomplete: 'family-name' })));
test('libellés d’envoi', () => {
  assert.ok(U.estLibelleEnvoi('Envoyer ma demande'));
  assert.ok(U.estLibelleEnvoi('VALIDER'));
  assert.ok(U.estLibelleEnvoi('Payer 12 €'));
  assert.ok(U.estLibelleEnvoi('Étape suivante'));
  assert.ok(!U.estLibelleEnvoi('France'));
  assert.ok(!U.estLibelleEnvoi('Marié(e)'));
});
test('cibles refusées', () => {
  assert.equal(U.verifierCible('chrome://settings').ok, false);
  assert.equal(U.verifierCible('https://chromewebstore.google.com/detail/x').ok, false);
  assert.equal(U.verifierCible('https://chrome.google.com/webstore/category/extensions').ok, false);
  assert.equal(U.verifierCible('chrome-extension://abc/panel.html').ok, false);
  assert.equal(U.verifierCible('https://exemple.fr/avis.pdf').ok, false);
  assert.equal(U.verifierCible('').ok, false);
});
test('cibles acceptées', () => {
  assert.equal(U.verifierCible('https://www.impots.gouv.fr/accueil').ok, true);
  assert.equal(U.verifierCible('file:///C:/test/formulaire-test.html').ok, true);
});
test('messages d’erreur HTTP', () => {
  assert.match(U.messageErreurHttp(401), /Clé API invalide/);
  assert.match(U.messageErreurHttp(429), /Limite de débit/);
  assert.match(U.messageErreurHttp(529), /surchargée/);
  assert.match(U.messageErreurHttp(418), /HTTP 418/);
});

/* ---------------- Dossier ---------------- */
section('Dossier');
test('fusion : ajout, doublon, conflit', () => {
  let d = U.fusionnerDossier([], [
    { cle: 'nom_naissance', libelle: 'Nom', valeur: 'EXEMPLE', confiance: 0.95 },
    { cle: 'date_naissance', libelle: 'Date de naissance', valeur: '1985-03-14', confiance: 0.9 },
    { cle: 'iban', libelle: 'IBAN', valeur: '', confiance: 0 }
  ], 'CNI');
  assert.equal(d.length, 3);
  d = U.fusionnerDossier(d, [
    { cle: 'nom_naissance', valeur: 'Exemple', confiance: 0.99 },          // même valeur (casse)
    { cle: 'date_naissance', valeur: '14/03/1985', confiance: 0.9 },        // même date, autre format
    { cle: 'iban', valeur: 'FR7630006000011234567890189', confiance: 0.9 }, // comble un vide
    { cle: 'email', valeur: 'a@b.fr', confiance: 1 }
  ], 'Bulletin');
  assert.equal(d.length, 4);
  const nom = d.find((r) => r.cle === 'nom_naissance');
  assert.equal(nom.valeur, 'EXEMPLE');
  assert.equal(nom.confiance, 0.99);
  assert.match(nom.source, /CNI \+ Bulletin/);
  assert.equal(d.find((r) => r.cle === 'date_naissance').conflits.length, 0);
  assert.equal(d.find((r) => r.cle === 'iban').valeur, 'FR7630006000011234567890189');
  d = U.fusionnerDossier(d, [{ cle: 'nom_naissance', valeur: 'EXEMPLAIRE', confiance: 0.8 }], 'Facture');
  const n2 = d.find((r) => r.cle === 'nom_naissance');
  assert.equal(n2.valeur, 'EXEMPLE', 'la première valeur est conservée');
  assert.equal(n2.conflits.length, 1, 'le conflit est signalé');
  assert.equal(n2.conflits[0].valeur, 'EXEMPLAIRE');
});
test('fusion : ne modifie pas l’entrée', () => {
  const d0 = [{ id: 'x', cle: 'a', libelle: 'A', valeur: '1', confiance: 1, source: 's', conflits: [] }];
  U.fusionnerDossier(d0, [{ cle: 'a', valeur: '2' }], 't');
  assert.equal(d0[0].conflits.length, 0);
});
test('fusion : confiance bornée et clé normalisée', () => {
  const d = U.fusionnerDossier([], [{ cle: 'Code Postal', valeur: '75002', confiance: 7 }], 'x');
  assert.equal(d[0].cle, 'code_postal');
  assert.equal(d[0].confiance, 1);
});
test('signatureChamp stable', () => {
  const a = U.signatureChamp({ type: 'texte', libelle: 'Nom de naissance *', name: 'nomNaissance', idAttr: 'nom' });
  const b = U.signatureChamp({ type: 'texte', libelle: 'nom de naissance', name: 'nomNaissance', idAttr: 'nom' });
  assert.equal(a, b);
});
test('empreinte stable et sensible au contenu', () => {
  assert.equal(U.empreinte('nom=exemple'), U.empreinte('nom=exemple'));
  assert.notEqual(U.empreinte('nom=exemple'), U.empreinte('nom=exempla'));
});
test('domaineDe', () => {
  assert.equal(U.domaineDe('https://www.caf.fr/allocataires'), 'caf.fr');
  assert.equal(U.domaineDe('file:///C:/x.html'), 'fichier local');
  assert.equal(U.domaineDe('pas une url'), '');
});

/* ---------------- Chiffrement ---------------- */
section('Chiffrement');
test('aller-retour AES-GCM', async () => {
  const objet = { profils: { moi: { nom: 'Moi', dossier: [{ cle: 'nom', valeur: 'ÉLODIE' }] } } };
  const bloc = await U.chiffrer(objet, 'une phrase secrète');
  assert.ok(!JSON.stringify(bloc).includes('ÉLODIE'));
  assert.deepEqual(await U.dechiffrer(bloc, 'une phrase secrète'), objet);
});
test('mauvaise phrase -> erreur', async () => {
  const bloc = await U.chiffrer({ a: 1 }, 'bonne phrase');
  await assert.rejects(() => U.dechiffrer(bloc, 'mauvaise phrase'), /incorrecte/);
});

(async () => {
  let reussis = 0;
  let echoues = 0;
  for (const t of file) {
    if (t.titre) { console.log(t.titre); continue; }
    try {
      await t.fn();
      reussis++;
      console.log('  ✔ ' + t.nom);
    } catch (e) {
      echoues++;
      console.log('  ✖ ' + t.nom + '\n      ' + String(e && e.message || e).split('\n').join('\n      '));
    }
  }
  console.log(`\n${reussis} réussi(s), ${echoues} échoué(s)`);
  process.exit(echoues ? 1 : 0);
})();
