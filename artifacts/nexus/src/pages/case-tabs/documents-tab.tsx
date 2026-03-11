import React, { useState } from "react";
import { useUploadDocument, Document } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Upload, Download } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function DocumentsTab({ caseId, documents }: { caseId: number, documents: Document[] }) {
  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip">
        <span className="nexus-label">DOCUMENT VAULT</span>
        <UploadDocumentDialog caseId={caseId} />
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {documents.length === 0 ? (
             <div className="py-12 text-center border border-dashed border-[#ffffff1a] bg-[#000] text-neutral-500 font-mono text-sm uppercase tracking-widest">
               NO EVIDENCE ATTACHED
             </div>
          ) : documents.map((doc) => (
            <div key={doc.id} className="p-3 border border-[#ffffff0d] bg-[#111820] hover:border-red-500/30 transition-colors group flex items-center justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-8 h-8 flex-shrink-0 bg-[#000] border border-[#ffffff1a] flex items-center justify-center">
                  <span className="text-[8px] font-mono text-red-500">PDF</span>
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-white truncate uppercase" title={doc.title}>{doc.title}</h4>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-neutral-500 mt-1 uppercase tracking-widest">
                    <span>{formatDate(doc.uploadedAt).split(',')[0]}</span>
                    <span className="w-px h-2 bg-[#ffffff1a]" />
                    <span className="truncate">SRC: {doc.source || 'UNKNOWN'}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 pl-4 border-l border-[#ffffff0d] ml-4">
                <span className="font-mono text-[10px] text-neutral-600 hidden sm:block">ID:{doc.id}</span>
                <button className="text-neutral-500 hover:text-red-500 transition-colors">
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
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
      }
    }
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
      }
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
        <div className="nexus-header-strip">
          <span className="nexus-label">UPLOAD EVIDENCE</span>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1">
            <Label className="nexus-label">File Selection</Label>
            <div className="relative">
              <Input type="file" name="file" required className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="w-full h-24 border border-dashed border-[#ffffff1a] bg-[#000] flex flex-col items-center justify-center text-neutral-500 group-hover:border-red-500/50 transition-colors">
                <Upload className="w-5 h-5 mb-2 opacity-50" />
                <span className="font-mono text-[10px] uppercase tracking-widest">DRAG & DROP OR BROWSE</span>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Document Title</Label>
            <Input name="title" required className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono" placeholder="e.g. Bank_Statement_Q3.pdf" />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Intelligence Source</Label>
            <Input name="source" className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono" placeholder="e.g. Subpoena, Open Source" />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-[#ffffff0d] mt-4">
            <Button type="submit" disabled={uploadMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[11px] w-full uppercase tracking-widest">
              {uploadMutation.isPending ? "UPLOADING..." : "TRANSMIT"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
