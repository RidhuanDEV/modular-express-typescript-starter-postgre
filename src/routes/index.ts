import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Express, Router } from "express";
import { logger } from "../core/logger/logger.js";

interface RouteModule {
  path: string;
  default: Router;
}

const MODULES_DIR = fileURLToPath(new URL("../modules", import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRouteModule(value: unknown): value is RouteModule {
  if (!isRecord(value)) return false;

  const routePath = value["path"];
  const router = value["default"];

  return typeof routePath === "string" && typeof router === "function";
}

async function findRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findRouteFiles(fullPath)));
      continue;
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith(".routes.js") || entry.name.endsWith(".routes.ts"))
    ) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function loadRoutes(app: Express): Promise<void> {
  const routeFiles = await findRouteFiles(MODULES_DIR);

  for (const file of routeFiles) {
    const importedModule: unknown = await import(pathToFileURL(file).href);

    if (!isRouteModule(importedModule)) {
      logger.warn({ file }, "Skipping route file with invalid route module contract");
      continue;
    }

    app.use(`/api${importedModule.path}`, importedModule.default);
    logger.info(`Loaded route module: /api${importedModule.path}`);
  }
}
