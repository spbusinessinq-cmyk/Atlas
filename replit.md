# Workspace

## Overview

pnpm workspace monorepo using TypeScript. This is the NEXUS investigative intelligence platform — part of the Red State Rhetoric (RSR) media ecosystem.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS
- **Graph**: @xyflow/react (React Flow) for relationship mapping

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── nexus/              # NEXUS frontend (React + Vite)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## NEXUS Platform

NEXUS is a hybrid investigative journalism / OSINT / intelligence analysis platform.

### Core Data Models

- **Case** — top-level investigation container (title, description, status, tags)
- **Entity** — people, orgs, companies, agencies, locations, etc.
- **Document** — uploaded files with metadata (source, publish date)
- **Relationship** — entity-to-entity connections with type and confidence
- **TimelineEntry** — dated events linked to entities and documents
- **Event (ORION)** — external event signals from ORION intake system
- **Note** — freeform markdown notes per case
- **MoneyFlow** — financial flows between entities

### Key Features

1. Case Dashboard — grid/list view of all cases
2. Case Detail — tabbed view: Overview, Entities, Documents, Graph, Timeline, Events, Notes, Money Flows
3. Entity Database — searchable entity list and entity profile pages
4. Relationship Graph — React Flow interactive graph (entities=nodes, relationships=edges)
5. Timeline View — vertical timeline with linked entities and documents
6. ORION Event Intake — intake external event signals into cases
7. Document Library — file upload with metadata
8. Notes Panel — markdown-supported case notes

### API Routes

All routes live under `/api`:

- `GET/POST /cases` — list/create cases
- `GET/PUT/DELETE /cases/:id` — case CRUD
- `GET /cases/:id/summary` — full case with all linked data
- `GET/POST /entities` — entity CRUD
- `GET/PUT/DELETE /entities/:id` — entity operations (GET returns full profile)
- `GET/POST /documents` — document metadata CRUD
- `POST /documents/upload` — multipart file upload
- `GET/POST /relationships` — relationship CRUD
- `GET/POST /timeline` — timeline entry CRUD
- `GET/POST /events` — ORION event CRUD
- `GET/POST /notes` — notes per case
- `PUT/DELETE /notes/:id` — note operations
- `GET/POST /money-flows` — money flow tracking

### File Uploads

Uploaded files are stored in `./uploads/` directory on the API server and served at `/uploads/`.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/nexus` (`@workspace/nexus`)

React + Vite frontend for NEXUS. Pages in `src/pages/`, layout in `src/components/layout.tsx`.

- Entry: `src/main.tsx`
- App: `src/App.tsx` — router with wouter, React Query provider
- Deps: @xyflow/react, react-markdown, framer-motion, date-fns, @hookform/resolvers

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`. Uses `@workspace/db` for persistence, `@workspace/api-zod` for validation.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM. Schema in `src/schema/`.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec (`openapi.yaml`) + Orval config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
