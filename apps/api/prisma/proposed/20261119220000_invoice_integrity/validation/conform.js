// Compare what Prisma expects for M-11a's models and fields with what PostgreSQL holds.
const w = require('/tmp/prismacheck/node_modules/@prisma/prisma-schema-wasm');
const { execFileSync } = require('child_process');
const src = require('fs').readFileSync('schema.prisma', 'utf8');
const dm = JSON.parse(w.get_dmmf(JSON.stringify({ prismaSchema: [['schema.prisma', src]] }))).datamodel;
const sql = (q) => execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', process.env.DB || 'm11b', '-Atc', q], { cwd: '/tmp' }).toString().trim();
const enums = new Set(dm.enums.map((e) => e.name));
const MODELS = ['Invoice', 'InvoiceItem', 'DocumentNumberSeries', 'InvoiceEvent', 'InvoiceCorrectionRequest', 'InvoiceCorrectionRequestNote'];
let problems = 0, checked = 0;
const q = (c) => (/^[a-z_][a-z0-9_]*$/.test(c) ? c : `"${c}"`);
const ok = (cond, msg) => { checked++; if (!cond) { problems++; console.log('MISMATCH', msg); } };

function pgType(f) {
  if (f.kind === 'enum') return `"${f.type}"`;
  const nt = f.nativeType;
  const n = nt && nt[0], a = nt && nt[1];
  if (f.type === 'String') return n === 'Uuid' ? 'uuid' : n === 'VarChar' ? `character varying(${a[0]})` : n === 'Char' ? `character(${a[0]})` : 'text';
  if (f.type === 'Boolean') return 'boolean';
  if (f.type === 'Int') return 'integer';
  if (f.type === 'Decimal') return `numeric(${a[0]},${a[1]})`;
  if (f.type === 'DateTime') return n === 'Date' ? 'date' : `timestamp(${a ? a[0] : 3}) with time zone`;
  return '?' + f.type;
}
function pgDefault(f) {
  if (f.isUpdatedAt || !f.hasDefaultValue) return '';
  if (f.kind === 'enum') return `'${f.default}'::"${f.type}"`;
  const d = f.default;
  if (d && typeof d === 'object' && d.name === 'now') return 'CURRENT_TIMESTAMP';
  if (d && typeof d === 'object' && d.name === 'uuid') return '';
  if (d && typeof d === 'object' && d.name === 'dbgenerated') return d.args[0];
  return String(d);
}
function checkField(m, f) {
  const table = m.dbName || m.name;
  const row = sql(`SELECT format_type(a.atttypid, a.atttypmod) || '|' || (NOT a.attnotnull) || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = '"${table}"'::regclass AND a.attname = '${f.dbName || f.name}' AND NOT a.attisdropped`);
  const [type, nullable, def] = row.split('|');
  ok(type === pgType(f), `${table}.${f.name} type ${type} vs Prisma ${pgType(f)}`);
  ok((nullable === 'true') === !f.isRequired, `${table}.${f.name} nullability`);
  ok(def === pgDefault(f), `${table}.${f.name} default "${def}" vs Prisma "${pgDefault(f)}"`);
}
function checkRelation(m, f) {
  if (!f.relationFromFields || f.relationFromFields.length === 0) return;
  const table = m.dbName || m.name;
  const target = dm.models.find((x) => x.name === f.type);
  const name = `${table}_${f.relationFromFields.join('_')}_fkey`;
  const row = sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${name}'`);
  const cols = f.relationFromFields.map(q).join(', ');
  const refs = f.relationToFields.map(q).join(', ');
  ok(row.startsWith(`FOREIGN KEY (${cols}) REFERENCES ${target.dbName}(${refs})`), `${name}: ${row || 'missing'}`);
  ok(row.includes('ON DELETE RESTRICT') && row.includes('ON UPDATE CASCADE'), `${name} actions: ${row}`);
}
const prismaIndexes = new Set();
for (const m of dm.models.filter((x) => MODELS.includes(x.name))) {
  const table = m.dbName || m.name;
  for (const f of m.fields) (f.kind === 'object' ? checkRelation : checkField)(m, f);
  const cols = sql(`SELECT string_agg(attname, ',' ORDER BY attname) FROM pg_attribute WHERE attrelid = '"${table}"'::regclass AND attnum > 0 AND NOT attisdropped`).split(',');
  const expected = m.fields.filter((f) => f.kind !== 'object').map((f) => f.dbName || f.name).sort();
  ok(JSON.stringify(cols.sort()) === JSON.stringify(expected), `${table} columns ${cols} vs ${expected}`);
  ok(sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${table}_pkey'`) === 'PRIMARY KEY (id)', `${table}_pkey`);
  prismaIndexes.add(`${table}_pkey`);
  const uniques = [...m.uniqueFields, ...m.fields.filter((f) => f.isUnique).map((f) => [f.name])];
  for (const u of uniques) {
    const name = `${table}_${u.join('_')}_key`;
    prismaIndexes.add(name);
    const def = sql(`SELECT indexdef FROM pg_indexes WHERE indexname = '${name}'`);
    ok(def === `CREATE UNIQUE INDEX "${name}" ON public.${table} USING btree (${u.map(q).join(', ')})`, `${name}: ${def || 'missing'}`);
  }
  for (const ix of (dm.indexes || []).filter((i) => i.model === m.name && i.type === 'normal')) {
    const fs = ix.fields.map((f) => f.name);
    const name = `${table}_${fs.join('_')}_idx`;
    prismaIndexes.add(name);
    const def = sql(`SELECT indexdef FROM pg_indexes WHERE indexname = '${name}'`);
    ok(def === `CREATE INDEX "${name}" ON public.${table} USING btree (${fs.map(q).join(', ')})`, `${name}: ${def || 'missing'}`);
  }
  // Every other index on the table must be a partial or expression index (not representable in
  // Prisma, ignored by migrate diff), listed here on purpose.
  const extra = sql(`SELECT string_agg(indexname || '=' || indexdef, E'\\n') FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${table}'`).split('\n').filter(Boolean);
  for (const e of extra) {
    const [name, def] = [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)];
    if (prismaIndexes.has(name)) continue;
    ok(/ WHERE |COALESCE\(/.test(def), `${table}: index ${name} is not in schema.prisma and is not partial or an expression: ${def}`);
    console.log(`  outside Prisma (partial/expression): ${name}`);
  }
}
for (const e of ['InvoiceKind', 'DocumentType', 'TaxNotCollectedReason', 'InvoiceEventKind', 'CorrectionRequestKind', 'InvoiceItemKind', 'InvoiceStatus']) {
  const vals = sql(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = '"${e}"'::regtype`);
  ok(vals === dm.enums.find((x) => x.name === e).values.map((v) => v.name).join(','), `enum ${e}: ${vals}`);
}
console.log(`${checked - problems}/${checked} checks match`);
process.exit(problems ? 1 : 0);
