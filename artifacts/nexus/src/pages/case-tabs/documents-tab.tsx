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
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Upload,
  Download,
  Cpu,
  CheckCircle2,
  XCircle,
  FileText,
  X,
  AlertCircle,
} from "lucide-react";
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

interface DocumentsTabProps {
  caseId: number;
  documents: Document[];
  selectedDocId?: number | null;
  onDocumentSelect?: (doc: Document | null) => void;
}

export default function DocumentsTab({
  caseId,
  documents,
  selectedDocId,
  onDocumentSelect,
}: DocumentsTabProps) {
  return (
    <div className="nexus-panel rounded-none h-full flex flex-col">
      <div className="nexus-header-strip">
        <span className="nexus-label">DOCUMENT VAULT — {documents.length} FILES</span>
        <UploadDocumentDialog caseId={caseId} />
      </div>

      <div className="flex-1 overflow-auto">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
            <FileText className="w-6 h-6 text-neutral-800" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO EVIDENCE ATTACHED
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-widest">
              Use INGEST to upload documents
            </div>
          </div>
        ) : (
          documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              caseId={caseId}
              isSelected={selectedDocId === doc.id}
              onSelect={() =>
                onDocumentSelect?.(selectedDocId === doc.id ? null : doc)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  caseId,
  isSelected,
  onSelect,
}: {
  doc: Document;
  caseId: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const queryClient = useQueryClient();
  const analyzeMutation = useAnalyzeDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        onSelect();
      },
    },
  });

  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 border-b border-[#ffffff06] cursor-pointer transition-all",
        isSelected
          ? "bg-red-500/5 border-l-2 border-l-red-600 border-b-[#ffffff06]"
          : "hover:bg-[#ffffff03] border-l-2 border-l-transparent"
      )}
    >
      {/* File icon */}
      <div className="w-7 h-7 flex-shrink-0 bg-[#000] border border-[#ffffff0d] flex items-center justify-center">
        <span className="text-[7px] font-mono text-red-600">DOC</span>
      </div>

      {/* Document info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate uppercase" title={doc.title}>
          {doc.title}
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-600 mt-0.5 uppercase tracking-wider">
          <span className="truncate max-w-[120px]">
            {doc.source || "UNKNOWN SOURCE"}
          </span>
          <span className="text-[#ffffff10]">·</span>
          <span className="flex-shrink-0">{formatDate(doc.uploadedAt).split(",")[0]}</span>
          <span className="text-[#ffffff10]">·</span>
          <span className="flex-shrink-0 text-neutral-700">ID:{doc.id}</span>
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-1.5 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {doc.filePath && (
          <a
            href={doc.filePath}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-neutral-700 hover:text-white transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        )}
        <button
          onClick={() => analyzeMutation.mutate({ id: doc.id })}
          disabled={analyzeMutation.isPending}
          className={cn(
            "flex items-center gap-1 px-2 py-1 border font-mono text-[9px] uppercase tracking-widest transition-colors",
            analyzeMutation.isPending
              ? "border-neutral-700 text-neutral-600 cursor-not-allowed"
              : "border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10"
          )}
          title="Run entity extraction"
        >
          <Cpu className="w-3 h-3" />
          {analyzeMutation.isPending ? "SCANNING..." : "ANALYZE"}
        </button>
      </div>
    </div>
  );
}

// ─── Document Inspector (used in Right Panel) ─────────────────────────────────

export function DocumentInspector({
  doc,
  caseId,
  onClose,
}: {
  doc: Document;
  caseId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: mentions = [] } = useListEntityMentions({
    documentId: doc.id,
    status: "pending",
  });

  const analyzeMutation = useAnalyzeDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      },
    },
  });

  const approveMutation = useApproveEntityMention({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
      },
    },
  });

  const rejectMutation = useRejectEntityMention({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/entity-mentions"] });
      },
    },
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="nexus-header-strip flex-shrink-0">
        <span className="nexus-label flex items-center gap-1.5">
          <FileText className="w-3 h-3 text-neutral-500" />
          DOCUMENT INSPECTOR
        </span>
        <button
          onClick={onClose}
          className="text-neutral-600 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Document metadata */}
        <div className="p-2.5 border border-[#ffffff08] bg-[#0a0e14] space-y-2">
          <div className="text-base font-bold text-white uppercase leading-tight tracking-tight">
            {doc.title}
          </div>
          <div className="space-y-0.5 font-mono text-[9px] text-neutral-600 uppercase tracking-widest">
            <div>
              SOURCE:{" "}
              <span className="text-neutral-400">{doc.source || "UNKNOWN"}</span>
            </div>
            <div>
              INGEST:{" "}
              <span className="text-neutral-400">
                {formatDate(doc.uploadedAt).split(",")[0]}
              </span>
            </div>
            <div>
              CASE-REF:{" "}
              <span className="text-neutral-400">
                {caseId.toString().padStart(6, "0")}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => analyzeMutation.mutate({ id: doc.id })}
            disabled={analyzeMutation.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <Cpu className="w-3 h-3" />
            {analyzeMutation.isPending ? "SCANNING..." : "ANALYZE"}
          </button>
          {doc.filePath && (
            <a
              href={doc.filePath}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 py-1.5 px-3 border border-[#ffffff0d] text-neutral-600 hover:text-white font-mono text-[9px] uppercase transition-colors"
              title="Download"
            >
              <Download className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Analysis result */}
        {analyzeMutation.isSuccess && analyzeMutation.data && (
          <div className="p-2 border border-cyan-500/20 bg-cyan-500/5 font-mono text-[9px] text-cyan-400 flex items-center gap-2">
            <Cpu className="w-3 h-3 flex-shrink-0" />
            EXTRACTION COMPLETE —{" "}
            {analyzeMutation.data.mentionsCreated} ENTITIES DETECTED
          </div>
        )}
        {analyzeMutation.isError && (
          <div className="p-2 border border-red-500/20 bg-red-500/5 font-mono text-[9px] text-red-400 flex items-center gap-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            EXTRACTION FAILED
          </div>
        )}

        {/* Pending detections */}
        <div className="space-y-2">
          <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-widest">
            ATLAS DETECTIONS — {mentions.length} PENDING
          </div>
          {mentions.length === 0 ? (
            <div className="py-3 text-center font-mono text-[9px] text-neutral-800 border border-dashed border-[#ffffff06]">
              NO PENDING — RUN ANALYZE TO DETECT
            </div>
          ) : (
            <div className="space-y-1">
              {mentions.map((m) => (
                <MentionCard
                  key={m.id}
                  mention={m}
                  caseId={caseId}
                  onApprove={() =>
                    approveMutation.mutate({ id: m.id, data: { caseId } })
                  }
                  onReject={() => rejectMutation.mutate({ id: m.id })}
                  isApproving={
                    approveMutation.isPending &&
                    approveMutation.variables?.id === m.id
                  }
                  isRejecting={
                    rejectMutation.isPending &&
                    rejectMutation.variables?.id === m.id
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function MentionCard({
  mention,
  caseId: _caseId,
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
  const colorClass =
    ENTITY_TYPE_COLORS[mention.entityType] ||
    "text-neutral-400 border-neutral-400/40 bg-neutral-400/5";
  const confidencePct = Math.round((mention.confidence || 0) * 100);

  return (
    <div className="p-2 border border-[#ffffff06] bg-[#070b10] space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-white uppercase">
          {mention.entityName}
        </span>
        <span
          className={cn(
            "text-[9px] font-mono px-1.5 py-0.5 border uppercase tracking-wider",
            colorClass
          )}
        >
          {mention.entityType.replace(/_/g, " ")}
        </span>
        <span className="text-[9px] font-mono text-neutral-700 ml-auto">
          {confidencePct}%
        </span>
      </div>
      {mention.context && (
        <p className="text-[9px] text-neutral-600 font-mono truncate">
          &ldquo;{mention.context}&rdquo;
        </p>
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={onApprove}
          disabled={isApproving || isRejecting}
          className="flex-1 flex items-center justify-center gap-1 py-1 border border-green-500/40 text-green-500 hover:bg-green-500/10 font-mono text-[9px] uppercase transition-colors disabled:opacity-40"
        >
          <CheckCircle2 className="w-3 h-3" />
          {isApproving ? "..." : "INGEST"}
        </button>
        <button
          onClick={onReject}
          disabled={isApproving || isRejecting}
          className="flex-1 flex items-center justify-center gap-1 py-1 border border-red-500/40 text-red-500 hover:bg-red-500/10 font-mono text-[9px] uppercase transition-colors disabled:opacity-40"
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
        <DialogTitle asChild>
          <div className="nexus-header-strip">
            <span className="nexus-label flex items-center gap-2">
              <Upload className="w-3 h-3 text-red-500" />
              INGEST EVIDENCE
            </span>
          </div>
        </DialogTitle>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="nexus-label">File</Label>
            <div className="relative">
              <Input
                type="file"
                name="file"
                required
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="w-full h-20 border border-dashed border-[#ffffff12] bg-[#000] flex flex-col items-center justify-center text-neutral-600 gap-1.5">
                <Upload className="w-4 h-4 opacity-40" />
                <span className="font-mono text-[9px] uppercase tracking-widest">
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
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono h-8"
              placeholder="e.g. Bank_Statement_Q3.pdf"
            />
          </div>
          <div className="space-y-1">
            <Label className="nexus-label">Intelligence Source</Label>
            <Input
              name="source"
              className="bg-[#000] border-[#ffffff1a] rounded-none focus-visible:ring-0 focus-visible:border-red-500 text-sm font-mono h-8"
              placeholder="e.g. Subpoena, Open Source"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-[#ffffff0d]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="rounded-none font-mono text-[10px] text-neutral-500 hover:text-white h-7"
            >
              CANCEL
            </Button>
            <Button
              type="submit"
              disabled={uploadMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white rounded-none font-mono text-[10px] px-4 h-7"
            >
              {uploadMutation.isPending ? "UPLOADING..." : "TRANSMIT"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
