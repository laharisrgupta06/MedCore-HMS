"""M-11b behaviour tests on a scratch PostgreSQL 16 database (seed.sql, then migration.sql).

Each case runs in its own transaction that is rolled back. All but the last statement must succeed;
the last must succeed ("ok") or fail with an error containing the expected text. Every case starts
with a simulated clock (medcore_tax_clock() replaced inside the transaction) at 2026-11-18 12:00 IST,
as in the M-11a tests. COMMIT_CHECK runs the commit-time (deferred) checks at that point.
"""
import subprocess
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "m11b"
A = "aaaaaaaa-0000-0000-0000-000000000001"
B = "bbbbbbbb-0000-0000-0000-000000000001"
ADM, RC, AC, DR, PH = (f"aaaaaaaa-0000-0000-0000-0000000000a{i}" for i in (1, 2, 3, 4, 5))
RC_B, AC_B = "bbbbbbbb-0000-0000-0000-0000000000b2", "bbbbbbbb-0000-0000-0000-0000000000b3"
PT, PT_B = "aaaaaaaa-0000-0000-0000-0000000000e6", "bbbbbbbb-0000-0000-0000-0000000000e6"
V1, V2, VB = "aaaaaaaa-0000-0000-0000-00000000a001", "aaaaaaaa-0000-0000-0000-00000000a002", "bbbbbbbb-0000-0000-0000-00000000a001"
LAB1, LAB2 = "aaaaaaaa-0000-0000-0000-00000000c201", "aaaaaaaa-0000-0000-0000-00000000c202"
DISP_PARA, DISP_SYRUP, DISP_PARA2 = (f"aaaaaaaa-0000-0000-0000-00000000d40{i}" for i in (1, 2, 3))
ROOM_6000, ROOM_ICU, ROOM_5000, ROOM_NICU, ROOM_NOCHARGE = (f"aaaaaaaa-0000-0000-0000-00000000e00{i}" for i in range(1, 6))
C_SVC, C_MED, C_DIAG, C_TAXSVC, C_NIL = (f"11111111-0000-0000-0000-00000000000{i}" for i in range(1, 6))
V_SVC, V_MED12, V_MED5, V_DIAG, V_TAXSVC, V_NIL = ("11111111-0000-0000-0000-000000000101", "11111111-0000-0000-0000-000000000102",
                                                   "11111111-0000-0000-0000-000000000112", "11111111-0000-0000-0000-000000000103",
                                                   "11111111-0000-0000-0000-000000000104", "11111111-0000-0000-0000-000000000105")
C_SVC_B, V_SVC_B = "22222222-0000-0000-0000-000000000001", "22222222-0000-0000-0000-000000000101"
RULE = "(SELECT id FROM statutory_room_tax_rules ORDER BY \"effectiveFrom\" DESC LIMIT 1)"
TODAY = "2026-11-18"
FIXTURE = ("CREATE OR REPLACE FUNCTION medcore_tax_clock() RETURNS timestamptz LANGUAGE sql VOLATILE "
           "AS $$ SELECT current_setting('medcore_test.clock')::timestamptz $$; "
           "SET LOCAL medcore_test.clock = '2026-11-18 12:00:00+05:30'")
COMMIT_CHECK = "SET CONSTRAINTS ALL IMMEDIATE"
I1, I2, I3, I4 = (f"99999999-0000-0000-0000-00000000000{i}" for i in range(1, 5))


def clock(ts):
    return f"SET LOCAL medcore_test.clock = '{ts if '+' in ts else ts + '+05:30'}'"


def check(cond, label):
    """A statement that fails unless cond (SQL) is true."""
    return f"DO $$ BEGIN IF NOT ({cond}) THEN RAISE EXCEPTION 'check failed: {label}'; END IF; END $$"


def invoice(id_, appt=V1, patient=PT, by=RC, kind="ORIGINAL", related=None, hosp=A):
    rel = f"'{related}'" if related else "NULL"
    return (f"INSERT INTO invoices (id,\"hospitalId\",\"appointmentId\",\"patientId\",kind,\"relatedInvoiceId\",\"createdById\",\"updatedAt\") "
            f"VALUES ('{id_}','{hosp}','{appt}','{patient}','{kind}',{rel},'{by}',now())")


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if v.startswith("("):
        return v
    return f"'{v}'"


def line(id_, inv, kind, *, qty=1, price, gross, taxable, tax, sd=TODAY, share=0, uncl=False, cid=None, vid=None,
         name=None, hsn=None, supply=None, treat=None, rate=None, incl=None, collected=False, reason=None,
         lab=None, disp=None, room=None, rule=None, daily=None, crit=None, added=None, hosp=A, desc="Charge"):
    cols = {"id": id_, "hospitalId": hosp, "invoiceId": inv, "kind": kind, "description": desc, "quantity": qty,
            "unitPrice": price, "lineTotal": None, "serviceDate": sd, "addedById": added, "unclassified": uncl,
            "classificationId": cid, "classificationVersionId": vid, "classificationName": name, "hsnSac": hsn,
            "supplyType": supply, "treatment": treat, "ratePercent": rate, "priceIncludesTax": incl,
            "gstCollected": collected, "notCollectedReason": reason, "grossAmount": gross, "discountShare": share,
            "taxableValue": taxable, "taxAmount": tax, "labOrderItemId": lab, "dispenseId": disp, "roomId": room,
            "roomRuleId": rule, "roomDailyCharge": daily, "roomCriticalCare": crit}
    cols["lineTotal"] = round(taxable + tax, 2)
    names = ",".join(f'"{k}"' for k in cols)
    return f"INSERT INTO invoice_items ({names}) VALUES ({','.join(q(v) for v in cols.values())})"


def consult(id_, inv, **kw):
    a = dict(price=500, gross=500, taxable=500, tax=0, cid=C_SVC, vid=V_SVC, name="Healthcare services", hsn="999312",
             supply="SERVICE", treat="EXEMPT", rate=0, incl=False, collected=True)
    a.update(kw)
    return line(id_, inv, "CONSULTATION", **a)


def lab(id_, inv, item=LAB1, **kw):
    a = dict(price=350, gross=350, taxable=350, tax=0, cid=C_DIAG, vid=V_DIAG, name="Diagnostics", hsn="999316",
             supply="SERVICE", treat="EXEMPT", rate=0, incl=False, collected=True, lab=item)
    a.update(kw)
    return line(id_, inv, "LAB", **a)


def para(id_, inv, disp=DISP_PARA, **kw):
    # 10 tablets at MRP 12, 5% included (version from 22 Sep 2026): taxable round(120*100/105) = 114.29.
    a = dict(qty=10, price=12, gross=120, taxable=114.29, tax=5.71, cid=C_MED, vid=V_MED5, name="Medicaments", hsn="3004",
             supply="GOODS", treat="TAXABLE", rate=5, incl=True, collected=True, disp=disp)
    a.update(kw)
    return line(id_, inv, "PHARMACY", **a)


def syrup(id_, inv, **kw):
    a = dict(qty=1, price=90, gross=90, taxable=90, tax=0, uncl=True, disp=DISP_SYRUP)
    a.update(kw)
    return line(id_, inv, "PHARMACY", **a)


def room(id_, inv, rm=ROOM_6000, days=2, daily=6000, taxed=True, crit=False, **kw):
    gross = days * daily
    a = dict(qty=days, price=daily, gross=gross, taxable=gross, tax=round(gross * 0.05, 2) if taxed else 0,
             name="Room accommodation", hsn="9993", supply="SERVICE", treat="TAXABLE" if taxed else "EXEMPT",
             rate=5 if taxed else 0, incl=False, collected=True, room=rm, rule=RULE, daily=daily, crit=crit, added=RC)
    a.update(kw)
    return line(id_, inv, "ROOM", **a)


def totals(inv):
    s = lambda c: f"(SELECT COALESCE(sum(\"{c}\"),0) FROM invoice_items WHERE \"invoiceId\"='{inv}')"
    return (f"UPDATE invoices SET subtotal={s('taxableValue')}, \"taxAmount\"={s('taxAmount')}, "
            f"\"discountAmount\"={s('discountShare')}, total={s('lineTotal')} WHERE id='{inv}'")


def finalise(inv, by=RC):
    return f"UPDATE invoices SET status='FINALISED', \"finalisedById\"='{by}' WHERE id='{inv}'"


def number_is(inv, n):
    return check(f"(SELECT \"invoiceNumber\" FROM invoices WHERE id='{inv}') = '{n}'", f"number {n}")


L1, L2, L3, L4, L5 = (f"88888888-0000-0000-0000-00000000000{i}" for i in range(1, 6))
DRAFT_A = [invoice(I1), consult(L1, I1), totals(I1)]
ISSUED_A = DRAFT_A + [finalise(I1)]

CASES = [
    # ---- creation ---------------------------------------------------------------------------
    ("empty draft is created with sequence 1 and a CREATED event", [invoice(I1),
        check(f"(SELECT \"sequence\" FROM invoices WHERE id='{I1}') = 1", "sequence"),
        check(f"EXISTS (SELECT 1 FROM invoice_events WHERE \"invoiceId\"='{I1}' AND kind='CREATED')", "event")], "ok"),
    ("invoice patient must be the visit's patient", [invoice(I1, patient=PT_B)], "patient of its visit"),
    ("draft cannot start with totals", [invoice(I1).replace("\"updatedAt\")", "\"updatedAt\",total)").replace("now())", "now(),5)")],
        "starts as an empty draft"),
    ("draft cannot carry a document number", [invoice(I1), f"UPDATE invoices SET \"invoiceNumber\"='TI/26-27/00001' WHERE id='{I1}'"],
        "set by the database"),
    ("one open draft per visit", [invoice(I1), invoice(I2)], "invoices_one_draft_per_appointment"),
    ("one live original per visit", ISSUED_A + [invoice(I2)], "invoices_one_original_per_appointment"),
    ("a voided original draft can be replaced; the new one is sequence 2", [invoice(I1),
        f"UPDATE invoices SET status='VOID', \"voidedById\"='{RC}', \"voidReason\"='Opened for the wrong visit' WHERE id='{I1}'",
        invoice(I2), check(f"(SELECT \"sequence\" FROM invoices WHERE id='{I2}') = 2", "sequence 2")], "ok"),
    ("late-charge invoice needs an issued original", DRAFT_A + [invoice(I2, kind="LATE_CHARGES", related=I1)],
        "follows the issued original"),
    ("late-charge invoice after the original is issued; original untouched", ISSUED_A + [
        "CREATE TEMP TABLE before_snap AS SELECT to_jsonb(i) j FROM invoices i WHERE id='" + I1 + "'",
        invoice(I2, kind="LATE_CHARGES", related=I1), lab("88888888-0000-0000-0000-0000000000f1", I2), totals(I2), finalise(I2),
        number_is(I2, "BOS/26-27/00002"),
        check(f"(SELECT to_jsonb(i) FROM invoices i WHERE id='{I1}') = (SELECT j FROM before_snap)", "original unchanged"),
        COMMIT_CHECK], "ok"),
    ("a late-charge invoice must follow an original of the same visit", ISSUED_A + [invoice(I2, appt=V2, kind="LATE_CHARGES", related=I1)],
        "follows the issued original"),
    ("invoices are never deleted, not even drafts", [invoice(I1), f"DELETE FROM invoices WHERE id='{I1}'"], "never deleted"),

    # ---- lines: source, price, snapshot ------------------------------------------------------
    ("consultation line with the right snapshot; totals checked at commit", DRAFT_A + [COMMIT_CHECK], "ok"),
    ("totals that differ from the lines are refused at commit", [invoice(I1), consult(L1, I1), COMMIT_CHECK],
        "Invoice totals must equal the sum of its lines"),
    ("consultation price must be the doctor's fee", [invoice(I1), consult(L1, I1, price=450, gross=450, taxable=450)],
        "must be 1 x 500.00 from its source"),
    ("a visit is charged one consultation", DRAFT_A + [consult(L2, I1)], "already charged a consultation"),
    ("wrong classification for a consultation", [invoice(I1), consult(L1, I1, cid=C_DIAG, vid=V_DIAG, name="Diagnostics", hsn="999316")],
        "classificationId, classificationVersionId, classificationName, hsnSac"),
    ("wrong collection flag (regular hospital collects)", [invoice(I1), consult(L1, I1, collected=False, reason="UNREGISTERED")],
        "gstCollected, notCollectedReason"),
    ("lab line uses the lab default and the test price", [invoice(I1), lab(L1, I1), totals(I1), COMMIT_CHECK], "ok"),
    ("lab line must belong to the invoice's visit", [invoice(I1), lab(L1, I1, item=LAB2)], "must belong to the invoice's visit"),
    ("lab test's own classification wins over the default", [invoice(I1),
        f"UPDATE lab_tests SET \"taxClassificationId\"='{C_SVC}' WHERE id='aaaaaaaa-0000-0000-0000-00000000c001'",
        lab(L1, I1, cid=C_SVC, vid=V_SVC, name="Healthcare services", hsn="999312")], "ok"),
    ("pharmacy line: version in force on the service date (5% from 22 Sep, MRP includes tax)", [invoice(I1), para(L1, I1), totals(I1), COMMIT_CHECK], "ok"),
    ("pharmacy line dated before the rate change keeps the old 12% version", [invoice(I1),
        para(L1, I1, sd="2026-09-21", vid=V_MED12, rate=12, taxable=107.14, tax=12.86)], "ok"),
    ("pharmacy line with the old version on a later date is refused", [invoice(I1), para(L1, I1, vid=V_MED12, rate=12, taxable=107.14, tax=12.86)],
        "classificationVersionId, ratePercent"),
    ("pharmacy quantity and price come from the dispense", [invoice(I1), para(L1, I1, qty=9, gross=108, taxable=102.86, tax=5.14)],
        "must be 10 x 12.00"),
    ("pharmacy line of another visit is refused", [invoice(I1), para(L1, I1, disp=DISP_PARA2)], "must belong to the invoice's visit"),
    ("unclassified medicine is stored unclassified, never blocked", [invoice(I1), syrup(L1, I1), totals(I1), COMMIT_CHECK], "ok"),
    ("unclassified medicine cannot be claimed as classified", [invoice(I1),
        syrup(L1, I1, uncl=False, cid=C_MED, vid=V_MED5, name="Medicaments", hsn="3004", supply="GOODS", treat="TAXABLE", rate=5, incl=True,
              collected=True, taxable=85.71, tax=4.29)], "unclassified, classificationId"),
    ("arithmetic is checked: tax added on top must round half-up", [invoice(I1),
        line(L1, I1, "OTHER", price=100, gross=100, taxable=100, tax=18.01, cid=C_TAXSVC, vid=V_TAXSVC, name="Taxable service", hsn="998599",
             supply="SERVICE", treat="TAXABLE", rate=18, incl=False, collected=True, added=RC)], "invoice_items_arithmetic_chk"),
    ("other charge at 18% added on top", [invoice(I1),
        line(L1, I1, "OTHER", price=100, gross=100, taxable=100, tax=18, cid=C_TAXSVC, vid=V_TAXSVC, name="Taxable service", hsn="998599",
             supply="SERVICE", treat="TAXABLE", rate=18, incl=False, collected=True, added=RC), totals(I1), COMMIT_CHECK], "ok"),
    ("other charge needs a classification", [invoice(I1), line(L1, I1, "OTHER", price=100, gross=100, taxable=100, tax=0, added=RC)],
        "needs a tax classification"),
    ("other charge with an inactive classification is refused (DEC-059)", [invoice(I1),
        f"UPDATE tax_classifications SET \"isActive\"=false WHERE id='{C_NIL}'",
        line(L1, I1, "OTHER", price=100, gross=100, taxable=100, tax=0, cid=C_NIL, vid=V_NIL, name="Life-saving drugs", hsn="3002",
             supply="GOODS", treat="NIL_RATED", rate=0, incl=False, collected=True, added=RC)], "inactive or has no rate"),
    ("medicine on a deactivated classification becomes unclassified", [invoice(I1),
        f"UPDATE medicines SET \"taxClassificationId\"='{C_NIL}' WHERE id='aaaaaaaa-0000-0000-0000-00000000d001'",
        f"UPDATE tax_classifications SET \"isActive\"=false WHERE id='{C_NIL}'",
        para(L1, I1, uncl=True, cid=None, vid=None, name=None, hsn=None, supply=None, treat=None, rate=None, incl=None,
             collected=False, taxable=120, tax=0)], "ok"),
    ("a charge cannot be dated after today", [invoice(I1), consult(L1, I1, sd="2026-11-20")], "cannot be dated after today"),
    ("draft line: only the snapshot and discount share can change", DRAFT_A + [f"UPDATE invoice_items SET \"unitPrice\"=1 WHERE id='{L1}'"],
        "Only the tax snapshot and discount share"),
    ("re-resolve: classify the medicine, update the draft line, then finalise", [invoice(I1), syrup(L1, I1), totals(I1),
        f"UPDATE medicines SET \"taxClassificationId\"='{C_NIL}' WHERE id='aaaaaaaa-0000-0000-0000-00000000d002'",
        f"UPDATE invoice_items SET unclassified=false, \"classificationId\"='{C_NIL}', \"classificationVersionId\"='{V_NIL}', "
        f"\"classificationName\"='Life-saving drugs', \"hsnSac\"='3002', \"supplyType\"='GOODS', treatment='NIL_RATED', \"ratePercent\"=0, "
        f"\"priceIncludesTax\"=false, \"gstCollected\"=true WHERE id='{L1}'",
        totals(I1), finalise(I1), number_is(I1, "BOS/26-27/00001"), COMMIT_CHECK], "ok"),
    ("draft lines can be removed", DRAFT_A + [f"DELETE FROM invoice_items WHERE id='{L1}'", totals(I1), COMMIT_CHECK], "ok"),

    # ---- rooms (DEC-049) --------------------------------------------------------------------
    ("room above 5,000 a day: 5% on the whole charge", [invoice(I1), room(L1, I1), totals(I1), COMMIT_CHECK], "ok"),
    ("room at exactly 5,000 stays exempt", [invoice(I1), room(L1, I1, rm=ROOM_5000, daily=5000, taxed=False)], "ok"),
    ("room at exactly 5,000 claimed taxable is refused", [invoice(I1), room(L1, I1, rm=ROOM_5000, daily=5000, taxed=True)], "treatment, ratePercent"),
    ("ICU room exempt at any price", [invoice(I1), room(L1, I1, rm=ROOM_ICU, daily=8000, taxed=False, crit=True)], "ok"),
    ("NICU (critical-care unit) exempt at any price", [invoice(I1), room(L1, I1, rm=ROOM_NICU, daily=9000, taxed=False, crit=True)], "ok"),
    ("room line price is the room's daily charge", [invoice(I1), room(L1, I1, daily=5500)], "must be 2 x 6000.00"),
    ("room without a daily charge is refused", [invoice(I1), room(L1, I1, rm=ROOM_NOCHARGE, daily=1)], "no daily charge"),
    ("manual lines record who added them", [invoice(I1), room(L1, I1, added=None)], "invoice_items_manual_by_chk"),

    # ---- discount (Q2 B, DEC-051) -------------------------------------------------------------
    ("accountant discount, shared and recorded (worked example of the plan)", [invoice(I1), consult(L1, I1), para(L2, I1),
        f"UPDATE invoice_items SET \"discountShare\"=50, \"taxableValue\"=450, \"lineTotal\"=450 WHERE id='{L1}'",
        f"UPDATE invoice_items SET \"discountShare\"=12, \"taxableValue\"=102.86, \"taxAmount\"=5.14, \"lineTotal\"=108 WHERE id='{L2}'",
        f"UPDATE invoices SET \"discountAmount\"=62, \"discountReason\"='Senior citizen concession', \"discountSetById\"='{AC}', "
        f"subtotal=552.86, \"taxAmount\"=5.14, total=558.00 WHERE id='{I1}'",
        check(f"(SELECT \"discountSetAt\" IS NOT NULL FROM invoices WHERE id='{I1}')", "set time"),
        check(f"EXISTS (SELECT 1 FROM invoice_events WHERE \"invoiceId\"='{I1}' AND kind='DISCOUNT_CHANGED' AND \"actorId\"='{AC}')", "event"),
        COMMIT_CHECK], "ok"),
    ("a receptionist cannot discount", DRAFT_A + [f"UPDATE invoice_items SET \"discountShare\"=50, \"taxableValue\"=450, \"lineTotal\"=450 WHERE id='{L1}'",
        f"UPDATE invoices SET \"discountAmount\"=50, \"discountReason\"='Concession', \"discountSetById\"='{RC}', subtotal=450, total=450 WHERE id='{I1}'"],
        "Only an accountant"),
    ("a discount needs a reason", DRAFT_A + [f"UPDATE invoices SET \"discountAmount\"=50, \"discountSetById\"='{AC}' WHERE id='{I1}'"],
        "invoices_discount_chk"),
    ("discount shares must add up to the discount (at commit)", DRAFT_A + [
        f"UPDATE invoice_items SET \"discountShare\"=40, \"taxableValue\"=460, \"lineTotal\"=460 WHERE id='{L1}'",
        f"UPDATE invoices SET \"discountAmount\"=50, \"discountReason\"='Concession', \"discountSetById\"='{AC}', subtotal=450, total=450 WHERE id='{I1}'",
        COMMIT_CHECK], "Invoice totals must equal"),
    ("a share cannot exceed its line", DRAFT_A + [f"UPDATE invoice_items SET \"discountShare\"=501, \"taxableValue\"=-1 WHERE id='{L1}'"],
        "invoice_items_arithmetic_chk"),

    # ---- finalising and numbering (DEC-052) ----------------------------------------------------
    ("finalise: bill of supply for exempt lines; number, seller and events", ISSUED_A + [number_is(I1, "BOS/26-27/00001"),
        check(f"(SELECT (\"documentType\",\"issueDate\",\"financialYear\",\"numberingScope\",\"sellerGstin\",\"sellerStateCode\",\"registrationType\")::text "
              f"FROM invoices WHERE id='{I1}') = '(BILL_OF_SUPPLY,2026-11-18,26-27,27AAPFU0939F1ZV,27AAPFU0939F1ZV,27,REGULAR)'", "snapshot"),
        check(f"EXISTS (SELECT 1 FROM invoice_events WHERE \"invoiceId\"='{I1}' AND kind='FINALISED' AND note='BOS/26-27/00001')", "event"),
        COMMIT_CHECK], "ok"),
    ("finalise: tax invoice when every line is taxed", [invoice(I1), para(L1, I1), totals(I1), finalise(I1), number_is(I1, "TI/26-27/00001")], "ok"),
    ("finalise: invoice-cum-bill of supply for mixed lines (Rule 46A)", [invoice(I1), consult(L1, I1), para(L2, I1), totals(I1), finalise(I1),
        number_is(I1, "ICB/26-27/00001")], "ok"),
    ("unregistered hospital: no GST collected, bill of supply, hospital scope", [
        invoice(I1, appt=VB, patient=PT_B, by=RC_B, hosp=B),
        consult(L1, I1, hosp=B, price=400, gross=400, taxable=400, cid=C_SVC_B, vid=V_SVC_B, collected=False, reason="UNREGISTERED"),
        totals(I1), finalise(I1, by=RC_B), number_is(I1, "BOS/26-27/00001"),
        check(f"(SELECT \"numberingScope\" FROM invoices WHERE id='{I1}') = 'HOSPITAL:{B}'", "scope"),
        check(f"(SELECT \"sellerGstin\" IS NULL AND \"registrationType\"='UNREGISTERED' FROM invoices WHERE id='{I1}')", "seller")], "ok"),
    ("two hospitals number independently", ISSUED_A + [
        invoice(I2, appt=VB, patient=PT_B, by=RC_B, hosp=B),
        consult(L2, I2, hosp=B, price=400, gross=400, taxable=400, cid=C_SVC_B, vid=V_SVC_B, collected=False, reason="UNREGISTERED"),
        totals(I2), finalise(I2, by=RC_B), number_is(I1, "BOS/26-27/00001"), number_is(I2, "BOS/26-27/00001")], "ok"),
    ("a voided draft keeps its lines and their sources: a lab item is billed once, ever", ISSUED_A + [
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2), totals(I2),
        f"UPDATE invoices SET status='VOID', \"voidedById\"='{RC}', \"voidReason\"='Patient left' WHERE id='{I2}'",
        invoice(I3, appt=V2), lab(L3, I3, item=LAB2)], "invoice_items_labOrderItemId_key"),
    ("consecutive numbers in one series; a voided draft consumes none", ISSUED_A + [
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2), totals(I2),
        f"UPDATE invoices SET status='VOID', \"voidedById\"='{RC}', \"voidReason\"='Patient left' WHERE id='{I2}'",
        invoice(I3, appt=V2), room(L3, I3, rm=ROOM_5000, daily=5000, taxed=False, days=1), totals(I3), finalise(I3), number_is(I3, "BOS/26-27/00002"),
        check(f"(SELECT \"invoiceNumber\" IS NULL FROM invoices WHERE id='{I2}')", "void has no number")], "ok"),
    ("only a receptionist or accountant can finalise", DRAFT_A + [finalise(I1, by=DR)], "Only a receptionist or accountant can finalise"),
    ("tax set-up must be confirmed first", DRAFT_A + [
        f"UPDATE hospitals SET \"taxSetupConfirmedAt\"=NULL, \"taxSetupConfirmedById\"=NULL WHERE id='{A}'", finalise(I1)],
        "confirm the tax set-up"),
    ("an empty invoice cannot be finalised", [invoice(I1), finalise(I1)], "at least one line"),
    ("unclassified lines block finalising", [invoice(I1), syrup(L1, I1), totals(I1), finalise(I1)], "must be classified"),
    ("totals must match when finalising", [invoice(I1), consult(L1, I1), finalise(I1)], "Invoice totals must equal the sum"),
    ("nothing to pay cannot be finalised", [invoice(I1), consult(L1, I1, share=500, taxable=0),
        f"UPDATE invoices SET \"discountAmount\"=500, \"discountReason\"='Staff family', \"discountSetById\"='{AC}' WHERE id='{I1}'",
        finalise(I1)], "nothing to pay"),
    ("the application cannot supply the number", DRAFT_A + [
        f"UPDATE invoices SET status='FINALISED', \"finalisedById\"='{RC}', \"invoiceNumber\"='BOS/26-27/00042' WHERE id='{I1}'"],
        "set by the database"),
    ("financial year: 31 March 23:59 and 1 April 00:00 are different years", [invoice(I1), consult(L1, I1), totals(I1),
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2), totals(I2),
        clock("2027-03-31 23:59:00"), finalise(I1), clock("2027-04-01 00:00:00"), finalise(I2),
        number_is(I1, "BOS/26-27/00001"), number_is(I2, "BOS/27-28/00001")], "ok"),
    ("series exhaustion: 99,999 is the last number", ISSUED_A + [
        f"UPDATE document_number_series SET \"nextSerial\"=99999 WHERE \"hospitalId\"='{A}'",
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2), totals(I2), finalise(I2), number_is(I2, "BOS/26-27/99999")], "ok"),
    ("series exhaustion refuses the next number", ISSUED_A + [
        f"UPDATE document_number_series SET \"nextSerial\"=100000 WHERE \"hospitalId\"='{A}'",
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2), totals(I2), finalise(I2)], "SERIES_EXHAUSTED"),
    ("new registration under the same GSTIN opens a series with a new prefix", ISSUED_A + [
        clock("2026-11-18 12:00:00"),
        "SET LOCAL session_replication_role = replica",
        f"INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",gstin,\"legalName\",\"stateCode\",\"effectiveFrom\",\"attestedById\") "
        f"VALUES ('33333333-0000-0000-0000-000000000002','{A}','COMPOSITION','27AAPFU0939F1ZV','Hospital A LLP','27','2026-11-18','{ADM}')",
        "SET LOCAL session_replication_role = origin",
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2, collected=False, reason="COMPOSITION"), totals(I2), finalise(I2),
        number_is(I2, "BOS2/26-27/00001"),
        check(f"(SELECT \"registrationType\"='COMPOSITION' FROM invoices WHERE id='{I2}')", "composition")], "ok"),

    # ---- issued documents are immutable (DEC-053) ------------------------------------------------
    ("issued: amounts cannot change", ISSUED_A + [f"UPDATE invoices SET total=1 WHERE id='{I1}'"], "cannot be changed in MedCore"),
    ("issued: cannot be voided", ISSUED_A + [
        f"UPDATE invoices SET status='VOID', \"voidedById\"='{AC}', \"voidReason\"='Wrong patient' WHERE id='{I1}'"], "cannot be cancelled in MedCore"),
    ("issued: number cannot change", ISSUED_A + [f"UPDATE invoices SET \"invoiceNumber\"='BOS/26-27/00009' WHERE id='{I1}'"], "cannot be changed"),
    ("issued: lines cannot change", ISSUED_A + [f"UPDATE invoice_items SET \"discountShare\"=0 WHERE id='{L1}'"], "Lines of an issued"),
    ("issued: lines cannot be removed", ISSUED_A + [f"DELETE FROM invoice_items WHERE id='{L1}'"], "Lines of an issued"),
    ("issued: lines cannot be added", ISSUED_A + [lab(L2, I1)], "Lines of an issued"),
    ("issued: payment status is not set in M-11b", ISSUED_A + [f"UPDATE invoices SET status='PAID' WHERE id='{I1}'"], "payment rules (M-12)"),
    ("issued: a receipt can be attached once", ISSUED_A + [
        f"INSERT INTO file_attachments (id,\"hospitalId\",purpose,\"storageKey\",\"originalName\",\"mimeType\",\"sizeBytes\",\"sha256\",\"uploadedById\") "
        f"VALUES ('77777777-0000-0000-0000-000000000001','{A}','RECEIPT_PDF','k','receipt.pdf','application/pdf',1,repeat('a',64),'{RC}')",
        f"UPDATE invoices SET \"receiptFileId\"='77777777-0000-0000-0000-000000000001' WHERE id='{I1}'"], "ok"),
    ("void is final", [invoice(I1), f"UPDATE invoices SET status='VOID', \"voidedById\"='{RC}', \"voidReason\"='Opened by mistake' WHERE id='{I1}'",
        f"UPDATE invoices SET status='DRAFT', \"voidedAt\"=NULL, \"voidedById\"=NULL, \"voidReason\"=NULL WHERE id='{I1}'"], "void invoice cannot change"),
    ("void needs a reason", [invoice(I1), f"UPDATE invoices SET status='VOID', \"voidedById\"='{RC}' WHERE id='{I1}'"], "invoices_void_chk"),
    ("a doctor cannot void", [invoice(I1), f"UPDATE invoices SET status='VOID', \"voidedById\"='{DR}', \"voidReason\"='Not needed' WHERE id='{I1}'"],
        "Only a receptionist or accountant can void"),
    ("a draft cannot be paid", DRAFT_A + [f"UPDATE invoices SET status='PAID' WHERE id='{I1}'"], "finalise it first"),

    # ---- correction requests and notes ------------------------------------------------------------
    ("correction request on an issued document, with history; the document is unchanged", ISSUED_A + [
        "CREATE TEMP TABLE before_snap AS SELECT to_jsonb(i) j FROM invoices i WHERE id='" + I1 + "'",
        f"INSERT INTO invoice_correction_requests (\"hospitalId\",\"invoiceId\",kind,description,\"requestedById\") "
        f"VALUES ('{A}','{I1}','CANCEL_DOCUMENT','Patient was billed for the wrong visit','{RC}')",
        check(f"EXISTS (SELECT 1 FROM invoice_events WHERE \"invoiceId\"='{I1}' AND kind='CORRECTION_REQUESTED')", "event"),
        check(f"(SELECT to_jsonb(i) FROM invoices i WHERE id='{I1}') = (SELECT j FROM before_snap)", "unchanged"),
        f"INSERT INTO invoice_correction_request_notes (\"hospitalId\",\"requestId\",note,\"externalReference\",\"authorId\") "
        f"SELECT '{A}', id, 'Credit note issued outside MedCore', 'CN-2026-0012', '{AC}' FROM invoice_correction_requests"], "ok"),
    ("no correction request on a draft", DRAFT_A + [
        f"INSERT INTO invoice_correction_requests (\"hospitalId\",\"invoiceId\",kind,description,\"requestedById\") "
        f"VALUES ('{A}','{I1}','CHANGE_AMOUNTS','Please change the fee please','{RC}')"], "only for issued documents"),
    ("a doctor cannot request a correction", ISSUED_A + [
        f"INSERT INTO invoice_correction_requests (\"hospitalId\",\"invoiceId\",kind,description,\"requestedById\") "
        f"VALUES ('{A}','{I1}','CHANGE_AMOUNTS','Please change the fee please','{DR}')"], "Only a receptionist or accountant"),
    ("only an accountant adds outcome notes", ISSUED_A + [
        f"INSERT INTO invoice_correction_requests (\"hospitalId\",\"invoiceId\",kind,description,\"requestedById\") "
        f"VALUES ('{A}','{I1}','WRONG_DETAILS','Wrong address printed on it','{RC}')",
        f"INSERT INTO invoice_correction_request_notes (\"hospitalId\",\"requestId\",note,\"authorId\") "
        f"SELECT '{A}', id, 'Handled', '{RC}' FROM invoice_correction_requests"], "Only an accountant can add"),
    ("correction requests are append-only", ISSUED_A + [
        f"INSERT INTO invoice_correction_requests (\"hospitalId\",\"invoiceId\",kind,description,\"requestedById\") "
        f"VALUES ('{A}','{I1}','WRONG_DETAILS','Wrong address printed on it','{RC}')",
        "UPDATE invoice_correction_requests SET description='changed description here'"], "append-only"),
    ("invoice history is append-only", [invoice(I1), "DELETE FROM invoice_events"], "append-only"),

    # ---- series rules ---------------------------------------------------------------------------
    ("series are never deleted", ISSUED_A + ["DELETE FROM document_number_series"], "never deleted"),
    ("series counter never goes down", ISSUED_A + ["UPDATE document_number_series SET \"nextSerial\"=1"], "never goes down"),
    ("series prefix never changes", ISSUED_A + ["UPDATE document_number_series SET prefix='XX'"], "keeps its scope"),
    ("a closed series issues nothing more; finalising opens the next prefix", ISSUED_A + [
        f"UPDATE document_number_series SET \"closedAt\"=now(), \"closedById\"='{ADM}'",
        invoice(I2, appt=V2), lab(L2, I2, item=LAB2), totals(I2), finalise(I2), number_is(I2, "BOS2/26-27/00001")], "ok"),
    ("prefixes are unique within a scope and year", ISSUED_A + [
        f"INSERT INTO document_number_series (\"hospitalId\",\"gstRegistrationId\",\"numberingScope\",\"documentType\",\"financialYear\",prefix,\"openedById\") "
        f"VALUES ('{A}','33333333-0000-0000-0000-000000000001','27AAPFU0939F1ZV','TAX_INVOICE','26-27','BOS','{ADM}')"],
        "document_number_series_numberingScope_financialYear_prefix_key"),
    ("an issued number is unique in its scope and year", ISSUED_A + [
        "SET LOCAL session_replication_role = replica",
        f"INSERT INTO invoices (id,\"hospitalId\",\"appointmentId\",\"patientId\",kind,\"sequence\",\"createdById\",\"updatedAt\",status,\"invoiceNumber\","
        f"\"finalisedAt\",\"finalisedById\",\"documentType\",\"issueDate\",\"financialYear\",\"numberingScope\",\"seriesId\",serial,\"registrationType\") "
        f"SELECT '{I2}','{A}','{V2}','{PT}','ORIGINAL',1,'{RC}',now(),'FINALISED','BOS/26-27/00001',now(),'{RC}','BILL_OF_SUPPLY','2026-11-18','26-27',"
        f"'27AAPFU0939F1ZV',(SELECT id FROM document_number_series LIMIT 1),2,'UNREGISTERED'"],
        "invoices_numberingScope_financialYear_invoiceNumber_key"),

    # ---- tenancy and isolation level --------------------------------------------------------------
    ("a line cannot use another hospital's classification", [invoice(I1, appt=VB, patient=PT_B, by=RC_B, hosp=B),
        line(L1, I1, "OTHER", hosp=B, price=100, gross=100, taxable=100, tax=18, cid=C_TAXSVC, vid=V_TAXSVC, name="Taxable service",
             hsn="998599", supply="SERVICE", treat="TAXABLE", rate=18, incl=False, collected=False, reason="UNREGISTERED", added=RC_B)],
        "inactive or has no rate"),
    ("an invoice cannot reference another hospital's visit", [invoice(I1, appt=VB, patient=PT_B, by=RC)], "violates foreign key"),
    ("billing writes refuse REPEATABLE READ", ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", invoice(I1)], "must run at READ COMMITTED"),
]


def run(case):
    name, stmts, expect = case
    head = [s for s in stmts if s.startswith("SET TRANSACTION")]
    body = [s for s in stmts if not s.startswith("SET TRANSACTION")]
    stmts = head + [FIXTURE] + body
    sql = "BEGIN;\n" + ";\n".join(stmts) + ";\nROLLBACK;\n"
    p = subprocess.run(["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB],
                       input=sql, capture_output=True, text=True, cwd="/tmp")
    err = p.stderr.strip()
    if expect == "ok":
        good = p.returncode == 0
    else:
        good = p.returncode != 0 and expect in err
        if good and len(stmts) > 1:
            prefix = "BEGIN;\n" + ";\n".join(stmts[:-1]) + ";\nROLLBACK;\n"
            r = subprocess.run(["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB],
                               input=prefix, capture_output=True, text=True, cwd="/tmp")
            good = r.returncode == 0
            if not good:
                err = "set-up failed: " + r.stderr.strip()
    return good, err


failed = 0
for c in CASES:
    good, err = run(c)
    print(("PASS " if good else "FAIL ") + c[0])
    if not good:
        failed += 1
        print("     expected:", c[2], "\n     got:", err[:400] or "success")
print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
sys.exit(1 if failed else 0)
