import React from "react";
import { useListEntities } from "@workspace/api-client-react";
import { Search } from "lucide-react";
import { Link } from "wouter";
import { formatDate } from "@/lib/utils";

export default function EntityList() {
  const { data: entities, isLoading } = useListEntities();
  const [search, setSearch] = React.useState("");

  const filtered = entities?.filter(e => e.name.toLowerCase().includes(search.toLowerCase())) || [];

  const typeColors: Record<string, string> = {
    person: "text-cyan-500 border-cyan-500/30 bg-cyan-500/10",
    organization: "text-amber-500 border-amber-500/30 bg-amber-500/10",
    company: "text-green-500 border-green-500/30 bg-green-500/10",
    government_agency: "text-red-500 border-red-500/30 bg-red-500/10",
    location: "text-purple-500 border-purple-500/30 bg-purple-500/10",
    event: "text-blue-500 border-blue-500/30 bg-blue-500/10",
    other: "text-neutral-400 border-neutral-500/30 bg-neutral-500/10"
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white uppercase">ENTITY REGISTRY</h1>
        <p className="text-neutral-500 tracking-widest text-[10px] font-mono mt-1 uppercase">// CLASSIFIED SUBJECTS & ORGANIZATIONS</p>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="relative w-full max-w-md">
          <input 
            type="text"
            placeholder="SEARCH REGISTRY..." 
            className="w-full bg-[#000] border border-[#ffffff1a] h-8 pl-8 pr-3 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-red-500 focus:ring-0 transition-colors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        </div>
      </div>

      <div className="border border-[#ffffff0d] bg-[#080a0d]">
        <div className="flex bg-[#ffffff05] border-b border-[#ffffff0d] px-4 py-2 font-mono text-[10px] text-neutral-500 uppercase tracking-widest">
          <div className="w-32">TYPE</div>
          <div className="flex-1">NAME</div>
          <div className="w-32 hidden sm:block">CASE</div>
          <div className="w-32 hidden md:block">CREATED</div>
          <div className="w-16 text-right">→</div>
        </div>
        
        <div className="divide-y divide-[#ffffff05]">
          {isLoading ? (
            <div className="p-8 text-center font-mono text-red-500 text-sm animate-pulse uppercase">QUERYING MAINFRAME...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center font-mono text-neutral-500 text-sm uppercase">NO MATCHING RECORDS</div>
          ) : (
            filtered.map(entity => (
              <Link key={entity.id} href={`/entities/${entity.id}`}>
                <div className="flex px-4 py-3 items-center hover:bg-[#ffffff05] cursor-pointer transition-colors group">
                  <div className="w-32">
                    <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 border ${typeColors[entity.type] || typeColors.other}`}>
                      {entity.type.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex-1 font-medium text-sm text-white group-hover:text-red-400 transition-colors">
                    {entity.name}
                  </div>
                  <div className="w-32 hidden sm:block font-mono text-[10px] text-neutral-500">
                    {entity.caseId ? `CASE-${entity.caseId.toString().padStart(4, '0')}` : 'UNLINKED'}
                  </div>
                  <div className="w-32 hidden md:block font-mono text-[10px] text-neutral-500">
                    {formatDate(entity.createdAt).split(',')[0]}
                  </div>
                  <div className="w-16 text-right text-neutral-600 group-hover:text-red-500 font-mono text-xs">
                    ACCESS
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
