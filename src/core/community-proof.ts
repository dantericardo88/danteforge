import fs from 'fs/promises';
import path from 'path';

export interface VerifiedAdopterProof {
  adopter: string;
  source: string;
  proofLinks: string[];
  verifiedDate: string;
  useCase: string;
  outcome: string;
}

export interface CommunityProofReport {
  docsScanned: string[];
  evidenceGuide: boolean;
  verifiedAdopterProofs: VerifiedAdopterProof[];
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function listMarkdownFiles(dir: string, relDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => path.join(relDir, entry.name));
  } catch {
    return [];
  }
}

function evidenceGuideReady(text: string): boolean {
  if (!text.trim()) return false;
  const required = ['adopter', 'use case', 'proof link', 'verified date', 'outcome'];
  const lower = text.toLowerCase();
  return required.every((field) => lower.includes(field));
}

function firstFieldValue(section: string, names: string[]): string {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*(.+)$`, 'im');
    const match = section.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
    const tablePattern = new RegExp(`^\\s*\\|\\s*${escaped}\\s*\\|\\s*(.+?)\\s*\\|`, 'im');
    const tableMatch = section.match(tablePattern);
    if (tableMatch?.[1]?.trim()) return tableMatch[1].trim();
  }
  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function proofLinks(section: string): string[] {
  return [...section.matchAll(/https?:\/\/[^\s)>\]]+/g)]
    .map((match) => match[0].replace(/[.,;]+$/, ''));
}

function sectionTitle(raw: string): string {
  return raw.replace(/^#+\s*/, '').trim();
}

function sections(markdown: string): Array<{ title: string; body: string }> {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  if (matches.length === 0) return [];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, next);
    return { title: sectionTitle(match[1] ?? ''), body };
  });
}

function verifiedDate(section: string): string {
  const explicit = firstFieldValue(section, ['verified date', 'verified', 'last checked']);
  const date = explicit.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  return date?.[0] ?? '';
}

function parseAdopterProofs(markdown: string, source: string): VerifiedAdopterProof[] {
  const results: VerifiedAdopterProof[] = [];
  for (const item of sections(markdown)) {
    const links = proofLinks(item.body);
    const date = verifiedDate(item.body);
    const useCase = firstFieldValue(item.body, ['use case', 'workflow', 'adopted for']);
    const outcome = firstFieldValue(item.body, ['outcome', 'result', 'impact']);
    if (!item.title || links.length === 0 || !date || !useCase || !outcome) continue;
    results.push({
      adopter: item.title,
      source,
      proofLinks: links,
      verifiedDate: date,
      useCase,
      outcome,
    });
  }
  return results;
}

export async function analyzeCommunityProof(cwd: string = process.cwd()): Promise<CommunityProofReport> {
  const guideRel = path.join('docs', 'ADOPTION_EVIDENCE.md');
  const proofCandidates = [
    'ADOPTERS.md',
    path.join('docs', 'ADOPTERS.md'),
    path.join('docs', 'CASE_STUDIES.md'),
    path.join('docs', 'case-studies', 'README.md'),
    ...await listMarkdownFiles(path.join(cwd, 'docs', 'case-studies'), path.join('docs', 'case-studies')),
    ...await listMarkdownFiles(path.join(cwd, 'case-studies'), 'case-studies'),
  ];

  const scanned = new Set<string>();
  const guideText = await readText(path.join(cwd, guideRel));
  if (guideText.trim()) scanned.add(guideRel);

  const verifiedAdopterProofs: VerifiedAdopterProof[] = [];
  for (const relPath of [...new Set(proofCandidates)]) {
    const text = await readText(path.join(cwd, relPath));
    if (!text.trim()) continue;
    scanned.add(relPath);
    verifiedAdopterProofs.push(...parseAdopterProofs(text, relPath));
  }

  return {
    docsScanned: [...scanned],
    evidenceGuide: evidenceGuideReady(guideText),
    verifiedAdopterProofs,
  };
}
