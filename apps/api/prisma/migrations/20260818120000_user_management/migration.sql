ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);

CREATE INDEX "User_disabledAt_role_createdAt_idx"
  ON "User"("disabledAt", "role", "createdAt");
