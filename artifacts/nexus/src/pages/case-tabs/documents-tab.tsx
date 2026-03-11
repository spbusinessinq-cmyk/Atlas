import React, { useState } from "react";
import { useUploadDocument, Document } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { FileText, Upload, Download, Calendar } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function DocumentsTab({ caseId, documents }: { caseId: number, documents: Document[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-mono text-muted-foreground text-sm">ATTACHED EVIDENCE FILES</h3>
        <UploadDocumentDialog caseId={caseId} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {documents.length === 0 ? (
           <div className="col-span-full py-12 text-center border border-dashed border-border rounded-lg text-muted-foreground font-mono">
             NO EVIDENCE ATTACHED
           </div>
        ) : documents.map((doc) => (
          <div key={doc.id} className="p-4 border border-border bg-card rounded-lg hover:border-primary/50 transition-colors group relative overflow-hidden">
            <div className="absolute right-0 top-0 w-16 h-16 bg-primary/5 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-150" />
            <div className="flex items-start gap-3">
              <div className="p-2 bg-secondary rounded-md text-primary">
                <FileText className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-sm truncate" title={doc.title}>{doc.title}</h4>
                <div className="text-xs font-mono text-muted-foreground mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {formatDate(doc.uploadedAt).split(',')[0]}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-1 truncate">
                  SRC: {doc.source || 'UNKNOWN'}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border flex justify-between items-center">
              <span className="font-mono text-xs text-muted-foreground">ID:{doc.id}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs font-mono group-hover:text-primary">
                <Download className="w-3 h-3 mr-2" /> FETCH
              </Button>
            </div>
          </div>
        ))}
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
        <Button className="bg-primary text-primary-foreground font-mono text-sm gap-2">
          <Upload className="w-4 h-4" /> SECURE_UPLOAD
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono">UPLOAD EVIDENCE</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs">File Selection</Label>
            <Input type="file" name="file" required className="bg-input font-mono text-muted-foreground file:text-foreground file:bg-secondary file:border-0 file:mr-4 file:py-1 file:px-3 file:rounded-sm" />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs">Document Title</Label>
            <Input name="title" required className="bg-input font-mono" placeholder="e.g. Bank_Statement_Q3.pdf" />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs">Intelligence Source</Label>
            <Input name="source" className="bg-input font-mono" placeholder="e.g. Subpoena, Open Source" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={uploadMutation.isPending} className="bg-primary text-primary-foreground font-mono w-full">
              {uploadMutation.isPending ? "UPLOADING..." : "TRANSMIT"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
