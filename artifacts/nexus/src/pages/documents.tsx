import React from "react";
import { useListDocuments } from "@workspace/api-client-react";
import { Search, FileText } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function DocumentLibrary() {
  const { data: documents, isLoading } = useListDocuments();
  const [search, setSearch] = React.useState("");

  const filtered =
    documents?.filter((d) =>
      d.title.toLowerCase().includes(search.toLowerCase())
    ) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-3">
      <div className="border-b border-[#ffffff0d] pb-3">
        <h1 className="text-xl font-bold tracking-tight text-white uppercase">
          DOCUMENT VAULT
        </h1>
        <p className="text-neutral-600 tracking-widest text-[9px] font-mono mt-0.5 uppercase">
          ATLAS // EVIDENCE &amp; INTELLIGENCE FILES
        </p>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            placeholder="SEARCH FILENAMES..."
            className="w-full bg-[#000] border border-[#ffffff0d] h-7 pl-7 pr-3 text-[10px] font-mono text-white placeholder:text-neutral-700 focus:outline-none focus:border-red-500 focus:ring-0 transition-colors uppercase"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-700" />
        </div>
        {!isLoading && (
          <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest whitespace-nowrap">
            {filtered.length} FILES
          </span>
        )}
      </div>

      <div className="border border-[#ffffff0d] bg-[#080a0d]">
        <div className="flex bg-[#ffffff03] border-b border-[#ffffff0d] px-4 py-1.5 font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
          <div className="w-8" />
          <div className="flex-1">FILENAME</div>
          <div className="w-44 hidden md:block">SOURCE</div>
          <div className="w-28 hidden sm:block text-right pr-4">CASE</div>
          <div className="w-28 text-right">INGEST DATE</div>
        </div>

        <div className="divide-y divide-[#ffffff04]">
          {isLoading ? (
            <div className="p-8 text-center font-mono text-[10px] text-red-500 animate-pulse uppercase tracking-widest">
              ACCESSING VAULT...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-6 h-6 text-neutral-800 mx-auto mb-3" />
              <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
                {search ? "NO FILES MATCH QUERY" : "NO DOCUMENTS INGESTED"}
              </div>
              {!search && (
                <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest mt-1">
                  Upload source material to begin analysis
                </div>
              )}
            </div>
          ) : (
            filtered.map((doc) => (
              <div
                key={doc.id}
                className="flex px-4 py-2 items-center hover:bg-[#ffffff03] transition-colors group"
              >
                <div className="w-8 flex items-center">
                  <div className="w-5 h-5 border border-red-500/20 bg-red-500/5 flex items-center justify-center text-[7px] font-mono text-red-600">
                    DOC
                  </div>
                </div>
                <div className="flex-1 font-medium text-xs text-white px-2 truncate uppercase">
                  {doc.title}
                </div>
                <div className="w-44 hidden md:block font-mono text-[9px] text-neutral-600 truncate pr-4">
                  {doc.source || "UNKNOWN SOURCE"}
                </div>
                <div className="w-28 hidden sm:block font-mono text-[9px] text-neutral-600 text-right pr-4">
                  {doc.caseId
                    ? `CASE-${doc.caseId.toString().padStart(4, "0")}`
                    : "UNLINKED"}
                </div>
                <div className="w-28 font-mono text-[9px] text-neutral-600 text-right">
                  {formatDate(doc.uploadedAt).split(",")[0]}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
