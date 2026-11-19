import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the multi-tenancy rules of prisma/schema.prisma (PRD section 03) so a future model
 * or relation cannot silently weaken tenant isolation.
 */
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');

interface ModelInfo {
  name: string;
  body: string;
  hospitalId: 'required' | 'optional' | 'none';
}

const models: ModelInfo[] = [...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)].map((m) => {
  const name = m[1] as string;
  const body = m[2] as string;
  const hid = /^\s+hospitalId\s+String(\?)?/m.exec(body);
  return { name, body, hospitalId: !hid ? 'none' : hid[1] ? 'optional' : 'required' };
});

/**
 * Tables that are deliberately not owned by one hospital. StatutoryRoomTaxRule (M-11a) is platform
 * reference data: the statutory room rule applies to every hospital and is append-only (R-13).
 */
const GLOBAL_MODELS = ['Hospital', 'Icd10Code', 'StatutoryRoomTaxRule', 'WebhookEvent'];
/** Platform-level rows (Super Admin activity) may have no hospital. */
const OPTIONAL_TENANT_MODELS = ['User', 'Notification', 'NotificationDelivery', 'AuditLog'];
/** Relations from required-tenant models that intentionally stay single-column. */
const SINGLE_COLUMN_ALLOWED = ['Diagnosis.icd10 -> Icd10Code'];

describe('schema multi-tenancy rules', () => {
  it('parses the expected number of models', () => {
    expect(models.length).toBe(51);
  });

  it('every model carries hospitalId unless it is a documented global model', () => {
    const missing = models.filter((m) => m.hospitalId === 'none').map((m) => m.name);
    expect(missing.sort()).toEqual([...GLOBAL_MODELS].sort());
  });

  it('only documented platform-level models have an optional hospitalId', () => {
    const optional = models.filter((m) => m.hospitalId === 'optional').map((m) => m.name);
    expect(optional.sort()).toEqual([...OPTIONAL_TENANT_MODELS].sort());
  });

  it('every relation between hospital-owned tables is a composite (id, hospitalId) foreign key', () => {
    const violations: string[] = [];
    for (const model of models.filter((m) => m.hospitalId === 'required')) {
      for (const line of model.body.split('\n')) {
        const rel = /^\s+(\w+)\s+(\w+)\??\s+@relation\((.*)\)/.exec(line);
        if (!rel || !line.includes('fields:')) continue;
        const [, field, target] = rel;
        if (target === 'Hospital') continue;
        const id = `${model.name}.${field} -> ${target}`;
        const composite = line.includes('hospitalId], references: [id, hospitalId]');
        // Any single-column relation to another table must be explicitly allowed.
        if (!composite && !SINGLE_COLUMN_ALLOWED.includes(id)) violations.push(id);
      }
    }
    expect(violations).toEqual([]);
  });
});
