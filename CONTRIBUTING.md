# Contribuer

Merci de lire ceci avant ta première contribution. C'est court, et cela évite
l'essentiel des frictions.

## Le circuit des branches

```
develop  →  staging  →  main
```

**`develop`** — c'est là qu'on travaille. Toute branche part de `develop` et y
retourne.

**`staging`** — ce qui est prêt à partir. Sert à valider un ensemble cohérent
avant la production.

**`main`** — la production. Rien n'y arrive autrement que par `staging`.

### Deux règles, sans exception

**On ne pousse jamais sur `main`.** Ni directement, ni en forçant, ni « juste
pour un correctif rapide ».

**On ne merge jamais tout seul.** Une pull request attend qu'une autre personne
l'ait relue, même si tous les indicateurs sont verts.

Ces deux règles ne sont pas techniquement imposées : les dépôts sont privés sur
un plan GitHub gratuit, qui n'autorise pas la protection de branche. Elles
reposent donc entièrement sur la discipline de chacun. Dis-le-toi une fois, et
tiens-t'y.

## Ouvrir une pull request

1. Pars de `develop` à jour :
   ```bash
   git checkout develop && git pull
   git checkout -b feat/ce-que-tu-fais
   ```
2. Travaille, en commits lisibles. Un commit = une idée.
3. **Fais tourner toute la vérification en local** (voir plus bas). Ne pousse
   pas en comptant sur la CI pour découvrir que ça casse.
4. Pousse et ouvre la PR **vers `develop`**.
5. Attends la CI et la relecture.

### Le message de commit

En anglais, à l'impératif, avec un préfixe : `feat:`, `fix:`, `refactor:`,
`test:`, `docs:`, `ci:`, `chore:`.

Le corps du message dit **pourquoi**, pas quoi — le diff dit déjà quoi. Si tu
corriges un défaut, explique ce qui se passait avant. C'est ce qui empêche
quelqu'un de le réintroduire dans six mois.

## Avant de pousser

```bash
pnpm install
pnpm exec prisma generate
pnpm run build      # vérification des types
pnpm run lint
pnpm test           # nécessite PostgreSQL en local
```

Tout doit passer. Un test rouge qu'on pousse « pour voir » coûte plus de temps à
tout le monde qu'il n'en fait gagner.

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

## Ce qui tourne sur ta PR

**CI** — types, lint, tests. Doit être vert.

**Sécurité** — audit des dépendances, recherche de secrets dans l'historique,
analyse CodeQL. Doit être vert.

**Revue automatique** — une relecture par IA qui poste des commentaires. Elle
signale, elle ne bloque pas : c'est un avis, pas un verdict.

Si un check échoue, va lire le journal avant de relancer :

```bash
gh run list --limit 5
gh run view <ID> --log-failed
```

Relancer sans lire ne corrige rien.

## Les secrets

Les fichiers `.env` sont chiffrés avec **git-crypt**. Sans la clé, tu verras du
binaire à leur place — c'est normal, ce n'est pas une corruption. Demande la clé
à Jimel, et ne la fais jamais transiter par le dépôt, un ticket ou une
conversation publique.

Ne commite **jamais** une clé, un jeton ou un mot de passe, même temporairement,
même dans une branche que tu comptes supprimer. L'historique garde tout.
