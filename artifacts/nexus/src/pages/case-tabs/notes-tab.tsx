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
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Editor */}
      <div className="nexus-panel rounded-none flex-1 flex flex-col min-h-[300px]">
        <div className="nexus-header-strip">
          <span className="nexus-label flex items-center gap-2">
            <Terminal className="w-3 h-3 text-red-500" /> SECURE_TERMINAL
          </span>
          <Button 
            onClick={handleSave} 
            disabled={createMutation.isPending || !content.trim()} 
            className="bg-red-600 hover:bg-red-700 text-white rounded-none h-6 px-3 font-mono text-[10px] uppercase tracking-wider gap-1.5"
          >
            <Save className="w-3 h-3" /> COMMIT NOTE
          </Button>
        </div>
        <Textarea 
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder=">_ ENTER MARKDOWN FORMATTED LOGS HERE..."
          className="flex-1 resize-none border-0 focus-visible:ring-0 rounded-none bg-[#000] font-mono text-sm p-4 leading-relaxed text-neutral-300 placeholder:text-neutral-700"
        />
      </div>

      {/* History */}
      <div className="nexus-panel rounded-none flex-1 flex flex-col h-full lg:w-1/2">
        <div className="nexus-header-strip">
          <span className="nexus-label">ANALYST LOGS</span>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4 bg-[#080a0d]">
          {notes.length === 0 ? (
            <div className="text-center font-mono text-neutral-600 text-sm uppercase tracking-widest mt-10">NO LOGS FOUND</div>
          ) : notes.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(note => (
            <div key={note.id} className="p-4 bg-[#111820] border border-[#ffffff0d]">
              <div className="font-mono text-[10px] text-neutral-500 mb-3 pb-2 border-b border-[#ffffff0a] flex justify-between">
                <span>LOG_ID: {note.id.toString().padStart(6, '0')}</span>
                <span>{formatDate(note.createdAt)}</span>
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-neutral-300 font-mono leading-relaxed text-xs">
                <ReactMarkdown>{note.content}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
