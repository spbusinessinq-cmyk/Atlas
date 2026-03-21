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
    *   **UI/UX:** Features a Case Dashboard, detailed Case Views (Overview, Entity Registry, Document Vault, Link Analysis, Temporal Trace), searchable Entity Database, interactive Link Analysis Graph, Timeline View, ORION Event Intake, and Notes Panel. The UI incorporates an "Elite Federal Intelligence Workstation" aesthetic. **Intelligence Dominance + Export Fix Pass:** ATLAS DOSSIER section now has a split header row — collapse toggle (left) + always-visible EXPORT button (right). Button states: "GENERATE & EXPORT" (auto-fetches dossier then opens print) / "EXPORT PDF" (opens immediately) / "GENERATING..." (loading). Toast feedback "✓ Dossier ready — export window opened" shown for 3.5s after click. QUALITY CONTROLS section removed (pipeline noise reduction). Smart financial empty state in dossier expanded view shows "Expected: contracts, grants, appropriations" + ingest guidance. WHY THIS MATTERS callout added to KEY FINDINGS page in print dossier — computed from investigative angles + financial signals + entity stats. **Zero-Friction + Print Dossier Pass:** `dossier-print.ts` generates 8-page clean white printable intelligence report (Cover, Executive Summary, Primary Actors, Key Findings, Financial Flows, Evidence, Timeline, Intelligence Gaps) opened in a new window triggering the browser print dialog. EXPORT PDF button in DOSSIER READY section. Right rail now shows "N detected → M require review" / "N detected → auto-processed" auto-intelligence framing. BULK ACTIONS section removed — passive review model. GENERATE DOSSIER added as final NEXT ACTION state when entities + docs present. Dossier expanded view shows CONFIRMED (≥3 docs, green), DEVELOPING (1-2 docs, amber), GAPS (auto-computed) intelligence clarity tiers. Financial signals show green left accent + confidence %. **Command Flow (ATLAS Dominance Pass):** Right rail rebuilt as a 3-zone command rail: (1) compact always-visible STATUS OVERVIEW with 4-number funnel grid + collapsible SYSTEM REPORT, (2) always-visible INTEL BRIEF with red left accent glow, (3) dominant NEXT ACTION box (`.atlas-next-action-box` CSS) with red gradient + border-left glow. Triage compresses to a compact amber summary strip (N PENDING + REVIEW →) with BULK ACTIONS collapsed by default. All collapsible sections start closed. CSS additions: `.atlas-next-action-box`, `.atlas-elevated`, `.atlas-glass-edge`, `.atlas-fade-in` animation, `.atlas-empty-state*`, `.atlas-triage-summary`. Top bar (`nexus-header-strip`) sharpened — thinner, red glow underline. TelemetryPip shows bold count values in white/amber. Graph nodes have stronger hover glow with `translateY(-1px)`. Panel depth/glass via `atlas-panel` with inset shadows + radial gradients.

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

8.  **MEGA PASS — ATLAS Launch Lock (Mar 2026):**
    *   **Drizzle Crash Fix (T001):** `dossier.ts` was crashing Drizzle ORM by referencing `documentsTable.publishedAt` (undefined) instead of `documentsTable.publishDate`; also removed invalid `(table as any).sourceUrl` cast. API server is now crash-free.
    *   **Entity Intelligence Purge (T002):** Added `CELEBRITY_PERSON_NAMES` blocklist (60+ names), `WORLD_GEOGRAPHY_DRIFT_BLOCKLIST` (foreign countries/sidebar drift), expanded `SPORTS_ENTERTAINMENT_BLOCKLIST`. Fixed admission firewall — blocklists were defined but never checked in `shouldAdmitMention()`. Raised LOW confidence threshold 0.72→0.80. Strengthened `housing_homelessness` OFF_TOPIC detection.
    *   **Auto-Triage Backend (T003):** New endpoint `POST /api/cases/:caseId/mentions/auto-triage` — auto-promotes high-quality entities, auto-rejects junk/low-conf/sidebar/off-topic, holds ambiguous middle. Frontend: AUTO-TRIAGE button in triage summary strip with promoted/rejected/held result feedback display.
    *   **Financial Intelligence Upgrade (T004):** `dossier.ts` now queries `financialSignalsTable` directly (not mention-context MONEY_RE hack) — returns structured signals with `amountRaw`, `amountDisplay`, `normalizedAmount`, `signalType`, `eventSummary`, `controlledBy`, `receivedBy`, `programName`, `confidence`, `inferred`. Ranked by score (confirmed > high-conf > large amounts). Frontend dossier panel + print dossier both updated to render rich financial signal cards.
    *   **Dossier Intelligence Quality (T007):** `buildCaseSummary()` and `buildInvestigativeAngles()` upgraded to entity-specific prose. New dossier sections added to API response: `knownGaps` (server-computed from entity/financial/timeline/relationship gaps), `whyItMatters` (narrative paragraph derived from case intent + financial signals + entity stats), `confidenceNote` (INSUFFICIENT/PROVISIONAL/MODERATE/STRONG classification with supporting counts). Print dossier now uses server-provided `whyItMatters` and `confidenceNote`. Query expansion uses quoted entity name searches with intent-specific suffixes.
    *   **UI Depth Pass (T009):** 5-dimension investigation coverage bar added to Zone 1 of right rail — shows SRC / ENT / REL / FIN / TL bars colored green (≥threshold), amber (some data), or neutral (empty). `DefaultInspector` accepts `financialSignalCount`, `timelineCount`, `relationshipCount` props passed from `CaseDetailInner`. Dossier expanded panel shows WHY THIS MATTERS (red left accent), INTELLIGENCE GAPS (amber, server-computed), CONFIDENCE NOTE (neutral box), EXPAND queries (mono font).

9.  **ATLAS LAUNCH LOCK — Intelligence Quality Pass (Mar 2026):**
    *   **Entity Extractor — Celebrity Blocklist Expansion (T002):** `CELEBRITY_PERSON_NAMES` expanded from ~50 to 130+ names covering actors, musicians, athletes, podcasters, reality TV, social media creators, and tech business celebrities. New OFF_TOPIC patterns added for gossip/lifestyle (`relationship|dating|breakup|fashion|paparazzi`) and sports stats (`scored|rushing|standings|championship`) contexts. Celebrity names now directly trigger OFF_TOPIC when no investigative context present.
    *   **Auto-Triage — Cross-Doc & Celebrity Rejection (T003):** Auto-triage endpoint now pre-fetches all case mentions and builds a per-entity document count map. Entities appearing in only 1 document are blocked from auto-promotion (held for analyst review instead), except government agencies/committees. New `CELEB_AUTO_REJECT_RE` regex pattern auto-rejects celebrity-name mentions with no investigative context (fraud|corruption|lawsuit|contract|indictment).
    *   **Case Compiler — Financial Intelligence Upgrade (T004):** Financial signal deduplication changed from `amountRaw`-only key to composite `entityName|signalType|roundedAmount` key — prevents showing near-duplicate signals from different documents. Scoring upgraded with bonuses: +8 confirmed (non-inferred), +6 complete flow trace (controlledBy + receivedBy), +3 partial flow trace, +4 contextual summary, +2 program-linked; −15 non-numeric penalty. Top financial signals now surface the most informative confirmed flows.
    *   **Dossier — Prose Upgrade (T007):** `buildCaseSummary()` now opens with intent-aware framing ("This file covers a public accountability investigation into homelessness spending...") before entities/docs/financial. Lead financial signal highlighted by name + amount. `buildWhyItMatters()` upgraded: leads with largest dollar signal if ≥$1M, includes cross-doc corroboration count for primary persons, adds intent-specific systemic framing (housing: "conditions favorable to waste, fraud, political favoritism"; crime: "systemic failures of oversight"; finance: "recurring accountability gap").
    *   **Dossier — New Intelligence Sections (T002/T003 backend):** Three new sections added to `/api/cases/:caseId/dossier` response: `powerStructure` (control chain prose from top person/org relationship), `riskFlags` (array of specific anomaly warnings: high-value signals, sole-source contracts, low-confidence edges, undated sources, duplicate entities), `recommendedActions` (array of FOIA/next-step actions keyed to seed intent and entities). All rendered in `case-detail.tsx` and `dossier-print.ts` (new SECTION 07: Power Structure & Risk page with numbered actions list).
    *   **Print Dossier — New Sections (T003):** Print template gains SECTION 07 "Power Structure & Risk" page with Power Structure Analysis block, Risk Flags list (⚠ markers, red accent), and numbered Recommended Actions. Previous intelligence gaps is now SECTION 08. Nine-page complete intelligence brief.
    *   **UI Depth Pass — Flow Trace Panel (T009):** FLOW TRACE quick view upgraded: each signal row now shows two-line display with amount (color-coded by confidence: green≥70%, dimmer green otherwise, amber for non-numeric) + signal type badge + INFERRED tag when applicable, and second line with [programName] + eventSummary. Non-numeric signals differentiated. `amountDisplay` preferred over `amountRaw`.

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