import React from "react";
import { useListDocuments } from "@workspace/api-client-react";
import { Search } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function DocumentLibrary() {
  const { data: documents, isLoading } = useListDocuments();
  const [search, setSearch] = React.useState("");

  const filtered = documents?.filter(d => d.title.toLowerCase().includes(search.toLowerCase())) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white uppercase">DOCUMENT VAULT</h1>
          <p className="text-neutral-500 tracking-widest text-[10px] font-mono mt-1 uppercase">// EVIDENCE & INTELLIGENCE FILES</p>
        </div>
        <button className="bg-red-600 hover:bg-red-700 text-white font-mono text-[11px] px-4 py-2 uppercase tracking-wider">
          INGEST DOCUMENT
        </button>
      </div>

      <div className="relative w-full max-w-md mb-4">
        <input 
          type="text"
          placeholder="SEARCH FILENAMES..." 
          className="w-full bg-[#000] border border-[#ffffff1a] h-8 pl-8 pr-3 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-500 focus:ring-0 transition-colors"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Search className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
      </div>

      <div className="border border-[#ffffff0d] bg-[#080a0d]">
        <div className="flex bg-[#ffffff05] border-b border-[#ffffff0d] px-4 py-2 font-mono text-[10px] text-neutral-500 uppercase tracking-widest">
          <div className="w-8"></div>
          <div className="flex-1">FILENAME</div>
          <div className="w-48 hidden md:block">SOURCE</div>
          <div className="w-32 hidden sm:block text-right">CASE</div>
          <div className="w-32 text-right">INGEST DATE</div>
        </div>
        
        <div className="divide-y divide-[#ffffff05]">
          {isLoading ? (
             <div className="p-8 text-center font-mono text-red-500 text-sm animate-pulse uppercase">ACCESSING VAULT...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center font-mono text-neutral-500 text-sm uppercase">NO FILES MATCH QUERY</div>
          ) : (
            filtered.map(doc => (
              <div key={doc.id} className="flex px-4 py-3 items-center hover:bg-[#ffffff04] transition-colors group">
                <div className="w-8 flex items-center justify-center">
                  <div className="w-4 h-4 border border-red-500/30 bg-red-500/10 flex items-center justify-center text-[8px] font-mono text-red-500">
                    PDF
                  </div>
                </div>
                <div className="flex-1 font-medium text-sm text-white px-2 truncate">
                  {doc.title}
                </div>
                <div className="w-48 hidden md:block font-mono text-[10px] text-neutral-400 truncate pr-4">
                  {doc.source || 'UNKNOWN'}
                </div>
                <div className="w-32 hidden sm:block font-mono text-[10px] text-cyan-500 text-right pr-4">
                  {doc.caseId ? `OP_${doc.caseId.toString().padStart(4, '0')}` : 'UNLINKED'}
                </div>
                <div className="w-32 font-mono text-[10px] text-neutral-500 text-right">
                  {formatDate(doc.uploadedAt).split(',')[0]}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
