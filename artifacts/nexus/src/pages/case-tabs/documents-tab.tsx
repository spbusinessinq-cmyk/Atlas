import React, { useState } from "react";
import {
  useUploadDocument,
  useAnalyzeDocument,
  useListEntityMentions,
  useApproveEntityMention,
  useRejectEntityMention,
  Document,
  EntityMention,
} from "@workspace/api-client-react";

// Extended type for web-ingested documents — these fields are returned by
// the API at runtime but not part of the generated TypeScript type yet.
type ExtendedDoc = Document & {
  sourceUrl?: string | null;
  sourceDomain?: string | null;
  ingestMethod?: string | null;
  rawText?: string | null;
  previewType?: string | null;
};
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Upload,
  Download,
  Cpu,
  CheckCircle2,
  XCircle,
  FileText,
  X,
  AlertCircle,
  ScanLine,
  Eye,
  ExternalLink,
  ArrowLeft,
  Globe,
  AlertTriangle,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "text-cyan-400 border-cyan-400/40 bg-cyan-400/5",
  organization: "text-amber-400 border-amber-400/40 bg-amber-400/5",
  company: "text-green-400 border-green-400/40 bg-green-400/5",
  government_agency: "text-red-400 border-red-400/40 bg-red-400/5",
  location: "text-purple-400 border-purple-400/40 bg-purple-400/5",
  event: "text-blue-400 border-blue-400/40 bg-blue-400/5",
};

interface DocumentsTabProps {
  caseId: number;
  documents: Document[];
  selectedDocId?: number | null;
  onDocumentSelect?: (doc: Document | null) => void;
  onViewDocument?: (doc: Document) => void;
}

export default function DocumentsTab({
  caseId,
  documents,
  selectedDocId,
  onDocumentSelect,
  onViewDocument,
}: DocumentsTabProps) {
  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip">
        <span className="nexus-label">DOCUMENT VAULT — {documents.length} FILES</span>
        <UploadDocumentDialog caseId={caseId} />
      </div>

      <div className="flex-1 overflow-auto">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
            <FileText className="w-8 h-8 text-neutral-800" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO EVIDENCE ATTACHED
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-wider">
              Use INGEST to upload source documents
            </div>
          </div>
        ) : (
          <>
            <div className="flex sticky top-0 z-10" style={{ background: "rgba(3,5,10,0.97)", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
              <div className="w-8 mr-3 flex-shrink-0" />
              <div className="flex-1 px-3 py-1.5 font-mono text-[7px] uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)" }}>EVIDENCE TITLE / SOURCE</div>
              <div className="w-48 px-3 py-1.5 font-mono text-[7px] uppercase tracking-[0.2em] text-right" style={{ color: "rgba(255,255,255,0.2)" }}>ACTIONS</div>
            </div>
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                caseId={caseId}
                isSelected={selectedDocId === doc.id}
                onSelect={() =>
                  onDocumentSelect?.(selectedDocId === doc.id ? null : doc)
                }
                onView={() => {
                  onDocumentSelect?.(doc);
                  onViewDocument?.(doc);
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const SIGNAL_BADGE: Record<"HIGH" | "MEDIUM" | "LOW", { text: string; cls: string }> = {
  HIGH:   { text: "HIGH",   cls: "text-green-400 border-green-500/30 bg-green-500/5" },
  MEDIUM: { text: "MED",    cls: "text-amber-500 border-amber-500/25 bg-amber-500/5" },
  LOW:    { text: "LOW",    cls: "text-neutral-700 border-[#ffffff0d] bg-transparent" },
};

function DocumentRow({
  doc,
  caseId,
  isSelected,
  onSelect,
  onView,
}: {
  doc: Document;
  caseId: number;
  isSelected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  const extDoc = doc as ExtendedDoc;
  const isWeb = extDoc.ingestMethod === "web";
  const diag = extDoc.rawText ? (() => { try { return parseAtlasDiag(extDoc.rawText!); } catch { return null; } })() : null;
  const signalScore = computeDocSignalScore(extDoc.rawText, diag?.entities);
  const signalBadge = SIGNAL_BADGE[signalScore];
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const analyzeMutation = useAnalyzeDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        onSelect();
      },
    },
  });

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Derive tier for left border coloring
  const tier = diag?.priority ?? "TIER-3";
  const tierBorderColor = tier === "TIER-1" ? "rgba(220,38,38,0.5)" : tier === "TIER-2" ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.06)";

  return (
    <div
      className={cn("flex items-center gap-0 transition-all duration-100")}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.032)",
        borderLeft: `2px solid ${isSelected ? "rgba(220,38,38,0.7)" : tierBorderColor}`,
        background: isSelected ? "rgba(220,38,38,0.03)" : "transparent",
      }}
    >
      <div
        onClick={onSelect}
        className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2 cursor-pointer"
        style={{ transition: "background 0.1s" }}
        onMouseEnter={e => !isSelected && (e.currentTarget.style.background = "rgba(255,255,255,0.015)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        {/* Type icon */}
        <div
          className="w-5 h-5 flex-shrink-0 flex items-center justify-center"
          style={{
            border: `1px solid ${isSelected ? (isWeb ? "rgba(6,182,212,0.35)" : "rgba(220,38,38,0.35)") : "rgba(255,255,255,0.07)"}`,
            background: isSelected ? (isWeb ? "rgba(6,182,212,0.06)" : "rgba(220,38,38,0.06)") : "rgba(255,255,255,0.02)",
          }}
        >
          {isWeb ? (
            <Globe className="w-2.5 h-2.5" style={{ color: isSelected ? "rgba(6,182,212,0.9)" : "rgba(255,255,255,0.25)" }} />
          ) : (
            <span className="text-[6px] font-mono" style={{ color: isSelected ? "rgba(220,38,38,0.8)" : "rgba(255,255,255,0.22)" }}>
              DOC
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div
            className="font-mono text-[10px] font-semibold uppercase truncate leading-tight mb-0.5"
            style={{ color: isSelected ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.45)", letterSpacing: "0.04em" }}
            title={doc.title}
          >
            {doc.title}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[8px] uppercase tracking-wider truncate max-w-[90px]" style={{ color: "rgba(255,255,255,0.2)" }}>
              {(doc as ExtendedDoc).sourceDomain || doc.source || "UNKNOWN"}
            </span>
            <span style={{ color: "rgba(255,255,255,0.1)" }}>·</span>
            <span className="font-mono text-[8px] tabular-nums" style={{ color: "rgba(255,255,255,0.18)" }} title={`Ingested: ${formatDate(doc.uploadedAt)}`}>
              {formatDate(doc.uploadedAt).split(",")[0]}
            </span>
            <span style={{ color: "rgba(255,255,255,0.1)" }}>·</span>
            {/* Signal badge */}
            <span className={`flex-shrink-0 px-1 py-px border font-mono text-[7px] uppercase tracking-widest ${signalBadge.cls}`}>
              {signalBadge.text}
            </span>
            {diag?.priority && (() => {
              const tierMap: Record<string, string> = {
                "TIER-1": "text-red-400 border-red-500/35 bg-red-500/04",
                "TIER-2": "text-amber-400 border-amber-500/30 bg-amber-500/04",
                "TIER-3": "text-neutral-700 border-[#ffffff0d] bg-transparent",
              };
              return (
                <span className={`flex-shrink-0 px-1 py-px border font-mono text-[7px] uppercase tracking-widest ${tierMap[diag.priority!] ?? "text-neutral-700 border-[#ffffff10]"}`}>
                  {diag.priority}
                </span>
              );
            })()}
            {diag?.alignment && (() => {
              const alignMap: Record<string, string> = {
                "CORE":       "text-cyan-500/70 border-cyan-500/25",
                "RELEVANT":   "text-sky-600/60 border-sky-500/15",
                "PERIPHERAL": "text-neutral-700 border-[#ffffff07]",
              };
              return (
                <span className={`flex-shrink-0 px-1 py-px border font-mono text-[7px] uppercase tracking-widest ${alignMap[diag.alignment!] ?? "text-neutral-700 border-[#ffffff08]"}`}>
                  {diag.alignment}
                </span>
              );
            })()}
          </div>
        </div>
      </div>

      <div
        className="flex items-center gap-1 px-2 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => analyzeMutation.mutate({ id: doc.id })}
          disabled={analyzeMutation.isPending}
          className={cn(
            "flex items-center gap-1 px-1.5 py-1 border font-mono text-[8px] uppercase tracking-widest transition-colors",
            analyzeMutation.isPending
              ? "border-neutral-800 text-neutral-700 cursor-not-allowed"
              : "border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10 hover:text-cyan-400 hover:border-cyan-500/60"
          )}
          title="Run entity extraction"
        >
          <Cpu className="w-2.5 h-2.5" />
          {analyzeMutation.isPending ? "…" : "ANALYZE"}
        </button>

        <button
          onClick={onView}
          className="flex items-center gap-1 px-1.5 py-1 border border-neutral-800 text-neutral-600 hover:border-neutral-600 hover:text-white font-mono text-[8px] uppercase tracking-widest transition-colors"
          title="View document"
        >
          <Eye className="w-2.5 h-2.5" />
          VIEW
        </button>

        {doc.filePath && (
          <a
            href={`/api/documents/${doc.id}/download`}
            className="p-1.5 text-neutral-700 hover:text-white transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        )}

        {confirmDelete ? (
          <div className="flex items-center gap-1 ml-1 border border-red-800/50 bg-red-950/30 px-1.5 py-1">
            <span className="font-mono text-[8px] text-red-400 uppercase tracking-wider whitespace-nowrap">
              DELETE?
            </span>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="font-mono text-[8px] text-red-400 hover:text-red-300 uppercase px-1 py-0.5 hover:bg-red-500/20 transition-colors"
            >
              {isDeleting ? "…" : "YES"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="font-mono text-[8px] text-neutral-600 hover:text-neutral-400 uppercase px-1 py-0.5 hover:bg-white/5 transition-colors"
            >
              NO
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 text-neutral-800 hover:text-red-500 transition-colors ml-1"
            title="Delete document"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Document Viewer (center panel) ───────────────────────────────────────────

export function DocumentViewer({
  doc,
  onBack,
}: {
  doc: Document;
  onBack: () => void;
}) {
  const extDoc = doc as ExtendedDoc;
  const isWeb = extDoc.ingestMethod === "web";
  const isWebArticle = extDoc.previewType === "web-article" || (isWeb && !doc.filePath);
  const ext = doc.filePath
    ? doc.filePath.split(".").pop()?.toLowerCase()
    : undefined;
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "");
  const hasFile = !!doc.filePath;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#000]">
      <div className="nexus-header-strip flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 font-mono text-[9px] text-neutral-600 hover:text-white uppercase tracking-widest transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-3 h-3" />
            BACK TO VAULT
          </button>
          <span className="text-[#ffffff12] text-xs">|</span>
          <span className="font-mono text-[10px] text-neutral-400 uppercase truncate">
            {doc.title}
          </span>
          {isWeb && (
            <span className="font-mono text-[8px] text-cyan-700 border border-cyan-700/40 px-1.5 py-0.5 uppercase flex-shrink-0 flex items-center gap-1">
              <Globe className="w-2.5 h-2.5" />
              WEB
            </span>
          )}
          {ext && !isWeb && (
            <span className="font-mono text-[8px] text-neutral-700 border border-[#ffffff0d] px-1 py-0.5 uppercase flex-shrink-0">
              {ext}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {doc.filePath && (
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mono text-[9px] text-neutral-600 hover:text-white uppercase transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              OPEN IN TAB
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {isWebArticle ? (
          <WebArticleViewer doc={extDoc} />
        ) : !hasFile ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <FileText className="w-8 h-8 text-neutral-800" />
            <div className="text-center space-y-1">
              <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
                NO FILE ATTACHED
              </div>
              <div className="font-mono text-[9px] text-neutral-800 uppercase">
                Upload a file through the INGEST workflow to view it here.
              </div>
            </div>
          </div>
        ) : isPdf ? (
          <iframe
            src={`/api/documents/${doc.id}/file`}
            className="w-full h-full border-0"
            title={doc.title}
          />
        ) : isImage ? (
          <div className="h-full flex items-center justify-center p-6 overflow-auto">
            <img
              src={`/api/documents/${doc.id}/file`}
              alt={doc.title}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <FileText className="w-8 h-8 text-neutral-700" />
            <div className="text-center space-y-1.5">
              <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
                PREVIEW NOT AVAILABLE
              </div>
              <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-wider">
                Open or download the source file.
              </div>
            </div>
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              OPEN FILE
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Document Signal Scoring ──────────────────────────────────────────────────

const FINANCIAL_KW = /\$|USD|budget|funding|grant|contract|appropriation|invest|award|payment|spending|allocated/gi;
const INVESTIGATIVE_KW = /fraud|corruption|kickback|bribery|embezzlement|laundering|whistleblower|subpoena|audit|misconduct|indictment|conviction|probe|oversight|accountability|procurement|no-bid|sole.source|shell company/gi;
const INVESTIGATIVE_CONTEXT_KW = /contract|housing|homeless|shelter|program|authority|department|procurement|grant|budget|allocation|oversight|compliance|violation|lawsuit|investigation|permit|rezoning|development/gi;

function computeDocSignalScore(rawText: string | null | undefined, entityCount?: number): "HIGH" | "MEDIUM" | "LOW" {
  if (!rawText) return "LOW";
  const text = rawText.slice(0, 5000); // Score based on first 5k chars
  const len = text.length;

  const financialHits = (text.match(FINANCIAL_KW) || []).length;
  const investigativeHits = (text.match(INVESTIGATIVE_KW) || []).length;
  const contextHits = (text.match(INVESTIGATIVE_CONTEXT_KW) || []).length;
  const entCount = entityCount ?? 0;

  // Score: financial (0-3) + investigative (0-3) + context (0-2) + entity density (0-2)
  let score = 0;
  score += Math.min(3, financialHits);
  score += Math.min(3, investigativeHits * 2);
  score += Math.min(2, contextHits);
  score += len > 3000 ? 1 : 0;
  score += entCount >= 5 ? 2 : entCount >= 2 ? 1 : 0;

  if (score >= 7) return "HIGH";
  if (score >= 3) return "MEDIUM";
  return "LOW";
}

// ─── Parse ATLAS-DIAG prefix ───────────────────────────────────────────────────

function parseAtlasDiag(rawText: string) {
  const m = rawText.match(/\[ATLAS-DIAG:([^\]]+)\]/);
  if (!m) return null;
  const kv: Record<string, string> = {};
  m[1].split("|").forEach((pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) return;
    kv[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
  });
  const dec = (v?: string) => { try { return v ? decodeURIComponent(v) : undefined; } catch { return v; } };
  return {
    status: (kv.status as "ok" | "partial" | "failed" | "wrapper") || "failed",
    chars: parseInt(kv.chars || "0"),
    paras: parseInt(kv.paras || "0"),
    sel: kv.sel || "unknown",
    strategy: kv.strategy || "unknown",
    finalUrl: dec(kv.final_url),
    rssUrl: dec(kv.rss_url),
    srcUrl: dec(kv.src_url),
    entities: kv.entities !== undefined ? parseInt(kv.entities) : undefined,
    analysisRan: kv.analysis_ran !== undefined ? kv.analysis_ran === "1" : undefined,
    contamination: (kv.contamination as "low" | "med" | "high" | undefined) || undefined,
    extractionMode: (kv.extraction_mode as "full" | "lead_only" | undefined) || undefined,
    score: kv.score !== undefined ? parseInt(kv.score) : undefined,
    priority: kv.priority,
    alignment: kv.alignment,
  };
}

function cleanDisplayText(rawText: string): string {
  return rawText
    .replace(/^\[ATLAS-DIAG:[^\]]+\]\n?/, "")
    .replace(/^\[EXTRACTION_INCOMPLETE\]\n?/, "")
    .replace(/^\[EXTRACTION_FAILED\]\n?/, "")
    .replace(/^\[WRAPPER_BLOCKED\]\n?/, "")
    .replace(/^\[FETCH_FAILED\]\n?/, "")
    .trim();
}

// ─── Web Article Viewer ────────────────────────────────────────────────────────

function WebArticleViewer({ doc }: { doc: ExtendedDoc }) {
  const [showDiag, setShowDiag] = useState(false);
  const rawText = doc.rawText || "";

  const diag = parseAtlasDiag(rawText);

  // Determine extraction state
  const hasWrapper = rawText.includes("[WRAPPER_BLOCKED]");
  const hasFetchFail = rawText.includes("[FETCH_FAILED]");
  const hasLegacyFailed = rawText.includes("[EXTRACTION_FAILED]");
  const hasLegacyIncomplete = rawText.includes("[EXTRACTION_INCOMPLETE]") && !hasLegacyFailed;

  const diagStatus = diag?.status
    ?? (hasWrapper ? "wrapper" : hasLegacyFailed || hasFetchFail ? "failed" : hasLegacyIncomplete ? "partial" : "ok");

  const displayText = cleanDisplayText(rawText);
  const hasText = displayText.length > 30;

  // Extraction state labels
  const stateConfig = {
    ok: {
      label: "EXTRACTION SUCCESS",
      color: "text-green-500",
      border: "border-green-500/20",
      bg: "bg-green-500/5",
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />,
      msg: `Article body recovered — ${diag?.chars.toLocaleString() ?? "?"} chars, ${diag?.paras ?? "?"} paragraphs.`,
    },
    partial: {
      label: "EXTRACTION PARTIAL",
      color: "text-orange-500",
      border: "border-orange-500/20",
      bg: "bg-orange-500/5",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0 mt-0.5" />,
      msg: `Partial article body recovered (${diag?.chars.toLocaleString() ?? "?"} chars, ${diag?.paras ?? "?"} paragraphs). Full article may require opening the original source.`,
    },
    failed: {
      label: "EXTRACTION FAILED",
      color: "text-red-500",
      border: "border-red-500/30",
      bg: "bg-red-500/5",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />,
      msg: "No usable article body was recovered. The page may be behind a paywall, JS-only, or returned insufficient content. Entity analysis was skipped.",
    },
    wrapper: {
      label: "WRAPPER / REDIRECT BLOCKED",
      color: "text-red-400",
      border: "border-red-500/30",
      bg: "bg-red-950/30",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />,
      msg: "This URL resolved to a redirect wrapper, Google News aggregator, or cookie-consent gate — no article content was accessible. Entity analysis was skipped.",
    },
  }[diagStatus] ?? {
    label: "EXTRACTION STATUS UNKNOWN",
    color: "text-neutral-500",
    border: "border-[#ffffff10]",
    bg: "bg-[#ffffff03]",
    icon: <AlertTriangle className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0 mt-0.5" />,
    msg: "Extraction state could not be determined.",
  };

  return (
    <div className="h-full overflow-auto bg-[#050709]">
      {/* Source metadata bar */}
      <div className="border-b border-[#ffffff06] px-6 py-3 flex items-center gap-4 bg-[#000]">
        <Globe className="w-3.5 h-3.5 text-cyan-700 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="font-mono text-[9px] text-cyan-700 uppercase tracking-wider truncate">
            {doc.sourceDomain || "UNKNOWN SOURCE"}
          </div>
          {doc.publishDate && (
            <div className="font-mono text-[8px] text-neutral-700 uppercase">
              PUBLISHED: {doc.publishDate}
            </div>
          )}
        </div>
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors flex-shrink-0"
          >
            <ExternalLink className="w-3 h-3" />
            OPEN ORIGINAL
          </a>
        )}
      </div>

      {/* Article title */}
      <div className="px-6 pt-6 pb-4 border-b border-[#ffffff06]">
        <h1 className="text-lg font-bold text-white uppercase tracking-tight leading-tight">
          {doc.title}
        </h1>
      </div>

      {/* Extraction state banner */}
      <div className={`mx-6 mt-4 p-3 border ${stateConfig.border} ${stateConfig.bg}`}>
        <div className="flex items-start gap-2.5">
          {stateConfig.icon}
          <div className="flex-1 space-y-0.5">
            <div className={`font-mono text-[9px] ${stateConfig.color} uppercase tracking-widest`}>
              {stateConfig.label}
            </div>
            <div className="font-mono text-[8px] text-neutral-600 uppercase leading-relaxed">
              {stateConfig.msg}
            </div>
          </div>
          {diag && (
            <button
              onClick={() => setShowDiag((v) => !v)}
              className="font-mono text-[8px] text-neutral-700 hover:text-neutral-400 uppercase tracking-widest flex-shrink-0 transition-colors"
            >
              {showDiag ? "HIDE" : "DIAG"}
            </button>
          )}
        </div>

        {/* Diagnostics panel */}
        {showDiag && diag && (
          <div className="mt-3 pt-3 border-t border-[#ffffff08] grid grid-cols-2 gap-x-6 gap-y-1">
            {[
              { k: "STATUS", v: diag.status.toUpperCase() },
              { k: "CHARS", v: diag.chars.toLocaleString() },
              { k: "PARAGRAPHS", v: diag.paras.toString() },
              { k: "SELECTOR", v: diag.sel },
              { k: "STRATEGY", v: diag.strategy },
              ...(diag.finalUrl && diag.finalUrl !== doc.sourceUrl
                ? [{ k: "FINAL URL", v: diag.finalUrl.slice(0, 60) + (diag.finalUrl.length > 60 ? "…" : "") }]
                : []),
            ].map(({ k, v }) => (
              <div key={k} className="flex gap-2 font-mono text-[8px] uppercase">
                <span className="text-neutral-700 tracking-widest flex-shrink-0">{k}:</span>
                <span className="text-neutral-400 truncate">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Article body */}
      <div className="px-6 py-5">
        {hasText ? (
          <div className="font-mono text-[11px] text-neutral-400 leading-relaxed whitespace-pre-wrap max-w-2xl">
            {displayText}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Globe className="w-6 h-6 text-neutral-800" />
            <div className="text-center space-y-1">
              <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
                NO CONTENT SNAPSHOT
              </div>
              <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-wider">
                Article content could not be retrieved. Open the original source.
              </div>
            </div>
            {doc.sourceUrl && (
              <a
                href={doc.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                OPEN ORIGINAL SOURCE
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Document Inspector (right panel) ─────────────────────────────────────────

export function DocumentInspector({
  doc,
  caseId,
  onClose,
  onView,
}: {
  doc: Document;
  caseId: number;
  onClose: () => void;
  onView?: () => void;
}) {
  const queryClient = useQueryClient();
  const extDoc = doc as ExtendedDoc;
  const isWeb = extDoc.ingestMethod === "web";

  const { data: pendingMentions = [] } = useListEntityMentions({
    documentId: doc.id,
    status: "pending",
  });

  const { data: approvedMentions = [] } = useListEntityMentions({
    documentId: doc.id,
    status: "approved",
  });

  const { data: rejectedMentions = [] } = useListEntityMentions({
    documentId: doc.id,
    status: "rejected",
  });

  const analyzeMutation = useAnalyzeDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      },
    },
  });

  const approveMutation = useApproveEntityMention({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      },
    },
  });

  const rejectMutation = useRejectEntityMention({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
      },
    },
  });

  const hasAnyMentions = pendingMentions.length > 0 || approvedMentions.length > 0 || rejectedMentions.length > 0;
  const totalDetections = pendingMentions.length + approvedMentions.length + rejectedMentions.length;
  const ext = doc.filePath
    ? doc.filePath.split(".").pop()?.toLowerCase()
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="nexus-header-strip flex-shrink-0">
        <span className="nexus-label flex items-center gap-1.5">
          {isWeb ? <Globe className="w-3 h-3 text-cyan-700" /> : <FileText className="w-3 h-3 text-neutral-500" />}
          {isWeb ? "WEB SOURCE" : "DOCUMENT INSPECTOR"}
        </span>
        <button
          onClick={onClose}
          className="text-neutral-600 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="p-2.5 border border-[#ffffff08] bg-[#0a0e14] space-y-2">
          <div className="text-sm font-bold text-white uppercase leading-tight tracking-tight">
            {doc.title}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isWeb && (
              <span className="inline-flex items-center gap-1 font-mono text-[8px] text-cyan-700 border border-cyan-700/40 px-1.5 py-0.5 uppercase">
                <Globe className="w-2.5 h-2.5" />
                WEB INGEST
              </span>
            )}
            {ext && !isWeb && (
              <span className="inline-block font-mono text-[8px] text-neutral-600 border border-[#ffffff0d] px-1.5 py-0.5 uppercase">
                {ext.toUpperCase()} FILE
              </span>
            )}
          </div>
          <div className="space-y-0.5 font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            {isWeb && extDoc.sourceDomain && (
              <div>
                DOMAIN:{" "}
                <span className="text-cyan-700">{extDoc.sourceDomain}</span>
              </div>
            )}
            {!isWeb && (
              <div>
                SOURCE:{" "}
                <span className="text-neutral-400">{doc.source || "UNKNOWN"}</span>
              </div>
            )}
            {doc.publishDate && (
              <div>
                PUBLISHED:{" "}
                <span className="text-neutral-400">{doc.publishDate}</span>
              </div>
            )}
            <div>
              INGESTED:{" "}
              <span className="text-neutral-400 tabular-nums">
                {formatDate(doc.uploadedAt)}
              </span>
            </div>
            <div>
              METHOD:{" "}
              <span className={isWeb ? "text-cyan-700" : "text-neutral-400"}>
                {isWeb ? "WEB" : "UPLOAD"}
              </span>
            </div>
            <div>
              CASE-REF:{" "}
              <span className="text-neutral-400">
                {caseId.toString().padStart(6, "0")}
              </span>
            </div>
            {isWeb && extDoc.rawText && (() => {
              const diagInspector = parseAtlasDiag(extDoc.rawText!);
              const rawInspector = extDoc.rawText!;
              const inspStatus = diagInspector?.status
                ?? (rawInspector.includes("[WRAPPER_BLOCKED]") ? "wrapper"
                  : rawInspector.includes("[EXTRACTION_FAILED]") || rawInspector.includes("[FETCH_FAILED]") ? "failed"
                  : rawInspector.includes("[EXTRACTION_INCOMPLETE]") ? "partial"
                  : "ok");
              const statusColors: Record<string, string> = {
                ok: "text-green-600",
                partial: "text-orange-500",
                failed: "text-red-500",
                wrapper: "text-red-400",
              };
              return (
                <>
                  <div>
                    BODY:{" "}
                    <span className={statusColors[inspStatus] ?? "text-neutral-400"}>
                      {inspStatus === "ok" ? `OK — ${diagInspector?.chars.toLocaleString() ?? "?"} chars, ${diagInspector?.paras ?? "?"} ¶`
                        : inspStatus === "partial" ? `PARTIAL — ${diagInspector?.chars.toLocaleString() ?? "?"} chars`
                        : inspStatus === "wrapper" ? "WRAPPER BLOCKED"
                        : "FAILED"}
                    </span>
                  </div>
                  {diagInspector?.strategy && (
                    <div>
                      EXTRACT:{" "}
                      <span className="text-neutral-400 uppercase">{diagInspector.strategy}</span>
                    </div>
                  )}
                  {diagInspector?.entities !== undefined && (
                    <div>
                      ENTITIES:{" "}
                      <span className={diagInspector.entities > 0 ? "text-amber-500" : "text-neutral-600"}>
                        {diagInspector.entities} detected
                      </span>
                    </div>
                  )}
                  {diagInspector?.contamination && (
                    <div>
                      CONTAM:{" "}
                      <span className={
                        diagInspector.contamination === "high" ? "text-orange-500" :
                        diagInspector.contamination === "med" ? "text-amber-600" :
                        "text-neutral-600"
                      }>
                        {diagInspector.contamination.toUpperCase()}
                        {diagInspector.extractionMode === "lead_only" ? " — LEAD ONLY" : ""}
                      </span>
                    </div>
                  )}
                  {diagInspector?.priority && (
                    <div>
                      PRIORITY:{" "}
                      <span className={
                        diagInspector.priority === "A" ? "text-green-500" :
                        diagInspector.priority === "B" ? "text-cyan-600" :
                        "text-neutral-600"
                      }>
                        {diagInspector.priority}
                        {diagInspector.alignment ? ` · ${diagInspector.alignment.toUpperCase()}` : ""}
                      </span>
                    </div>
                  )}
                  {diagInspector?.rssUrl && (
                    <div>
                      URL SRC:{" "}
                      <span className="text-green-700 text-[8px] break-all">REAL URL ✓</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        <div className="space-y-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              analyzeMutation.mutate({ id: doc.id });
            }}
            disabled={analyzeMutation.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 hover:border-cyan-500/60 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <Cpu className="w-3 h-3" />
            {analyzeMutation.isPending ? "SCANNING..." : "ANALYZE DOCUMENT"}
          </button>

          {onView && (
            <button
              onClick={onView}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white font-mono text-[9px] uppercase tracking-widest transition-colors"
            >
              <Eye className="w-3 h-3" />
              {isWeb ? "VIEW ARTICLE" : "VIEW DOCUMENT"}
            </button>
          )}

          {isWeb && extDoc.sourceUrl && (
            <a
              href={extDoc.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-cyan-500/20 text-cyan-700 hover:border-cyan-500/40 hover:text-cyan-400 font-mono text-[9px] uppercase transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              OPEN ORIGINAL URL
            </a>
          )}

          {doc.filePath && (
            <a
              href={`/api/documents/${doc.id}/download`}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-[#ffffff0d] text-neutral-600 hover:text-white font-mono text-[9px] uppercase transition-colors"
            >
              <Download className="w-3 h-3" />
              DOWNLOAD
            </a>
          )}
        </div>

        {analyzeMutation.isSuccess && analyzeMutation.data && (() => {
          const data = analyzeMutation.data as {
            mentionsCreated?: number;
            extractionMethod?: string;
            warning?: string;
          };
          const skipped = data.extractionMethod === "wrapper-blocked" || data.extractionMethod === "failed";
          if (skipped) {
            return (
              <div className="p-2 border border-red-500/20 bg-red-500/5 font-mono text-[9px] text-red-400 flex items-start gap-2">
                <ShieldAlert className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>ANALYSIS SKIPPED — {data.warning || "Usable article body not recovered."}</span>
              </div>
            );
          }
          return (
            <div className="p-2 border border-cyan-500/20 bg-cyan-500/5 font-mono text-[9px] text-cyan-400 flex items-center gap-2">
              <Cpu className="w-3 h-3 flex-shrink-0" />
              ANALYSIS COMPLETE — {data.mentionsCreated ?? 0} ENTITY SIGNALS DETECTED
            </div>
          );
        })()}
        {analyzeMutation.isError && (
          <div className="p-2 border border-red-500/20 bg-red-500/5 font-mono text-[9px] text-red-400 flex items-center gap-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            ANALYSIS REQUEST FAILED
          </div>
        )}

        {/* Detection Summary */}
        {hasAnyMentions && (
          <div className="grid grid-cols-4 gap-1 p-2 border border-[#ffffff06] bg-[#08090d]">
            {[
              { label: "TOTAL", val: totalDetections, color: "text-neutral-400" },
              { label: "PENDING", val: pendingMentions.length, color: "text-orange-400" },
              { label: "APPROVED", val: approvedMentions.length, color: "text-green-500" },
              { label: "REJECTED", val: rejectedMentions.length, color: "text-red-500" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-0.5">
                <span className={cn("font-mono text-[14px] font-bold tabular-nums", s.color)}>
                  {s.val.toString().padStart(2, "0")}
                </span>
                <span className="font-mono text-[7px] text-neutral-700 uppercase tracking-widest">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {!hasAnyMentions && (
          <div className="py-5 text-center space-y-2 border border-dashed border-[#ffffff06]">
            <ScanLine className="w-4 h-4 text-neutral-800 mx-auto" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO USEFUL DETECTIONS FOUND
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-wider">
              Run ANALYZE to extract entities and references.
            </div>
          </div>
        )}

        {pendingMentions.length > 0 && (
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-orange-500 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-orange-500 inline-block" />
              PENDING TRIAGE — {pendingMentions.length}
            </div>
            <div className="space-y-1">
              {pendingMentions.map((m) => (
                <MentionCard
                  key={m.id}
                  mention={m}
                  caseId={caseId}
                  onApprove={() =>
                    approveMutation.mutate({ id: m.id, data: { caseId } })
                  }
                  onReject={() => rejectMutation.mutate({ id: m.id })}
                  isApproving={
                    approveMutation.isPending &&
                    approveMutation.variables?.id === m.id
                  }
                  isRejecting={
                    rejectMutation.isPending &&
                    rejectMutation.variables?.id === m.id
                  }
                />
              ))}
            </div>
          </div>
        )}

        {approvedMentions.length > 0 && (
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-green-700 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-green-600 inline-block" />
              INGESTED TO REGISTRY — {approvedMentions.length}
            </div>
            <div className="space-y-1">
              {approvedMentions.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 border border-[#ffffff05] bg-[#070b10]"
                >
                  <CheckCircle2 className="w-3 h-3 text-green-700 flex-shrink-0" />
                  <span className="text-xs font-semibold text-neutral-400 uppercase truncate">
                    {m.entityName}
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-[8px] font-mono px-1 py-0.5 border uppercase",
                      ENTITY_TYPE_COLORS[m.entityType] ||
                        "text-neutral-500 border-neutral-500/30"
                    )}
                  >
                    {m.entityType.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {rejectedMentions.length > 0 && (
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-red-800 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-red-700 inline-block" />
              REJECTED — {rejectedMentions.length}
            </div>
            <div className="space-y-1">
              {rejectedMentions.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 border border-red-900/20 bg-[#070b10] opacity-60"
                >
                  <XCircle className="w-3 h-3 text-red-800 flex-shrink-0" />
                  <span className="text-xs font-semibold text-neutral-600 uppercase truncate line-through">
                    {m.entityName}
                  </span>
                  <span
                    className="ml-auto text-[8px] font-mono px-1 py-0.5 border uppercase text-neutral-700 border-neutral-800/40"
                  >
                    {m.entityType.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function MentionCard({
  mention,
  caseId: _caseId,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  mention: EntityMention;
  caseId: number;
  onApprove: () => void;
  onReject: () => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const colorClass =
    ENTITY_TYPE_COLORS[mention.entityType] ||
    "text-neutral-400 border-neutral-400/40 bg-neutral-400/5";
  const confidencePct = Math.round((mention.confidence || 0) * 100);

  // Parse context encoding [A:r=ROLE|t=TOPIC|z=ZONE]
  const ctx = mention.context ?? "";
  const ctxMatch = ctx.match(/^\[A:r=([^|]+)\|t=([^|]+)\|z=([^\]]+)\]/);
  const ctxRole = ctxMatch ? ctxMatch[1] : null;
  const ctxTopic = ctxMatch ? ctxMatch[2] : null;
  const ctxZone = ctxMatch ? ctxMatch[3] : null;
  const plainCtx = ctxMatch ? ctx.slice(ctxMatch[0].length).trim() : ctx;

  // Derive triage signal chips
  type ChipDef = { label: string; cls: string };
  const chips: ChipDef[] = [];
  if (ctxZone === "title") chips.push({ label: "TITLE HIT", cls: "text-green-400 border-green-900/40" });
  else if (ctxZone === "dek" || ctxZone === "lead") chips.push({ label: "LEAD HIT", cls: "text-teal-400 border-teal-900/40" });
  if (ctxTopic === "OFF_TOPIC") chips.push({ label: "OFF-TOPIC", cls: "text-red-500 border-red-900/40" });
  if (ctxRole === "UNKNOWN") chips.push({ label: "LOW-ROLE", cls: "text-amber-600 border-amber-900/40" });
  if (/NAV_RESIDUE|ARTIFACT|CROSS_STORY|ZONE_REJECT/.test(ctx)) chips.push({ label: "NAV NOISE", cls: "text-orange-500 border-orange-900/40" });
  if (/BLOCKLIST|BOILERPLATE/.test(ctx)) chips.push({ label: "JUNK", cls: "text-red-700 border-red-900/40" });
  if (/multi.?doc|T1_CONFIRMED|T1_STRONG/.test(ctx)) chips.push({ label: "MULTI-DOC", cls: "text-cyan-500 border-cyan-900/40" });

  return (
    <div className="p-2 border border-[#ffffff06] bg-[#070b10] space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-white uppercase">
          {mention.entityName}
        </span>
        <span
          className={cn(
            "text-[9px] font-mono px-1.5 py-0.5 border uppercase tracking-wider",
            colorClass
          )}
        >
          {mention.entityType.replace(/_/g, " ")}
        </span>
        <span className="text-[9px] font-mono text-neutral-700 ml-auto">
          {confidencePct}%
        </span>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span key={chip.label} className={cn("font-mono text-[8px] border px-1 uppercase tracking-wider", chip.cls)}>
              {chip.label}
            </span>
          ))}
          {ctxRole && ctxRole !== "UNKNOWN" && (
            <span className="font-mono text-[8px] border px-1 uppercase tracking-wider text-neutral-600 border-neutral-800">
              {ctxRole}
            </span>
          )}
        </div>
      )}
      {plainCtx && (
        <p className="text-[9px] text-neutral-600 font-mono truncate">
          &ldquo;{plainCtx}&rdquo;
        </p>
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={onApprove}
          disabled={isApproving || isRejecting}
          className="flex-1 flex items-center justify-center gap-1 py-1 border border-green-500/40 text-green-500 hover:bg-green-500/10 font-mono text-[9px] uppercase transition-colors disabled:opacity-40"
        >
          <CheckCircle2 className="w-3 h-3" />
          {isApproving ? "..." : "INGEST"}
        </button>
        <button
          onClick={onReject}
          disabled={isApproving || isRejecting}
          className="flex-1 flex items-center justify-center gap-1 py-1 border border-red-500/40 text-red-500 hover:bg-red-500/10 font-mono text-[9px] uppercase transition-colors disabled:opacity-40"
        >
          <XCircle className="w-3 h-3" />
          {isRejecting ? "..." : "REJECT"}
        </button>
      </div>
    </div>
  );
}

function UploadDocumentDialog({ caseId }: { caseId: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const uploadMutation = useUploadDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setOpen(false);
      },
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File;
    if (!file || file.size === 0) return;
    uploadMutation.mutate({
      data: {
        file,
        caseId,
        title: fd.get("title") as string,
        source: fd.get("source") as string,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-red-600 hover:bg-red-700 text-white rounded-none h-6 px-3 font-mono text-[10px] uppercase tracking-wider gap-1.5">
          <Upload className="w-3 h-3" /> INGEST
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px] border border-[#ffffff1a] bg-[#0d1117] rounded-none p-0">
        <DialogTitle asChild>
          <div className="nexus-header-strip">
            <span className="nexus-label flex items-center gap-2">
              <Upload className="w-3 h-3 text-red-500" />
              INGEST EVIDENCE
            </span>
          </div>
        </DialogTitle>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="nexus-label">File</Label>
            <div className="relative">
              <Input
                type="file"
                name="file"
                required
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-full h-20 border border-dashed border-[#ffffff12] bg-[#000] flex flex-col items-center justify-center text-neutral-600 gap-1.5">
                <Upload className="w-4 h-4 opacity-40" />
                <span className="font-mono text-[9px] uppercase tracking-widest">
                  DRAG &amp; DROP OR BROWSE
                </span>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Document Title</Label>
            <Input
              name="title"
              required
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono h-8"
              placeholder="e.g. Bank_Statement_Q3.pdf"
            />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Intelligence Source</Label>
            <Input
              name="source"
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono h-8"
              placeholder="e.g. Subpoena, Open Source"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-[#ffffff0d]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="rounded-none font-mono text-[10px] text-neutral-500 hover:text-white h-7"
            >
              CANCEL
            </Button>
            <Button
              type="submit"
              disabled={uploadMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[10px] px-4 h-7"
            >
              {uploadMutation.isPending ? "UPLOADING..." : "TRANSMIT"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
