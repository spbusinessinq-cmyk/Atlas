import React, { useState } from "react";
import { useCreateEntity, Entity, EntityType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, User } from "lucide-react";
import { Link } from "wouter";

export default function EntitiesTab({ caseId, entities }: { caseId: number, entities: Entity[] }) {
  const [search, setSearch] = useState("");

  const filtered = entities.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search known entities..." 
            className="pl-9 font-mono bg-input border-border"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <CreateEntityDialog caseId={caseId} />
      </div>

      <div className="rounded-md border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="font-mono text-xs">ID</TableHead>
              <TableHead className="font-mono text-xs">DESIGNATION</TableHead>
              <TableHead className="font-mono text-xs">CLASSIFICATION</TableHead>
              <TableHead className="font-mono text-xs text-right">ACTION</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground font-mono">NO RECORDS MATCH QUERY</TableCell>
              </TableRow>
            ) : filtered.map((entity) => (
              <TableRow key={entity.id} className="border-border hover:bg-muted/30">
                <TableCell className="font-mono text-xs text-muted-foreground">{entity.id.toString().padStart(5, '0')}</TableCell>
                <TableCell className="font-bold flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  {entity.name}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs bg-secondary">{entity.type.toUpperCase()}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/entities/${entity.id}`}>
                    <Button variant="ghost" size="sm" className="font-mono text-xs hover:text-primary">PROFILE</Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CreateEntityDialog({ caseId }: { caseId: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createMutation = useCreateEntity({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/summary`] });
        queryClient.invalidateQueries({ queryKey: [`/api/entities`] });
        setOpen(false);
      }
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      data: {
        name: fd.get("name") as string,
        type: fd.get("type") as EntityType,
        description: fd.get("description") as string,
        caseId: caseId
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border font-mono text-sm gap-2">
          <Plus className="w-4 h-4" /> ADD_ENTITY
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono">REGISTER NEW ENTITY</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs">Primary Designation / Name</Label>
            <Input name="name" required className="bg-input font-mono" />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs">Classification</Label>
            <Select name="type" defaultValue="person">
              <SelectTrigger className="bg-input font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(EntityType).map(t => (
                  <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs">Initial Intel</Label>
            <Input name="description" className="bg-input font-mono" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending} className="bg-primary text-primary-foreground font-mono">
              {createMutation.isPending ? "REGISTERING..." : "COMMIT_RECORD"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
