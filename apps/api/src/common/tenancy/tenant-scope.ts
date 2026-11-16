import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Models that carry hospitalId, read from the generated client (37 required + 4 optional). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'hospitalId'))
    .map((m) => m.name),
);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

export function tenantMismatch(): ForbiddenException {
  return new ForbiddenException({
    code: 'TENANT_MISMATCH',
    message: 'This record belongs to another hospital.',
  });
}

type Data = Record<string, unknown>;

function scopeData(data: unknown, hospitalId: string): Data {
  const d = { ...(data as Data) };
  // Relation-style tenant assignment would bypass the check; scoped code must use the scalar.
  if ('hospital' in d) throw tenantMismatch();
  if (d.hospitalId !== undefined && d.hospitalId !== hospitalId) throw tenantMismatch();
  d.hospitalId = hospitalId;
  return d;
}

function guardUpdateData(data: unknown, hospitalId: string): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Data;
  if ('hospital' in d) throw tenantMismatch();
  if (d.hospitalId !== undefined && d.hospitalId !== hospitalId) throw tenantMismatch();
  return d;
}

/**
 * Rewrites the arguments of one Prisma operation so it can only see or change rows of hospitalId.
 * Reads and writes are filtered by hospitalId; creates get hospitalId set (a different value is
 * rejected); tenants can never be changed. Rows in other tenants simply do not exist for the caller,
 * so lookups return null / not found (404), never another hospital's data. Nested relation writes
 * are additionally protected by the composite (id, hospitalId) foreign keys (DEC-018).
 */
export function scopeArgs(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  hospitalId: string,
): Record<string, unknown> {
  if (!TENANT_MODELS.has(model)) return args ?? {};
  const a: Record<string, unknown> = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) {
    a.where = { ...((a.where as Data | undefined) ?? {}), hospitalId };
  }
  if (CREATE_OPS.has(operation)) {
    a.data = Array.isArray(a.data)
      ? a.data.map((d) => scopeData(d, hospitalId))
      : scopeData(a.data, hospitalId);
  }
  if (operation === 'upsert') {
    a.create = scopeData(a.create, hospitalId);
    a.update = guardUpdateData(a.update, hospitalId);
  }
  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
    a.data = guardUpdateData(a.data, hospitalId);
  }
  return a;
}
