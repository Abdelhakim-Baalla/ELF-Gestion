# ELF Construction — Application privée Cloudflare (V1 de validation)

> **État : code fonctionnel de première version, NON VALIDÉ pour des finances réelles.** Ne pas saisir de vraies dettes, noms et pièces justificatives avant les tests sur Cloudflare, les autorisations et une restauration effective de sauvegarde D1. Cette version n'a pas encore de module pièces jointes, ni d'annulation de recettes/devis dans l'interface (API disponible) ; ne pas confondre avec une production terminée.

## Ce qui est présent

- Cinq espaces : Accueil, Recettes, Fournisseurs, Chantiers, Larbi ; interface responsive et privée.
- Nom chantier/client saisi une fois ; propriétaire ELF ou Larbi au choix. Devis optionnels.
- Création de chantiers, fournisseurs, main-d'œuvre ; modifications simples ; date et progression « saisie en cours » ou « vérifié ».
- Dépenses liées au chantier et à un fournisseur/intervenant ; montant total et plusieurs règlements partiels ; paiement par Larbi pour ELF.
- Devis / avenants additifs, versements clients ; aucun solde client inventé sans devis.
- Compte Larbi personnel séparé des dettes ELF, et suivi distinct des avances/remboursements Larbi pour ELF.
- Comptes administrateur, gestion (Mustapha) et consultation seule ; sessions privées, mots de passe hashés ; audit de saisie / modification / annulation.
- Base D1 unique et durable (dans les limites/conditions du service Cloudflare), saisie manuelle sans Excel.

## Étapes de publication (ne pas cliquer Deploy avant l'étape 4)

1. **GitHub** : importer **le contenu de ce dossier** à la racine du dépôt privé `ELFconstruction/-ELF-Gestion` : `src/`, `public/`, `migrations/`, `tests/`, `package.json`, `wrangler.jsonc`, `README.md` et `.gitignore`. Ne pas importer un dossier englobant supplémentaire. Aucun mot de passe dans GitHub.
2. **Cloudflare → Storage & databases → D1 → Create database** : créer une base nommée `elf-gestion-db`. Copier son **Database ID** (UUID), pas les identifiants du compte.
3. **GitHub → wrangler.jsonc** : remplacer `REMPLACER_PAR_IDENTIFIANT_D1` par le vrai UUID de la base D1 ; conserver `binding: DB` et `database_name: elf-gestion-db`.
4. **Initialiser la base AVANT d'utiliser l'application** : avec un terminal connecté à Cloudflare, dans le dossier du projet, exécuter `npm install`, `npx wrangler login`, puis `npm run db:remote`. Ceci crée les tables. À faire UNE FOIS par base, jamais en supprimant les tables d'une base contenant de vraies données. Alternative : depuis l'éditeur SQL de D1, appliquer le contenu entier de `migrations/0001_initial.sql` après revue.
5. **Secret première installation** : dans Cloudflare Workers → projet `elf-gestion` → Settings → Variables and Secrets, créer le secret chiffré `SETUP_TOKEN` avec une valeur aléatoire **d'au moins 20 caractères**. Ne JAMAIS stocker cette valeur dans GitHub, captures d'écran ou chat. Il n'est utilisé que pour créer le premier administrateur, et peut être retiré après initialisation.
6. **Workers & Pages → Create application → GitHub** : sélectionner uniquement `ELFconstruction/-ELF-Gestion`, racine du dépôt (pas `tamv2`, pas de sous-dossier). Choisir le Worker `elf-gestion`. Commande build/deploy `npx wrangler deploy` si demandée. Avant de déployer, vérifier que le binding D1 `DB` existe et que le secret a été défini (selon l'interface Cloudflare, le secret peut se configurer après le premier déploiement et avant la première connexion).
7. Ouvrir l'adresse `*.workers.dev`. La page de première installation demande `SETUP_TOKEN`, nom, e-mail et un mot de passe d'au moins 12 caractères. Créer le premier admin, puis se connecter.
8. Ajouter Mustapha sous **Paramètres → Ajouter un utilisateur**, rôle `Gestion / saisie`. Ne pas partager le mot de passe administrateur. Accès père/Youssef `Consultation seule` après validation.
9. Tester les cas décrits ci-dessous **sans données réelles**. Exporter la base et tester sa **restauration sur une base de TEST distincte** avant production. En production, garder une sauvegarde chiffrée hors Cloudflare.

### Pour tester localement

```bash
npm install
npm run db:local
npm run dev
npm test
```

Créer un fichier `.dev.vars` **seulement en local**, jamais dans GitHub :

```
SETUP_TOKEN="secret-de-test-unique-d-au-moins-20-caracteres"
```

### Checks rapides des calculs

- Chantier ELF sans devis, avec 15 000 DH de dépenses : reste client « À déterminer », pas 0.
- Chantier ELF devis 100 000 DH, versements 40 000 DH : reste client 60 000 DH.
- Achat fournisseur 15 000 DH, paiements 5 000 puis 4 000 : coût 15 000, payé 9 000, reste 6 000.
- Fournisseur identique sur deux chantiers : une seule fiche fournisseur, deux lignes de dépenses par chantier.
- Paiement 5 000 DH par Larbi pour une dette ELF : dette fournisseur –5 000 et dette ELF→Larbi +5 000 ; coût inchangé.
- Chantier Larbi : aucune dépense ajoutée à ELF.
- Test lecture seule : aucun ajout / aucune modification autorisée par l'API.
- Test multiutilisateur : deux navigateurs distincts, données synchronisées après rechargement.

## Limitations connues (à corriger/valider avant usage réel)

- **Aucun stockage des pièces jointes à ce stade.** R2 peut être envisagé uniquement si ses conditions et la facturation conviennent, sinon une stratégie alternative doit être définie.
- **Pas de migration automatique d'une structure future** : toute évolution de la base passera par une migration revue et une sauvegarde préalable.
- **Pas d'importation Excel** (choix métier validé : saisie directe).
- Pas de rattachement d'un seul paiement à plusieurs factures en une seule opération : chaque paiement est attribué à une dépense, et plusieurs paiements peuvent être saisis.
- Un changement du propriétaire d'un chantier est verrouillé (intervention technique auditée requise) pour prévenir un transfert de dettes entre ELF et Larbi.
- Pas de devis pour chantiers personnels de Larbi dans V1 (gestion des dépenses et dettes personnelles).
- Les frais généraux sont des dépenses ELF sans chantier, accessibles via la saisie de dépense lorsque l'on est dans Chantiers ou via le bouton de fiche chantier ; vérifier le parcours utilisateur.
- L'API permet l'annulation auditée de devis/encaissements, mais l'interface d'annulation de ces opérations reste à faire ; ne pas saisir de données réelles avant correction.
- Le contrôle des paiements partiels empêche la plupart des erreurs de somme, mais la concurrence exacte et les corrections extrêmes doivent être validées avec tests intégrés avant production financière.
- Certaines situations avancées doivent encore être spécifiées (devis en réduction, paiements regroupés, facture liée à plusieurs chantiers, annulation de remboursements et compte Larbi débiteur).
- **Sécurité** : prévoir MFA ou protection Cloudflare Access et politique de récupération du compte avant production, sauvegardes chiffrées et suppression/réinitialisation sécurisée.
- Offre Workers / D1 gratuite soumise à quotas et conditions modifiables ; **0 DH n'est pas garanti à vie**. Un simple dépôt privé GitHub ne constitue pas une sauvegarde de D1.

## Architecture

- `src/index.js` : API Cloudflare Worker.
- `src/logic.js` : calculs DH (centimes entiers), mot de passe et synthèses.
- `public/` : interface web sans bibliothèque externe, optimisée Mac/Windows/iPhone.
- `migrations/0001_initial.sql` : base D1 relationnelle.
- `tests/logic.test.mjs` : tests unitaires.
- `wrangler.jsonc` : configuration Worker + assets + liaison DB.

Ne pas transmettre de mot de passe ou `SETUP_TOKEN` par chat.
