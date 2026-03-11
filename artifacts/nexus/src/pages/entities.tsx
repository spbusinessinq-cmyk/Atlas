import React from "react";
import { useListEntities } from "@workspace/api-client-react";
import { Search, Users, Database } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { formatDate } from "@/lib/utils";

export default function EntityList() {
  const { data: entities, isLoading } = useListEntities();
  const [search, setSearch] = React.useState("");

  const filtered = entities?.filter(e => e.name.toLowerCase().includes(search.toLowerCase())) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Database className="w-8 h-8 text-primary" />
            Global Entity Registry
          </h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">TOTAL KNOWN IDENTITIES: {entities?.length || 0}</p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search across all cases..." 
            className="pl-9 font-mono bg-card border-border h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-lg">
        {isLoading ? (
          <div className="p-8 text-center font-mono text-primary animate-pulse">QUERYING MAINFRAME...</div>
        ) : (
          <Table>
            <TableHeader className="bg-muted">
              <TableRow className="border-border">
                <TableHead className="font-mono text-xs w-24">SYS_ID</TableHead>
                <TableHead className="font-mono text-xs">DESIGNATION</TableHead>
                <TableHead className="font-mono text-xs">CLASS</TableHead>
                <TableHead className="font-mono text-xs hidden md:table-cell">RECORDED</TableHead>
                <TableHead className="font-mono text-xs text-right">ACTION</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(entity => (
                <TableRow key={entity.id} className="border-border hover:bg-muted/50 transition-colors">
                  <TableCell className="font-mono text-xs text-muted-foreground">{entity.id.toString().padStart(6, '0')}</TableCell>
                  <TableCell className="font-bold flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary/70" />
                    {entity.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px] bg-secondary border-border">{entity.type.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">
                    {formatDate(entity.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/entities/${entity.id}`}>
                      <Button variant="ghost" size="sm" className="font-mono text-xs text-primary hover:text-primary-foreground hover:bg-primary">
                        ACCESS
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 font-mono text-muted-foreground">NO MATCHING RECORDS</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
