# Démarrer sur ce dépôt

De « je clone » à « les tests passent chez moi ». Compte trente minutes la
première fois.

Ce dépôt contient **l'API**. Pour ce qu'est SkillBridge et comment les
quatre dépôts s'articulent, lis `PROJET.md`.

## 1. Ce dont tu as besoin

- **Node 22** — la version exacte est dans `.nvmrc`. Avec nvm : `nvm use`.
- **pnpm 11.9.0** — `corepack enable` suffit, la version est épinglée dans
  `package.json` et tout autre gestionnaire produira un arbre différent.
- **PostgreSQL 16** — soit installé localement, soit par Docker (voir plus bas).

Vérifie ce que tu as :

```bash
node --version      # doit afficher v22.x
pnpm --version      # doit afficher 11.9.0
```

Si `pnpm` est absent : `corepack enable`, puis rouvre ton terminal.

## 2. Récupérer le code

```bash
git clone https://github.com/SkillBridge-Education/skillbridge-backend.git
cd skillbridge-backend
git checkout develop      # on ne travaille jamais depuis main
pnpm install
```

## 3. Les secrets

Les fichiers `.env` sont **chiffrés par git-crypt**. Sans la clé tu verras du
binaire à leur place : c'est normal, ce n'est pas une corruption.

Demande la clé à Jimel — jamais par un ticket, un commit ou une conversation
publique. Puis :

```bash
git-crypt unlock /chemin/vers/la/cle
```

Tu peux travailler sans la clé en partant de `.env.example`, ce que décrit
l'étape suivante.

## 4. Le fichier `.env`

`.env` est **chiffré par git-crypt**. Tant que tu n'as pas la clé, tu verras du
binaire à sa place — ce n'est pas une corruption.

Copie `.env.example` pour démarrer :

```bash
cp .env.example .env
```

Puis remplis, au minimum :

| Variable | Ce que c'est |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:TON_MOT_DE_PASSE@localhost:5432/skillbridge` |
| `JWT_SECRET` | N'importe quelle chaîne d'**au moins 32 caractères**. Le serveur refuse de démarrer en production en dessous. |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:5174` — le site et le back-office. Oublier le 5174 donne une « Network Error » côté admin, sans autre indice. |

`GMAIL_USER` et `GMAIL_APP_PASSWORD` peuvent rester vides : sans eux les e-mails
ne partent pas, et tout le reste fonctionne.

## 5. La base de données

**Avec Docker**, le plus simple :

```bash
# POSTGRES_PASSWORD doit exister dans ton .env, compose refuse de démarrer sans
docker compose up -d db
```

**Sans Docker**, crée la base à la main :

```bash
createdb skillbridge
```

Puis applique le schéma :

```bash
pnpm exec prisma generate     # génère le client TypeScript
pnpm exec prisma migrate deploy
```

⚠️ **`prisma migrate dev` proposera de réinitialiser la base.** Ne l'accepte
jamais sur une base qui contient des données réelles. Pour appliquer des
migrations existantes, c'est toujours `migrate deploy`.

Il n'y a **pas de jeu de données de démarrage**. Crée-toi un compte via
`POST /auth/register`, ou par l'interface du site une fois qu'il tourne.

## 6. Lancer

```bash
pnpm run dev        # http://localhost:5000, rechargement à chaque sauvegarde
```

Vérifie que ça répond :

```bash
curl http://localhost:5000/health     # doit renvoyer 200
```

## 7. Vérifier que tout marche

Ces commandes sont **exactement** celles que la CI exécute. Si elles passent chez
toi, elles passeront sur la pull request.

```bash
pnpm exec prisma generate
pnpm run build      # vérification des types
pnpm run lint
pnpm test           # a besoin de PostgreSQL en marche
```

Les tests écrivent dans **ta base de développement**. Ils nettoient derrière eux
— tous les comptes créés commencent par `vitest-` — mais ne les lance pas contre
une base que tu ne peux pas perdre.

Lance-les **avant chaque push**, pas après. Une CI rouge qu'on découvre à
l'ouverture d'une PR coûte du temps à toute l'équipe, et la faire passer par
essais successifs en coûte encore plus.

## 8. Les pièges de ce dépôt

**`prisma db execute --file` peut échouer en silence.** Il a déjà affiché son
aide et terminé en succès sans rien appliquer, laissant une migration marquée
comme appliquée qui ne l'était pas. Vérifie toujours le résultat en base plutôt
que de croire le code de sortie.

**L'ordre des migrations est celui du nom de dossier**, pas de la date de
création. Nomme toujours au format `AAAAMMJJHHMMSS_description`, sinon une
migration qui dépend d'une autre peut passer avant elle. C'est arrivé.

**Les clés non déclarées dans un schéma zod sont supprimées sans erreur.**
Ajouter un champ côté client sans l'ajouter au schéma le fait disparaître en
silence, et rien ne te le dira.

## 9. Quand quelque chose ne marche pas

**Ne relance pas un job de CI sans avoir lu pourquoi il a échoué.**

```bash
gh run list --limit 5
gh run view <ID> --log-failed
```

Sur une pull request :

```bash
gh pr checks <numéro>
gh pr view <numéro> --comments
```

## Et ensuite

- `CONTRIBUTING.md` — le circuit `develop → staging → main`, les messages de
  commit, comment ouvrir une pull request.
- `AGENTS.md` — les mêmes règles, écrites pour un assistant IA.
- `PROJET.md` — ce qu'est SkillBridge et le rôle de ce dépôt.
