ALTER TABLE "Event" ADD COLUMN "displayCardId" TEXT, ADD COLUMN "displayProblemId" TEXT;
CREATE UNIQUE INDEX "Event_displayCardId_key" ON "Event"("displayCardId");
CREATE UNIQUE INDEX "Event_displayProblemId_key" ON "Event"("displayProblemId");
ALTER TABLE "Event" ADD CONSTRAINT "Event_displayCardId_fkey" FOREIGN KEY ("displayCardId") REFERENCES "PowerCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_displayProblemId_fkey" FOREIGN KEY ("displayProblemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
