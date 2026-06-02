import fs from "node:fs";
import path from "node:path";
import swaggerJsDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express, Request, Response, RequestHandler } from "express";

let globalSchemas: Record<string, Record<string, unknown>> = {};
const schemasPath = path.join(process.cwd(), "src", "docs", "schemas.json");
if (fs.existsSync(schemasPath)) {
  globalSchemas = JSON.parse(fs.readFileSync(schemasPath, "utf-8")) as Record<string, Record<string, unknown>>;
}

function generateSpecForModule(moduleName?: string): object {
  const isModule = typeof moduleName === "string";
  const title = isModule ? `${moduleName.toUpperCase()} Module API` : "All Modules API";
  const apis = isModule ? [`./src/modules/${moduleName}/**/*.routes.*`] : ["./src/modules/**/*.routes.*"];
  
  // Filter schemas to only include relevant module schemas
  const schemas: Record<string, Record<string, unknown>> = {};
  if (isModule) {
    const norm = moduleName.toLowerCase();
    for (const [k, v] of Object.entries(globalSchemas)) {
      if (k.toLowerCase().includes(norm)) {
        schemas[k] = v;
      }
    }
  } else {
    Object.assign(schemas, globalSchemas);
  }

  const specOptions: swaggerJsDoc.Options = {
    definition: {
      openapi: "3.0.0",
      info: { 
        title, 
        version: "1.0.0",
        description: "Auto-generated REST API documentation",
      },
      servers: [{ url: `/api`, description: "API server" }],
      components: {
        securitySchemes: { 
          bearerAuth: { 
            type: "http", 
            scheme: "bearer",
            bearerFormat: "JWT"
          } 
        },
        schemas,
      },
    },
    apis,
  };

  return swaggerJsDoc(specOptions);
}

export function setupSwagger(app: Express): void {
  const modulesDir = path.join(process.cwd(), "src", "modules");
  const activeModules = fs.existsSync(modulesDir)
    ? fs.readdirSync(modulesDir).filter((f: string): boolean => fs.statSync(path.join(modulesDir, f)).isDirectory())
    : [];

  const globalSpec = generateSpecForModule();

  // Dynamic spec routers
  app.get("/docs/specs/all.json", (_req: Request, res: Response): void => {
    res.json(globalSpec);
  });
  
  app.get("/docs/specs/:moduleName.json", (req: Request, res: Response): void => {
    const { moduleName } = req.params;
    if (typeof moduleName === "string" && activeModules.includes(moduleName)) {
      res.json(generateSpecForModule(moduleName));
    } else {
      res.status(404).json({ error: "Module not found" });
    }
  });

  interface SwaggerUrl {
    url: string;
    name: string;
  }

  // Serve UI with Dropdown Option
  const urls: SwaggerUrl[] = [
    { url: "/docs/specs/all.json", name: "All Modules" },
    ...activeModules.map((m: string): SwaggerUrl => ({
      url: `/docs/specs/${m}.json`,
      name: `${m.charAt(0).toUpperCase() + m.slice(1)} Module`
    }))
  ];

  const swaggerUiOptions = {
    swaggerOptions: {
      urls,
    }
  };

  const serveHandler: RequestHandler[] = swaggerUi.serve;
  const setupHandler: RequestHandler = swaggerUi.setup(undefined, swaggerUiOptions);

  app.use(
    "/docs",
    ...serveHandler,
    setupHandler
  );
}
