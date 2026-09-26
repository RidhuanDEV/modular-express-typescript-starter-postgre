import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

if (process.env.CI !== "true" || !process.env.PG_TEST_ADMIN_URL) {
  throw new Error("Migration integration test requires CI=true and PG_TEST_ADMIN_URL");
}
const adminUrl = new URL(process.env.PG_TEST_ADMIN_URL);
if (adminUrl.pathname !== "/postgres") throw new Error("PG_TEST_ADMIN_URL must connect to postgres maintenance database");
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const databases = [];
const root = resolve(import.meta.dirname, "..");

function prisma(args, databaseUrl) {
  const result = spawnSync("npx", ["prisma", ...args], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}

async function withDatabase(kind, work) {
  const name = `template_ci_${kind}_${randomBytes(6).toString("hex")}`;
  databases.push(name);
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await work(url.toString());
}

try {
  await withDatabase("fresh", async (url) => {
    prisma(["migrate", "deploy"], url);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const result = await client.query("SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL");
      if (result.rows[0].count !== 2) throw new Error("Fresh database did not apply both migrations");
      await client.query('SELECT id FROM "StoredFile" LIMIT 0');
    } finally { await client.end(); }
  });
  await withDatabase("upgrade", async (url) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const initial = await readFile(resolve(root, "prisma/migrations/20260524120000_init/migration.sql"), "utf8");
      await client.query(initial);
      await client.query('INSERT INTO "Role" (id, name, "createdAt", "updatedAt") VALUES ($1, $2, $3, $3)', ["role-fixture", "fixture", "2026-01-01 00:00:00"]);
      await client.query('INSERT INTO "User" (id, email, password, "roleId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $5)', ["user-fixture", "fixture@example.test", "hash", "role-fixture", "2026-01-01 00:00:00"]);
      await client.query('INSERT INTO "CrudAuditLog" (id, action, module, "entityId", "userId", "before", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $7)', ["audit-fixture", "UPDATE", "user", "user-fixture", "user-fixture", '{"password":"secret","safe":"visible"}', "2026-01-01 00:00:00"]);
    } finally { await client.end(); }
    prisma(["migrate", "resolve", "--applied", "20260524120000_init"], url);
    prisma(["migrate", "deploy"], url);
    const verify = new pg.Client({ connectionString: url });
    await verify.connect();
    try {
      const result = await verify.query('SELECT "createdAt", "before", "actorIdSnapshot" FROM "CrudAuditLog" WHERE id = $1', ["audit-fixture"]);
      const row = result.rows[0];
      if (!row || row.createdAt.toISOString() !== "2026-01-01T00:00:00.000Z" || row.before.password !== "[REDACTED]" || row.before.safe !== "visible" || row.actorIdSnapshot !== "user-fixture") {
        throw new Error("Upgrade migration did not preserve timestamps and redact audit data");
      }
      await verify.query('SELECT id FROM "StoredFile" LIMIT 0');
    } finally { await verify.end(); }
  });
  console.log("Fresh and upgrade migrations verified");
} finally {
  for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
