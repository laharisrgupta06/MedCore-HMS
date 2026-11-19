// Compare what Prisma expects for M-11a's models and fields with what PostgreSQL holds.
const w = require('@prisma/prisma-schema-wasm');
const { execFileSync } = require('child_process');
const src = require('fs').readFileSync('schema.prisma', 'utf8');
const dm = JSON.parse(
  w.get_dmmf(JSON.stringify({ prismaSchema: [['schema.prisma', src]] })),
).datamodel;
const sql = (q) =>
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', 'm11a', '-Atc', q], { cwd: '/tmp' })
    .toString()
    .trim();
const enums = new Set(dm.enums.map((e) => e.name));
const NEW_MODELS = [
  'TaxClassification',
  'TaxClassificationVersion',
  'HospitalTaxDefault',
  'HospitalGstRegistration',
  'StatutoryRoomTaxRule',
];
const NEW_FIELDS = {
  Hospital: ['taxSetupConfirmedAt', 'taxSetupConfirmedById', 'taxTimezoneLockedAt'],
  LabTest: ['taxClassificationId'],
  Medicine: ['taxClassificationId'],
  Room: ['criticalCareUnit'],
};
let problems = 0,
  checked = 0;
const q = (c) => (/^[a-z_][a-z0-9_]*$/.test(c) ? c : `"${c}"`);
const ok = (cond, msg) => {
  checked++;
  if (!cond) {
    problems++;
    console.log('MISMATCH', msg);
  }
};

function pgType(f) {
  if (f.kind === 'enum') return `"${f.type}"`;
  const nt = f.nativeType;
  const n = nt && nt[0],
    a = nt && nt[1];
  if (f.type === 'String')
    return n === 'Uuid'
      ? 'uuid'
      : n === 'VarChar'
        ? `character varying(${a[0]})`
        : n === 'Char'
          ? `character(${a[0]})`
          : 'text';
  if (f.type === 'Boolean') return 'boolean';
  if (f.type === 'Int') return 'integer';
  if (f.type === 'Decimal') return `numeric(${a[0]},${a[1]})`;
  if (f.type === 'DateTime')
    return n === 'Date' ? 'date' : `timestamp(${a ? a[0] : 3}) with time zone`;
  return '?' + f.type;
}
function pgDefault(f) {
  if (f.isUpdatedAt || !f.hasDefaultValue) return '';
  const d = f.default;
  if (d && typeof d === 'object' && d.name === 'now') return 'CURRENT_TIMESTAMP';
  if (d && typeof d === 'object' && d.name === 'uuid') return '';
  if (d && typeof d === 'object' && d.name === 'dbgenerated') return d.args[0];
  return String(d);
}
function checkField(m, f) {
  const table = m.dbName || m.name;
  const row =
    sql(`SELECT format_type(a.atttypid, a.atttypmod) || '|' || (NOT a.attnotnull) || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
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
  const name =
    f.relationName && table === 'hospitals'
      ? 'hospitals_taxSetupConfirmedById_id_fkey'
      : `${table}_${f.relationFromFields.join('_')}_fkey`;
  const row = sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${name}'`);
  const del = { Restrict: 'ON DELETE RESTRICT', Cascade: 'ON DELETE CASCADE' }[
    f.relationOnDelete || 'Restrict'
  ];
  const cols = f.relationFromFields.map(q).join(', ');
  const refs = f.relationToFields.map(q).join(', ');
  ok(
    row.startsWith(`FOREIGN KEY (${cols}) REFERENCES ${target.dbName}(${refs})`),
    `${name}: ${row || 'missing'}`,
  );
  ok(row.includes(del), `${name} delete action: ${row}`);
  const upd =
    table === 'hospitals' && f.name === 'taxSetupConfirmedBy'
      ? !row.includes('ON UPDATE')
      : row.includes('ON UPDATE CASCADE');
  ok(upd, `${name} update action: ${row}`);
}
for (const m of dm.models) {
  const table = m.dbName || m.name;
  const isNew = NEW_MODELS.includes(m.name);
  const fields = isNew
    ? m.fields
    : m.fields.filter(
        (f) =>
          (NEW_FIELDS[m.name] || []).includes(f.name) ||
          (NEW_FIELDS[m.name] &&
            f.relationFromFields &&
            f.relationFromFields.some((c) => NEW_FIELDS[m.name].includes(c))),
      );
  for (const f of fields) {
    if (f.kind === 'object') checkRelation(m, f);
    else checkField(m, f);
  }
  if (!isNew) continue;
  // Exactly the columns Prisma knows, no more.
  const cols = sql(
    `SELECT string_agg(attname, ',' ORDER BY attname) FROM pg_attribute WHERE attrelid = '"${table}"'::regclass AND attnum > 0 AND NOT attisdropped`,
  ).split(',');
  const expected = m.fields
    .filter((f) => f.kind !== 'object')
    .map((f) => f.dbName || f.name)
    .sort();
  ok(
    JSON.stringify(cols.sort()) === JSON.stringify(expected),
    `${table} columns ${cols} vs ${expected}`,
  );
  // Primary key and unique indexes with Prisma's names.
  const pk = m.primaryKey ? m.primaryKey.fields : m.fields.filter((f) => f.isId).map((f) => f.name);
  ok(
    sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${table}_pkey'`) ===
      `PRIMARY KEY (${pk.map(q).join(', ')})`,
    `${table}_pkey`,
  );
  const uniques = [...m.uniqueFields, ...m.fields.filter((f) => f.isUnique).map((f) => [f.name])];
  for (const u of uniques) {
    const name = `${table}_${u.join('_')}_key`;
    const def = sql(`SELECT indexdef FROM pg_indexes WHERE indexname = '${name}'`);
    ok(
      def.startsWith(
        `CREATE UNIQUE INDEX "${name}" ON public.${table} USING btree (${u.map(q).join(', ')})`,
      ),
      `${name}: ${def || 'missing'}`,
    );
  }
}
// Enum values.
for (const e of ['TaxSupplyType', 'TaxTreatment', 'GstRegistrationType', 'CriticalCareUnit']) {
  const vals = sql(
    `SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = '"${e}"'::regtype`,
  );
  ok(
    vals ===
      dm.enums
        .find((x) => x.name === e)
        .values.map((v) => v.name)
        .join(','),
    `enum ${e}: ${vals}`,
  );
}
console.log(`${checked - problems}/${checked} checks match`);
process.exit(problems ? 1 : 0);
