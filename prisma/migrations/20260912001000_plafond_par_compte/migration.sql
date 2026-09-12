-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditCap" INTEGER NOT NULL DEFAULT 500;


-- La contrainte lit desormais le plafond du compte, et non une valeur figee.
--
-- C'est ce qui rend le plafond infranchissable quel que soit le chemin
-- d'ecriture : un increment brut qui oublierait la regle echoue en base plutot
-- que de la contourner en silence. Les comptes existants gardent leurs credits,
-- y compris ceux montes a 700 par une prime de fidelite -- leur plafond est
-- remonte d'autant avant que la contrainte ne s'applique.
UPDATE "User" SET "creditCap" = CEIL("credits"::numeric / 100) * 100 WHERE "credits" > "creditCap";

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_credits_bounds_check";

ALTER TABLE "User"
ADD CONSTRAINT "User_credits_bounds_check"
CHECK ("credits" >= 0 AND "credits" <= "creditCap");
