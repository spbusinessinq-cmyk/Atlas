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

1. **Analyze endpoint** — `POST /documents/:id/analyze` — runs NER pipeline using `pdf-parse` (PDFs) + `compromise.js` (NLP) to extract people, organizations, locations, government agencies. For web-ingested documents, uses stored `rawText` instead of a file.
2. **Entity Detection Approval** — extracted mentions go to `pending` status; analysts INGEST (creates entity) or REJECT each detection via the Documents tab UI
3. **Link Intelligence** — clicking any edge in the relationship graph opens a side panel showing evidence chain, allows linking documents to relationships with optional excerpts
4. **Entity Profile** — clicking nodes in graph shows entity profile panel with connections list

### Web Ingestion Engine (PASS 3)

ATLAS can search the public web and ingest results directly into the Document Vault.

**Search provider**: Google News RSS (`news.google.com/rss/search`) — free, no API key, returns real articles.

**Flow**: WEB INGEST (nav) → enter query → results list → INGEST → document created in vault → entity analysis auto-runs on article text.

**Routes**:
- `POST /web-search` — query `{ query }`, returns `{ results[], provider, count }`. Each result: `{ title, url, sourceDomain, snippet, publishDate, contentType }`
- `POST /web-ingest` — query `{ title, url, sourceDomain, snippet, publishDate, caseId }`. Tries to fetch full article HTML (extracts text with `node-html-parser`). If URL is a PDF, downloads and saves as a file. Auto-runs entity analysis on retrieved text. Returns `{ document, mentionsCreated, analysisRan }`.

**Document fields added (web sources)**:
- `sourceUrl` — original URL (Google News redirect or direct)
- `sourceDomain` — publisher domain name
- `ingestMethod` — `"upload"` (default) or `"web"`
- `rawText` — extracted article text (web) or null (file upload)
- `previewType` — `"file"` (default, for uploads) or `"web-article"` (for web ingestion)

**Document Vault behavior for web sources**:
- Document row shows a Globe icon instead of "DOC" text
- DocumentViewer detects `previewType === "web-article"` and shows article viewer with source metadata bar, article body (rawText), and OPEN ORIGINAL button
- DocumentInspector header shows "WEB SOURCE" with globe icon, WEB INGEST badge, DOMAIN, METHOD: WEB, and OPEN ORIGINAL URL button

### Entity Intelligence Layer (PASS 4)

**Auto-Dossier** — The EntityIntelPanel (Entity Dossier) in the Link Analysis graph now shows full dossier-level intelligence:
- MENTIONS + DOCUMENTS metric grid (approved mentions only)
- FIRST SEEN / LAST SEEN dates computed from mention createdAt
- SOURCE DOCUMENTS — actual document titles with Globe icon for web sources, mention frequency count
- CONFIRMED CONNECTIONS — existing relationship links
- CO-MENTIONED ENTITIES — entities that appear in the same document; scored LOW/MEDIUM/HIGH based on shared document count; displayed with colored score prefix
- MENTION LOG — ALL mentions for this entity (approved + pending + rejected), each showing: document title, source domain, context snippet, status badge, confidence %, date

**Entity Registry Enrichment** — Each entity row now shows:
- MENTIONS count (cyan, from approved entity mentions)
- DOCS count (unique documents containing the entity)
- FIRST SEEN date (earliest mention createdAt)

**Suggested Edge Scoring** — Co-mention suggestions now carry a score:
- 1 shared document → LOW → "POSSIBLE ASSOC" (faint dashed cyan edge)
- 2 shared documents → MEDIUM → "CO-MENTION" (medium dashed cyan edge)
- 3+ shared documents → HIGH → "HIGH CO-OCCUR" (brighter dashed cyan edge)

**Graph Stats Overlay** — Top-left bar shows: `N NODES · M EDGES · K SUGGESTED (X HIGH)`

**Next Action Guidance** — New state: if entities exist AND suggested links detected AND no confirmed relationships → "X co-mention associations detected. Review suggested links." CTA: "REVIEW CO-MENTIONS"

**System Log** (`/logs` page + `GET /api/system-log`):
- Real event feed from `system_log` PostgreSQL table
- Events logged from: document upload (`document_ingested`), web ingest (`web_source_ingested`), NER analysis (`analysis_completed`), entity approve (`entity_approved`), entity reject (`entity_rejected`)
- Each entry: timestamp, colored event type badge with icon, message, CASE # / DOC # / ENTITY # refs
- Auto-refreshes every 15s, manual REFRESH button, total count display

**PDF Parser Fix** — `entity-extractor.ts` updated to use pdf-parse v2 API: `new PDFParse({ data: buffer }).getText()` instead of the v1 function-call style

**New files**:
- `lib/db/src/schema/system_log.ts` — system_log table
- `artifacts/api-server/src/lib/log-event.ts` — shared logEvent() helper
- `artifacts/api-server/src/routes/system_log.ts` — GET /system-log route

### PASS 4.5 — Extraction Validation + Navigation Fixes

**Document Vault Navigation Fix**:
- Global `/documents` page: each document row now has an `onClick` handler that stores the docId in `sessionStorage.setItem("atlas_pending_doc", docId)` then navigates to `/cases/:caseId`
- `CaseDetail` component: `useEffect` fires when `summary` loads, reads `atlas_pending_doc` from sessionStorage, clears it, then auto-switches to `"documents"` section and opens the document viewer
- Case Detail Overview panel: document rows are now clickable — `onViewDocument` callback switches to documents section + opens viewer

**EXTRACTION_INCOMPLETE Flag**:
- `web_ingest.ts`: when extracted body < 300 chars, rawText is prefixed with `[EXTRACTION_INCOMPLETE]\n`
- `WebArticleViewer`: detects prefix, shows amber AlertTriangle warning banner "EXTRACTION INCOMPLETE — Full article body could not be retrieved"
- Still shows whatever partial content was saved; strips prefix before display

**Detection Visibility (DocumentInspector)**:
- Added `useListEntityMentions({ documentId, status: "rejected" })` query
- Detection summary grid at top: TOTAL | PENDING | APPROVED | REJECTED (4-cell with colored counts)
- Empty state message changed from "NO DETECTIONS AVAILABLE" to "NO USEFUL DETECTIONS FOUND"
- New REJECTED section with strikethrough entity names and red XCircle icons

**Entity Extraction Quality Improvements** (`entity-extractor.ts`):
- Multi-word title-case phrase detection (2–5 capitalized words): detects "Highland Gardens Hotel", "City Administrative Officer", etc.
- Org suffix detection (each word must start with capital letter to avoid false positives): Hotel, Authority, Department, Office, Program, Shelter, Housing, Foundation, Commission, Bureau, etc.
- Prefix-based org detection: "Project Homekey", "Operation X", "Program Y"
- Gov patterns: "Department of X", "Office of X", "Bureau of X", "City of X"
- All multi-word patterns require `[A-Z][a-zA-Z]+` per word (no lowercase fragments)
- Cap increased from 50 to 60 entities per document

**Web Search Relevance Scoring** (`web_ingest.ts`):
- Results sorted by relevance score after parsing RSS
- Exact query phrase in title: +6 pts
- Query words in title: +2/word, in snippet: +1/word
- Investigative keywords (contract, funding, homeless, hotel, program, fraud, etc.): +1.5/title, +0.5/snippet
- Lifestyle/entertainment domains (tmz, buzzfeed, entertainment, celebrity, etc.): −8 pts
- PDF sources: +1 (tend to be primary source documents)

**Article Body Extraction Improvements** (`web_ingest.ts`):
- Added 9 more CSS selectors (`.article__body`, `.story-text`, `[itemprop=articleBody]`, `[data-component=article-body]`, etc.)
- Paragraph aggregation fallback: if no selector matches, collect all `<p>` tags > 40 chars and join
- Added more noise element removal (`.social-share`, `.newsletter`, `.widget`, `.popup`, `.sidebar`)
- `extractArticleText` now returns `{ text, status: "ok" | "incomplete" }` for EXTRACTION_INCOMPLETE flag

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
- `POST /web-search` — search Google News RSS, returns `{ results[], provider, count }`
- `POST /web-ingest` — fetch and ingest a web source into the Document Vault (auto-analyzes)

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
