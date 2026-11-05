-- From the team's lender sheet: the position each lender prefers (a ranking hint, not a hard
-- rule) and the industries it does not fund (matched against the merchant's industry).

-- AlterTable
ALTER TABLE "FunderProgram" ADD COLUMN "preferredPositions" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "FunderProgram" ADD COLUMN "excludedIndustries" JSONB NOT NULL DEFAULT '[]';
