import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Download,
  ExternalLink,
  Globe,
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  title: string;
  url: string;
  sourceDomain: string;
  snippet: string;
  publishDate: string;
  contentType: "web-article" | "pdf";
}

interface IngestState {
  [url: string]: "ingesting" | "done" | "error";
}

export default function WebIngestTab({ caseId, initialQuery }: { caseId: number; initialQuery?: string }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(() => {
    const stored = sessionStorage.getItem("atlas_expansion_query");
    if (stored) {
      sessionStorage.removeItem("atlas_expansion_query");
      return stored;
    }
    return initialQuery || "";
  });

  React.useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [ingestState, setIngestState] = useState<IngestState>({});
  const [ingestResults, setIngestResults] = useState<
    Record<string, { mentionsCreated: number }>
  >({});

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setSearchError(null);
    setResults([]);
    setSearched(false);

    try {
      const resp = await fetch("/api/web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || data.error || "Search failed");
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      setSearchError(String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleIngest = async (result: SearchResult) => {
    setIngestState((s) => ({ ...s, [result.url]: "ingesting" }));

    try {
      const resp = await fetch("/api/web-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.title,
          url: result.url,
          sourceDomain: result.sourceDomain,
          snippet: result.snippet,
          publishDate: result.publishDate,
          caseId,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Ingest failed");

      setIngestState((s) => ({ ...s, [result.url]: "done" }));
      setIngestResults((r) => ({
        ...r,
        [result.url]: { mentionsCreated: data.mentionsCreated },
      }));

      // Invalidate case summary to show new document + pending mentions
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
    } catch (err) {
      console.error("Ingest error:", err);
      setIngestState((s) => ({ ...s, [result.url]: "error" }));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#080a0d]">
      {/* Search bar */}
      <div className="border-b border-[#ffffff0d] px-4 py-3 flex-shrink-0 space-y-2">
        <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
          SOURCE SEARCH — PUBLIC WEB INTELLIGENCE
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-700 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Highland Gardens Hotel, LAHSA contracts, Project Homekey..."
              className="w-full bg-[#0a0e14] border border-[#ffffff0d] text-white font-mono text-xs pl-9 pr-3 py-2 placeholder-neutral-800 focus:border-cyan-500/40 focus:bg-[#0d1219] transition-colors"
              disabled={searching}
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 border font-mono text-[10px] uppercase tracking-widest transition-colors flex-shrink-0",
              searching || !query.trim()
                ? "border-neutral-800 text-neutral-700 cursor-not-allowed"
                : "border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 hover:border-cyan-500/60"
            )}
          >
            {searching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            {searching ? "SEARCHING..." : "SEARCH"}
          </button>
        </form>

        {/* Query examples */}
        <div className="flex flex-wrap gap-1.5">
          {[
            "Highland Gardens Hotel",
            "LAHSA hotel contracts",
            "Project Homekey Los Angeles",
            "homeless shelter budget",
          ].map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="font-mono text-[8px] text-neutral-700 hover:text-neutral-400 border border-[#ffffff06] hover:border-[#ffffff15] px-1.5 py-0.5 transition-colors uppercase tracking-wider"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {searching && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Loader2 className="w-5 h-5 text-cyan-600 animate-spin" />
            <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest animate-pulse">
              QUERYING OPEN SOURCES...
            </div>
          </div>
        )}

        {searchError && !searching && (
          <div className="m-4 p-3 border border-red-500/30 bg-red-500/5 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-mono text-[10px] text-red-400 uppercase tracking-widest">
                SEARCH ERROR
              </div>
              <div className="font-mono text-[9px] text-red-600">{searchError}</div>
            </div>
          </div>
        )}

        {!searching && searched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Globe className="w-6 h-6 text-neutral-800" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO RESULTS FOUND
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase">
              Try a different query or more specific search terms.
            </div>
          </div>
        )}

        {!searching && results.length === 0 && !searched && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
            <div className="relative">
              <Globe className="w-8 h-8 text-neutral-800" />
              <Search className="w-3.5 h-3.5 text-neutral-700 absolute -bottom-1 -right-1" />
            </div>
            <div className="text-center space-y-1">
              <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
                OPEN SOURCE INTELLIGENCE
              </div>
              <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-wider max-w-xs text-center">
                Search the public web for entities, organizations, properties, and programs.
                Ingest results directly into the Document Vault.
              </div>
            </div>
            <div className="space-y-1 font-mono text-[9px] text-neutral-800 uppercase">
              <div className="flex items-center gap-2">
                <ChevronRight className="w-2.5 h-2.5 text-cyan-900" />
                SEARCH → results appear below
              </div>
              <div className="flex items-center gap-2">
                <ChevronRight className="w-2.5 h-2.5 text-cyan-900" />
                INGEST → saves to Document Vault
              </div>
              <div className="flex items-center gap-2">
                <ChevronRight className="w-2.5 h-2.5 text-cyan-900" />
                AUTO-ANALYSIS → extracts entities immediately
              </div>
            </div>
          </div>
        )}

        {!searching && results.length > 0 && (
          <div>
            <div className="flex bg-[#ffffff04] border-b border-[#ffffff06] px-4 py-1.5 font-mono text-[9px] text-neutral-700 uppercase tracking-widest sticky top-0 z-10">
              <div className="flex-1">SOURCE / TITLE</div>
              <div className="w-52 text-right">{results.length} RESULTS</div>
            </div>
            {results.map((result) => (
              <ResultRow
                key={result.url}
                result={result}
                ingestStatus={ingestState[result.url]}
                ingestResult={ingestResults[result.url]}
                onIngest={() => handleIngest(result)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({
  result,
  ingestStatus,
  ingestResult,
  onIngest,
}: {
  result: SearchResult;
  ingestStatus?: "ingesting" | "done" | "error";
  ingestResult?: { mentionsCreated: number };
  onIngest: () => void;
}) {
  const isDone = ingestStatus === "done";
  const isIngesting = ingestStatus === "ingesting";
  const isError = ingestStatus === "error";

  return (
    <div
      className={cn(
        "border-b border-[#ffffff06] px-4 py-3 transition-all",
        isDone ? "bg-[#00ff6408] border-l-2 border-l-green-700" : "border-l-2 border-l-transparent hover:bg-[#ffffff03]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className="mt-0.5 flex-shrink-0">
          {result.contentType === "pdf" ? (
            <div className="w-7 h-7 border border-red-500/30 bg-red-500/5 flex items-center justify-center">
              <span className="font-mono text-[7px] text-red-500">PDF</span>
            </div>
          ) : (
            <div className="w-7 h-7 border border-[#ffffff0d] bg-[#000] flex items-center justify-center">
              <Globe className="w-3.5 h-3.5 text-neutral-700" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-sm font-semibold text-white uppercase leading-tight tracking-tight line-clamp-2">
            {result.title}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[9px] text-cyan-700 uppercase tracking-wider">
              {result.sourceDomain}
            </span>
            {result.publishDate && (
              <>
                <span className="text-[#ffffff12]">·</span>
                <span className="font-mono text-[9px] text-neutral-700 uppercase">
                  {formatPubDate(result.publishDate)}
                </span>
              </>
            )}
            <span className="text-[#ffffff12]">·</span>
            <span
              className={cn(
                "font-mono text-[8px] px-1.5 py-0.5 border uppercase",
                result.contentType === "pdf"
                  ? "text-red-500 border-red-500/30"
                  : "text-neutral-600 border-[#ffffff0d]"
              )}
            >
              {result.contentType === "pdf" ? "PDF" : "ARTICLE"}
            </span>
          </div>
          {result.snippet && (
            <p className="font-mono text-[9px] text-neutral-600 leading-relaxed line-clamp-2">
              {result.snippet}
            </p>
          )}

          {/* Ingest success feedback */}
          {isDone && ingestResult && (
            <div className="flex items-center gap-1.5 font-mono text-[9px] text-green-600">
              <CheckCircle2 className="w-3 h-3" />
              INGESTED TO VAULT
              {ingestResult.mentionsCreated > 0 && (
                <span className="text-amber-600 ml-1 flex items-center gap-1">
                  <Cpu className="w-2.5 h-2.5" />
                  {ingestResult.mentionsCreated} ENTITIES DETECTED
                </span>
              )}
            </div>
          )}
          {isError && (
            <div className="flex items-center gap-1.5 font-mono text-[9px] text-red-600">
              <AlertTriangle className="w-3 h-3" />
              INGEST FAILED — RETRY
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
          {!isDone && (
            <button
              onClick={onIngest}
              disabled={isIngesting}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 border font-mono text-[9px] uppercase tracking-widest transition-colors",
                isIngesting
                  ? "border-neutral-800 text-neutral-700 cursor-not-allowed"
                  : isError
                    ? "border-red-500/40 text-red-500 hover:bg-red-500/10"
                    : "border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500/70"
              )}
            >
              {isIngesting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {isIngesting ? "..." : isError ? "RETRY" : "INGEST"}
            </button>
          )}

          {isDone && (
            <span className="flex items-center gap-1 px-2 py-1.5 border border-green-700/40 font-mono text-[9px] text-green-700 uppercase tracking-widest">
              <CheckCircle2 className="w-3 h-3" />
              INGESTED
            </span>
          )}

          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1.5 border border-[#ffffff0d] text-neutral-600 hover:text-white hover:border-neutral-600 font-mono text-[9px] uppercase tracking-widest transition-colors"
            title="Open source in new tab"
          >
            <ExternalLink className="w-3 h-3" />
            SOURCE
          </a>

          {result.contentType === "pdf" && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-neutral-700 hover:text-white transition-colors"
              title="Download PDF"
            >
              <FileText className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function formatPubDate(pubDate: string): string {
  if (!pubDate) return "";
  try {
    const d = new Date(pubDate);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return pubDate.split(",")[0] || pubDate;
  }
}
