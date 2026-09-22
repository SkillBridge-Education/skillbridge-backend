-- The loyalty reward (200 credits at 50 sessions taught) is meant to be felt,
-- and is granted even when it takes a balance past the normal 500 ceiling.
-- The bound still exists -- it is raised to 700, not removed -- so a runaway
-- write is still caught by the database rather than only by application code.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_credits_bounds_check";

ALTER TABLE "User"
ADD CONSTRAINT "User_credits_bounds_check"
CHECK ("credits" >= 0 AND "credits" <= 700);
