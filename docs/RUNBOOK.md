# Runbook — exploitation SkillBridge

Que faire quand quelque chose ne va pas. Écrit pour être lisible sous pression.

## Vérifier que le service est vivant

```bash
curl https://<api>/health     # -> {"status":"ok","message":"API is healthy"}
```

`/health` est la route de supervision. `/` renvoie la même chose, conservée pour
les appelants historiques.

Le conteneur expose un healthcheck Docker sur cette route : `docker ps` affiche
`healthy` / `unhealthy` sans avoir à interroger l'application.

## Lire les logs

Les logs sont structurés en JSON (pino). En production, filtrer par niveau :

```bash
docker compose logs app | grep '"level":50'   # error
docker compose logs app | grep '"level":60'   # fatal
```

Niveaux : 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.

Les identifiants sont masqués à la source (`utils/logger.ts` : en-têtes
`authorization` et `cookie`, champs `password`, `token`). **Ne jamais retirer ces
règles de masquage pour déboguer** — un log est souvent le premier endroit d'où un
secret fuit.

Un `warn` sur une requête est attendu : c'est une erreur 4xx, donc l'API qui fait
son travail. Seuls les `error` et `fatal` signalent un vrai problème.

## Symptômes courants

### L'application ne démarre pas au déploiement

Vérifier dans l'ordre :
1. `JWT_SECRET` est-il défini ? `utils/env.ts` refuse de démarrer en production
   sans un secret réel.
2. `DATABASE_URL` pointe-t-il vers une base joignable ? Le conteneur exécute
   `prisma migrate deploy` avant de servir : si la base est absente, il s'arrête là.
3. Compose démarre-t-il l'app avant PostgreSQL ? La condition
   `depends_on: db: condition: service_healthy` doit être présente.

### Les e-mails ne partent pas

Symptôme dans les logs : `Failed to send verification email` avec
`535 BadCredentials`.

Cause connue : le mot de passe d'application Gmail est invalide ou révoqué. Le
régénérer dans les paramètres du compte Google, puis mettre à jour
`GMAIL_APP_PASSWORD`.

Hors production, si aucun identifiant n'est configuré, le lien est **journalisé**
au lieu d'être envoyé (`Email not configured, verification link logged instead of
sent`) — l'inscription locale reste donc utilisable.

À terme, Gmail ne tiendra pas la charge et finira en spam sans SPF/DKIM/DMARC sur
le domaine : prévoir un service transactionnel.

### Une session reste bloquée en `ACTIVE`

Historiquement causé par une écriture de crédits contournant le plafond : la
contrainte SQL faisait échouer toute la transaction de clôture, donc l'apprenant
n'était jamais remboursé. Corrigé, mais si le symptôme réapparaît, chercher un
`credits: { increment }` ou `{ decrement }` brut ajouté depuis :

```bash
grep -rn "credits: { increment\|credits: { decrement" src/
```

Il ne doit y en avoir **aucun** : tout passe par `grantCredits` / `spendCredits`.

### Un utilisateur banni reçoit encore des événements temps réel

Le middleware Socket.IO relit le statut du compte à la connexion, mais une socket
**déjà ouverte** survit à la suspension. Appeler `disconnectUser(userId, motif)`
(`sockets/index.ts`) au moment de la sanction.

### Trop de 429

Les limites sont dans `middleware/rateLimit.ts` : 120 requêtes/minute en global,
30/minute sur la recherche et l'envoi de contenu, 10/heure sur les signalements.

Si tous les utilisateurs sont limités en même temps, vérifier que
`app.set("trust proxy", 1)` est bien actif : sans cela, tout le trafic est compté
sur l'IP du reverse proxy et partage un seul compteur.

## Base de données

### Sauvegarde

```bash
docker compose exec db pg_dump -U postgres skillbridge > backup-$(date +%F).sql
```

⚠️ **Une restauration jamais testée n'est pas une sauvegarde.** Tester la
restauration sur une base jetable avant d'en avoir besoin.

### Restauration

```bash
docker compose exec -T db psql -U postgres skillbridge < backup-YYYY-MM-DD.sql
```

### Migrations

L'historique et la base peuvent diverger si quelqu'un a utilisé `prisma db push`.
Diagnostiquer avec `npx prisma migrate status`.

⚠️ **Ne jamais lancer `prisma migrate reset` sur une base contenant des données
réelles** : la commande supprime tout. Si Prisma le propose, c'est le signe d'une
divergence à résoudre autrement — marquer une migration déjà appliquée avec
`prisma migrate resolve --applied <nom>`, ou produire le SQL par différentiel :

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Relire ce SQL **avant** de l'appliquer et vérifier l'absence de `DROP`.

## Incident de sécurité

1. **Fuite de secret** — le considérer comme compromis dès la publication : les
   dépôts sont publics. Faire tourner la clé immédiatement (`JWT_SECRET`,
   mot de passe de base, identifiants e-mail). Faire tourner `JWT_SECRET`
   invalide tous les tokens émis, donc déconnecte tout le monde : c'est l'effet
   recherché.
2. **Violation de données personnelles** — notification à la CNIL sous **72 heures**.
   Les utilisateurs sont des mineurs, ce qui alourdit l'obligation d'information.
3. **Compte compromis** — suspendre (`UserStatus.SUSPENDED`), ce qui bloque
   immédiatement l'API puisque le statut est relu à chaque requête, puis appeler
   `disconnectUser` pour couper les sockets ouvertes.

## Contacts et accès

À compléter : hébergeur, accès à la base de production, registrar du domaine,
responsable technique joignable, compte Sentry.
