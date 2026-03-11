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
- **NLP/NER**: compromise (JS) + pdf-parse for document entity extraction

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
- **Relationship** — entity-to-entity connections with type, confidence, and dateRange
- **TimelineEntry** — dated events linked to entities and documents
- **Event (ORION)** — external event signals from ORION intake system
- **Note** — freeform markdown notes per case
- **MoneyFlow** — financial flows between entities (with currency, confidenceLevel)
- **EntityMention** — ATLAS-extracted entity detections from documents (pending/approved/rejected)
- **RelationshipEvidence** — evidence documents linked to specific relationships

### ATLAS System

The ATLAS subsystem provides automated entity extraction from uploaded documents:

1. **Analyze endpoint** — `POST /documents/:id/analyze` — runs NER pipeline using `pdf-parse` (PDFs) + `compromise.js` (NLP) to extract people, organizations, locations, government agencies
2. **Entity Detection Approval** — extracted mentions go to `pending` status; analysts INGEST (creates entity) or REJECT each detection via the Documents tab UI
3. **Link Intelligence** — clicking any edge in the relationship graph opens a side panel showing evidence chain, allows linking documents to relationships with optional excerpts
4. **Entity Profile** — clicking nodes in graph shows entity profile panel with connections list

### Key Frontend Features

1. Case Dashboard — grid/list view of all cases
2. Case Detail — tabbed view: Overview, Entity Registry, Document Vault, Link Analysis, Temporal Trace, Analyst (Notes)
3. Entity Database — searchable entity list and entity profile pages
4. Link Analysis Graph — React Flow interactive graph with edge/node selection:
   - **LINK INTELLIGENCE panel** — shows evidence docs for selected relationship, add/remove evidence links
   - **Entity Profile panel** — shows entity details and connections when node is clicked
5. Timeline View — vertical timeline with linked entities and documents
6. ORION Event Intake — intake external event signals into cases
7. Document Vault — file upload with ANALYZE button; entity detection review panel
8. Notes Panel — markdown-supported case notes

### API Routes

All routes live under `/api`:

- `GET/POST /cases` — list/create cases
- `GET/PUT/DELETE /cases/:id` — case CRUD
- `GET /cases/:id/summary` — full case with all linked data (includes `pendingMentions` count)
- `GET/POST /entities` — entity CRUD
- `GET/PUT/DELETE /entities/:id` — entity operations (GET returns full profile)
- `GET/POST /documents` — document metadata CRUD
- `POST /documents/upload` — multipart file upload (stored in `./uploads/`)
- `POST /documents/:id/analyze` — ATLAS NER extraction pipeline
- `GET/POST /relationships` — relationship CRUD (includes evidenceCount)
- `GET /relationship-evidence?relationshipId=` — evidence for a relationship
- `POST /relationship-evidence` — add evidence doc to relationship
- `DELETE /relationship-evidence/:id` — remove evidence
- `GET /timeline` — timeline entry CRUD
- `GET /events` — ORION event CRUD
- `GET/POST /notes`, `PUT/DELETE /notes/:id` — case notes
- `GET/POST /money-flows`, `DELETE /money-flows/:id` — financial flows (with currency/confidenceLevel)
- `GET /entity-mentions` — list extracted entity detections (filter by documentId, caseId, status)
- `POST /entity-mentions/:id/approve` — approve detection → creates entity in registry
- `POST /entity-mentions/:id/reject` — reject detection

### File Uploads

Uploaded files are stored in `./uploads/` directory on the API server and served at `/uploads/`.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always build api-client-react after codegen** — run `pnpm --filter @workspace/api-client-react exec tsc --build`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck
- After adding new endpoints to OpenAPI: run codegen → build api-client-react → use in nexus

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client + zod schemas
- `pnpm --filter @workspace/db run push-force` — push schema changes to DB

## Packages

### `artifacts/nexus` (`@workspace/nexus`)

React + Vite frontend for NEXUS. Pages in `src/pages/`, layout in `src/components/layout.tsx`.

- Entry: `src/main.tsx`
- App: `src/App.tsx` — router with wouter, React Query provider
- Deps: @xyflow/react, react-markdown, framer-motion, date-fns, @hookform/resolvers

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`. Uses `@workspace/db` for persistence, `@workspace/api-zod` for validation.
NER pipeline: `src/lib/entity-extractor.ts` (compromise + pdf-parse).

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM. Schema in `src/schema/`.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec (`openapi.yaml`) + Orval config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
