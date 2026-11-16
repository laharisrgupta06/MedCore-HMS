import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseIcdCsv } from './load-icd10';

describe('ICD-10 loader', () => {
  it('parses quoted titles and rejects malformed rows', () => {
    expect(
      parseIcdCsv(
        'code,title\r\nj06.9,"Acute upper respiratory infection, unspecified"\nI10,Essential (primary) hypertension\n',
      ),
    ).toEqual([
      { code: 'J06.9', title: 'Acute upper respiratory infection, unspecified' },
      { code: 'I10', title: 'Essential (primary) hypertension' },
    ]);
    expect(() => parseIcdCsv('id,name\nI10,x')).toThrow('header');
    expect(() => parseIcdCsv('code,title\n123,Bad')).toThrow('Line 2');
  });

  it('bundled subset is valid and unique', () => {
    const codes = parseIcdCsv(
      readFileSync(resolve(__dirname, '../../prisma/data/icd10-cm-subset.csv'), 'utf8'),
    );
    expect(codes.length).toBeGreaterThan(70);
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
  });
});
