# SkillBridge — Backend

API REST + temps réel (Socket.IO) pour la plateforme de troc de savoirs peer-to-peer.

## Stack

| Outil | Version | Rôle |
|---|---|---|
| Node.js | 18+ | Runtime |
| TypeScript | 6 | Typage |
| Express | 5 | Framework HTTP |
| Prisma | 7 | ORM |
| PostgreSQL | 15 | Base de données |
| Socket.IO | 4 | Temps réel (chat, notifications, sessions) |
| JWT | — | Authentification |
| bcrypt | — | Hash des mots de passe |
| Vitest + Supertest | — | Tests |
| pnpm | 11 | Gestionnaire de paquets |

## Lancer en local

```bash
# Cloner
git clone https://github.com/abidinetou-lgtm/skillbridge-backend.git
cd skillbridge-backend

# Installer (corepack fournit pnpm avec Node 22+)
corepack enable
pnpm install

# Configurer l'environnement
cp .env.example .env
# Remplir DATABASE_URL et JWT_SECRET

# Créer et migrer la DB
pnpm exec prisma migrate dev --name init

# Lancer
pnpm dev
# → http://localhost:5000
# → Test : http://localhost:5000/
```

## Tests

```bash
pnpm test
```

Les tests (`src/__tests__/`) sont des tests d'intégration Vitest + Supertest qui
tournent contre l'app Express en mémoire, avec la base PostgreSQL configurée par
`DATABASE_URL`. Les utilisateurs créés pendant les tests utilisent un email
préfixé `vitest-` et sont supprimés automatiquement après chaque suite.

## Variables d'environnement

```env
DATABASE_URL=postgresql://postgres:motdepasse@localhost:5432/skillbridge
JWT_SECRET=skillbridge-secret-minimum-32-caracteres
JWT_EXPIRES_IN=7d
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
APP_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5173
GMAIL_USER=votre.adresse@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
REQUIRE_EMAIL_VERIFICATION=false
```

- `CORS_ORIGIN` accepte plusieurs origines séparées par des virgules.
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` : identifiants SMTP Gmail (mot de passe
  d'application, pas le mot de passe du compte) utilisés par `nodemailer` dans
  `emailService.ts` pour les emails de vérification et de réinitialisation.
- `REQUIRE_EMAIL_VERIFICATION` : si `true`, bloque la connexion tant que
  l'email n'est pas vérifié.

En production (Coolify) :
```env
DATABASE_URL=postgresql://...  (URL Coolify PostgreSQL)
NODE_ENV=production
CORS_ORIGIN=https://skillbridge.octilabs.com
```

## Structure du projet

```
backend/
├── prisma/
│   ├── schema.prisma       # Modèles DB
│   └── migrations/         # Historique des migrations
├── src/
│   ├── controllers/        # Logique de chaque route
│   ├── services/           # Logique métier
│   ├── routes/             # Définition des endpoints
│   ├── middleware/
│   │   ├── authMiddleware.ts   # Vérification JWT
│   │   ├── authRateLimit.ts    # Rate limiting sur les routes auth sensibles
│   │   └── errorMiddleware.ts
│   ├── sockets/
│   │   └── index.ts            # Serveur Socket.IO (auth JWT + émission d'événements)
│   ├── utils/
│   │   ├── prisma.ts
│   │   ├── jwt.ts
│   │   ├── password.ts
│   │   ├── env.ts
│   │   └── httpError.ts
│   ├── __tests__/          # Tests Vitest + Supertest
│   ├── app.ts              # Config Express + middlewares
│   └── server.ts           # Point d'entrée (HTTP + Socket.IO)
├── Dockerfile
├── .env.example
└── package.json
```

## Routes API

Toutes les routes sont montées à la racine (pas de préfixe `/api`).

### Health
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/` | Health check | Non |

### Auth
| Méthode | Route | Description | Auth |
|---|---|---|---|
| POST | `/auth/register` | Inscription | Non |
| POST | `/auth/login` | Connexion → JWT | Non |
| GET | `/auth/verify-email?token=...` | Vérifier l'adresse email | Non |
| POST | `/auth/resend-verification` | Renvoyer l'email de vérification | Non |
| POST | `/auth/forgot-password` | Demander un lien de réinitialisation | Non |
| POST | `/auth/reset-password` | Réinitialiser le mot de passe | Non |
| GET | `/auth/me` | Profil connecté | Oui |

### Users
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/users/search` | Recherche de profils | Non |
| GET | `/users/me` | Mon profil complet | Oui |
| PUT/PATCH | `/users/me` | Modifier son profil | Oui |
| GET | `/users/:id` | Profil public | Non |
| GET | `/users/:id/ratings` | Avis reçus | Oui |
| GET | `/users/:id/rating-summary` | Résumé de notation | Oui |
| POST | `/users/skills` | Ajouter une compétence enseignée | Oui |
| DELETE | `/users/skills/:id` | Supprimer une compétence | Oui |
| POST | `/users/learning-goals` | Ajouter un objectif d'apprentissage | Oui |
| DELETE | `/users/learning-goals/:id` | Supprimer un objectif | Oui |

### Matches (Connexions)
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/matches/suggestions` | Profils compatibles | Oui |
| POST | `/matches/request` | Envoyer une demande de connexion | Oui |
| GET | `/matches/mine` | Mes connexions | Oui |
| PATCH | `/matches/:id` | Accepter / Décliner / Annuler | Oui |

### Conversations
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/conversations` | Mes conversations | Oui |
| GET | `/conversations/:id` | Métadonnées d'une conversation | Oui |
| GET | `/conversations/:id/messages` | Messages d'une conversation | Oui |
| POST | `/conversations/:id/messages` | Envoyer un message texte | Oui |
| POST | `/conversations/:id/messages/file` | Envoyer un message fichier | Oui |
| PATCH | `/conversations/:id/archive` | Archiver | Oui |
| PATCH | `/conversations/:id/unarchive` | Désarchiver | Oui |
| DELETE | `/conversations/:id` | Supprimer | Oui |

### Sessions
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/sessions/mine` | Mes sessions | Oui |
| GET | `/sessions/:id` | Détail d'une session | Oui |
| POST | `/sessions` | Créer une session (1 apprenant) | Oui |
| POST | `/sessions/group` | Créer une session de groupe | Oui |
| PATCH | `/sessions/:id` | Modifier une session | Oui |
| POST | `/sessions/:id/accept` | Accepter (apprenant) | Oui |
| POST | `/sessions/:id/refuse` | Refuser (apprenant) | Oui |
| POST | `/sessions/:id/join` | Rejoindre → Jitsi Room | Oui |
| POST | `/sessions/:id/end` | Terminer + règlement des crédits | Oui |
| POST | `/sessions/:id/rating` | Noter la session | Oui |
| GET | `/sessions/:id/participants` | Lister les participants (groupe) | Oui |
| POST | `/sessions/:id/participants` | Ajouter un participant (groupe) | Oui |
| DELETE | `/sessions/:id/participants/:userId` | Retirer un participant (groupe) | Oui |

### Notifications
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/notifications` | Mes notifications | Oui |
| POST | `/notifications` | Créer une notification | Oui |
| PATCH | `/notifications/:id/read` | Marquer comme lue | Oui |

### Crédits
| Méthode | Route | Description | Auth |
|---|---|---|---|
| GET | `/credits` | Solde de crédits courant | Oui |

## Temps réel — Socket.IO

Le serveur Socket.IO est attaché au même serveur HTTP qu'Express
(`src/server.ts`) et authentifie chaque connexion via le JWT existant
(`src/sockets/index.ts`), avant de placer le socket dans une room `user:<id>`.
Aucune logique métier n'est dupliquée : les services Prisma existants
émettent simplement un événement après l'opération.

| Événement | Émis par | Payload |
|---|---|---|
| `notification:new` | `notificationsService.createNotificationService` | La notification créée |
| `message:new` | `conversationService` (message texte/fichier) | `{ conversationId, message }` |
| `session:update` | `sessionService` (création/accept/refuse/join/end/update) | `{ id, teacherId, learnerId, status }` |

Connexion côté client :
```js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: { token: jwtToken },
});
```

## Modèle de données principal

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  firstName    String
  lastName     String
  passwordHash String
  bio          String?
  credits      Int      @default(120)
  role         Role     @default(USER)
  status       UserStatus @default(ACTIVE)
  createdAt    DateTime @default(now())
}
```

## Système de crédits

```
Inscription        → +120 crédits offerts
Donner un cours    → +N crédits (N = durée en minutes)
Recevoir un cours  → -N crédits
Session de groupe  → gratuite (0 crédit)
Solde minimum      → 0 (bloqué si insuffisant)
```

Le transfert se fait dans `POST /sessions/:id/end` :
```
creditsToTransfer = durée en minutes
teacher.credits  += creditsToTransfer
learner.credits  -= creditsToTransfer
```

## Branches Git

```
main    → production (Coolify)
dev     → développement commun
feat/*  → features
fix/*   → corrections
```

```bash
git checkout dev
git pull origin dev
git checkout -b feat/ma-feature
# ... coder ...
git add .
git commit -m "feat: description"
git push origin feat/ma-feature
# Pull Request → dev
```

## Déploiement — Coolify

Le backend est déployé via Docker sur `jimel-api.octilabs.com`.

Le `Dockerfile` à la racine du repo gère :
1. Build TypeScript
2. Génération du client Prisma
3. Migrations automatiques au démarrage
4. Lancement du serveur

Variables à configurer dans Coolify :
```
DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, PORT, NODE_ENV, CORS_ORIGIN, APP_URL,
FRONTEND_URL, GMAIL_USER, GMAIL_APP_PASSWORD, REQUIRE_EMAIL_VERIFICATION
```

**Pre-deploy command dans Coolify :**
```bash
pnpm exec prisma migrate deploy
```

## Équipe

| Membre | Rôle |
|---|---|
| Mahamane Ahmad Maiga | Backend — Auth, Users, Connections |
| Yahia Thierno Maiga | Backend — Sessions, Crédits, Chat |
