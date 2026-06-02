# 📘 Developer Guide: Architecture, Standards & Patterns

Welcome to the Developer Guide. This starter template implements an opinionated, feature-based modular layout with **Strict TypeScript Type Safety**, **Clean Layer Decoupling**, and **Automated OpenAPI/Swagger Documentation Sync**.

If you are not using the CRUD generator (via `npm run make:crud`), you **MUST** follow the guidelines and patterns in this document to manually create feature modules and ensure the codebase remains clean, predictable, and robust.

---

## 📁 1. Feature Module Folder Structure

Each new feature should reside in its own folder under `src/modules/<feature-name>/`.
For example, a new `product` module must look like this:

```text
src/modules/product/
├── dto/
│   ├── create-product.dto.ts    # Creation input types
│   ├── update-product.dto.ts    # Update input types
│   ├── search-product.dto.ts    # Pagination & filter query inputs
│   └── product-response.dto.ts  # Outgoing serialised JSON type contract
├── mappers/
│   └── product.mapper.ts        # Maps Prisma Models to Response DTOs
├── policies/
│   └── product.policy.ts        # Action-level and ownership auth filters
├── queries/
│   └── product.query.ts         # Sorting, filtering & field allowlists
├── product.schema.ts            # Zod validation schemas
├── product.repository.ts        # Direct Prisma database query encapsulation
├── product.service.ts           # Core business logic & database transactions
├── product.controller.ts        # HTTP adapter (no business logic)
└── product.routes.ts            # Router endpoints & middleware pipeline
```

---

## ⚡ 2. Codebase Layers & Responsibility Flow

The lifecycle of an API request flow follows a strict sequence:

`Request` ➡️ `Router` ➡️ `Controller` ➡️ `Service` ➡️ `Repository` ➡️ `Database`

### A. Zod Schema (`<feature>.schema.ts`)
*   **Responsibility**: Defines input validation schemas using Zod.
*   **Rules**:
    *   Export separate schemas for creation, updates, and searches.
    *   **Zod-to-Swagger Sync**: Exporting any schema ending in `Schema` (e.g. `createProductSchema`) allows the auto-sync script to extract it and convert it into a beautiful Swagger UI schema component.

```typescript
import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  price: z.number().positive("Price must be positive"),
});

export const updateProductSchema = createProductSchema.partial();
```

### B. DTOs (`dto/*.dto.ts`)
*   **Responsibility**: Declares strict compile-time types for inputs and outputs.
*   **Rules**:
    *   Use `z.infer<typeof schema>` to generate input DTOs.
    *   Define outgoing response DTOs as clean TypeScript interfaces.

```typescript
// dto/create-product.dto.ts
import type { z } from "zod";
import type { createProductSchema } from "../product.schema.js";

export type CreateProductDto = z.infer<typeof createProductSchema>;
```

### C. Mapper (`mappers/*.mapper.ts`)
*   **Responsibility**: Decouples the Prisma database structure from the API response payload.
*   **Rules**:
    *   Acts as the **API Contract Boundary**. If database columns change, only update the Mapper.
    *   Convert `Date` objects to ISO-8601 string representations (e.g., `toISOString()`) to match JSON serialization exactly.

```typescript
import type { Product } from "@prisma/client";
import type { ProductResponseDto } from "../dto/product-response.dto.js";

export function toProductResponse(model: Product): ProductResponseDto {
  return {
    id: model.id,
    name: model.name,
    price: model.price,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}
```

### D. Policy (`policies/*.policy.ts`)
*   **Responsibility**: Performs granular resource-level ownership or additional business authorization checks.
*   **Rules**:
    *   Do not put route-level RBAC (roles) here; those belong in route middlewares.
    *   Throw `HttpError.forbidden()` to deny access, return `void` to approve.

```typescript
import type { JwtUserPayload } from "../../../types/index.js";
import type { Product } from "@prisma/client";
import { HttpError } from "../../../core/errors/http-error.js";

export class ProductPolicy {
  canUpdate(user: JwtUserPayload, product: Product): void {
    if (product.ownerId !== user.id && user.roleId !== "admin-role-id") {
      throw HttpError.forbidden("You do not own this product");
    }
  }
}
```

### E. Query Config (`queries/*.query.ts`)
*   **Responsibility**: Sets sorting, searching, and filtering allowlists for the Query Builder to protect against slow query index misses.

```typescript
import type { QueryBuilderConfig } from "../../../core/database/query-builder.js";

export const productQueryConfig: QueryBuilderConfig = {
  searchFields: ["name"],
  sortableFields: ["createdAt", "price"],
  selectableFields: ["id", "name", "price", "createdAt"],
  filters: {},
  defaultIncludes: {},
};
```

### F. Repository (`<feature>.repository.ts`)
*   **Responsibility**: Encapsulates raw database queries. No business logic, auth checks, or caching.
*   **Rules**:
    *   Accept an optional `Prisma.TransactionClient` parameter (`trx`) to participate in transactions.

```typescript
import type { Prisma, Product } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export class ProductRepository {
  async findById(id: string, trx?: Prisma.TransactionClient): Promise<Product | null> {
    const client = trx ?? prisma;
    return client.product.findUnique({ where: { id } });
  }
}
```

### G. Service (`<feature>.service.ts`)
*   **Responsibility**: Orchestrates domain business logic, manages cache invalidations, triggers database audit logs, and handles transactional boundaries.
*   **Rules**:
    *   Always use `prisma.$transaction()` for multiple sequential writes.
    *   Log actions via the centralized `auditService.persist()`.
    *   Manage caches safely via `cacheService`.

```typescript
import { ProductRepository } from "./product.repository.js";
import { prisma } from "../../config/prisma.js";
import { auditService } from "../../core/audit/audit.service.js";
import { AuditAction } from "../../constants/audit.constants.js";

const repository = new ProductRepository();

export class ProductService {
  async create(data: CreateProductDto, user: JwtUserPayload): Promise<ProductResponseDto> {
    const record = await prisma.$transaction(async (tx) => {
      const created = await repository.create(data, tx);
      await auditService.persist({
        action: AuditAction.CREATE,
        module: "product",
        entityId: created.id,
        userId: user.id,
        after: created,
        trx: tx,
      });
      return created;
    });
    return toProductResponse(record);
  }
}
```

### H. Controller (`<feature>.controller.ts`)
*   **Responsibility**: Resolves HTTP transport parameters, parses inputs, and fires standard JSON response helpers. No business logic or SQL.
*   **Rules**:
    *   Use arrow functions to bind methods automatically to preserve `this` context.
    *   Forward unexpected errors to `next(err)`.

```typescript
import type { Request, Response, NextFunction } from "express";
import { ProductService } from "./product.service.js";
import { sendSuccess } from "../../utils/response.js";

const service = new ProductService();

export class ProductController {
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await service.findById(req.params.id);
      sendSuccess(res, { data });
    } catch (err) {
      next(err);
    }
  };
}
```

### I. Routes (`<feature>.routes.ts`)
*   **Responsibility**: Mounts Express URL endpoints, assigns authentication guards (`authenticate`), checks permissions (`requirePermission`), and validates schemas (`validate`).

```typescript
import { Router } from "express";
import { ProductController } from "./product.controller.js";
import { authenticate } from "../../core/auth/auth.middleware.js";
import { validate } from "../../core/middleware/validate.middleware.js";
import { createProductSchema } from "./product.schema.js";

const router = Router();
const controller = new ProductController();

router.post("/", authenticate, validate({ body: createProductSchema }), controller.create);

export default router;
```

---

## 🔒 3. Strict TypeScript Standards

To maintain type safety and avoid compiler bypasses, follow these three non-negotiable rules:

1.  **NO `any` types**: Declare full types or explicit interfaces. Do not bypass checks with `any`.
2.  **NO `unknown` types**: Define target types explicitly.
3.  **NO Typecasting / Type Assertions**: Avoid `as any` or `as unknown as x`. Let TypeScript infer types naturally, or type variables properly at definition time.

If a value's shape is dynamic, use index signatures like `Record<string, Record<string, unknown>>` instead of `any`.

---

## 📝 4. Automated API Documentation (Zod to Swagger)

Our API documentation is fully automated. You do not need to write OpenAPI schema YAML definitions manually.

### How to use Zod Schema Synchronization:
1. Export a Zod schema in `*.schema.ts` ending with `Schema` (e.g., `export const createProductSchema = ...`).
2. Run the sync command in your terminal:
   ```bash
   npm run api-docs
   ```
3. This triggers the script in `src/scripts/generate-swagger-schemas.ts` which uses Zod 4's native `.toJSONSchema()` method to extract and compile all exported schemas into `src/docs/schemas.json`.
4. In your route OpenAPI JSDoc, simply reference the compiled schema as a component:
   ```yaml
   # Inside routes file JSDoc:
   requestBody:
     required: true
     content:
       application/json:
         schema:
           $ref: '#/components/schemas/CreateProduct'
   ```

### Dynamic Modular Specs Dropdown
When you boot the server, the Swagger engine (`src/docs/swagger.ts`) scans `src/modules` automatically. It will set up isolated OpenAPI specifications for each active module.
*   Access **All Modules** or toggle specific features via the select dropdown at the top of the Swagger UI page at `http://localhost:3000/docs`.
