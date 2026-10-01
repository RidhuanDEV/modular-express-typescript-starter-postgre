import { cp, mkdir, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "create-ridhuanbackendtemplate", "template");
if (!target.startsWith(`${root}${sep}`)) throw new Error("Template target is outside repository");
const files = [
  ".gitattributes", ".dockerignore", ".env.example", ".gitignore", "Dockerfile", "docker-compose.yml",
  "docker-compose.override.yml", "package.json", "package-lock.json", "prisma.config.ts",
  "tsconfig.json", "eslint.config.js", "README.md", "DEVELOPER-GUIDE.md", "src", "prisma", "tests", "LICENSE", "scripts/minio.Dockerfile", "scripts/init-bucket.sh", ".env.mysql.example", "docker-compose.mysql.yml", "scripts/mysql-entrypoint.sh", "scripts/mysql-init-user.sh",
];
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of files) await cp(join(root, file), join(target, file === ".gitignore" ? "gitignore.template" : file), { recursive: true });
