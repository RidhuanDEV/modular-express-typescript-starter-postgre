#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readdir, readFile, cp, mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(packageRoot, "template");
const args = process.argv.slice(2);
const noInstall = args.includes("--no-install");
const yes = args.includes("--yes");
const targetArg = args.find((arg) => !arg.startsWith("--"));

function fail(message) {
  throw new Error(message);
}

function slug(value) {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) fail("Project name must contain letters or numbers");
  return normalized;
}

function port(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) fail("Port must be an integer from 1 to 65535");
  return parsed;
}

function setEnv(source, replacements) {
  const seen = new Set();
  const lines = source.split(/\r?\n/).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !(match[1] in replacements)) return line;
    seen.add(match[1]);
    return `${match[1]}=${replacements[match[1]]}`;
  });
  for (const key of Object.keys(replacements)) if (!seen.has(key)) fail(`Missing env template key ${key}`);
  return lines.join("\n");
}

async function main() {
  const target = resolve(targetArg ?? "my-api");
  const existing = await readdir(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && existing.length) fail(`Target directory is not empty: ${target}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, defaultValue) => yes || !process.stdin.isTTY ? defaultValue : (await rl.question(`${label} [${defaultValue}]: `)).trim() || defaultValue;
  try {
    const name = slug(await ask("Project name", basename(target)));
    const appPort = port(await ask("Application port", "3000"));
    const dbName = await ask("Database name", name.replace(/[^a-z0-9_]/g, "_"));
    const dbUser = await ask("Database user", name.replace(/[^a-z0-9_]/g, "_"));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName) || dbName.length > 63) fail("PostgreSQL database name requires an ASCII SQL identifier, maximum 63 bytes");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbUser) || dbUser.length > 63) fail("PostgreSQL username requires an ASCII SQL identifier, maximum 63 bytes");
    const dbPassword = process.env.RIDHUAN_DB_PASSWORD || randomBytes(24).toString("hex");
    if (!/^[A-Za-z0-9._~-]+$/.test(dbPassword)) fail("Database password must use letters, numbers, dots, underscores, tildes or hyphens");
    const redisChoice = (await ask("Enable Redis cache and distributed rate limit? (y/n)", "n")).toLowerCase();
    if (!["y", "n"].includes(redisChoice)) fail("Redis choice must be y or n");
    const storage = (await ask("Upload storage (local/s3)", "local")).toLowerCase();
    if (!["local", "s3"].includes(storage)) fail("Storage must be local or s3");
    const redisEnabled = redisChoice === "y";
    const s3 = storage === "s3" ? {
      endpoint: await ask("S3 endpoint for manual startup", "http://localhost:9000"),
      dockerEndpoint: await ask("S3 endpoint inside Docker", "http://minio:9000"),
      region: await ask("S3 region", "us-east-1"),
      bucket: await ask("S3 bucket", "uploads"),
      accessKey: await ask("S3 access key", "minioadmin"),
      secretKey: process.env.RIDHUAN_S3_SECRET_KEY || randomBytes(24).toString("hex"),
    } : null;
    if (s3) {
      for (const endpoint of [s3.endpoint, s3.dockerEndpoint]) new URL(endpoint);
      for (const value of [s3.region, s3.bucket, s3.accessKey, s3.secretKey]) {
        if (!/^[A-Za-z0-9._~-]+$/.test(value)) fail("S3 identifiers and secrets must use letters, numbers, dots, underscores, tildes or hyphens");
      }
    }
    const envTemplate = await readFile(join(templateRoot, ".env.example"), "utf8");
    const replacements = {
      PORT: String(appPort), APP_PORT: String(appPort),
      DATABASE_URL: `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@localhost:5432/${encodeURIComponent(dbName)}?sslmode=disable`,
      DATABASE_URL_DOCKER: `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@postgres:5432/${encodeURIComponent(dbName)}?sslmode=disable`,
      COMPOSE_PROFILES: [redisEnabled ? "redis" : "", s3?.dockerEndpoint === "http://minio:9000" ? "minio" : ""].filter(Boolean).join(","),
      COMPOSE_PROJECT_NAME: `${name.replaceAll(".", "-").replaceAll("_", "-")}-${randomBytes(4).toString("hex")}`,
      S3_ACCESS_KEY_ID: "development", S3_SECRET_ACCESS_KEY: randomBytes(24).toString("hex"),
      POSTGRES_USER: dbUser, POSTGRES_PASSWORD: dbPassword, POSTGRES_DB: dbName,
      JWT_SECRET: randomBytes(48).toString("hex"),
      ADMIN_PASSWORD: randomBytes(24).toString("hex"), USER_PASSWORD: randomBytes(24).toString("hex"),
      REDIS_NAMESPACE: `${name.replaceAll(".", "-").replaceAll("_", "-")}-${randomBytes(4).toString("hex")}`,
      CACHE_ENABLED: String(redisEnabled), RATE_LIMIT_STORE: redisEnabled ? "redis" : "memory",
      UPLOAD_STORAGE: storage,
      ...(s3 ? { S3_ENDPOINT: s3.endpoint, S3_ENDPOINT_DOCKER: s3.dockerEndpoint,
        S3_REGION: s3.region, S3_BUCKET: s3.bucket, S3_ACCESS_KEY_ID: s3.accessKey,
        S3_SECRET_ACCESS_KEY: s3.secretKey } : {}),
    };
    const envFile = setEnv(envTemplate, replacements);
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(templateRoot)) await cp(join(templateRoot, entry), join(target, entry), { recursive: true });
    await writeFile(join(target, ".gitignore"), await readFile(join(target, "gitignore.template")));
    await unlink(join(target, "gitignore.template"));
    const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    packageJson.name = name;
    packageJson.version = "0.1.0";
    packageJson.private = true;
    packageJson.scripts["verify:template"] = "npm run test && npm run api-docs:check && npx prisma validate";
    await writeFile(join(target, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
    const lock = JSON.parse(await readFile(join(target, "package-lock.json"), "utf8"));
    lock.name = name;
    lock.version = "0.1.0";
    lock.packages[""].name = name;
    lock.packages[""].version = "0.1.0";
    await writeFile(join(target, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    await writeFile(join(target, ".env"), envFile, { flag: "wx", mode: 0o600 });
    console.log(`Created ${target}`);
    if (!noInstall) {
      const result = spawnSync("npm", ["install"], { cwd: target, stdio: "inherit", shell: process.platform === "win32" });
      if (result.status !== 0) fail("npm install failed; scaffold is ready, run npm install in the project directory");
    }
    const profiles = [redisEnabled ? "--profile redis" : "", s3 ? "--profile minio" : ""].filter(Boolean).join(" ");
    console.log(`Next: cd ${target}\nManual: npx prisma generate && npx prisma migrate deploy && npm run seed && npm run dev\nDocker: docker compose ${profiles} up --build`);
  } finally {
    rl.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
