# Overview

NEXUS is a pnpm workspace monorepo using TypeScript, serving as a hybrid investigative journalism, OSINT, and intelligence analysis platform. It is a core component of the Red State Rhetoric (RSR) media ecosystem. The platform enables advanced data modeling for investigations, automated entity extraction from documents, and web content ingestion, aiming to provide comprehensive tools for intelligence analysis and reporting.

# User Preferences

I want iterative development. I prefer that the agent asks before making major changes.

# System Architecture

The project is structured as a pnpm monorepo using Node.js 24 and TypeScript 5.9.

**Core Technologies:**
- **API Framework:** Express 5
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod (`zod/v4`)
- **API Codegen:** Orval (from OpenAPI spec)
- **Build System:** esbuild
- **Frontend:** React, Vite, Tailwind CSS
- **Graph Visualization:** @xyflow/react (React Flow) for relationship mapping
- **NLP/NER:** compromise (JS) and pdf-parse for document entity extraction

**Monorepo Structure:**
- `artifacts/`: Deployable applications (`api-server`, `nexus` frontend)
- `lib/`: Shared libraries (`api-spec`, `api-client-react`, `api-zod`, `db`)
- `scripts/`: Utility scripts

**Key Features & Specifications:**

1.  **NEXUS Platform:**
    *   **Core Data Models:** Case, Entity, Document, Relationship, TimelineEntry, Event (ORION), Note, MoneyFlow, EntityMention, RelationshipEvidence.
    *   **UI/UX:** Features a Case Dashboard, Case Detail views (Overview, Entity Registry, Document Vault, Link Analysis, Temporal Trace), searchable Entity Database, interactive Link Analysis Graph, Timeline View, ORION Event Intake, and Notes Panel.

2.  **ATLAS Subsystem (Automated Entity Extraction):**
    *   `POST /documents/:id/analyze` endpoint processes PDFs (`pdf-parse`) and web articles (`compromise.js`) to extract people, organizations, and locations.
    *   Extracted mentions are initially `pending` and can be `INGESTED` (creating an entity) or `REJECTED` by analysts via the UI.
    *   Supports linking evidence documents to relationships and provides detailed entity profiles within the graph view.
    *   `EXTRACTION_INCOMPLETE` flag for web articles where full text extraction fails, displaying a warning.
    *   Improved entity extraction quality with multi-word title-case phrase detection and specific organizational patterns.
    *   Detection visibility in DocumentInspector now includes `TOTAL`, `PENDING`, `APPROVED`, and `REJECTED` counts.

3.  **Web Ingestion Engine:**
    *   Utilizes Google News RSS for web searches, ingesting articles directly into the Document Vault.
    *   `POST /web-search` for querying and `POST /web-ingest` for fetching and storing web content.
    *   Automatically runs entity analysis on ingested web articles.
    *   Document Vault distinguishes web sources with specific icons and a specialized article viewer (`previewType: "web-article"`).
    *   Web search results are scored for relevance based on keywords, article content, domain types, location-awareness (LA-specific boosts), and junk-title detection.
    *   **Critical fix (Pass 12):** Google News RSS items carry the real article URL in `<source url="...">` attribute. Parser now uses this instead of the Google News redirect token, making ~7/8 docs extractable per seed run.
    *   **JSON-LD extraction (Pass 12):** `extractArticleText()` now runs JSON-LD structured-data extraction as Pass 0, before CSS selectors. Recovers full `articleBody` from major news sites even when JS-rendered (LA Times, CBS News, NBC, AP, ProPublica, etc.).
    *   **Seed diagnostics (Pass 12):** `runSeedPipeline()` tracks per-doc extraction quality (ok/partial/failed/wrapper). Embeds machine-readable `[ATLAS-SEED:searched=N|total=N|ingested=N|ok=N|partial=N|failed=N|wrapper=N|detected=N|promoted=N|fallback=0/1]` block in case description. Human-readable summary explains what succeeded and failed.
    *   **SeedDiagnosticsCard (Pass 12):** Overview panel parses and displays the seed report as a 6-stat grid card for auto-seeded cases. `cleanDescription()` strips the raw `[ATLAS-SEED:...]` block from human-readable displays.
    *   T1 auto-approve: confidence ≥ 0.82, 2+ docs. T2 fallback: confidence ≥ 0.70, prefers ok-doc hits and org/agency/facility types, cap 3.
    *   **ATLAS-DIAG extended fields (Pass 13):** `encodeDiagPrefix()` now accepts `rssUrl`, `srcUrl`, `entities`, and `analysisRan` extra fields. Backend stores these in each doc's `rawText` ATLAS-DIAG block. After entity extraction the pipeline patches the block in-place with `entities=N|analysis_ran=1`. Frontend `parseAtlasDiag()` and local `parseDocDiag()` parse all new fields.
    *   **RSS URL preservation (Pass 13):** `parseRssItems()` stores original Google News redirect as `result.rssLink`. `encodeDiagPrefix()` stores it as `rss_url=...` and `src_url=...` for each doc. Frontend proves URL resolution (redirect vs. real URL) in the per-doc log.
    *   **SeedDiagnosticsCard v2 (Pass 13):** Now shows a collapsible per-doc pipeline log table (title, body status, char count, extraction strategy, entity count, URL source mode). URL resolution proof section shows a sample RSS → real-URL mapping.
    *   **Document Vault timestamp (Pass 13):** Document list and inspector now show full date + time (not date-only) for the ingest timestamp. Source domain shown from `sourceDomain` field when available.
    *   **React Flow blue-box fix (Pass 13):** `.react-flow__node.selected` CSS now overrides the library's built-in blue box-shadow with `outline: none; box-shadow: none` so custom node selection styling takes full precedence.

4.  **Entity Intelligence Layer:**
    *   **Auto-Dossier:** EntityIntelPanel displays comprehensive entity intelligence including mentions, documents, first/last seen dates, source documents, confirmed connections, and co-mentioned entities with scoring.
    *   **Entity Registry Enrichment:** Shows mention counts, unique document counts, and first seen dates for each entity.
    *   **Suggested Edge Scoring:** Co-mention suggestions are scored (LOW, MEDIUM, HIGH) based on shared documents, visualized with dashed cyan edges.
    *   **Graph Stats Overlay:** Displays node, edge, and suggested link counts.
    *   **Next Action Guidance:** Provides UI prompts for reviewing co-mention associations.
    *   **System Log:** Real-time event feed (`/logs` page) for document ingestion, web ingestion, analysis, and entity approval/rejection events.

5.  **Financial Intelligence + Entity Engine + Console Depth (Pass 16):**
    *   **Financial Extraction Engine Rewrite (Part 1):** New robust `MONEY_PATTERN` regex correctly detects `$2 billion`, `$1.3B`, `$400 million`, `$75M`, `$250,000`, `USD 2 billion` patterns. `normalizeAmount()` now handles B/M/K/T single-letter suffixes. Returns `amountDisplay` field (e.g. `$2B`, `$75M`) for clean UI rendering. `FINANCIAL_PROXIMITY_PATTERN` gate prevents false-positive signals — only sentences with financial keywords emit signals.
    *   **FlowTrace Panel Upgrade (Part 7):** Now renders `amountDisplay` (not raw match) in green. Context sentence shown in monospace. Source label reads "SOURCE:". Signal type badge uses lowercase lookup.
    *   **Entity Noise Filter Expansion (Parts 3):** `MEDIA_SOURCE_BLOCKLIST` expanded with PR wire services (PRNewswire, Business Wire, GlobeNewswire, Newswire), page artifact text (Breaking News, Editors Note, Advertisement, Sponsored Content), social platforms (TikTok, LinkedIn), and generic content fragments (Read More, Full Story, Top Stories).
    *   **Document Signal Scoring (Part 6):** `computeDocSignalScore()` function rates each document HIGH/MEDIUM/LOW based on financial keyword hits, investigative keyword hits, context keyword density, document length, and entity count. Signal badge shown in Document Vault rows.
    *   **Boot Screen (Part 10):** `BootScreen.tsx` added — full-screen black overlay with subtle red grid background, radar sweep animation, 5-line boot message sequence, and progress bar. Completes in ~2.35 seconds then fades out. Shows once per browser session (sessionStorage flag). `atlas-radar-sweep` and `atlas-boot-progress` CSS keyframes added to index.css.
    *   **Dashboard System Status Panel (Parts 8, 9):** Three visual depth planes (`atlas-shell` → `atlas-control-panel` → `atlas-content-surface`) replace the thin telemetry strip. ATLAS CORE ONLINE header with pulsing green dot. Four metric cells: DOSSIERS / ENTITY REGISTRY / DOCUMENT VAULT / TRIAGE QUEUE — each with icon, label, large count, and contextual sub-label.
    *   **Case Intelligence Summary (Part 12):** New CASE INTELLIGENCE panel added at top of OverviewPanel showing SOURCES INGESTED / ENTITY REGISTRY / FINANCIAL SIGNALS counts, plus PERSONS/ORGS breakdown, timeline events, usable sources count, and a PRIMARY ENTITIES chip row.

6.  **Console Refinement & Intelligence Hardening (Pass 15):**
    *   **CSS Global Tightening:** `nexus-header-strip` reduced to `py-1.5`, `nexus-label` reduced to `text-[9px]`. Added `.nexus-row` utility class for ultra-compact console rows.
    *   **Dashboard Redesign:** 4-card metric grid replaced with a compact inline telemetry strip (DOSSIERS / ENTITIES / VAULT / PENDING). List-mode case cards rewritten as single-line dossier registry rows with status dot, CASE-ID, title, telemetry, chevron. Default view changed to list mode.
    *   **Document Vault Compact Rows:** Document row height reduced (py-1.5), icon shrunk to 5×5, text to xs, action buttons tightened.
    *   **Case Health Block:** DefaultInspector (right inspector) now has a CASE HEALTH grid showing DOCS, USABLE, BLOCKED, ENTITIES, and TRIAGE counts. Uses seed diag data when available.
    *   **Right Inspector Narrowed:** Right case inspector reduced from w-72 to w-64.
    *   **OverviewPanel Compacted:** Grid gap and padding reduced; entity/document list rows tighter.
    *   **Entity Extractor Intelligence Hardening:** Added `SPORTS_ENTERTAINMENT_BLOCKLIST` blocking leagues, trophies, entertainment brands. Added `SPORTS_CONTEXT_PATTERN` and `INVESTIGATIVE_CONTEXT_PATTERN` regexes. Sports/entertainment context entities get 0.55× confidence penalty. Investigative context entities get +0.05–+0.10 confidence boost.
    *   **Suggested Edge Scoring:** Type-compatibility bonus added — high-value investigative pairs (person+org, person+gov_agency, org+gov_agency, etc.) receive a +1 effective score boost toward HIGH rating.

6.  **Graph & Case Control Hardening (Pass 14):**
    *   **Operator Actions (EntityIntelPanel):** REMOVE FROM GRAPH (client-side hide), DELETE FROM CASE (API cascade delete + reject mentions), DELETE GLOBALLY (all cases), REJECT ALL PENDING MENTIONS — all with inline confirmation UI.
    *   **Edge Controls (LinkIntelPanel):** DELETE EDGE button with confirmation, HIDE ALL SUGGESTED EDGES toggle.
    *   **Graph Filters:** HIDE ISOLATED (no confirmed edges) and HIDE LOW-DEG (≤1 confirmed edge) toggles on graph canvas; visible node count shown as N/Total.
    *   **showSuggested lifted to case-detail.tsx:** State lifted from GraphCanvas to CaseDetail for LinkIntelPanel's HIDE ALL SUGGESTED to work.
    *   **hiddenEntityIds Set in CaseDetail:** Client-side entity visibility, filtered visibleEntities passed to GraphCanvas.
    *   **CASE CONTROLS Panel (DefaultInspector):** Bulk mention controls — REJECT LOW-CONFIDENCE, REJECT SINGLE-WORD PERSONS, REJECT ALL PENDING, PURGE FAILED DOCUMENTS — all with API calls and query invalidation.
    *   **Dashboard delete button:** Moved from top-right (overlapping CASE-ID label) to bottom-right of case cards.

6.  **API Routes:**
    *   All API routes are under `/api` and cover CRUD operations for cases, entities, documents, relationships, timeline entries, events, notes, money flows, and entity mentions.
    *   Includes specific routes for document upload, analysis, web search, web ingestion, and entity mention approval/rejection.
    *   New endpoints: `DELETE /cases/:caseId/entities/:entityId` (cascade delete), `POST /cases/:caseId/entities/:entityId/reject-mentions`, `DELETE /cases/:caseId/documents/purge?type=`, `DELETE /cases/:caseId/mentions/pending`, `POST /cases/:caseId/mentions/bulk-reject`.

6.  **TypeScript Configuration:** Each package extends `tsconfig.base.json` with `composite: true`. Root `tsconfig.json` lists all packages as project references.

# External Dependencies

-   **Frontend Libraries:** `@xyflow/react` (React Flow), `react-markdown`, `framer-motion`, `date-fns`, `@hookform/resolvers`, `wouter`, `React Query`.
-   **Backend Libraries:** `express`, `pdf-parse`, `compromise` (JS NLP library), `node-html-parser`.
-   **Database:** PostgreSQL.
-   **ORM:** Drizzle ORM.
-   **Validation:** Zod.
-   **API Generation:** Orval.
-   **Build Tool:** esbuild.
-   **CSS Framework:** Tailwind CSS.
-   **External Services:** Google News RSS (`news.google.com/rss/search`) for web ingestion.