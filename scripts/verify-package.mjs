import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const cwd = resolve(import.meta.dirname, "../create-ridhuanbackendtemplate");
const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd, encoding: "utf8", shell: process.platform === "win32",
});
if (result.status !== 0) throw new Error(result.stderr || "npm pack --dry-run failed");
const packs = JSON.parse(result.stdout);
const paths = packs[0].files.map((file) => file.path);
const forbidden = paths.filter((path) => /(^|\/)(\.env|node_modules|dist|uploads|\.git)(\/|$)/.test(path) && !path.endsWith(".env.example"));
if (forbidden.length) throw new Error(`Package contains forbidden paths: ${forbidden.join(", ")}`);
for (const required of ["bin/create.mjs", "template/package.json", "template/package-lock.json", "template/.env.example", "template/prisma/schema.prisma", "template/src/app.ts"]) {
  if (!paths.includes(required)) throw new Error(`Package is missing ${required}`);
}
console.log(`Package contents verified: ${paths.length} files`);

const scratch = await mkdtemp(join(tmpdir(), "ridhuan-template-"));
const project = join(scratch, "new-api");
try {
  const cli = resolve(cwd, "bin/create.mjs");
  const created = spawnSync(process.execPath, [cli, project, "--yes", "--no-install"], { encoding: "utf8" });
  if (created.status !== 0) throw new Error(created.stderr || created.stdout);
  const manifest = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  const env = await readFile(join(project, ".env"), "utf8");
  if (manifest.name !== "new-api" || manifest.private !== true || !env.includes("POSTGRES_DB=new_api") || !env.includes("APP_PORT=3000") || env.includes("change_this_to_a_random_string_at_least_32_chars")) {
    throw new Error("Initializer output is invalid");
  }
  await writeFile(join(project, "preserve.txt"), "keep");
  const rejected = spawnSync(process.execPath, [cli, project, "--yes", "--no-install"], { encoding: "utf8" });
  if (rejected.status === 0 || (await readFile(join(project, "preserve.txt"), "utf8")) !== "keep") {
    throw new Error("Initializer overwrote an existing directory");
  }
  console.log("Initializer scaffold and overwrite protection verified");
} finally {
  if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary directory");
  await rm(scratch, { recursive: true, force: true });
}
