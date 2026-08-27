## SkillBridge

SkillBridge est une plateforme d'échange de compétences entre pairs. On y
enseigne ce qu'on sait et on apprend ce qu'on ignore, sans argent : la monnaie
est le temps.

**1 crédit = 1 minute d'enseignement.** Chaque compte reçoit 120 crédits à
l'inscription, plafonnés à 500. Les crédits sont débités à l'acceptation d'une
session et versés à l'enseignant à la fin, au temps réellement écoulé — le
reliquat est remboursé.

### Deux univers

La plateforme a deux modes qui ne se comportent pas pareil.

**Compte personnel** — l'échange entre particuliers, avec l'économie de crédits
décrite ci-dessus.

**Mon établissement** — un espace fermé pour une école. Les cours y sont un
service de l'établissement, pas un échange marchand : **aucun crédit
n'intervient**. Un élève ne choisit pas ses compétences à l'inscription, c'est
l'école qui déclare son domaine. On y entre avec un identifiant délivré par
l'établissement (`PROF-XXXXXX`, `STU-XXXXXX`), lié à une adresse e-mail précise.

### Ce qui contraint tout le reste

Le public compte des **mineurs de 15 à 18 ans**, et la plateforme est soumise au
**RGPD** et au **DSA**. Ce n'est pas une note de bas de page : c'est ce qui
décide, en cas de doute, de la façon de trancher.

Concrètement, cela veut dire qu'une fonctionnalité de sécurité qui *semble*
fonctionner sans fonctionner est plus grave qu'une fonctionnalité absente. Un
bouton « Bloquer » qui écrit une ligne en base sans rien empêcher est pire que
pas de bouton du tout : il promet une protection qui n'existe pas.

### Les quatre dépôts

| Dépôt | Rôle |
|---|---|
| `skillbridge-backend` | L'API. Toute la logique métier, la base, les sockets. Seule source de vérité. |
| `skillbridge-frontend` | Le site public. Inscription, découverte, sessions, chat. |
| `skillbridge-mobile` | L'application Expo / React Native. C'est là que se fait l'essentiel des tests réels. |
| `skillbridge-admin` | Le back-office. Modération, recours, établissements, audit. |

Le backend est en amont de tout : un changement de contrat d'API s'y décide, et
les trois clients suivent.

### Le rôle de ce dépôt

C'est **l'API**, et la seule source de vérité du projet. Les trois clients ne
font que présenter ce qu'elle décide.

Express 5, TypeScript, Prisma 7, PostgreSQL, Socket.IO. Architecture en trois
couches : `routes` → `controllers` → `services`, et les services seuls parlent à
Prisma.

Ce qui vit ici et nulle part ailleurs :

- l'économie de crédits, plafond compris ;
- l'autorisation à deux axes : `User.role` (USER / ADMIN, toute la plateforme)
  et `Membership.orgRole` (élève, professeur, administrateur d'école, portée à
  un seul établissement) ;
- la modération : signalements, blocages, suspensions, recours ;
- les identifiants d'établissement et les codes d'accès ;
- le journal d'audit, en écriture seule.

Un changement ici casse potentiellement les trois clients. C'est le dépôt où la
relecture compte le plus.

### Où trouver le reste

- `CONTRIBUTING.md` — le circuit de contribution, les branches, la CI.
- `AGENTS.md` — les consignes pour les assistants IA qui écrivent ici.
