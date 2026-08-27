# Travailler sur ce dépôt en tant qu'agent IA

Ce fichier s'adresse aux assistants — Claude, Copilot, Cursor, Gemini ou autre —
qui écrivent du code ici. Lis-le en entier avant ta première modification.

Les règles qui suivent ne sont pas des préférences de style. Chacune vient d'un
défaut réel qui a coûté du temps sur ce projet.

## Les deux interdits

**Ne pousse jamais sur `main`.** Jamais directement, jamais en forçant. `main`
est la production et n'accepte que ce qui vient de `staging`.

**Ne merge jamais une pull request toi-même.** Même verte, même triviale, même
si tu l'as écrite entièrement. Un humain relit et décide.

Ces deux règles ne sont pas imposées techniquement — le plan GitHub gratuit ne
permet pas la protection de branche sur un dépôt privé. Rien ne t'arrêtera. Ce
n'est pas une permission.

## Avant de pousser quoi que ce soit

```bash
pnpm install
pnpm exec prisma generate
pnpm run build      # vérification des types
pnpm run lint
pnpm test           # nécessite PostgreSQL en local
```

**Tout doit passer.** Ne pousse pas en annonçant que la CI vérifiera : elle
vérifiera, et elle sera rouge, et quelqu'un devra s'en occuper.

Si un test échoue, lis-le avant de le modifier. Un test qui échoue après ton
changement dit souvent quelque chose de vrai. Sur ce projet, un test affirmait
que les boutons d'export RGPD *devaient* être désactivés : il verrouillait le
défaut en place, et le corriger « cassait » la suite. C'est le test qui avait
tort, mais il a fallu le démontrer, pas le supposer.

## Ce qui ne doit jamais manquer

**Un test qui passe par la vraie route.** Un service peut être écrit, testé et
monté sur aucun routeur. C'est arrivé ici : quatre actions du chat répondaient
404 sur un vrai téléphone pendant que leurs tests unitaires passaient. Un test
unitaire du service ne peut pas voir ça — seule une requête sur la route le
peut.

**Une justification dans le code, pas dans la PR.** Quand tu prends une décision
non évidente, écris pourquoi en commentaire, au-dessus du code concerné. La
description d'une PR disparaît de la vue de celui qui lira ce fichier dans un
an.

**Une vérification que ce que tu affirmes est vrai.** N'annonce pas qu'une
migration est appliquée parce que la commande a rendu la main : ici,
`prisma db execute --file` a déjà affiché son aide et terminé en succès sans
rien appliquer. Vérifie, puis affirme.

## Ce qui rend une modification bloquante

Ce projet a des utilisateurs de **15 à 18 ans** et des obligations **RGPD** et
**DSA**. Traite comme bloquant, sans discuter :

- ce qui expose des données personnelles à qui ne devrait pas les voir ;
- ce qui contourne la vérification d'âge ;
- ce qui rend une fonctionnalité de sécurité décorative.

Ce dernier point mérite qu'on s'y arrête. Une protection qui *paraît* marcher
est pire que son absence, parce qu'on cesse de s'en méfier. Le bouton
« Bloquer » de ce projet a écrit des lignes en base pendant des mois sans rien
empêcher : le compte bloqué envoyait toujours des demandes, lisait toujours le
profil, apparaissait toujours dans la recherche.

## Les pièges de ce dépôt

- Une route qui lit ou écrit des données d'un membre **exige un jeton**. Une
  route publique qui renvoie des profils est un annuaire de mineurs.
- L'établissement (`organizationId`) se lit **depuis le compte appelant**, jamais
  depuis le corps ou l'URL de la requête.
- Les crédits passent par `grantCredits` et `spendCredits`, jamais par un
  `increment` brut : le plafond est une contrainte SQL, et la contourner fait
  échouer toute la transaction.
- Une transition d'état se **revendique dans la transaction qui la paie**, sinon
  deux requêtes concurrentes la règlent deux fois.
- Tout ce qui vient du client passe par un schéma zod. **Les clés non déclarées
  sont supprimées en silence** : un champ ajouté au client sans être ajouté au
  schéma disparaît sans la moindre erreur.
- Un nouveau service doit être **monté sur une route**. Un service testé mais
  non monté répond 404 en production pendant que ses tests passent.

## Lire les journaux de la CI

Quand un check échoue, va lire avant de relancer :

```bash
gh run list --limit 5
gh run view <ID>                  # quel job a échoué
gh run view <ID> --log-failed     # le journal du job en échec
```

Sur une pull request précise :

```bash
gh pr checks <numéro>
gh pr view <numéro> --comments    # y compris la revue automatique
```

Relancer un job sans avoir lu pourquoi il a échoué ne corrige rien et fait
perdre trois minutes à chaque tentative.

## Le ton du code

Écris comme le code environnant. Même densité de commentaires, mêmes noms, mêmes
idiomes. Une contribution qui se remarque par son style est une contribution
qu'il faudra harmoniser plus tard.

Les commentaires expliquent **pourquoi**, jamais quoi. `// incrémente i` ne sert
personne ; `// on relit le statut ici parce que la transaction précédente a pu
le changer` sauve une heure à quelqu'un.
