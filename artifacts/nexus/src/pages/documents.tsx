import React from "react";
import { useListDocuments } from "@workspace/api-client-react";
import { FileText, Search, Download, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export default function DocumentLibrary() {
  const { data: documents, isLoading } = useListDocuments();
  const [search, setSearch] = React.useState("");

  const filtered = documents?.filter(d => d.title.toLowerCase().includes(search.toLowerCase())) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            Secure Evidence Vault
          </h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">INDEXED FILES: {documents?.length || 0}</p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search filenames..." 
            className="pl-9 font-mono bg-card border-border h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center font-mono text-primary animate-pulse">ACCESSING VAULT...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map(doc => (
            <div key={doc.id} className="bg-card border border-border p-4 rounded-lg flex flex-col justify-between hover:border-primary/50 transition-colors group">
              <div>
                <div className="w-10 h-10 bg-secondary rounded-md flex items-center justify-center text-primary mb-3">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm mb-2 line-clamp-2" title={doc.title}>{doc.title}</h3>
                <div className="text-xs text-muted-foreground font-mono space-y-1">
                  <div className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {formatDate(doc.uploadedAt).split(',')[0]}</div>
                  <div>SRC: {doc.source || 'UNKNOWN'}</div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border flex justify-between items-center">
                <span className="font-mono text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">OP_{doc.caseId?.toString().padStart(4, '0') || 'NONE'}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground group-hover:text-primary">
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground font-mono border border-dashed border-border rounded-lg">
              NO FILES MATCH QUERY
            </div>
          )}
        </div>
      )}
    </div>
  );
}
