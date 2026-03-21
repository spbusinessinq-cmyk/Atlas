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