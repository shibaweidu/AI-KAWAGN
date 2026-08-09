CREATE TABLE "HotSearchTerm" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HotSearchTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HotSearchTerm_term_key" ON "HotSearchTerm"("term");
CREATE INDEX "HotSearchTerm_active_position_idx" ON "HotSearchTerm"("active", "position");
