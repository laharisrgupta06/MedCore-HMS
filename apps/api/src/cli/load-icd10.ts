/**
 * Loads ICD-10 codes into the global icd10_codes reference table (EMR-005; roadmap: "seeded subset").
 *   pnpm --filter @medcore/api icd10:load              (bundled starter subset of ICD-10-CM)
 *   pnpm --filter @medcore/api icd10:load path/to.csv  (any CSV with a code,title header)
 * ICD-10-CM is published by CMS/CDC in the public domain, so the full code file can be loaded the same way.
 * Idempotent: existing codes get the title from the file; nothing is deleted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const CODE = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

/** Parses `code,title` CSV (RFC 4180 quoting). Exported for tests. */
export function parseIcdCsv(text: string): { code: string; title: string }[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim())) rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  endRow();
  const [header, ...body] = rows;
  if (
    !header ||
    header[0]?.trim().toLowerCase() !== 'code' ||
    header[1]?.trim().toLowerCase() !== 'title'
  )
    throw new Error('The file must start with the header "code,title".');
  return body.map((r, i) => {
    const code = (r[0] ?? '').trim().toUpperCase();
    const title = (r[1] ?? '').trim();
    if (!CODE.test(code) || !title)
      throw new Error(`Line ${i + 2}: "${r.join(',')}" is not a valid code,title row.`);
    return { code, title };
  });
}

async function main(): Promise<void> {
  const file = resolve(
    process.argv[2] ?? resolve(__dirname, '../../prisma/data/icd10-cm-subset.csv'),
  );
  const codes = parseIcdCsv(readFileSync(file, 'utf8'));
  const prisma = new PrismaClient();
  try {
    for (let i = 0; i < codes.length; i += 500) {
      await prisma.$transaction(
        codes.slice(i, i + 500).map((c) =>
          prisma.icd10Code.upsert({
            where: { code: c.code },
            create: c,
            update: { title: c.title },
          }),
        ),
      );
    }
    console.warn(`Loaded ${codes.length} ICD-10 codes from ${file}.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
