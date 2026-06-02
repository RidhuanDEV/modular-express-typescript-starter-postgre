import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const SRC = path.join(process.cwd(), "src");
const SCHEMAS_JSON_PATH = path.join(SRC, "docs", "schemas.json");

// Ensure the docs directory exists
const docsDir = path.dirname(SCHEMAS_JSON_PATH);
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

interface ZodSchemaWithJsonSchema {
  toJSONSchema(): Record<string, unknown>;
}

// 1. Recursive scanner to find all *.schema.ts files
function findSchemaFiles(dir: string, filesList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return filesList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findSchemaFiles(fullPath, filesList);
    } else if (file.endsWith(".schema.ts")) {
      filesList.push(fullPath);
    }
  }
  return filesList;
}

// 2. Strictly-typed guard to check if a value is a Zod schema with toJSONSchema
function isZodSchema(value: unknown): value is ZodSchemaWithJsonSchema {
  if (value && typeof value === "object") {
    return (
      value instanceof z.ZodType ||
      ("toJSONSchema" in value && typeof (value as ZodSchemaWithJsonSchema).toJSONSchema === "function")
    );
  }
  return false;
}

// 3. Importer & native Zod-to-JSON-Schema converter
async function generate(): Promise<void> {
  const schemaFiles = findSchemaFiles(SRC);
  const schemas: Record<string, Record<string, unknown>> = {};

  for (const file of schemaFiles) {
    const fileUrl = pathToFileURL(file).href;
    const schemaModule: Record<string, unknown> = await import(fileUrl);
    
    for (const [key, value] of Object.entries(schemaModule)) {
      if (isZodSchema(value)) {
        const rawSchema = value.toJSONSchema();
        const cleanSchema = { ...rawSchema };
        delete cleanSchema["$schema"]; // Strip json-schema metadata

        // Clean name (e.g. "createUserSchema" -> "CreateUser")
        const cleanKey = key.replace(/schema$/i, "");
        const schemaName = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1);
        schemas[schemaName] = cleanSchema;
      }
    }
  }

  fs.writeFileSync(SCHEMAS_JSON_PATH, JSON.stringify(schemas, null, 2), "utf-8");
  console.log(`✓ Synchronized ${Object.keys(schemas).length} Zod schemas!`);
}

generate().catch(console.error);
