-- Keep every reverted change; allow one current change per source row.
DROP INDEX "MetadataChange_rowId_key";
CREATE INDEX "MetadataChange_rowId_idx" ON "MetadataChange"("rowId");
CREATE UNIQUE INDEX "MetadataChange_active_row_key" ON "MetadataChange"("rowId") WHERE "revertedAt" IS NULL;
