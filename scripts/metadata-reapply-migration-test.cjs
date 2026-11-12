const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createRequire} = require("node:module");
const req = createRequire(path.resolve("apps/api/package.json"));
const {PrismaClient} = req("@prisma/client");
const url = process.env.METADATA_JOBS_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/video_jobs_test") throw Error("Isolated test database required");
const db = new PrismaClient({datasources:{db:{url}}});
(async()=>{
  await db.$transaction(async tx=>{
    // Temporary table shadows the real table only on this transaction connection.
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "MetadataChange" (id text PRIMARY KEY, "rowId" text NOT NULL, "revertedAt" timestamp, payload jsonb) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX "MetadataChange_rowId_key" ON "MetadataChange"("rowId")`);
    await tx.$executeRawUnsafe(`INSERT INTO "MetadataChange" VALUES ('old','row',now(),'{"title":"original"}'),('active','other',null,'{"title":"preserved"}')`);
    const before=await tx.$queryRawUnsafe(`SELECT * FROM "MetadataChange" ORDER BY id`);
    const sql=fs.readFileSync(path.resolve("packages/database/prisma/migrations/20261112170000_metadata_reapply_history/migration.sql"),"utf8");
    for(const statement of sql.replace(/^--.*$/gm, "").split(";").filter(s=>s.trim())) await tx.$executeRawUnsafe(statement);
    assert.deepEqual(await tx.$queryRawUnsafe(`SELECT * FROM "MetadataChange" ORDER BY id`),before);
    await tx.$executeRawUnsafe(`INSERT INTO "MetadataChange" VALUES ('new','row',null,'{}')`);
    const inserted=await tx.$executeRawUnsafe(`INSERT INTO "MetadataChange" VALUES ('duplicate','row',null,'{}') ON CONFLICT DO NOTHING`);
    assert.equal(inserted,0);
    assert.equal((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "MetadataChange"`))[0].n,3);
  });
  console.log("REAPPLY_MIGRATION_OK existing history unchanged, reverted row reused, duplicate active change rejected");
})().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});
