import React from "react";
import { ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <ShieldAlert className="w-24 h-24 text-destructive mb-6 animate-pulse" />
      <h1 className="text-4xl font-bold font-mono tracking-widest text-foreground mb-2">RESTRICTED_AREA</h1>
      <p className="text-muted-foreground font-mono mb-8 max-w-md">
        ERROR 404: The requested sector does not exist or your clearance level is insufficient to access this directory.
      </p>
      <Link href="/">
        <Button className="bg-primary text-primary-foreground font-mono hover:bg-primary/90">
          RETURN TO DASHBOARD
        </Button>
      </Link>
    </div>
  );
}
