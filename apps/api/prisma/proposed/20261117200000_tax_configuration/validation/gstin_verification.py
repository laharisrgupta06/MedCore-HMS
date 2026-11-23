"""Independent verification of medcore_gstin_valid() (M-11a revision 2).

Compares the SQL function with python-stdnum 2.2 (stdnum.in_.gstin, an independent implementation:
generic Luhn mod-N over all 15 characters) on:
  1. real GSTINs taken from published documents (primary sources first);
  2. stdnum's own documented test numbers;
  3. real registrations of other types (tax deductor), which a hospital does not invoice under;
  4. every single-character substitution and adjacent transposition of each real valid GSTIN;
  5. 20,000 random well-formed candidates with a random check character.
Known, deliberate differences (state code 38, PAN holder type K) are reported separately.
"""
import random
import subprocess
import sys

from stdnum.in_ import gstin as sd

DB = sys.argv[1] if len(sys.argv) > 1 else "m11a"
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def sql_valid(numbers):
    out = {}
    for i in range(0, len(numbers), 2000):
        chunk = numbers[i:i + 2000]
        values = ",".join(f"({j},'{n}')" for j, n in enumerate(chunk))
        q = f"SELECT j, coalesce(medcore_gstin_valid(g), false) FROM (VALUES {values}) v(j, g) ORDER BY j"
        r = subprocess.run(["sudo", "-u", "postgres", "psql", "-d", DB, "-Atc", q],
                           capture_output=True, text=True, cwd="/tmp", check=True)
        for line in r.stdout.split():
            j, ok = line.split("|")
            out[chunk[int(j)]] = ok == "t"
    return out


REAL_VALID = [
    # (gstin, holder, source) - primary sources first
    ("37AAHAA4036G1ZY", "AIIMS Mangalagiri", "AIIMS Mangalagiri GST registration certificate, aiimsmangalagiri.edu.in"),
    ("24AADCB2295A1Z7", "Baroda Medicare Pvt Ltd (Sunshine Global Hospital)", "Gujarat AAR 106/2020, gstcouncil.gov.in"),
    ("24AAQFM2633M1ZY", "M/s MJ Solanki", "Telangana AAR 04/2024 (AIIMS Bibinagar), taxmanagementindia.com / livelaw.in"),
    ("07ADKPJ3897P1ZM", "M/s Kore Security Services", "Telangana AAR 04/2024 (AIIMS Bibinagar)"),
    ("36AAVFP9999G1ZZ", "M/s P. Suresh & Associates", "Telangana AAR 04/2024 (AIIMS Bibinagar)"),
    ("08AAAGA0038H1ZY", "AIIMS Jodhpur", "public GST record, knowyourgst.com"),
    ("03AAAGA2223A1ZN", "AIIMS Bathinda", "public GST record, knowyourgst.com"),
    ("36AAAGA2453A1Z6", "AIIMS Bibinagar", "public GST record, piceapp.com (shown in lower case)"),
    ("18AAAGA2376L1ZB", "AIIMS Guwahati", "public GST record, piceapp.com (shown in lower case)"),
    ("33AAACA5443N3ZN", "Apollo Hospitals Enterprise Ltd, Tamil Nadu", "public GST record, piceapp.com"),
    ("07AAACA5443N1ZK", "Apollo Hospitals Enterprise Ltd, Delhi", "public GST record, piceapp.com"),
    ("19AAACA5443N1ZF", "Apollo Hospitals Enterprise Ltd, West Bengal", "public GST record, piceapp.com"),
    ("07AAATG2183J1ZO", "Gujarmal Modi Hospital", "public GST record, knowyourgst.com"),
    ("27AAPFU0939F1ZV", "stdnum documented valid number", "python-stdnum doctest"),
]
STDNUM_INVALID = [("27AAPFU0939F1ZO", "check character"), ("27AAPFU0939F1AA", "14th character not Z"),
                  ("27AAPFU0939F1Z", "length 14"), ("369296450896540", "format")]
REAL_OTHER_TYPES = [
    ("08JDHA08253A1D4", "AIIMS Jodhpur, tax deductor (TAN-based)"),
    ("20RCHA03549A1DF", "AIIMS Deoghar, tax deductor"),
    ("07DELS71442A1DD", "AIIMS New Delhi, tax deductor"),
    ("07DELG00001B1DM", "G.B. Pant Hospital, tax deductor"),
    ("37HYDR05893G1DJ", "Government General Hospital Ongole, tax deductor"),
    ("19CALA25755C1D3", "AIIMS Kalyani, tax deductor"),
    ("22AACAA7875J1DV", "AIIMS Raipur, tax deductor (PAN-based, D in place of Z)"),
    ("07DELD20333F1D7", "Dr B.R.A. Institute Rotary Cancer Hospital, tax deductor"),
]

results = []


def check(label, ok):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + label)


print("== 1. Real GSTINs from published documents (expected valid in both)")
s = sql_valid([g for g, _, _ in REAL_VALID])
for g, who, src in REAL_VALID:
    check(f"{g}  {who}  [{src}]  SQL={s[g]} stdnum={sd.is_valid(g)}", s[g] and sd.is_valid(g))

print("\n== 2. stdnum's documented invalid numbers (expected invalid in both)")
s = sql_valid([g for g, _ in STDNUM_INVALID])
for g, why in STDNUM_INVALID:
    check(f"{g}  ({why})  SQL={s[g]} stdnum={sd.is_valid(g)}", not s[g] and not sd.is_valid(g))

print("\n== 3. Real registrations of other types (refused by design: not a supplier registration)")
s = sql_valid([g for g, _ in REAL_OTHER_TYPES])
for g, who in REAL_OTHER_TYPES:
    check(f"{g}  {who}  SQL={s[g]} stdnum={sd.is_valid(g)}", not s[g])

print("\n== 4. Every single substitution and adjacent transposition of the real valid GSTINs")
mutants = set()
for g, _, _ in REAL_VALID:
    for i in range(15):
        for c in ALPHABET:
            if c != g[i]:
                mutants.add(g[:i] + c + g[i + 1:])
        if i < 14 and g[i] != g[i + 1]:
            mutants.add(g[:i] + g[i + 1] + g[i] + g[i + 2:])
mutants = sorted(mutants)
s = sql_valid(mutants)
agree = sum(1 for m in mutants if s[m] == sd.is_valid(m))
sql_accepts = [m for m in mutants if s[m]]
check(f"{len(mutants)} mutants: SQL and stdnum agree on {agree}", agree == len(mutants))
# A mutant can only pass if it changes a position the check character does not protect in a way
# that still forms a valid number; report how many each validator accepts.
print(f"     mutants accepted: SQL {len(sql_accepts)}, stdnum {sum(1 for m in mutants if sd.is_valid(m))}"
      " (single substitutions of the check-protected part are always caught by Luhn mod 36)")
subs_in_body = [m for m in sql_accepts if sum(a != b for a, b in zip(m, next(g for g, _, _ in REAL_VALID if sum(x != y for x, y in zip(g, m)) <= 2))) == 1]
check(f"no single-character substitution of a real GSTIN is accepted ({len(subs_in_body)} found)", not subs_in_body)

print("\n== 5. 20,000 random well-formed candidates with a random check character")
random.seed(20261118)
STATES = [f"{i:02d}" for i in range(1, 38)]          # 01..37: the codes both validators know
HOLDERS = "ABCFGHJLPT"                                 # the Income Tax Department list
cands = []
for _ in range(20000):
    pan = ("".join(random.choice(ALPHABET[10:]) for _ in range(3)) + random.choice(HOLDERS)
           + random.choice(ALPHABET[10:]) + f"{random.randint(1, 9999):04d}" + random.choice(ALPHABET[10:]))
    body = random.choice(STATES) + pan + random.choice(ALPHABET[1:]) + "Z"
    cands.append(body + random.choice(ALPHABET))
s = sql_valid(cands)
agree = sum(1 for c in cands if s[c] == sd.is_valid(c))
valid_n = sum(1 for c in cands if s[c])
check(f"{len(cands)} candidates: SQL and stdnum agree on {agree}; {valid_n} valid (about 1 in 36 expected: {len(cands) // 36})",
      agree == len(cands))

print("\n== 6. Deliberate differences from stdnum")
from stdnum import luhn
ladakh = "38AAPFU0939F1Z" + luhn.calc_check_digit("38AAPFU0939F1Z", ALPHABET)
k_type = "27AAPKU0939F1Z" + luhn.calc_check_digit("27AAPKU0939F1Z", ALPHABET)
s = sql_valid([ladakh, k_type])
check(f"{ladakh} state 38 (Ladakh, assigned after stdnum's table): SQL={s[ladakh]} stdnum={sd.is_valid(ladakh)}", s[ladakh])
check(f"{k_type} PAN holder K (not in the Income Tax Department list): SQL={s[k_type]} stdnum={sd.is_valid(k_type)}", not s[k_type])
low = REAL_VALID[0][0].lower()
s = sql_valid([low])
check(f"{low} lower case: SQL={s[low]} (the API must upper-case input first); stdnum={sd.is_valid(low)} (normalises)", not s[low])

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
