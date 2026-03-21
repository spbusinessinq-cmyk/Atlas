# Overview

NEXUS is a pnpm workspace monorepo built with TypeScript, designed as a hybrid investigative journalism, OSINT, and intelligence analysis platform. It's a key part of the Red State Rhetoric (RSR) media ecosystem, offering advanced data modeling, automated entity extraction, and web content ingestion to support comprehensive intelligence analysis and reporting.

# User Preferences

I want iterative development. I prefer that the agent asks before making major changes.

# System Architecture

The project is structured as a pnpm monorepo using Node.js and TypeScript.

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

**Key Features & Specifications:**

1.  **NEXUS Platform:**
    *   **Core Data Models:** Case, Entity, Document, Relationship, TimelineEntry, Event (ORION), Note, MoneyFlow, EntityMention, RelationshipEvidence.
    *   **UI/UX:** Features a Case Dashboard, detailed Case Views (Overview, Entity Registry, Document Vault, Link Analysis, Temporal Trace), searchable Entity Database, interactive Link Analysis Graph, Timeline View, ORION Event Intake, and Notes Panel. The UI incorporates a "Premium Glass" aesthetic with specific CSS for panels, buttons, and navigation, including a boot-up sequence.

2.  **ATLAS Subsystem (Automated Entity Extraction):**
    *   Processes PDFs and web articles to extract people, organizations, and locations, making extracted mentions available for analyst review (ingestion or rejection).
    *   Improved extraction quality with multi-word title-case detection and organizational patterns.
    *   Supports linking evidence to relationships and detailed entity profiles.

3.  **Web Ingestion Engine:**
    *   Ingests articles from sources like Google News RSS into the Document Vault.
    *   Automatically runs entity analysis on ingested content.
    *   Web search results are scored for relevance and extraction includes JSON-LD structured data.
    *   Includes seed diagnostics and a SeedDiagnosticsCard UI component to monitor extraction quality.

4.  **Entity Intelligence Layer:**
    *   **Auto-Dossier:** Provides comprehensive entity intelligence in an EntityIntelPanel, including mentions, documents, co-mentioned entities with scoring, and first/last seen dates.
    *   **Entity Registry Enrichment:** Shows mention counts, unique document counts, and first seen dates.
    *   **Suggested Edge Scoring:** Visualizes co-mention suggestions with scores (LOW, MEDIUM, HIGH) based on shared documents.
    *   **Graph Stats Overlay:** Displays counts for nodes, edges, and suggested links.
    *   **Next Action Guidance:** Provides UI prompts for reviewing co-mention associations.
    *   **System Log:** Real-time event feed for platform activities.

5.  **Financial Intelligence & Case Control:**
    *   **Financial Extraction Engine:** Robust regex for detecting and normalizing financial amounts (e.g., "$2 billion", "$75M"), with proximity patterns to reduce false positives.
    *   **Document Signal Scoring:** Rates documents (HIGH/MEDIUM/LOW) based on financial keywords, investigative keywords, context density, length, and entity count.
    *   **Entity Noise Filtering:** Expanded blocklists for media sources, page artifacts, social platforms, and generic content fragments. Includes sport/entertainment blocklists and context-based confidence adjustments.
    *   **Graph & Case Controls:** Features operator actions for entities (remove, delete, reject mentions), edge controls (delete, hide suggested), and graph filters (hide isolated, hide low-degree nodes).
    *   **Bulk Actions:** Provides bulk mention controls (reject low-confidence, single-word persons, all pending) and document purging.
    *   **Case Compiler:** Automated system to score documents, rank entities, prioritize timeline events and financial signals, and generate a comprehensive `compiledBrief` (qualityNote, whatThisCaseIs, currentState, gaps, queries). This brief is displayed in an `AtlasCaseBrief` component with collapsible sections, quality badges, and key insights.

6.  **Pass 28-32 — ATLAS Master Investigator (current):**
    *   **Target Mode Classifier:** `classifyTarget()` in `entity-extractor.ts` detects 10 target modes: `person_target`, `organization_target`, `government_agency`, `place_target`, `program_target`, `funding_target`, `event_target`, `scandal_target`, `topic_target`, `general`. Stored as `targetMode`, `targetLabel`, `targetConfidence` in `casesTable`.
    *   **Query Autopilot:** `generateInvestigativeQueries()` generates 8-14 mode-aware investigative queries (persons: donations/PAC/lawsuit/contracts; orgs: audit/procurement/oversight; funding: grant/misuse/fraud; scandal: indictment/affidavit/deposition; etc.). Replaces the old `buildQueryVariations`.
    *   **Auto-Graph Compiler:** After seed pipeline completes, auto-creates relationship edges between top entities via co-mention analysis and stores `autoGraphQuality` (STRONG/PROVISIONAL/RECOVERED/WEAK/FAILED) in DB. `compileCaseBrief` is auto-triggered at end of pipeline.
    *   **Dossier 2.0:** `CaseBrief` now includes `keyRelationships` (entity pairs with confidence), `likelyAngles` (mode-aware investigative angles), `targetMode`, `targetLabel`, `autoGraphQuality`, `totalRelationships`. `buildLikelyAngles()` generates mode-specific angles.
    *   **Command Center Overview:** `OverviewPanel` rewritten as full command center with 5-tile CASE HEALTH grid, TARGET MODE badge, GRAPH QUALITY badge, action buttons (RECOMPILE DOSSIER / REBUILD GRAPH / RUN RECOVERY), 2-col entity+evidence layout, KEY RELATIONSHIPS and LIKELY ANGLES sections.
    *   **Document Vault Upgrades:** Document rows now show TIER badge (TIER-1/2/3 from ATLAS-DIAG `priority` field) and ALIGNMENT marker (CORE/RELEVANT/PERIPHERAL from ATLAS-DIAG `alignment` field) in addition to existing signal scores.
    *   **Entity Registry Upgrades:** Entities sorted by mention count descending; new RANK column (#01, #02...); CONFIDENCE column shows percentage bar (relative to top entity); rows for top 3 are highlighted.
    *   **Glass UI Overhaul (T007):** New CSS classes: `.nexus-panel` (deeper glass floor), `.nexus-header-strip` (radial red highlight), `.atlas-health-tile` (radial lighting), `.atlas-glass-violet`, `.atlas-panel-glow-*`, `.atlas-mode-badge`. API: `POST /api/cases/:caseId/rebuild-graph` (re-compute graph edges from co-mentions).

7.  **Stabilization + Intelligence Pass (T001–T007, Mar 2026):**
    *   **Entity Type Correction (T001):** `correctEntityType()` post-processes NER output — entities containing org-structure suffixes (LLC, Corp, Fund, Foundation, Initiative, Committee, etc.) or known govt acronyms (HUD, FBI, DOJ, LAHSA, HACLA, etc.) are forced to `organization` / `government_agency` even if NLP labeled them as `person`. Wired into `addMention()`.
    *   **Blocklist Expansion (T001):** `SKIP_NAMES` extended with slogan/marketing fragments (Innovation, Excellence, Equity, etc.), nav/UI residue (Back To, See All, Homepage, etc.), section heading words (Analysis, Summary, Overview) and document artifact stubs.
    *   **Financial Signal Precision (T002):** `scoreFinancialConfidence()` now uses 3-tier action-verb scale: Tier-1 explicit award/appropriation verbs (+0.25), Tier-2 directed flow verbs (+0.15), Tier-3 generic funding (+0.08). Anchor token overlap weighted up to +0.15; no-overlap penalty −0.05. New `EXPLICIT_AWARD_GATE` and `DIRECTED_FLOW_GATE` regex constants.
    *   **Visual Depth Pass (T005):** New CSS classes: `.atlas-empty-state / icon / title / sub / badge` (premium empty state system); `.atlas-section-header-accent / -cyan / -amber / -green` (left-accent colored section headers with radial glow); `.atlas-scanlines` (panel scan-line depth texture).
    *   **Empty State Intelligence (T006):** All major panel empty states updated with icon + contextual reason + actionable badge — ENTITY REGISTRY, EVIDENCE VAULT, TEMPORAL TRACE, FLOW TRACE, LINK ANALYSIS graph (distinguishes "entities in triage" from "no docs ingested").

**API Routes:**
*   A comprehensive set of RESTful API routes under `/api` covering CRUD operations for all core data models.
*   Specific endpoints for document upload, analysis, web search/ingestion, and entity mention management.

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