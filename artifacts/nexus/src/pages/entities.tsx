import React from "react";
import { useListEntities } from "@workspace/api-client-react";
import { Search } from "lucide-react";
import { Link } from "wouter";
import { formatDate } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  person: "text-cyan-500 border-cyan-500/30",
  organization: "text-amber-500 border-amber-500/30",
  company: "text-green-500 border-green-500/30",
  government_agency: "text-red-500 border-red-500/30",
  location: "text-purple-500 border-purple-500/30",
  event: "text-blue-500 border-blue-500/30",
  other: "text-neutral-500 border-neutral-500/30",
};

export default function EntityList() {
  const { data: entities, isLoading } = useListEntities();
  const [search, setSearch] = React.useState("");

  const filtered =
    entities?.filter((e) =>
      e.name.toLowerCase().includes(search.toLowerCase())
    ) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-3">
      <div className="border-b border-[#ffffff0d] pb-3">
        <h1 className="text-xl font-bold tracking-tight text-white uppercase">
          ENTITY REGISTRY
        </h1>
        <p className="text-neutral-600 tracking-widest text-[9px] font-mono mt-0.5 uppercase">
          ATLAS // CLASSIFIED SUBJECTS &amp; ORGANIZATIONS
        </p>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            placeholder="SEARCH REGISTRY..."
            className="w-full bg-[#000] border border-[#ffffff0d] h-7 pl-7 pr-3 text-[10px] font-mono text-white placeholder:text-neutral-700 focus:outline-none focus:border-red-500 focus:ring-0 transition-colors uppercase"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-700" />
        </div>
        {!isLoading && (
          <span className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest whitespace-nowrap">
            {filtered.length} RECORDS
          </span>
        )}
      </div>

      <div className="border border-[#ffffff0d] bg-[#080a0d]">
        <div className="flex bg-[#ffffff03] border-b border-[#ffffff0d] px-4 py-1.5 font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
          <div className="w-32">TYPE</div>
          <div className="flex-1">NAME</div>
          <div className="w-28 hidden sm:block">CASE</div>
          <div className="w-28 hidden md:block">REGISTERED</div>
          <div className="w-16 text-right">→</div>
        </div>

        <div className="divide-y divide-[#ffffff04]">
          {isLoading ? (
            <div className="p-8 text-center font-mono text-[10px] text-red-500 animate-pulse uppercase tracking-widest">
              QUERYING REGISTRY...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
                {search ? "NO RECORDS MATCH QUERY" : "NO REGISTERED ENTITIES"}
              </div>
              {!search && (
                <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest mt-1">
                  Add entities from a case to populate the registry
                </div>
              )}
            </div>
          ) : (
            filtered.map((entity) => (
              <Link key={entity.id} href={`/entities/${entity.id}`}>
                <div className="flex px-4 py-2.5 items-center hover:bg-[#ffffff03] cursor-pointer transition-colors group">
                  <div className="w-32">
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 border bg-black ${
                        TYPE_COLORS[entity.type] || TYPE_COLORS.other
                      }`}
                    >
                      {entity.type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="flex-1 font-medium text-sm text-white group-hover:text-red-400 transition-colors uppercase truncate">
                    {entity.name}
                  </div>
                  <div className="w-28 hidden sm:block font-mono text-[9px] text-neutral-600">
                    {entity.caseId
                      ? `CASE-${entity.caseId.toString().padStart(4, "0")}`
                      : "UNLINKED"}
                  </div>
                  <div className="w-28 hidden md:block font-mono text-[9px] text-neutral-600">
                    {formatDate(entity.createdAt).split(",")[0]}
                  </div>
                  <div className="w-16 text-right text-neutral-700 group-hover:text-red-500 font-mono text-[9px] uppercase">
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
