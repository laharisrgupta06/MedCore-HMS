import { SEARCH_ACCESS, SearchService } from './search.service';

/** DASH-012: search queries only the kinds a role may open, on the tenant client, with no clinical fields. */
describe('SearchService', () => {
  const make = () => {
    const queried: string[] = [];
    const model = (name: string) => ({
      findMany: (args: { select?: Record<string, unknown> }) => {
        queried.push(name);
        expect(JSON.stringify(args.select ?? {})).not.toMatch(
          /diagnos|items|result|total|amount|notes/i,
        );
        return Promise.resolve([]);
      },
      findFirst: () =>
        Promise.resolve(name === 'hospital' ? { timezone: 'Asia/Kolkata' } : { id: 'd1' }),
    });
    const client = Object.fromEntries(
      ['hospital', 'patient', 'doctor', 'appointment', 'invoice', 'prescription', 'medicine'].map(
        (m) => [m, model(m)],
      ),
    );
    return { svc: new SearchService({ client } as never), queried };
  };
  const actor = (role: string) =>
    ({ userId: 'u1', role, hospitalId: 'h1', sessionId: 's' }) as never;

  it.each(
    Object.entries({
      RECEPTIONIST: ['patients', 'doctors', 'appointments', 'invoices'],
      PHARMACIST: ['patients', 'doctors', 'prescriptions', 'medicines'],
      LAB_TECHNICIAN: ['patients', 'doctors'],
      ACCOUNTANT: ['patients', 'doctors', 'appointments', 'invoices'],
    }),
  )('%s searches only %j', async (role, kinds) => {
    const { svc, queried } = make();
    const r = await svc.search(actor(role), 'ram');
    expect(r.searched).toEqual(kinds);
    const table: Record<string, string> = {
      patients: 'patient',
      doctors: 'doctor',
      appointments: 'appointment',
      invoices: 'invoice',
      prescriptions: 'prescription',
      medicines: 'medicine',
    };
    expect([...new Set(queried)].sort()).toEqual(kinds.map((k) => table[k]).sort());
  });

  it('never lets a patient or the platform super admin search', () => {
    for (const roles of Object.values(SEARCH_ACCESS)) {
      expect(roles).not.toContain('PATIENT');
      expect(roles).not.toContain('SUPER_ADMIN');
    }
  });

  it('refuses a query shorter than 2 characters', async () => {
    await expect(make().svc.search(actor('DOCTOR'), ' a ')).rejects.toMatchObject({ status: 400 });
  });

  it('cannot widen the kinds beyond the role by asking for them', async () => {
    const r = await make().svc.search(actor('LAB_TECHNICIAN'), 'ram', [
      'invoices',
      'prescriptions',
    ]);
    expect(r.searched).toEqual([]);
  });
});
