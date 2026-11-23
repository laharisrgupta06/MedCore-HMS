"""M-11b concurrency tests with real sessions and the real clock (run with: sudo -u postgres python3 concurrency_tests.py).

Each test starts from a fresh copy of the seeded and migrated database (m11b_base) and uses real
parallel connections at READ COMMITTED (the application's level):
  C1  50 concurrent finalises in one series: serials 1..50, no gap, no duplicate
  C2  a finalise that rolls back leaves the counter unchanged; the next finalise takes the number
  C3  a line waits for an open GST registration writer (DEC-058), then matches its committed values
  C4  a line waits for an open medicine classification assignment, then matches it
  C5  a line racing a finalise: whichever locks the invoice first wins, never both
  C6  two sessions creating the visit's draft at once: exactly one succeeds
  C7  a writer that rolls back leaves the line on the old values
  C8  a replacement draft waits for an open void, then re-bills the released lab item (decision 4)
  C9  if that void rolls back, the replacement draft is refused and the lab item stays on the draft
"""
import threading
import time

import psycopg

A = "aaaaaaaa-0000-0000-0000-000000000001"
B = "bbbbbbbb-0000-0000-0000-000000000001"
RC, AC, ADM = "aaaaaaaa-0000-0000-0000-0000000000a2", "aaaaaaaa-0000-0000-0000-0000000000a3", "aaaaaaaa-0000-0000-0000-0000000000a1"
RC_B, ADM_B = "bbbbbbbb-0000-0000-0000-0000000000b2", "bbbbbbbb-0000-0000-0000-0000000000b1"
PT, PT_B = "aaaaaaaa-0000-0000-0000-0000000000e6", "bbbbbbbb-0000-0000-0000-0000000000e6"
DOC, DEPT = "aaaaaaaa-0000-0000-0000-0000000000c4", "aaaaaaaa-0000-0000-0000-0000000000d0"
VB = "bbbbbbbb-0000-0000-0000-00000000a001"
V1 = "aaaaaaaa-0000-0000-0000-00000000a001"
ROOM_5000 = "aaaaaaaa-0000-0000-0000-00000000e003"
C_SVC_B, V_SVC_B = "22222222-0000-0000-0000-000000000001", "22222222-0000-0000-0000-000000000101"
GSTIN_B = "29AAACB1234F1Z1"  # replaced below by a computed valid GSTIN
DB = "m11b_run"
results = []


def gstin(first14):
    al = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    s = 0
    for i, ch in enumerate(first14):
        p = al.index(ch) * (1 if i % 2 == 0 else 2)
        s += p // 36 + p % 36
    return first14 + al[(36 - s % 36) % 36]


GSTIN_B = gstin("29AAACB1234F1Z")


def report(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def fresh():
    with psycopg.connect("dbname=postgres", autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {DB} TEMPLATE m11b_base")


def conn():
    return psycopg.connect(f"dbname={DB}")


def today(c):
    return c.execute(f"SELECT medcore_local_date('{A}')").fetchone()[0]


def room_line(c, inv, id_, hosp=A, by=RC):
    c.execute(
        'INSERT INTO invoice_items (id,"hospitalId","invoiceId",kind,description,quantity,"unitPrice","lineTotal","serviceDate","addedById",'
        '"classificationName","hsnSac","supplyType",treatment,"ratePercent","priceIncludesTax","gstCollected","grossAmount","taxableValue",'
        '"taxAmount","roomId","roomRuleId","roomDailyCharge","roomCriticalCare") VALUES (%s,%s,%s,\'ROOM\',\'Ward\',1,5000,5000,%s,%s,'
        '\'Room accommodation\',\'9993\',\'SERVICE\',\'EXEMPT\',0,false,true,5000,5000,0,%s,'
        '(SELECT id FROM statutory_room_tax_rules ORDER BY "effectiveFrom" DESC LIMIT 1),5000,false)',
        (id_, hosp, inv, today(c), by, ROOM_5000))
    c.execute('UPDATE invoices SET subtotal=subtotal+5000, total=total+5000 WHERE id=%s', (inv,))


def visits(n):
    """n extra visits for patient A, each with an empty draft and one exempt room line, committed."""
    ids = []
    with conn() as c:
        for i in range(n):
            v = f"aaaaaaaa-1111-0000-0000-{i:012d}"
            inv = f"aaaaaaaa-2222-0000-0000-{i:012d}"
            c.execute("SET LOCAL session_replication_role = replica")
            c.execute('INSERT INTO appointments (id,"hospitalId","doctorId","patientId","departmentId","scheduledAt","endAt",status,"createdById","updatedAt") '
                      "VALUES (%s,%s,%s,%s,%s,timestamptz '2025-01-01 00:00+00'+%s*interval '1 hour',timestamptz '2025-01-01 00:15+00'+%s*interval '1 hour','COMPLETED',%s,now())",
                      (v, A, DOC, PT, DEPT, i, i, RC))
            c.execute("SET LOCAL session_replication_role = origin")
            c.execute('INSERT INTO invoices (id,"hospitalId","appointmentId","patientId","createdById","updatedAt") VALUES (%s,%s,%s,%s,%s,now())',
                      (inv, A, v, PT, RC))
            room_line(c, inv, f"aaaaaaaa-3333-0000-0000-{i:012d}")
            c.commit()
            ids.append(inv)
    return ids


# ---- C1 -----------------------------------------------------------------------------------------
fresh()
invs = visits(50)
errors = []
barrier = threading.Barrier(50)


def fin(inv):
    try:
        with conn() as c:
            barrier.wait()
            c.execute("UPDATE invoices SET status='FINALISED', \"finalisedById\"=%s WHERE id=%s", (RC, inv))
    except Exception as e:  # noqa: BLE001
        errors.append(str(e))


ts = [threading.Thread(target=fin, args=(i,)) for i in invs]
[t.start() for t in ts]
[t.join() for t in ts]
with conn() as c:
    serials = sorted(r[0] for r in c.execute("SELECT serial FROM invoices WHERE status='FINALISED'"))
    nums = c.execute('SELECT count(DISTINCT "invoiceNumber") FROM invoices WHERE status=\'FINALISED\'').fetchone()[0]
    nxt = c.execute('SELECT "nextSerial" FROM document_number_series').fetchall()
report("C1 50 concurrent finalises: serials 1..50, no gap or duplicate, counter at 51",
       not errors and serials == list(range(1, 51)) and nums == 50 and nxt == [(51,)],
       f"errors={len(errors)}, serials {serials[:3]}..{serials[-3:]}, series rows {nxt}")

# ---- C2 -----------------------------------------------------------------------------------------
fresh()
invs = visits(2)
with conn() as c:
    c.execute("UPDATE invoices SET status='FINALISED', \"finalisedById\"=%s WHERE id=%s", (RC, invs[0]))
    got = c.execute('SELECT "invoiceNumber" FROM invoices WHERE id=%s', (invs[0],)).fetchone()[0]
    c.rollback()
with conn() as c:
    c.execute("UPDATE invoices SET status='FINALISED', \"finalisedById\"=%s WHERE id=%s", (RC, invs[1]))
    c.commit()
    n2 = c.execute('SELECT "invoiceNumber" FROM invoices WHERE id=%s', (invs[1],)).fetchone()[0]
    series = c.execute('SELECT count(*) FROM document_number_series').fetchone()[0]
report("C2 a rolled-back finalise leaves no gap", got.endswith("/00001") and n2.endswith("/00001") and series == 1, f"{got} rolled back, then {n2}")


# ---- C3: registration writer open while a line is written (DEC-058) --------------------------------
def b_draft():
    with conn() as c:
        c.execute('INSERT INTO invoices (id,"hospitalId","appointmentId","patientId","createdById","updatedAt") VALUES '
                  "('bbbbbbbb-2222-0000-0000-000000000001',%s,%s,%s,%s,now())", (B, VB, PT_B, RC_B))
        c.commit()


def b_consult(c, collected):
    reason = None if collected else "UNREGISTERED"
    c.execute(
        'INSERT INTO invoice_items (id,"hospitalId","invoiceId",kind,description,quantity,"unitPrice","lineTotal","serviceDate",'
        '"classificationId","classificationVersionId","classificationName","hsnSac","supplyType",treatment,"ratePercent","priceIncludesTax",'
        '"gstCollected","notCollectedReason","grossAmount","taxableValue","taxAmount","consultationAppointmentId") VALUES '
        "('bbbbbbbb-3333-0000-0000-000000000001',%s,'bbbbbbbb-2222-0000-0000-000000000001','CONSULTATION','Consultation',1,400,400,"
        "%s,%s,%s,'Healthcare services','999312','SERVICE','EXEMPT',0,false,%s,%s,400,400,0,%s)",
        (B, today(c), C_SVC_B, V_SVC_B, collected, reason, VB))
    c.execute("UPDATE invoices SET subtotal=400, total=400 WHERE id='bbbbbbbb-2222-0000-0000-000000000001'")


def race(writer_sql, writer_args, line_fn, writer_commits):
    """Writer opens a transaction and holds its locks; the line starts, must wait, then the writer ends."""
    w = conn()
    w.execute(writer_sql, writer_args)
    out = {}

    def line():
        t0 = time.time()
        try:
            with conn() as c:
                line_fn(c)
                c.commit()
            out["ok"] = True
        except Exception as e:  # noqa: BLE001
            out["ok"] = False
            out["err"] = str(e).splitlines()[0]
        out["waited"] = time.time() - t0

    t = threading.Thread(target=line)
    t.start()
    time.sleep(1.5)
    waiting = t.is_alive()
    (w.commit if writer_commits else w.rollback)()
    w.close()
    t.join()
    return waiting, out


REG_SQL = ('INSERT INTO hospital_gst_registrations (id,"hospitalId","registrationType",gstin,"legalName","stateCode","effectiveFrom","attestedById") '
           "VALUES (gen_random_uuid(),%s,'REGULAR',%s,'Hospital B Pvt Ltd','29',medcore_tax_date(%s),%s)")

fresh()
b_draft()
waiting, out = race(REG_SQL, (B, GSTIN_B, B, ADM_B), lambda c: b_consult(c, collected=False), True)
report("C3a a line waits for an open registration writer; stale 'unregistered' snapshot refused after commit",
       waiting and not out["ok"] and "notCollectedReason" in out.get("err", "") and out["waited"] >= 1.4,
       f"waited {out['waited']:.1f}s: {out.get('err', 'committed')}")
fresh()
b_draft()
waiting, out = race(REG_SQL, (B, GSTIN_B, B, ADM_B), lambda c: b_consult(c, collected=True), True)
report("C3b ... and a line matching the committed registration succeeds", waiting and out["ok"], f"waited {out['waited']:.1f}s {out.get('err', '')}")
fresh()
b_draft()
waiting, out = race(REG_SQL, (B, GSTIN_B, B, ADM_B), lambda c: b_consult(c, collected=False), False)
report("C7 a registration writer that rolls back leaves the line on the old values", waiting and out["ok"], f"waited {out['waited']:.1f}s {out.get('err', '')}")

# ---- C4: medicine classification assignment open while a pharmacy line is written ------------------
SYRUP_INV = "aaaaaaaa-2222-0000-0000-000000000099"


def syrup_unclassified(c):
    c.execute('INSERT INTO invoice_items (id,"hospitalId","invoiceId",kind,description,quantity,"unitPrice","lineTotal","serviceDate",'
              'unclassified,"grossAmount","taxableValue","taxAmount","dispenseId") VALUES '
              "('aaaaaaaa-3333-0000-0000-000000000099',%s,%s,'PHARMACY','Syrup',1,90,90,%s,true,90,90,0,'aaaaaaaa-0000-0000-0000-00000000d402')",
              (A, SYRUP_INV, today(c)))
    c.execute('UPDATE invoices SET subtotal=90, total=90 WHERE id=%s', (SYRUP_INV,))


fresh()
with conn() as c:
    c.execute('INSERT INTO invoices (id,"hospitalId","appointmentId","patientId","createdById","updatedAt") VALUES (%s,%s,%s,%s,%s,now())',
              (SYRUP_INV, A, V1, PT, RC))
    c.commit()
# The M-11a assignment trigger itself locks the hospital row, then writes the classification row.
ASSIGN = "UPDATE medicines SET \"taxClassificationId\"=%s WHERE id='aaaaaaaa-0000-0000-0000-00000000d002'"
waiting, out = race(ASSIGN, ("11111111-0000-0000-0000-000000000005",), syrup_unclassified, True)
report("C4 a pharmacy line waits for an open classification assignment, then refuses the stale 'unclassified' snapshot",
       waiting and not out["ok"] and "unclassified" in out.get("err", ""), f"waited {out['waited']:.1f}s: {out.get('err', 'committed')}")

# ---- C5: line versus finalise --------------------------------------------------------------------
fresh()
invs = visits(1)
w = conn()
room_line(w, invs[0], "aaaaaaaa-3333-0000-0000-000000000077")  # holds the invoice lock
out = {}


def do_fin():
    try:
        with conn() as c:
            c.execute("UPDATE invoices SET status='FINALISED', \"finalisedById\"=%s WHERE id=%s", (RC, invs[0]))
            c.commit()
            out["ok"] = True
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["err"] = str(e).splitlines()[0]


t = threading.Thread(target=do_fin)
t.start()
time.sleep(1.5)
waited = t.is_alive()
w.commit()
w.close()
t.join()
with conn() as c:
    total, n = c.execute('SELECT total, (SELECT count(*) FROM invoice_items WHERE "invoiceId"=%s) FROM invoices WHERE id=%s', (invs[0], invs[0])).fetchone()
report("C5a a finalise waits for an open line, then issues it with both lines", waited and out.get("ok") and n == 2 and total == 10000,
       f"total {total}, lines {n}")

fresh()
invs = visits(1)
f = conn()
f.execute("UPDATE invoices SET status='FINALISED', \"finalisedById\"=%s WHERE id=%s", (RC, invs[0]))  # holds the invoice
out = {}


def do_line():
    try:
        with conn() as c:
            room_line(c, invs[0], "aaaaaaaa-3333-0000-0000-000000000078")
            c.commit()
            out["ok"] = True
    except Exception as e:  # noqa: BLE001
        out["ok"] = False
        out["err"] = str(e).splitlines()[0]


t = threading.Thread(target=do_line)
t.start()
time.sleep(1.5)
waited = t.is_alive()
f.commit()
f.close()
t.join()
report("C5b a line waits for an open finalise, then is refused", waited and not out["ok"] and "issued or void" in out.get("err", ""),
       out.get("err", "committed"))

# ---- C6: concurrent draft creation ----------------------------------------------------------------
fresh()
errs, oks = [], []
bar = threading.Barrier(2)


def mk(i):
    try:
        with conn() as c:
            bar.wait()
            c.execute('INSERT INTO invoices (id,"hospitalId","appointmentId","patientId","createdById","updatedAt") VALUES (%s,%s,%s,%s,%s,now())',
                      (f"aaaaaaaa-2222-0000-0000-00000000005{i}", A, V1, PT, RC))
            c.commit()
            oks.append(i)
    except Exception as e:  # noqa: BLE001
        errs.append(str(e).splitlines()[0])


ts = [threading.Thread(target=mk, args=(i,)) for i in range(2)]
[t.start() for t in ts]
[t.join() for t in ts]
report("C6 two sessions create the visit's draft at once: exactly one succeeds", len(oks) == 1 and len(errs) == 1
       and ("invoices_one_draft_per_appointment" in errs[0] or "invoices_appointmentId_sequence_key" in errs[0]), errs[0] if errs else "")

# ---- C8, C9: void racing its replacement (decision 4) -----------------------------------------------
LAB_LINE = ('INSERT INTO invoice_items (id,"hospitalId","invoiceId",kind,description,quantity,"unitPrice","lineTotal","serviceDate",'
            '"classificationId","classificationVersionId","classificationName","hsnSac","supplyType",treatment,"ratePercent","priceIncludesTax",'
            '"gstCollected","grossAmount","taxableValue","taxAmount","labOrderItemId") VALUES (%s,%s,%s,\'LAB\',\'CBC\',1,350,350,%s,'
            "'11111111-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000103','Diagnostics','999316','SERVICE','EXEMPT',0,false,"
            "true,350,350,0,'aaaaaaaa-0000-0000-0000-00000000c201')")
D1, D2 = "aaaaaaaa-2222-0000-0000-0000000000d1", "aaaaaaaa-2222-0000-0000-0000000000d2"


def void_race(commit_void):
    fresh()
    with conn() as c:
        c.execute('INSERT INTO invoices (id,"hospitalId","appointmentId","patientId","createdById","updatedAt") VALUES (%s,%s,%s,%s,%s,now())',
                  (D1, A, V1, PT, RC))
        c.execute(LAB_LINE, ("aaaaaaaa-3333-0000-0000-0000000000d1", A, D1, today(c)))
        c.execute("UPDATE invoices SET subtotal=350, total=350 WHERE id=%s", (D1,))
        c.commit()
    v = conn()
    v.execute("UPDATE invoices SET status='VOID', \"voidedById\"=%s, \"voidReason\"='Voided by mistake' WHERE id=%s", (RC, D1))
    out = {}

    def replacement():
        t0 = time.time()
        try:
            with conn() as c:
                c.execute('INSERT INTO invoices (id,"hospitalId","appointmentId","patientId","createdById","updatedAt") VALUES (%s,%s,%s,%s,%s,now())',
                          (D2, A, V1, PT, RC))
                c.execute(LAB_LINE, ("aaaaaaaa-3333-0000-0000-0000000000d2", A, D2, today(c)))
                c.execute("UPDATE invoices SET subtotal=350, total=350 WHERE id=%s", (D2,))
                c.commit()
            out["ok"] = True
        except Exception as e:  # noqa: BLE001
            out["ok"] = False
            out["err"] = str(e).splitlines()[0]
        out["waited"] = time.time() - t0

    t = threading.Thread(target=replacement)
    t.start()
    time.sleep(1.5)
    waiting = t.is_alive()
    (v.commit if commit_void else v.rollback)()
    v.close()
    t.join()
    with conn() as c:
        live = c.execute('SELECT count(*) FROM invoice_items WHERE "labOrderItemId"=\'aaaaaaaa-0000-0000-0000-00000000c201\' AND "releasedAt" IS NULL').fetchone()[0]
        total = c.execute('SELECT count(*) FROM invoice_items WHERE "labOrderItemId"=\'aaaaaaaa-0000-0000-0000-00000000c201\'').fetchone()[0]
    return waiting, out, live, total


waiting, out, live, total = void_race(True)
report("C8 a replacement draft waits for an open void, then re-bills the released lab item; one live line, both kept",
       waiting and out.get("ok") and live == 1 and total == 2, f"waited {out['waited']:.1f}s, live {live}, lines {total} {out.get('err', '')}")
waiting, out, live, total = void_race(False)
report("C9 if the void rolls back, the replacement is refused and the lab item stays on the original draft",
       waiting and not out.get("ok") and "invoices_one_draft_per_appointment" in out.get("err", "") and live == 1 and total == 1,
       f"{out.get('err', 'committed')}; live {live}, lines {total}")

with psycopg.connect("dbname=postgres", autocommit=True) as c:
    c.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
print(f"\n{sum(results)}/{len(results)} concurrency checks passed")
