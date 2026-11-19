# GSTIN validation reference (M-11a, DEC-048 revision 2)

This records what `medcore_gstin_valid()` accepts and refuses, the sources each rule comes from, and
the test vectors that `gstin_verification.py` checks against an independent implementation. The full
output of the last run is in `gstin_verification-output.txt`.

## What the function checks

A GSTIN is accepted only if all of these hold:

| Position | Rule                                                          | Pattern                                  |
| -------- | ------------------------------------------------------------- | ---------------------------------------- |
| 1-2      | State code 01 to 38                                           | `[0-9]{2}`, then 1..38                   |
| 3-12     | The holder's PAN: 5 letters, 4 digits, 1 letter               | `[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]` |
| 4        | PAN holder type: A, B, C, F, G, H, J, L, P or T               | `[ABCFGHJLPT]`                           |
| 8-11     | PAN serial is not 0000                                        |                                          |
| 13       | Registration number for that PAN in that state: 1-9, then A-Z | `[1-9A-Z]`                               |
| 14       | Always `Z` for a normal or composition taxpayer               | `Z`                                      |
| 15       | Check character: Luhn mod 36 over characters 1 to 14          | `[0-9A-Z]`                               |

Full pattern: `^[0-9]{2}[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`.

Input must already be upper case. The function is IMMUTABLE and STRICT (NULL in, NULL out; the column
check treats NULL according to the registration type, as before).

## Accepted

- Normal and composition taxpayer registrations (14th character `Z`), built on an individual,
  company, firm, trust, association of persons, body of individuals, government, local authority,
  artificial juridical person or Hindu undivided family PAN (holder types P, C, F, T, A, B, G, L, J, H).
- Every state and union territory code from 01 to 38, including 38 (Ladakh).

## Refused, and why

| Format                                                                         | Example                          | Why a hospital invoice cannot carry it                                                               |
| ------------------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Tax deductor (TDS) registration: TAN-based, or `D` in position 14              | 07DELS71442A1DD, 22AACAA7875J1DV | Issued to deduct tax, not to make supplies. Real hospitals hold these in addition to a normal GSTIN. |
| Tax collector (TCS, e-commerce operator): `C` in position 14                   |                                  | Collects tax for others; not a supplier registration.                                                |
| UIN (UN bodies, embassies)                                                     |                                  | Recipients, not suppliers.                                                                           |
| Non-resident taxable person and OIDAR (state code 97 or 99, or a non-PAN base) |                                  | A hospital in India registers as a normal taxpayer.                                                  |
| PAN holder type K (krish, a historical Income Tax category)                    | 27AAPKU0939F1ZK                  | Not in the Income Tax Department's current list of holder types. stdnum accepts it.                  |
| State code 00 or above 38                                                      |                                  | No such state or union territory.                                                                    |
| PAN serial 0000                                                                |                                  | Not issued.                                                                                          |
| Lower case                                                                     | 37aahaa4036g1zy                  | Refused by the database; the API must upper-case input before saving (stdnum normalises).            |
| Wrong length, wrong check character                                            | 27AAPFU0939F1Z, 27AAPFU0939F1ZO  | Malformed.                                                                                           |

If MedCore ever needs to record one of the refused types (for example a hospital's own tax deductor
registration), that is a new column or table and a new reviewed migration, not a relaxation of this check.

## Sources

| Rule                                            | Source                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure (state, PAN, entity number, Z, check) | GST registration rules and GSTN's published format; the check algorithm is not formally published by GSTN, so it is verified against real issued numbers below |
| PAN holder types                                | Income Tax Department, incometaxindia.gov.in (PAN structure, fourth character)                                                                                 |
| Check character (Luhn mod 36)                   | python-stdnum 2.2, `stdnum.in_.gstin` (an independent implementation, used as the oracle)                                                                      |
| State codes 01 to 38                            | GST state code list; 38 Ladakh added after the 2019 reorganisation                                                                                             |

## Test vectors

### Real GSTINs from published documents (all accepted, and accepted by stdnum)

| GSTIN           | Holder                                                        | Source                                                          |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| 37AAHAA4036G1ZY | AIIMS Mangalagiri                                             | GST registration certificate, aiimsmangalagiri.edu.in (primary) |
| 24AADCB2295A1Z7 | Baroda Medicare Pvt Ltd (Sunshine Global Hospital)            | Gujarat AAR 106/2020, gstcouncil.gov.in (primary)               |
| 24AAQFM2633M1ZY | M/s MJ Solanki                                                | Telangana AAR 04/2024 (AIIMS Bibinagar) (primary)               |
| 07ADKPJ3897P1ZM | M/s Kore Security Services                                    | Telangana AAR 04/2024 (primary)                                 |
| 36AAVFP9999G1ZZ | M/s P. Suresh & Associates                                    | Telangana AAR 04/2024 (primary)                                 |
| 08AAAGA0038H1ZY | AIIMS Jodhpur                                                 | public GST record, knowyourgst.com                              |
| 03AAAGA2223A1ZN | AIIMS Bathinda                                                | public GST record, knowyourgst.com                              |
| 36AAAGA2453A1Z6 | AIIMS Bibinagar                                               | public GST record, piceapp.com                                  |
| 18AAAGA2376L1ZB | AIIMS Guwahati                                                | public GST record, piceapp.com                                  |
| 33AAACA5443N3ZN | Apollo Hospitals Enterprise Ltd, Tamil Nadu (entity number 3) | public GST record, piceapp.com                                  |
| 07AAACA5443N1ZK | Apollo Hospitals Enterprise Ltd, Delhi                        | public GST record, piceapp.com                                  |
| 19AAACA5443N1ZF | Apollo Hospitals Enterprise Ltd, West Bengal                  | public GST record, piceapp.com                                  |
| 07AAATG2183J1ZO | Gujarmal Modi Hospital                                        | public GST record, knowyourgst.com                              |
| 27AAPFU0939F1ZV | stdnum documented valid number                                | python-stdnum doctest                                           |

### stdnum's documented invalid numbers (refused by both)

27AAPFU0939F1ZO (check character), 27AAPFU0939F1AA (14th character not Z), 27AAPFU0939F1Z (length 14),
369296450896540 (format).

### Real tax deductor registrations (refused by design; stdnum also refuses them)

08JDHA08253A1D4 (AIIMS Jodhpur), 20RCHA03549A1DF (AIIMS Deoghar), 07DELS71442A1DD (AIIMS New Delhi),
07DELG00001B1DM (G.B. Pant Hospital), 37HYDR05893G1DJ (GGH Ongole), 19CALA25755C1D3 (AIIMS Kalyani),
22AACAA7875J1DV (AIIMS Raipur, PAN-based with D), 07DELD20333F1D7 (Dr B.R.A. IRCH).

### Generated vectors

- 7,511 single-character substitutions and adjacent transpositions of the real valid GSTINs: the SQL
  function and stdnum agree on all of them, and none is accepted.
- 20,000 random well-formed candidates with a random check character: agreement on all 20,000; 564
  valid against about 555 expected (1 in 36).

### Deliberate differences from stdnum

| GSTIN           | MedCore  | stdnum   | Reason                                         |
| --------------- | -------- | -------- | ---------------------------------------------- |
| 38AAPFU0939F1ZS | accepted | refused  | State 38 (Ladakh) is newer than stdnum's table |
| 27AAPKU0939F1ZK | refused  | accepted | Holder type K is not a current PAN category    |
| 37aahaa4036g1zy | refused  | accepted | Lower case; the API upper-cases first          |

## Limits

These checks establish that a number is well formed and carries a correct check character. They do
not establish that it is registered, active, or belongs to this hospital. That needs the GST portal or
a GSP, which is out of scope for Phase 8 (accountant review remains the release gate, DEC-054).
