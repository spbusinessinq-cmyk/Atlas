import React, { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useListCases, useCreateCase, CaseStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Briefcase, ChevronRight, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

export default function Dashboard() {
  const { data: cases, isLoading } = useListCases();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const statusColors: Record<CaseStatus, string> = {
    open: "border-l-blue-500 bg-blue-500/10 text-blue-500",
    active: "border-l-primary bg-primary/10 text-primary",
    closed: "border-l-muted-foreground bg-muted text-muted-foreground",
    archived: "border-l-yellow-500 bg-yellow-500/10 text-yellow-500"
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Active Operations</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">MONITORING {cases?.length || 0} DIRECTIVES</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-input rounded-md p-1 border border-border">
            <Button 
              variant="ghost" 
              size="icon" 
              className={`h-7 w-7 rounded-sm ${viewMode === "grid" ? "bg-muted shadow-sm" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className={`h-7 w-7 rounded-sm ${viewMode === "list" ? "bg-muted shadow-sm" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          <CreateCaseDialog />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <Card key={i} className="h-64 animate-pulse bg-muted/50" />
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
              <Card className={`group cursor-pointer hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 bg-card overflow-hidden ${viewMode === 'list' ? 'flex flex-row items-center p-4' : 'flex flex-col h-full'}`}>
                <div className={`w-1 shrink-0 ${statusColors[c.status].split(' ')[0]} ${viewMode === 'list' ? 'h-full rounded-full mr-4' : 'h-1 w-full absolute top-0 left-0'}`} />
                
                <CardHeader className={viewMode === "list" ? "p-0 flex-1" : "pb-2"}>
                  <div className="flex justify-between items-start">
                    <Badge variant="outline" className={`font-mono text-xs border-transparent ${statusColors[c.status].split(' ').slice(1).join(' ')}`}>
                      {c.status.toUpperCase()}
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground">{formatDate(c.updatedAt)}</span>
                  </div>
                  <CardTitle className="text-xl mt-3 group-hover:text-primary transition-colors flex items-center gap-2">
                    <Briefcase className="w-5 h-5 text-muted-foreground" />
                    {c.title}
                  </CardTitle>
                  <CardDescription className="line-clamp-2 mt-2">
                    {c.description || "No description provided."}
                  </CardDescription>
                </CardHeader>
                
                <CardContent className={viewMode === "list" ? "p-0 flex-1 hidden md:block" : "flex-1 mt-4"}>
                  <div className="flex flex-wrap gap-2">
                    {c.tags?.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="secondary" className="bg-secondary text-secondary-foreground text-xs font-mono">
                        {tag}
                      </Badge>
                    ))}
                    {(c.tags?.length || 0) > 3 && (
                      <Badge variant="secondary" className="bg-secondary text-xs font-mono">
                        +{(c.tags?.length || 0) - 3}
                      </Badge>
                    )}
                  </div>
                </CardContent>
                
                <CardFooter className={viewMode === "list" ? "p-0 justify-end" : "pt-4 border-t border-border/50 justify-between text-sm text-muted-foreground"}>
                  {viewMode === "grid" && <span className="font-mono text-xs">ID: {c.id.toString().padStart(6, '0')}</span>}
                  <div className="flex items-center text-primary group-hover:translate-x-1 transition-transform">
                    {viewMode === "list" && <span className="mr-2 font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity">ACCESS</span>}
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </CardFooter>
              </Card>
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
        <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline font-mono">NEW_CASE</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border-border bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl border-b border-border pb-4 flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            INITIALIZE NEW CASE
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title" className="font-mono text-xs text-muted-foreground uppercase">Designation</Label>
            <Input id="title" name="title" required className="font-mono bg-input border-border" placeholder="e.g. OP-CRIMSON-TIDE" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description" className="font-mono text-xs text-muted-foreground uppercase">Briefing / Objective</Label>
            <Textarea id="description" name="description" className="bg-input border-border min-h-[100px]" placeholder="Detailed case objectives..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status" className="font-mono text-xs text-muted-foreground uppercase">Initial Status</Label>
              <Select name="status" defaultValue="open">
                <SelectTrigger className="bg-input border-border font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">OPEN</SelectItem>
                  <SelectItem value="active">ACTIVE</SelectItem>
                  <SelectItem value="closed">CLOSED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags" className="font-mono text-xs text-muted-foreground uppercase">Tags (comma separated)</Label>
              <Input id="tags" name="tags" className="bg-input border-border font-mono text-sm" placeholder="fraud, cysec, target-x" />
            </div>
          </div>
          <DialogFooter className="border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="font-mono">CANCEL</Button>
            <Button type="submit" disabled={createMutation.isPending} className="bg-primary text-primary-foreground font-mono">
              {createMutation.isPending ? "INITIALIZING..." : "CONFIRM_INIT"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
