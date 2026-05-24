# Modular Express TypeScript Backend Starter

An opinionated, production-ready backend starter kit for teams that want a clean, modular Express codebase with TypeScript strict mode, Prisma ORM 7, Zod validation, JWT authentication, RBAC, caching, and a built-in CRUD generator.

This repository is designed to be a **robust foundation**, providing essential infrastructure and core modules so you can focus on building your domain logic instead of repeating boilerplate.

## 🚀 Key Features

- **Express 5 + TypeScript Strict**: Predictable application code with the latest framework features.
- **Feature-Based Modular Architecture**: Clean separation of concerns under `src/modules/*`.
- **Prisma ORM 7**: Type-safe database queries and automated schema migrations.
- **Zod Validation**: Type-safe request payloads and query contracts.
- **JWT Auth + RBAC**: Secure authentication and fine-grained Role-Based Access Control.
- **Built-in Audit Logging**: Automatic tracking of sensitive operations and resource changes.
- **Advanced Caching**: Redis-backed cache layer for performance and scalability.
- **Background Jobs**: BullMQ integration for reliable asynchronous processing.
- **API Documentation**: Automated Swagger/OpenAPI documentation.
- **Productivity Tools**: CLI CRUD generator to bootstrap new modules in seconds.

## 📁 Project Structure

```text
prisma/
└── schema.prisma         # Prisma database schema definition
src/
├── app.ts                # App entry point (Express configuration)
├── server.ts             # Server entry point (Port listening & shutdown)
├── config/               # Global configurations (Prisma, Redis, Environment)
├── constants/            # Cross-cutting string literals (Audit, Permissions, Modules)
├── core/                 # Shared infrastructure (The "Engine")
│   ├── audit/            # Centralized audit logging logic
│   ├── auth/             # JWT & RBAC middleware/services
│   ├── cache/            # Redis caching service
│   ├── database/         # Shared DB utilities (Query builder, etc.)
│   ├── errors/           # Custom HTTP error handlers
│   ├── http/             # Request context and HTTP utilities
│   ├── logger/           # Structured logging (Pino)
│   ├── middleware/       # Global middlewares (Rate limit, Validation, Errors)
│   ├── queue/            # Background job processing (BullMQ)
│   └── validation/       # Zod-specific utilities and error mapping
├── docs/                 # OpenAPI/Swagger definition files
├── modules/              # Feature modules (Domain logic)
├── routes/               # Global route registration index
├── scripts/              # Internal utility scripts (CRUD Generator)
├── types/                # Project-wide TypeScript type declarations
└── utils/                # Small, pure helper functions (Pagination, Response)
```

## 🏗️ Layered Architecture

Each feature module under `src/modules/` follows a strict layered pattern:

```text
src/modules/<feature>/
├── dto/                  # Data Transfer Objects (Request/Response contracts)
├── mappers/              # Transform Models to DTOs
├── policies/             # Authorization rules for this specific resource
├── queries/              # Specialized query configurations (Filter/Sort/Search)
├── <feature>.repository.ts # Direct database access layer
├── <feature>.service.ts    # Business logic & orchestration
├── <feature>.controller.ts # HTTP request/response handling
├── <feature>.routes.ts     # Route definitions & resource-specific middleware
└── <feature>.schema.ts     # Zod validation schemas
```

### Responsibility Breakdown

| Layer | Responsibility |
| :--- | :--- |
| **Routes** | Endpoint definitions, middleware chain, and Swagger annotations. |
| **Controller** | Acts as an adapter, parsing requests and sending responses. No business logic here. |
| **Service** | Orchestrates business logic, handles transactions, audit logs, and cache management. |
| **Repository** | Isolated database operations using the Prisma client. |
| **Schema** | Uses Zod to enforce strict input validation. |
| **DTO/Mapper** | Ensures the API contract is decoupled from the database schema. |
| **Policy** | Contains reusable authorization logic (e.g., `canUpdateThisResource`). |

## 🛠️ Tech Stack

- **Runtime**: Node.js 24+
- **Framework**: Express 5
- **Language**: TypeScript (Strict Mode)
- **Database**: PostgreSQL 18
- **ORM**: Prisma 7
- **Caching**: Redis 8
- **Queue**: BullMQ
- **Validation**: Zod
- **Logging**: Pino
- **Documentation**: Swagger UI

## 🏁 Getting Started

### Local Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your local PostgreSQL and Redis credentials
   ```

3. **Initialize Database**:
   ```bash
   npx prisma migrate dev
   npm run seed
   ```

4. **Run Development Server**:
   ```bash
   npm run dev
   ```

### Docker Setup
```bash
cp .env.example .env
```

```bash
docker compose up --build
```

This will spin up the application, PostgreSQL 18, and Redis 8 automatically. The app container runs `prisma migrate deploy` and the production seed before starting, creating the base `admin` and `user` roles, core permissions, and the default accounts from `ADMIN_EMAIL` / `ADMIN_PASSWORD` and `USER_EMAIL` / `USER_PASSWORD`.

## ⚡ Productivity: Modules & CRUD Generator

The project ships with several core modules already implemented:
- `auth`: Authentication (login, register, token management)
- `user`: User account management
- `roles` & `permissions`: Granular RBAC system

To bootstrap a new feature module in seconds:
```bash
npm run make:crud <feature-name>
```

The CLI generator automatically creates a complete, type-safe feature structure. Generated `*.routes.ts` files are auto-discovered by `src/routes/index.ts`, so restarting the dev server exposes the new API path after the Prisma model exists and the client has been regenerated.
1. **Schema** (`<feature>.schema.ts`): Zod schemas for validating client payloads.
2. **DTOs** (`dto/*.ts`): Strict request/response types.
3. **Repository** (`<feature>.repository.ts`): Isolated data access interface.
4. **Service** (`<feature>.service.ts`): Orchestrates transactions, cache invalidation, and audit logging.
5. **Controller** (`<feature>.controller.ts`): Handles HTTP routing using generic Express `Request` types without typecasting.
6. **Routes** (`<feature>.routes.ts`): Direct route mapping using arrow functions (no `.bind()`).
7. **Policy** (`policies/<feature>.policy.ts`): Fine-grained resource-level ownership controls.
8. **Query** (`queries/<feature>.query.ts`): Allowlist-driven query builder settings (safely preventing index-misses).
9. **Mapper** (`mappers/<feature>.mapper.ts`): Decouples database entities from HTTP response contracts.

---

## 🧩 Architectural Decision Records & Edge Cases

When expanding the starter, follow these strict guidelines to maintain codebase health:

### 1. Edge Case: Adding New Actions/Operations in the Same Module
* **Problem**: You need to add a specialized action that doesn't fit standard CRUD (e.g., `/users/:id/suspend` or `/users/:id/reset-password`).
* **Solution**: **Do NOT create a separate module.** Keep it encapsulated within the existing module:
  * **Schema**: Add a `suspendUserSchema` or `resetPasswordSchema` inside `user.schema.ts`.
  * **Controller**: Add an arrow-function method `suspend = async (req: Request, res: Response, next: NextFunction): Promise<void> => { ... }`.
  * **Service**: Implement `suspend(id, reason, user, requestId)` wrapping the state change and audit log inside a transaction.
  * **Routes**: Register `router.put('/:id/suspend', authenticate, requirePermission(USER_PERMISSIONS.UPDATE), validate({ body: suspendUserSchema }), controller.suspend)`.

### 2. Edge Case: Cross-Module Orchestration (Multi-Entity Operations)
* **Problem**: Creating a resource in Module A must automatically trigger actions or writes in Module B (e.g., registering a User requires creating a Billing Profile, writing to Audit Logs, and sending a welcome email).
* **Solution**:
  * Keep the **Controller clean**. The controller must only invoke the primary module's service.
  * **Orchestrate inside the Service**: The primary service (e.g., `UserService`) should import the secondary services/repositories and execute them inside its transaction.
  * **Asynchronous Offloading**: For non-blocking operations like sending emails or notifying external APIs, offload them to background jobs (using `src/core/queue/`) after the transaction successfully commits.

### 3. Edge Case: Custom Complex DB Queries
* **Problem**: A query needs complex aggregations or multi-table joins that are difficult or slow to model in standard Prisma queries.
* **Solution**:
  * Add a custom method inside `<feature>.repository.ts`.
  * Write raw SQL queries using `prisma.$queryRaw` rather than forcing Prisma ORM helper functions.
  * Ensure the output is mapped back to a predictable structure inside `<feature>.mapper.ts` to maintain a stable API contract.

## 🚢 Deployment

1. **Build the project**:
   ```bash
   npm run build
   ```
2. **Start production server**:
   ```bash
   npm start
   ```

## 📜 API Documentation & OpenAPI Swagger

The project features fully automated API documentation using **Swagger / OpenAPI 3.0**. 

### 1. How to View
* **Swagger UI Interactive Interface**: Access `http://localhost:3000/docs` in your browser when the server is running.
* **JSON Definition**: Access `http://localhost:3000/docs.json` to export the raw OpenAPI specification.

### 2. How to Add Docs Automatically
The documentation engine (`src/docs/swagger.ts`) automatically scans all routes files under feature modules: `src/modules/**/*.routes.ts`. 

To document a new route, simply write standard **YAML OpenAPI annotations** directly inside a JSDoc block in your route file:

```typescript
/**
 * @openapi
 * /products/{id}:
 *   get:
 *     tags: [Product]
 *     summary: Retrieve a single product by UUID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Successfully fetched product details
 *       404:
 *         description: Product not found
 */
router.get('/:id', authenticate, controller.getById);
```

As soon as you restart the development server (`npm run dev`), the new endpoint, parameters, authentication scopes, and response schemas will instantly appear in the **Swagger UI** under the `/docs` page!

---

## 🏥 Health Check
* The health check endpoint is available at `/health` to verify server, database, and cache connectivity.
