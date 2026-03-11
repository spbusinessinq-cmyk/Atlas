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
  ScanLine,
  Eye,
  ExternalLink,
  ArrowLeft,
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
  onViewDocument?: (doc: Document) => void;
}

export default function DocumentsTab({
  caseId,
  documents,
  selectedDocId,
  onDocumentSelect,
  onViewDocument,
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
            <FileText className="w-8 h-8 text-neutral-800" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO EVIDENCE ATTACHED
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-wider">
              Use INGEST to upload source documents
            </div>
          </div>
        ) : (
          <>
            <div className="flex bg-[#ffffff04] border-b border-[#ffffff06] px-3 py-1.5 font-mono text-[9px] text-neutral-700 uppercase tracking-widest sticky top-0">
              <div className="w-8 mr-3 flex-shrink-0" />
              <div className="flex-1">TITLE / SOURCE</div>
              <div className="w-48 text-right">ACTIONS</div>
            </div>
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                caseId={caseId}
                isSelected={selectedDocId === doc.id}
                onSelect={() =>
                  onDocumentSelect?.(selectedDocId === doc.id ? null : doc)
                }
                onView={() => {
                  onDocumentSelect?.(doc);
                  onViewDocument?.(doc);
                }}
              />
            ))}
          </>
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
  onView,
}: {
  doc: Document;
  caseId: number;
  isSelected: boolean;
  onSelect: () => void;
  onView: () => void;
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
      className={cn(
        "flex items-center gap-0 border-b border-[#ffffff06] transition-all duration-150",
        isSelected
          ? "bg-[#dc262608] border-l-2 border-l-red-600"
          : "border-l-2 border-l-transparent"
      )}
    >
      <div
        onClick={onSelect}
        className={cn(
          "flex items-center gap-3 flex-1 min-w-0 px-3 py-3 cursor-pointer",
          isSelected ? "hover:bg-[#dc26260a]" : "hover:bg-[#ffffff04]"
        )}
      >
        <div
          className={cn(
            "w-8 h-8 flex-shrink-0 border flex items-center justify-center",
            isSelected
              ? "bg-red-500/10 border-red-500/30"
              : "bg-[#000] border-[#ffffff0d]"
          )}
        >
          <span
            className={cn(
              "text-[7px] font-mono",
              isSelected ? "text-red-400" : "text-neutral-700"
            )}
          >
            DOC
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "text-sm font-semibold uppercase truncate transition-colors leading-tight",
              isSelected ? "text-white" : "text-neutral-300"
            )}
            title={doc.title}
          >
            {doc.title}
          </div>
          <div className="flex items-center gap-2 text-[9px] font-mono mt-0.5 uppercase tracking-wider text-neutral-700">
            <span className="truncate max-w-[140px]">
              {doc.source || "UNKNOWN SOURCE"}
            </span>
            <span className="text-[#ffffff10]">·</span>
            <span className="flex-shrink-0">
              {formatDate(doc.uploadedAt).split(",")[0]}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex items-center gap-1 px-2 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => analyzeMutation.mutate({ id: doc.id })}
          disabled={analyzeMutation.isPending}
          className={cn(
            "flex items-center gap-1 px-2 py-1.5 border font-mono text-[9px] uppercase tracking-widest transition-colors",
            analyzeMutation.isPending
              ? "border-neutral-800 text-neutral-700 cursor-not-allowed"
              : "border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10 hover:text-cyan-400 hover:border-cyan-500/60"
          )}
          title="Run entity extraction"
        >
          <Cpu className="w-3 h-3" />
          {analyzeMutation.isPending ? "…" : "ANALYZE"}
        </button>

        <button
          onClick={onView}
          className="flex items-center gap-1 px-2 py-1.5 border border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-white font-mono text-[9px] uppercase tracking-widest transition-colors"
          title="View document"
        >
          <Eye className="w-3 h-3" />
          VIEW
        </button>

        {doc.filePath && (
          <a
            href={`/api/documents/${doc.id}/download`}
            className="p-1.5 text-neutral-700 hover:text-white transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Document Viewer (center panel) ───────────────────────────────────────────

export function DocumentViewer({
  doc,
  onBack,
}: {
  doc: Document;
  onBack: () => void;
}) {
  const ext = doc.filePath
    ? doc.filePath.split(".").pop()?.toLowerCase()
    : undefined;
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext || "");
  const hasFile = !!doc.filePath;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#000]">
      <div className="nexus-header-strip flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 font-mono text-[9px] text-neutral-600 hover:text-white uppercase tracking-widest transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-3 h-3" />
            BACK TO VAULT
          </button>
          <span className="text-[#ffffff12] text-xs">|</span>
          <span className="font-mono text-[10px] text-neutral-400 uppercase truncate">
            {doc.title}
          </span>
          {ext && (
            <span className="font-mono text-[8px] text-neutral-700 border border-[#ffffff0d] px-1 py-0.5 uppercase flex-shrink-0">
              {ext}
            </span>
          )}
        </div>
        {doc.filePath && (
          <a
            href={`/api/documents/${doc.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[9px] text-neutral-600 hover:text-white uppercase transition-colors flex-shrink-0"
          >
            <ExternalLink className="w-3 h-3" />
            OPEN IN TAB
          </a>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {!hasFile ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <FileText className="w-8 h-8 text-neutral-800" />
            <div className="text-center space-y-1">
              <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
                NO FILE ATTACHED
              </div>
              <div className="font-mono text-[9px] text-neutral-800 uppercase">
                Upload a file through the INGEST workflow to view it here.
              </div>
            </div>
          </div>
        ) : isPdf ? (
          <iframe
            src={`/api/documents/${doc.id}/file`}
            className="w-full h-full border-0"
            title={doc.title}
          />
        ) : isImage ? (
          <div className="h-full flex items-center justify-center p-6 overflow-auto">
            <img
              src={`/api/documents/${doc.id}/file`}
              alt={doc.title}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <FileText className="w-8 h-8 text-neutral-700" />
            <div className="text-center space-y-1.5">
              <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-widest">
                PREVIEW NOT AVAILABLE
              </div>
              <div className="font-mono text-[9px] text-neutral-700 uppercase tracking-wider">
                Open or download the source file.
              </div>
            </div>
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-widest transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              OPEN FILE
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Document Inspector (right panel) ─────────────────────────────────────────

export function DocumentInspector({
  doc,
  caseId,
  onClose,
  onView,
}: {
  doc: Document;
  caseId: number;
  onClose: () => void;
  onView?: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: pendingMentions = [] } = useListEntityMentions({
    documentId: doc.id,
    status: "pending",
  });

  const { data: approvedMentions = [] } = useListEntityMentions({
    documentId: doc.id,
    status: "approved",
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

  const hasAnyMentions = pendingMentions.length > 0 || approvedMentions.length > 0;
  const ext = doc.filePath
    ? doc.filePath.split(".").pop()?.toLowerCase()
    : undefined;

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
        <div className="p-2.5 border border-[#ffffff08] bg-[#0a0e14] space-y-2">
          <div className="text-sm font-bold text-white uppercase leading-tight tracking-tight">
            {doc.title}
          </div>
          {ext && (
            <span className="inline-block font-mono text-[8px] text-neutral-600 border border-[#ffffff0d] px-1.5 py-0.5 uppercase">
              {ext.toUpperCase()} FILE
            </span>
          )}
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

        <div className="space-y-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              analyzeMutation.mutate({ id: doc.id });
            }}
            disabled={analyzeMutation.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-cyan-500/40 text-cyan-500 hover:bg-cyan-500/10 hover:border-cyan-500/60 font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <Cpu className="w-3 h-3" />
            {analyzeMutation.isPending ? "SCANNING..." : "ANALYZE DOCUMENT"}
          </button>

          {onView && (
            <button
              onClick={onView}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-white font-mono text-[9px] uppercase tracking-widest transition-colors"
            >
              <Eye className="w-3 h-3" />
              VIEW DOCUMENT
            </button>
          )}

          {doc.filePath && (
            <a
              href={`/api/documents/${doc.id}/download`}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-[#ffffff0d] text-neutral-600 hover:text-white font-mono text-[9px] uppercase transition-colors"
            >
              <Download className="w-3 h-3" />
              DOWNLOAD
            </a>
          )}
        </div>

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

        {!hasAnyMentions && (
          <div className="py-5 text-center space-y-2 border border-dashed border-[#ffffff06]">
            <ScanLine className="w-4 h-4 text-neutral-800 mx-auto" />
            <div className="font-mono text-[10px] text-neutral-700 uppercase tracking-widest">
              NO DETECTIONS AVAILABLE
            </div>
            <div className="font-mono text-[9px] text-neutral-800 uppercase tracking-wider">
              Run ANALYZE to extract entities and references.
            </div>
          </div>
        )}

        {pendingMentions.length > 0 && (
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-amber-600 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
              PENDING TRIAGE — {pendingMentions.length}
            </div>
            <div className="space-y-1">
              {pendingMentions.map((m) => (
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
          </div>
        )}

        {approvedMentions.length > 0 && (
          <div className="space-y-2">
            <div className="font-mono text-[9px] text-green-700 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-green-600 inline-block" />
              INGESTED TO REGISTRY — {approvedMentions.length}
            </div>
            <div className="space-y-1">
              {approvedMentions.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 border border-[#ffffff05] bg-[#070b10]"
                >
                  <CheckCircle2 className="w-3 h-3 text-green-700 flex-shrink-0" />
                  <span className="text-xs font-semibold text-neutral-400 uppercase truncate">
                    {m.entityName}
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-[8px] font-mono px-1 py-0.5 border uppercase",
                      ENTITY_TYPE_COLORS[m.entityType] ||
                        "text-neutral-500 border-neutral-500/30"
                    )}
                  >
                    {m.entityType.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
