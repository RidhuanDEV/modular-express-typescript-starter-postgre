import { cp, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "create-ridhuanbackendtemplate", "template");
const files = [
  ".dockerignore", ".env.example", ".gitignore", "Dockerfile", "docker-compose.yml",
  "docker-compose.override.yml", "package.json", "package-lock.json", "prisma.config.ts",
  "tsconfig.json", "README.md", "DEVELOPER-GUIDE.md", "src", "prisma", "tests",
];
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of files) await cp(join(root, file), join(target, file), { recursive: true });
