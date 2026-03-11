import React, { useState } from "react";
import { useCreateNote, Note } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { Save, Terminal } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function NotesTab({ caseId, notes }: { caseId: number, notes: Note[] }) {
  const [content, setContent] = useState("");
  const queryClient = useQueryClient();
  
  const createMutation = useCreateNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        setContent("");
      }
    }
  });

  const handleSave = () => {
    if (!content.trim()) return;
    createMutation.mutate({
      data: { caseId, content }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full p-4">
      {/* Editor */}
      <div className="flex flex-col border border-border rounded-md bg-card overflow-hidden h-[calc(100vh-250px)]">
        <div className="bg-muted px-4 py-2 border-b border-border flex justify-between items-center">
          <span className="font-mono text-xs text-muted-foreground flex items-center gap-2">
            <Terminal className="w-4 h-4" /> SECURE_TERMINAL
          </span>
          <Button size="sm" onClick={handleSave} disabled={createMutation.isPending || !content.trim()} className="h-7 text-xs font-mono gap-1">
            <Save className="w-3 h-3" /> COMMIT
          </Button>
        </div>
        <Textarea 
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter markdown formatted notes here..."
          className="flex-1 resize-none border-0 focus-visible:ring-0 rounded-none bg-background font-mono text-sm p-4 leading-relaxed text-foreground"
        />
      </div>

      {/* History */}
      <div className="flex flex-col border border-border rounded-md bg-sidebar overflow-hidden h-[calc(100vh-250px)]">
        <div className="bg-muted px-4 py-2 border-b border-border">
          <span className="font-mono text-xs text-muted-foreground">ANALYST_LOGS</span>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {notes.length === 0 ? (
            <div className="text-center font-mono text-muted-foreground mt-10">NO LOGS FOUND</div>
          ) : notes.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(note => (
            <div key={note.id} className="p-4 bg-card border border-border rounded-md shadow-sm">
              <div className="font-mono text-xs text-primary mb-3 pb-2 border-b border-border/50">
                LOG_ID: {note.id} // {formatDate(note.createdAt)}
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-foreground font-sans">
                <ReactMarkdown>{note.content}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
