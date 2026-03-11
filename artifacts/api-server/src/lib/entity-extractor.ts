import nlp from "compromise";
import fs from "fs";
import path from "path";

export interface ExtractedMention {
  entityName: string;
  entityType: string;
  confidence: number;
  context: string;
  startPos: number;
  endPos: number;
}

// Map compromise tags to our entity types
function mapTagToType(tag: string): string {
  const mapping: Record<string, string> = {
    Person: "person",
    Organization: "organization",
    Place: "location",
    Acronym: "organization",
    Government: "government_agency",
  };
  return mapping[tag] || "organization";
}

// Extract plain text from a file — supports PDF and plain text
export async function extractTextFromFile(filePath: string): Promise<string> {
  const absPath = path.resolve(filePath.replace(/^\/uploads\//, "./uploads/"));

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const ext = path.extname(absPath).toLowerCase();

  if (ext === ".pdf") {
    try {
      // pdf-parse v2 API: new PDFParse({ data: buffer }).getText()
      const { PDFParse } = await import("pdf-parse");
      const buffer = fs.readFileSync(absPath);
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text || "";
    } catch (err) {
      console.warn("PDF parse error:", err);
      return "";
    }
  }

  // For plain text files
  if ([".txt", ".md", ".csv"].includes(ext)) {
    return fs.readFileSync(absPath, "utf-8");
  }

  // For other files try UTF-8 read
  try {
    return fs.readFileSync(absPath, "utf-8");
  } catch {
    return "";
  }
}

// Run NER on text using compromise.js
export function extractEntities(text: string): ExtractedMention[] {
  if (!text || text.trim().length < 10) return [];

  const doc = nlp(text);
  const mentions: ExtractedMention[] = [];
  const seen = new Set<string>();

  // Extract people
  doc.people().forEach((person: ReturnType<typeof nlp>) => {
    const name = person.text().trim();
    if (name.length > 2 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      const context = getContext(text, name);
      mentions.push({
        entityName: name,
        entityType: "person",
        confidence: 0.80,
        context,
        startPos: context.indexOf(name),
        endPos: context.indexOf(name) + name.length,
      });
    }
  });

  // Extract organizations
  doc.organizations().forEach((org: ReturnType<typeof nlp>) => {
    const name = org.text().trim();
    if (name.length > 2 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      const context = getContext(text, name);
      mentions.push({
        entityName: name,
        entityType: "organization",
        confidence: 0.72,
        context,
        startPos: context.indexOf(name),
        endPos: context.indexOf(name) + name.length,
      });
    }
  });

  // Extract places
  doc.places().forEach((place: ReturnType<typeof nlp>) => {
    const name = place.text().trim();
    if (name.length > 2 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      const context = getContext(text, name);
      mentions.push({
        entityName: name,
        entityType: "location",
        confidence: 0.68,
        context,
        startPos: context.indexOf(name),
        endPos: context.indexOf(name) + name.length,
      });
    }
  });

  // Also look for government agency patterns
  const govPatterns = [
    /\b(Department of [A-Z][a-zA-Z\s]+)\b/g,
    /\b([A-Z]{2,6})\b/g, // Acronyms like FBI, LAPD, LAHSA
    /\b(Office of [A-Z][a-zA-Z\s]+)\b/g,
    /\b(Bureau of [A-Z][a-zA-Z\s]+)\b/g,
    /\b(Agency for [A-Z][a-zA-Z\s]+)\b/g,
  ];

  for (const pattern of govPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length > 2 && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        const context = getContext(text, name);
        const isAcronym = /^[A-Z]{2,6}$/.test(name);
        mentions.push({
          entityName: name,
          entityType: isAcronym ? "government_agency" : "government_agency",
          confidence: isAcronym ? 0.55 : 0.75,
          context,
          startPos: match.index,
          endPos: match.index + name.length,
        });
      }
    }
  }

  // Deduplicate and sort by confidence
  return mentions
    .filter((m, i, arr) => arr.findIndex((x) => x.entityName === m.entityName) === i)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50); // Cap at 50 per document
}

function getContext(text: string, name: string): string {
  const idx = text.indexOf(name);
  if (idx === -1) return name;
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + name.length + 80);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
