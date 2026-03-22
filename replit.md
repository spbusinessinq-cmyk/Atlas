# Overview

NEXUS is a pnpm workspace monorepo built with TypeScript, designed as a hybrid investigative journalism, OSINT, and intelligence analysis platform. It's a key part of the Red State Rhetoric (RSR) media ecosystem, offering advanced data modeling, automated entity extraction, and web content ingestion to support comprehensive intelligence analysis and reporting. The project aims to provide an "Elite Federal Intelligence Workstation" experience for analysts.

# User Preferences

I want iterative development. I prefer that the agent asks before making major changes.

# System Architecture

The project is structured as a pnpm monorepo using Node.js and TypeScript, emphasizing a robust, scalable, and intelligent analysis platform.

**Core Technologies:**
*   **API Framework:** Express 5
*   **Database:** PostgreSQL with Drizzle ORM
*   **Validation:** Zod
*   **API Codegen:** Orval (from OpenAPI spec)
*   **Build System:** esbuild
*   **Frontend:** React, Vite, Tailwind CSS
*   **Graph Visualization:** @xyflow/react (React Flow)
*   **NLP/NER:** compromise (JS) and pdf-parse for document entity extraction

**Monorepo Structure:**
*   `artifacts/`: Deployable applications (API server, NEXUS frontend)
*   `lib/`: Shared libraries (API spec, client, Zod schemas, DB)
*   `scripts/`: Utility scripts

**Key Features & Design Principles:**

1.  **NEXUS Platform Core:**
    *   **Data Models:** Case, Entity, Document, Relationship, TimelineEntry, Event (ORION), Note, MoneyFlow, EntityMention, RelationshipEvidence.
    *   **UI/UX:** Features a Case Dashboard, detailed Case Views (Overview, Entity Registry, Document Vault, Link Analysis, Temporal Trace), searchable Entity Database, interactive Link Analysis Graph, Timeline View, ORION Event Intake, and Notes Panel. The UI employs a "Glass UI" aesthetic with radial lighting, enhanced panel depth, and clear visual hierarchy for intelligence assessment.
    *   **Dossier Generation:** Automated 13-page printable intelligence reports (Cover, Executive Summary, Primary Actors, Key Findings, Financial Flows, Evidence, Timeline, Power Structure & Risk, Intelligence Gaps, Entity Network Map, Source Credibility Assessment, Recommended Actions, Legal Notice), designed for professional output. Includes dynamic content like `whyItMatters` and `confidenceNote` based on case analysis.
    *   **Command Center:** An `OverviewPanel` serves as a full command center with a 5-tile CASE HEALTH grid, TARGET MODE badge, GRAPH QUALITY badge, action buttons (RECOMPILE DOSSIER / REBUILD GRAPH / RUN RECOVERY), and dedicated sections for KEY RELATIONSHIPS and LIKELY ANGLES.

2.  **ATLAS Subsystem (Automated Intelligence):**
    *   **Entity Extraction:** Processes PDFs and web articles to extract and categorize entities (people, organizations, locations). Includes `correctEntityType()` for post-processing NLP output and expanded blocklists (`SKIP_NAMES`, `CELEBRITY_PERSON_NAMES`, `WORLD_GEOGRAPHY_DRIFT_BLOCKLIST`, `SPORTS_ENTERTAINMENT_BLOCKLIST`) to improve accuracy and reduce noise.
    *   **Target Mode Classifier:** `classifyTarget()` identifies 10 target modes (e.g., `person_target`, `organization_target`, `funding_target`) to tailor analysis.
    *   **Financial Intelligence:** Robust regex and scoring (`scoreFinancialConfidence()`) for detecting and normalizing financial amounts with multi-tier action-verb scales and anchor token weighting. Includes `financialSignalsTable` for structured financial data and sophisticated deduplication.
    *   **Document Signal Scoring:** Rates documents (HIGH/MEDIUM/LOW) based on financial keywords, investigative keywords, context density, length, and entity count.
    *   **Auto-Triage:** Automatically promotes high-quality entities, rejects junk/low-confidence/off-topic mentions, and holds ambiguous entries for analyst review, with specific rules for cross-document presence and celebrity rejection.
    *   **Query Autopilot:** `generateInvestigativeQueries()` creates mode-aware investigative queries.
    *   **Auto-Graph Compiler:** Automatically creates relationship edges between top entities based on co-mention analysis and assesses `autoGraphQuality`.

3.  **Web Ingestion Engine:**
    *   Ingests articles from sources like Google News RSS into the Document Vault.
    *   Automatically runs entity analysis on ingested content, scoring web search results for relevance and extracting JSON-LD structured data.

4.  **Entity Intelligence Layer:**
    *   **Auto-Dossier:** Provides comprehensive entity intelligence (mentions, documents, co-mentioned entities with scoring, first/last seen dates).
    *   **Suggested Edge Scoring:** Visualizes co-mention suggestions (LOW, MEDIUM, HIGH) based on shared documents.
    *   **Case Compiler:** Automated system to score documents, rank entities, prioritize timeline events and financial signals, and generate a comprehensive `compiledBrief` (qualityNote, whatThisCaseIs, currentState, gaps, queries) with key insights.
    *   **System Log:** Real-time event feed for platform activities.

5.  **Graph & Case Controls:** Provides operator actions for entities (remove, delete, reject mentions), edge controls (delete, hide suggested), and graph filters (hide isolated, hide low-degree nodes). Includes bulk actions for mentions and document purging.

6.  **Analyst Seed Launcher (OMEGA upgrade):** Multi-tab case creation form with TARGET (freeform prompt), SOURCE URLs (analyst-provided URLs fetched and ingested immediately), and RAW NOTES (unstructured text ingested as a document). All three are processed concurrently via `ingestAnalystInputs()` alongside the main ATLAS seed pipeline.

7.  **BLACKDOG Security Monitor:** Sidebar health check component (`BlackdogStatus.tsx`) that pings a configurable endpoint (`VITE_BLACKDOG_URL` env var) and displays GREEN/AMBER/RED status. Shows "NOT CONFIGURED" when env var is unset. Auto-pings every 30 seconds with 6-second timeout.

8.  **System Wipe UI:** Hardened wipe panel in the dashboard with typed confirmation — operator must type "WIPE ATLAS" exactly before the confirm button enables. Calls `DELETE /api/admin/wipe` with token `{ confirm: "WIPE_ALL_DATA" }`.

9.  **Entity Registry Delete:** Per-row delete button on entity list rows (hover to reveal). Calls `DELETE /api/cases/:caseId/entities/:entityId`. Entity detail panel in graph view also has delete-from-case and delete-globally actions.

10. **Triage Hardening:** Dead link detection on case links in triage queue (shows ⚠ NOT FOUND for invalid case IDs). CaseDetail 404 shows styled fallback instead of plain error. TriageDetailPanel with full analyst console (confidence, credibility, flags, delete, case link validation).

11. **Evidence Ingest Overhaul (ATLAS FINAL MEGA PASS):** Multi-tab upload dialog with FILE, URL, TEXT, and NOTE tabs. Each mode uses the correct backend fields (`ingestMethod`, `previewType`, `sourceUrl`, `sourceDomain`, `rawText`). URL mode auto-parses domain and shows character count.

12. **Graph God Mode (AtlasNode + NodeToolbar):** Custom `AtlasNode` component with hover micro-controls via `NodeToolbar` from `@xyflow/react`. Per-node: FOCUS (isolate subgraph), REMOVE (from graph view only), DELETE (global entity purge with confirmation). `ManualAddPanel` sidebar in graph tab for manually creating entities and relationships.

13. **Launcher Command Mode:** `SeedLauncher` has a dual-mode toggle — NEW INVESTIGATION launches the standard seed pipeline, CASE COMMAND routes freeform operator commands to `parseCommand()` / `handleCommand()` which resolve cases by ID (`case XXXXXX` / `#XXXXXX`) and execute API actions (recompile, rebuild graph, etc.).

14. **Investigative Intelligence Sections (Finding Extraction Overhaul):** `CaseBrief` extended with `keyFindings`, `financialRedFlags`, `powerNodes`, `oversightFailures`, `recommendedActions`. Five new builder functions in `case-compiler.ts` populate these fields. Case overview displays them in collapsible sections. Dossier print includes a new "Investigative Intelligence" dossier page with all five sections.

15. **Entity Name Normalization (Graph Source Accuracy):** `validateEntityShape()` now blocks: numeric/dollar amounts, pure numeric strings, truncated names ending in `…`, URL fragments, junk-verb-phrase starters, bare years (4-digit), and names over 60 characters. Six new constants (`DOLLAR_ENTITY_PATTERN`, `PURE_NUMERIC`, `TRUNCATED_NAME`, `URL_FRAGMENT`, `JUNK_PHRASE_STARTERS`) guard the admission pipeline.

16. **ATLAS Entity/Money/Timeline Improvement Pass (T001–T013):**
    *   **Entity Normalization (T001):** `addMention()` strips leading prepositions/articles (`of`, `the`, `a`, `from`, `in`, `by`, etc.) from entity names. Hard-rejects any mention with confidence < 0.5.
    *   **Entity Deduplication (T003):** Before DB insert loop in entity_mentions.ts, extracted entities are deduped by lowercase name using a Map.
    *   **Financial → Entity Linking (T005):** Financial signals with null `entityName` are retroactively linked to extracted entities via text-overlap matching against document content.
    *   **Timeline Date Extraction Fix:** `DATE_PATTERNS` array now places "Month + 4-digit Year" patterns (e.g., "January 2024") BEFORE "Month + 1-2 digit Day" patterns to prevent "January 2024" being mis-parsed as "January 20" (yielding incorrect year 2001).
    *   **Timeline Year Filter (T006):** Timeline events are filtered at insertion time using a ±2 year window from the document's publish date. Junk events filtered by `JUNK_TIMELINE_TYPES` set and `JUNK_TIMELINE_RE` regex (media/sports/entertainment noise). Uses JUNK blocklist (not allowlist) so "EVENT" fallback type passes through.
    *   **rawText Extraction Fix:** `/documents/:id/analyze` endpoint now uses rawText for ALL ingest methods (not just "web"), enabling full-text extraction from manually-ingested and uploaded documents.
    *   **"INVESTIGATIVE TIMELINE" Rename (T007):** Tab label changed from "TEMPORAL TRACE" to "INVESTIGATIVE TIMELINE" at both occurrences in case-detail.tsx.
    *   **Connections CRUD (T008):** Dossier Connections section replaced static list with typed `ConnItem` objects (`status: SYSTEM | EDITED | NEW`), auto-seeded from `entityRelationships` on first edit-mode entry, persisted to `localStorage atlas_connection_items_{caseId}`. Full add/edit/delete operations.
    *   **Dossier Edit Verification (T009):** All 8 dossier workspace textarea sections (caseSummary, powerStructureOverride, whyItMattersOverride, financialNote, anglesOverride, gapsOverride, actionsOverride, riskOverride) verified to correctly call `saveDossierOverride()` and persist to localStorage.
    *   **Test Validation Doc:** Case 38, Doc 259 — synthetic MTA FY2024 Budget Audit Report with 4 named orgs, 4 dated events, 3 financial signals. Produces 5 correct timeline entries (2024-01-01, 2024-03-01 dates) after all pipeline fixes.
    *   **ATLAS FINAL MASTER PASS (T001-T012):** Complete intelligence quality, entity brain, and control layer overhaul in `dossier.ts`:
        *   **T001 — Entity Quality Hard Cap:** Entities scored by financial_linkage×3, avg_confidence×3, doc_frequency×2, title_presence×2, relationship_strength×2. Sorted by score, hard-capped at MAX 12.
        *   **T002 — Entity Type Enforcement:** Types normalized to GOVERNMENT/AGENCY/PROGRAM/CONTRACTOR/NONPROFIT/PERSON/LOCATION via `normalizeEntityType()` lookup in dossier.ts and entity-profile.tsx.
        *   **T003 — Entity Intelligence Profile:** Per-entity profiles generated for every confirmed entity: WHAT IT IS, ROLE IN CASE, WHY IT MATTERS, EVIDENCE STRENGTH (STRONG/MODERATE/LIMITED), OPEN QUESTIONS. Displayed in dossier workspace KEY ENTITIES section and entity-profile.tsx (replacing "No supplemental intelligence" placeholder).
        *   **T004 — Relationship Sanity:** Junk types (co_mention, title_co_mention, preposition-based) hard-deleted from dossier output. Only meaningful types retained. Max 10 relationships. Confidence threshold 0.3 minimum.
        *   **T005 — Power Structure Chains:** Financial signals converted to explicit Entity → Program → $X flow chains. Displayed as labeled control chain text in POWER STRUCTURE section.
        *   **T006 — Flow Trace Clean Mode:** Only confirmed numeric financial signals exposed. Deduped by entity+amount. Sorted largest→smallest. "No confirmed financial flows identified." fallback.
        *   **T007 — Timeline Final Form:** Hard cap changed from 12 to 8 events. JUNK_KEYWORDS expanded. Format: [DATE] — [TYPE] → What → Why in dossier workspace.
        *   **T008 — Executive Summary 4-Paragraph:** `buildCaseSummary()` generates 4 paragraphs separated by \n\n: P1=what the case is, P2=key entities+money, P3=main issue/risk, P4=confidence level. Frontend renders as separate paragraphs.
        *   **T009 — Dossier Structure Lock:** Workspace sections enforced in order: 1.Executive Summary 2.Power Structure 3.Financial Flows 4.Key Entities 5.Investigative Timeline 6.Risk/Exposure 7.Recommended Actions.
        *   **T010 — Graph Clean Mode:** `cleanGraphRelationships` computed in case-detail.tsx, filtering out co_mention/title_co_mention/preposition types before passing to GraphCanvas and EntityIntelPanel.
        *   **T011 — Fail-Safe Mode:** `insufficientData` flag added to dossier response when both entities AND financials are absent. SYSTEM NOTICE block displayed in workspace.
        *   **T012 — Final Validation:** Confirmed against cases 37 and 38. Entities capped, profiles generated, relationships clean, timeline ≤8, summary 4-paragraph, power structure structured.

**API Routes:**
*   Comprehensive RESTful API routes under `/api` for CRUD operations across all core data models, including specific endpoints for document upload, analysis, web search/ingestion, and entity mention management.

# External Dependencies

*   **Frontend Libraries:** `@xyflow/react`, `react-markdown`, `framer-motion`, `date-fns`, `@hookform/resolvers`, `wouter`, `React Query`.
*   **Backend Libraries:** `express`, `pdf-parse`, `compromise`, `node-html-parser`.
*   **Database:** PostgreSQL.
*   **ORM:** Drizzle ORM.
*   **Validation:** Zod.
*   **API Generation:** Orval.
*   **Build Tool:** esbuild.
*   **CSS Framework:** Tailwind CSS.
*   **External Services:** Google News RSS.