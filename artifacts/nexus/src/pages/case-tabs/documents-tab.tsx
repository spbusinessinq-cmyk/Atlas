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
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Upload, Download, Cpu, CheckCircle2, XCircle, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
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

export default function DocumentsTab({ caseId, documents }: { caseId: number; documents: Document[] }) {
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null);

  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip">
        <span className="nexus-label">DOCUMENT VAULT</span>
        <UploadDocumentDialog caseId={caseId} />
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-1">
          {documents.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-[#ffffff1a] bg-[#000] text-neutral-500 font-mono text-sm uppercase tracking-widest">
              NO EVIDENCE ATTACHED
            </div>
          ) : (
            documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                caseId={caseId}
                expanded={expandedDocId === doc.id}
                onToggle={() =>
                  setExpandedDocId(expandedDocId === doc.id ? null : doc.id)
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  caseId,
  expanded,
  onToggle,
}: {
  doc: Document;
  caseId: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const analyzeMutation = useAnalyzeDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/entity-mentions`] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      },
    },
  });

  const { data: mentionsData } = useListEntityMentions({
    documentId: doc.id,
    status: "pending",
  });
  const mentions = mentionsData || [];

  const isAnalyzing = analyzeMutation.isPending;

  return (
    <div className="border border-[#ffffff0d] bg-[#0a0e14] hover:border-red-500/20 transition-colors">
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggle}
            className="text-neutral-600 hover:text-white transition-colors flex-shrink-0"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
          <div className="w-7 h-7 flex-shrink-0 bg-[#000] border border-[#ffffff1a] flex items-center justify-center">
            <span className="text-[7px] font-mono text-red-500">DOC</span>
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-xs text-white truncate uppercase" title={doc.title}>
              {doc.title}
            </h4>
            <div className="flex items-center gap-3 text-[10px] font-mono text-neutral-500 mt-0.5 uppercase tracking-widest">
              <span>{formatDate(doc.uploadedAt).split(",")[0]}</span>
              <span className="w-px h-2 bg-[#ffffff1a]" />
              <span className="truncate">SRC: {doc.source || "UNKNOWN"}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pl-3 border-l border-[#ffffff0d] ml-3 flex-shrink-0">
          <span className="font-mono text-[9px] text-neutral-600 hidden sm:block">
            ID:{doc.id}
          </span>
          {doc.filePath && (
            <a
              href={doc.filePath}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-500 hover:text-red-500 transition-colors"
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              analyzeMutation.mutate({ id: doc.id });
              if (!expanded) onToggle();
            }}
            disabled={isAnalyzing}
            className={cn(
              "flex items-center gap-1 px-2 py-1 border font-mono text-[9px] uppercase tracking-widest transition-colors",
              isAnalyzing
                ? "border-neutral-700 text-neutral-600 cursor-not-allowed"
                : "border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 hover:border-cyan-500"
            )}
            title="Run entity extraction"
          >
            <Cpu className="w-3 h-3" />
            {isAnalyzing ? "SCANNING..." : "ANALYZE"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#ffffff0d] bg-[#060a0e]">
          {analyzeMutation.isSuccess && analyzeMutation.data && (
            <div className="px-4 py-2 border-b border-[#ffffff0d] flex items-center gap-2 text-[10px] font-mono text-cyan-400">
              <Cpu className="w-3 h-3" />
              ATLAS EXTRACTION COMPLETE — {analyzeMutation.data.mentionsCreated} ENTITIES DETECTED
              <span className="text-neutral-600 ml-2">
                ({analyzeMutation.data.textLength.toLocaleString()} chars via {analyzeMutation.data.extractionMethod})
              </span>
            </div>
          )}
          {analyzeMutation.isError && (
            <div className="px-4 py-2 border-b border-[#ffffff0d] flex items-center gap-2 text-[10px] font-mono text-red-400">
              <AlertCircle className="w-3 h-3" />
              EXTRACTION FAILED
            </div>
          )}

          <EntityMentionList mentions={mentions} caseId={caseId} documentId={doc.id} />
        </div>
      )}
    </div>
  );
}

function EntityMentionList({
  mentions,
  caseId,
  documentId,
}: {
  mentions: EntityMention[];
  caseId: number;
  documentId: number;
}) {
  const queryClient = useQueryClient();

  const approveMutation = useApproveEntityMention({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/entity-mentions`] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      },
    },
  });
  const rejectMutation = useRejectEntityMention({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/entity-mentions`] });
      },
    },
  });

  if (mentions.length === 0) {
    return (
      <div className="px-4 py-6 text-center font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
        NO PENDING DETECTIONS — RUN ANALYZE TO EXTRACT ENTITIES
      </div>
    );
  }

  return (
    <div className="p-3 space-y-1">
      <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
        <span className="text-cyan-500">ATLAS</span>
        <span className="w-px h-3 bg-[#ffffff1a]" />
        <span>{mentions.length} PENDING DETECTIONS — REVIEW &amp; TRIAGE</span>
      </div>
      {mentions.map((m) => (
        <MentionCard
          key={m.id}
          mention={m}
          caseId={caseId}
          onApprove={() =>
            approveMutation.mutate({ id: m.id, data: { caseId } })
          }
          onReject={() => rejectMutation.mutate({ id: m.id })}
          isApproving={approveMutation.isPending && approveMutation.variables?.id === m.id}
          isRejecting={rejectMutation.isPending && rejectMutation.variables?.id === m.id}
        />
      ))}
    </div>
  );
}

function MentionCard({
  mention,
  caseId,
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
  const colorClass = ENTITY_TYPE_COLORS[mention.entityType] || "text-neutral-400 border-neutral-400/40 bg-neutral-400/5";
  const confidencePct = Math.round((mention.confidence || 0) * 100);

  return (
    <div className="flex items-start gap-3 p-2 border border-[#ffffff08] bg-[#070b10] hover:border-[#ffffff18] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-xs text-white font-mono uppercase">{mention.entityName}</span>
          <span className={cn("text-[9px] font-mono px-1.5 py-0.5 border uppercase tracking-wider", colorClass)}>
            {mention.entityType.replace(/_/g, " ")}
          </span>
          <span className="text-[9px] font-mono text-neutral-600">
            CONF: {confidencePct}%
          </span>
        </div>
        {mention.context && (
          <p className="text-[10px] text-neutral-500 font-mono mt-1 truncate" title={mention.context}>
            &ldquo;{mention.context}&rdquo;
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onApprove}
          disabled={isApproving || isRejecting}
          className="flex items-center gap-1 px-2 py-1 border border-green-500/40 text-green-500 hover:bg-green-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          title="Add to Entity Registry"
        >
          <CheckCircle2 className="w-3 h-3" />
          {isApproving ? "..." : "INGEST"}
        </button>
        <button
          onClick={onReject}
          disabled={isApproving || isRejecting}
          className="flex items-center gap-1 px-2 py-1 border border-red-500/40 text-red-500 hover:bg-red-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          title="Reject detection"
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
        <div className="nexus-header-strip">
          <span className="nexus-label">UPLOAD EVIDENCE</span>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1">
            <Label className="nexus-label">File Selection</Label>
            <div className="relative">
              <Input
                type="file"
                name="file"
                required
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-full h-24 border border-dashed border-[#ffffff1a] bg-[#000] flex flex-col items-center justify-center text-neutral-500">
                <Upload className="w-5 h-5 mb-2 opacity-50" />
                <span className="font-mono text-[10px] uppercase tracking-widest">
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
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono"
              placeholder="e.g. Bank_Statement_Q3.pdf"
            />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Intelligence Source</Label>
            <Input
              name="source"
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono"
              placeholder="e.g. Subpoena, Open Source"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-[#ffffff0d] mt-4">
            <Button
              type="submit"
              disabled={uploadMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[11px] w-full uppercase tracking-widest"
            >
              {uploadMutation.isPending ? "UPLOADING..." : "TRANSMIT"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
