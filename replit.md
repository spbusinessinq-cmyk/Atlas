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
    *   Web search results are scored for relevance based on keywords, article content, and domain types.
    *   Enhanced article body extraction using multiple CSS selectors and a paragraph aggregation fallback.

4.  **Entity Intelligence Layer:**
    *   **Auto-Dossier:** EntityIntelPanel displays comprehensive entity intelligence including mentions, documents, first/last seen dates, source documents, confirmed connections, and co-mentioned entities with scoring.
    *   **Entity Registry Enrichment:** Shows mention counts, unique document counts, and first seen dates for each entity.
    *   **Suggested Edge Scoring:** Co-mention suggestions are scored (LOW, MEDIUM, HIGH) based on shared documents, visualized with dashed cyan edges.
    *   **Graph Stats Overlay:** Displays node, edge, and suggested link counts.
    *   **Next Action Guidance:** Provides UI prompts for reviewing co-mention associations.
    *   **System Log:** Real-time event feed (`/logs` page) for document ingestion, web ingestion, analysis, and entity approval/rejection events.

5.  **API Routes:**
    *   All API routes are under `/api` and cover CRUD operations for cases, entities, documents, relationships, timeline entries, events, notes, money flows, and entity mentions.
    *   Includes specific routes for document upload, analysis, web search, web ingestion, and entity mention approval/rejection.

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