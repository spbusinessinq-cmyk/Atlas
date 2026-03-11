import React, { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useListCases, useCreateCase, CaseStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Briefcase, ChevronRight, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

export default function Dashboard() {
  const { data: cases, isLoading } = useListCases();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const statusColors: Record<CaseStatus, string> = {
    open: "border-blue-500/50 text-blue-500 before:bg-blue-500",
    active: "border-red-600/50 text-red-600 before:bg-red-600",
    closed: "border-neutral-500/50 text-neutral-500 before:bg-neutral-500",
    archived: "border-amber-500/50 text-amber-500 before:bg-amber-500"
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#ffffff0d] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white uppercase">ACTIVE DOSSIERS</h1>
          <p className="text-neutral-500 tracking-widest text-[10px] font-mono mt-1 uppercase">CASE CONTROL</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-[#0d1117] rounded-none p-1 border border-[#ffffff0d]">
            <button 
              className={`p-1.5 ${viewMode === "grid" ? "bg-[#ffffff10] text-white" : "text-neutral-500 hover:text-white"}`}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button 
              className={`p-1.5 ${viewMode === "list" ? "bg-[#ffffff10] text-white" : "text-neutral-500 hover:text-white"}`}
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <CreateCaseDialog />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <div key={i} className="h-64 animate-pulse bg-[#0d1117] border border-[#ffffff0d]" />
          ))}
        </div>
      ) : (
        <motion.div 
          className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "space-y-4"}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {cases?.map((c) => (
            <Link key={c.id} href={`/cases/${c.id}`}>
              <div className={`group cursor-pointer nexus-card flex flex-col hover:border-[#dc262640] transition-all duration-300 relative ${viewMode === 'list' ? 'flex-row items-stretch' : 'h-full'}`}>
                {/* Top strip */}
                <div className="nexus-header-strip">
                  <div className={`font-mono text-[10px] uppercase tracking-wider flex items-center gap-1.5 ${statusColors[c.status].split(' ')[1]}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${statusColors[c.status].split(' ')[2].replace('before:bg-', 'bg-')}`} />
                    {c.status}
                  </div>
                  <div className="font-mono text-[11px] text-neutral-500">
                    CASE-{c.id.toString().padStart(6, '0')} // {formatDate(c.updatedAt).split(',')[0]}
                  </div>
                </div>
                
                <div className={`p-4 flex-1 flex flex-col ${viewMode === 'list' ? 'flex-row items-center gap-6' : ''}`}>
                  <div className={viewMode === 'list' ? 'flex-1' : ''}>
                    <h3 className="text-lg font-bold text-white mb-2 group-hover:text-red-500 transition-colors uppercase">{c.title}</h3>
                    <p className="text-sm text-neutral-400 line-clamp-2 leading-relaxed">
                      {c.description || "No classification brief provided."}
                    </p>
                  </div>
                  
                  <div className={`flex flex-wrap gap-2 ${viewMode === 'list' ? 'w-48' : 'mt-4'}`}>
                    {c.tags?.slice(0, 3).map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 border border-[#ffffff10] text-[10px] font-mono text-neutral-400 uppercase bg-[#00000050]">
                        {tag}
                      </span>
                    ))}
                    {(c.tags?.length || 0) > 3 && (
                      <span className="px-1.5 py-0.5 border border-[#ffffff10] text-[10px] font-mono text-neutral-400 bg-[#00000050]">
                        +{(c.tags?.length || 0) - 3}
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Bottom strip */}
                <div className="bg-[#ffffff02] border-t border-[#ffffff0d] px-3 py-2 flex items-center justify-between mt-auto">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-500">
                    <span>ENT: N/A</span>
                    <span className="text-[#ffffff20]">|</span>
                    <span>DOC: N/A</span>
                    <span className="text-[#ffffff20]">|</span>
                    <span>TIMELINE: N/A</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-red-500 transition-colors group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </motion.div>
      )}
    </div>
  );
}

function CreateCaseDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createMutation = useCreateCase({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        setOpen(false);
      }
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      data: {
        title: fd.get("title") as string,
        description: fd.get("description") as string,
        status: fd.get("status") as CaseStatus,
        tags: (fd.get("tags") as string).split(",").map(t => t.trim()).filter(Boolean)
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-red-600 hover:bg-red-700 text-white rounded-none h-8 px-4 font-mono text-[11px] uppercase tracking-wider gap-2">
          <Plus className="w-3 h-3" /> NEW CASE
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border border-[#ffffff1a] bg-[#0d1117] rounded-none p-0">
        <div className="nexus-header-strip">
          <span className="nexus-label flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            INITIALIZE NEW CASE
          </span>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="title" className="nexus-label">Designation</Label>
            <Input id="title" name="title" required className="font-mono bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 nexus-glow-focus text-sm" placeholder="e.g. OP-CRIMSON-TIDE" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description" className="nexus-label">Briefing / Objective</Label>
            <Textarea id="description" name="description" className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 nexus-glow-focus min-h-[100px] text-sm" placeholder="Detailed case objectives..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="status" className="nexus-label">Initial Status</Label>
              <Select name="status" defaultValue="open">
                <SelectTrigger className="bg-[#000] border-[#ffffff1a] rounded-none font-mono focus:ring-0 focus:border-red-500 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-[#ffffff1a] rounded-none font-mono">
                  <SelectItem value="open">OPEN</SelectItem>
                  <SelectItem value="active">ACTIVE</SelectItem>
                  <SelectItem value="closed">CLOSED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags" className="nexus-label">Tags (comma separated)</Label>
              <Input id="tags" name="tags" className="bg-[#000] border-[#ffffff1a] rounded-none font-mono text-sm focus-visible:ring-0 focus-visible:border-red-500" placeholder="fraud, cysec, target-x" />
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-2 border-t border-[#ffffff0d] mt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="rounded-none font-mono text-[11px] text-neutral-400 hover:text-white hover:bg-[#ffffff05]">CANCEL</Button>
            <Button type="submit" disabled={createMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[11px]">
              {createMutation.isPending ? "INITIALIZING..." : "CONFIRM INIT"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
