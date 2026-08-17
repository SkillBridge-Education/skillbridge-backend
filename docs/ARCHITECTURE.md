# Architecture SkillBridge

Vue d'ensemble des quatre projets et de la façon dont ils communiquent.

## Les quatre projets

| Projet | Rôle | Stack | Port dev |
|---|---|---|---|
| `skillbridge-backend` | API et source de vérité | Node 22, Express 5, Prisma 7, PostgreSQL | 5000 |
| `skillbridge-frontend` | Application web publique | React 18, Vite, JavaScript, Tailwind | 5173 |
| `skillbridge-admin` | Back-office d'administration | React 18, Vite, TypeScript, Tailwind | 5174 |
| `skillbridge-mobile` | Application mobile | Expo, React Native, TypeScript | — |

Quatre dépôts distincts plutôt qu'un monorepo : les deux premiers avaient déjà un
historique de PR et une CI en place, et un monorepo aurait coûté la réécriture des
pipelines, des Dockerfile et de la configuration git-crypt pour ne partager que
quelques centaines de lignes.

Le back-office est séparé de l'application publique pour que le code
d'administration ne soit pas livré à tous les visiteurs.

## Communication

Tous les clients parlent à la même API en HTTP (JSON) avec un JWT en en-tête
`Authorization: Bearer`. Il n'y a pas de cookie de session : c'est ce qui rend
l'API utilisable telle quelle depuis React Native.

Le temps réel passe par Socket.IO sur le même serveur HTTP. Le client s'authentifie
au moment du handshake avec le même JWT.

```
skillbridge-frontend ─┐
skillbridge-mobile   ─┼─► HTTP + Socket.IO ─► skillbridge-backend ─► PostgreSQL
skillbridge-admin    ─┘
```

## Modèle d'autorisation à deux axes

C'est le point le plus important à comprendre avant de toucher aux permissions.

**Axe plateforme** — `User.role : USER | ADMIN`. Pouvoir sur l'ensemble du service.
Seul un `ADMIN` administre la plateforme.

**Axe organisation** — `Membership { userId, organizationId, orgRole }` avec
`orgRole : STUDENT | TEACHER | ORG_ADMIN`. Pouvoir limité à **une** école.

Un professeur n'a aucun pouvoir sur la plateforme : il en a dans son établissement.
Mélanger les deux axes dans un seul enum rendrait impossible d'isoler les données
entre écoles — un « professeur » deviendrait professeur partout.

Un compte **sans** `Membership` actif est un utilisateur particulier : c'est ce qui
distingue le mode normal du mode scolaire.

Les écoles sont créées en `PENDING` et validées à la main par un administrateur.
C'est ce qui empêche un particulier de s'octroyer le mode scolaire.

## Deux invariants de sécurité à préserver

Ces deux propriétés existent aujourd'hui et sont testées. Les casser rouvrirait des
failles d'élévation de privilège.

1. **Le rôle est relu en base à chaque requête** (`middleware/authMiddleware.ts`),
   jamais lu depuis le JWT. C'est ce qui rend un token forgé inoffensif et une
   révocation de rôle immédiate. Ne jamais « optimiser » en lisant `payload.role`.
2. **Les mises à jour de profil utilisent une liste blanche explicite**
   (`services/userService.ts` + `utils/profileValidation.ts`, qui ignore toute clé
   inconnue). Ne jamais ajouter `role` ou `credits` à `UpdateProfileInput`, ni
   remplacer la construction champ par champ par un spread de `req.body`.

Le rôle professeur ne doit être écrit **que** par le flux SSO côté serveur, à partir
d'une assertion signée — jamais depuis un paramètre client, jamais déduit d'un
suffixe d'adresse e-mail (l'e-mail est choisi par l'utilisateur à l'inscription).

## Économie de crédits

Un crédit vaut une minute d'enseignement. L'apprenant est débité **à l'acceptation**
de la session, pas à sa création : la proposition annonce à l'apprenant ce que
l'acceptation lui coûtera. À la fin, l'enseignant est crédité du temps réellement
écoulé et le reliquat est remboursé.

Le solde est borné entre 0 et `MAX_CREDITS` (500) par une contrainte SQL
(`User_credits_bounds_check`). **Toute écriture de crédits doit passer par
`grantCredits` / `spendCredits`** (`services/creditService.ts`) : un `increment`
Prisma brut contourne le plafond, viole la contrainte et fait échouer toute la
transaction — ce qui laissait auparavant des sessions bloquées en `ACTIVE` avec
l'apprenant jamais remboursé.

Décision actée : un professeur enseigne **hors économie de crédits** — l'élève n'est
pas débité et le professeur n'est pas crédité.

## Modération

Un signalement est compté **par signaleur distinct** avant toute restriction
automatique : sans cela, trois comptes coordonnés pourraient réduire n'importe qui
au silence. Les signalements sont limités à 10 par heure et par compte.

Un compte suspendu reçoit un `403` avec le motif de la sanction et le chemin de
recours, et non un « token invalide » — le DSA impose de motiver une sanction et
d'ouvrir une voie de recours interne. Il ne peut atteindre que la route de recours.

Toute action d'administration exige un **motif** et est inscrite dans
`AdminAuditLog`, en ajout seul. C'est l'exigence d'« accountability » du RGPD et la
seule protection contre un usage abusif interne — le back-office permet de
distribuer des crédits.

## Documents liés

- [`AUTH.md`](./AUTH.md) — flux d'authentification en détail
- [`RUNBOOK.md`](./RUNBOOK.md) — exploitation et incidents
- `../PLAN_MOBILE_ET_SSO.md` — feuille de route mobile et SSO
- `../NIVEAU_PRO_CHECKLIST.md` — ce qui reste avant une mise en production
