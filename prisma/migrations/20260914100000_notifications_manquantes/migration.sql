-- Rattrape ce qui avait ete pousse dans la base de developpement sans migration.
--
-- Les quatre variantes et l'index existaient en developpement mais dans aucun
-- fichier de migration : un deploiement neuf aurait produit une base sans eux,
-- et toute notification de ces quatre types aurait echoue en production.
--
-- Ecrit de facon idempotente pour pouvoir s'appliquer aussi bien sur la base
-- qui les a deja que sur une base vierge.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_REFUSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONNECTION_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONNECTION_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MESSAGE_RECEIVED';

CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");
