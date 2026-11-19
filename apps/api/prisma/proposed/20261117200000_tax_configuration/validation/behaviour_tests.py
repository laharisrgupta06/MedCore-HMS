"""M-11a behaviour tests on a scratch PostgreSQL 16 database.

Each case runs in its own transaction that is rolled back, so cases are independent. A case is a
list of statements: all but the last must succeed; the last must succeed (expect "ok") or fail with
an error containing the expected text.

Revision 2: every case starts with a simulated clock (FIXTURE): medcore_tax_clock() is replaced,
inside the case's own transaction, by a function reading the setting medcore_test.clock, set to
2026-11-18 12:00 India time. A case moves time with clock(...). "SET CONSTRAINTS ALL IMMEDIATE" runs
the deferred (commit-time) checks at that point, with the clock as it then stands, which is what a
COMMIT at that moment would do. Cases marked REAL_CLOCK run without the fixture.
"""
import subprocess
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "m11a"
A = "aaaaaaaa-0000-0000-0000-000000000001"
UA = "aaaaaaaa-0000-0000-0000-0000000000a1"
B = "bbbbbbbb-0000-0000-0000-000000000001"
UB = "bbbbbbbb-0000-0000-0000-0000000000b1"
LAB = "aaaaaaaa-0000-0000-0000-00000000c001"
MED = "aaaaaaaa-0000-0000-0000-00000000d001"
ROOM = "aaaaaaaa-0000-0000-0000-00000000e001"
TODAY = "'2026-11-18'::date"
FIXTURE = ("CREATE OR REPLACE FUNCTION medcore_tax_clock() RETURNS timestamptz LANGUAGE sql VOLATILE "
           "AS $$ SELECT current_setting('medcore_test.clock')::timestamptz $$; "
           "SET LOCAL medcore_test.clock = '2026-11-18 12:00:00+05:30'")
REAL_CLOCK = "-- real clock"


def clock(ts):
    """Move the simulated clock (India time unless an offset is given)."""
    return f"SET LOCAL medcore_test.clock = '{ts if '+' in ts else ts + '+05:30'}'"


COMMIT_CHECK = "SET CONSTRAINTS ALL IMMEDIATE"

SVC = "11111111-0000-0000-0000-000000000001"   # service classification, hospital A
GDS = "11111111-0000-0000-0000-000000000002"   # goods classification, hospital A
SVC_B = "22222222-0000-0000-0000-000000000001"  # service classification, hospital B


def cls(id_, hosp, user, name, supply, code, active="true"):
    return (f'INSERT INTO tax_classifications (id,"hospitalId",name,"supplyType","hsnSac","isActive",'
            f'"createdById","updatedAt") VALUES (\'{id_}\',\'{hosp}\',\'{name}\',\'{supply}\',\'{code}\','
            f'{active},\'{user}\',now())')


def ver(id_, c, treatment, rate, incl, start, hosp=A, user=UA):
    return (f'INSERT INTO tax_classification_versions (id,"hospitalId","classificationId",treatment,'
            f'"ratePercent","priceIncludesTax","effectiveFrom","createdById") VALUES (\'{id_}\','
            f'\'{hosp}\',\'{c}\',\'{treatment}\',{rate},{incl},{start},\'{user}\')')


def reg(id_, hosp, user, typ, gstin, name, state, start=TODAY):
    q = lambda v: "NULL" if v is None else f"'{v}'"
    return (f'INSERT INTO hospital_gst_registrations (id,"hospitalId","registrationType",gstin,'
            f'"legalName","stateCode","effectiveFrom","attestedById") VALUES (\'{id_}\',\'{hosp}\','
            f'\'{typ}\',{q(gstin)},{q(name)},{q(state)},{start},\'{user}\')')


DEACT_G = f"UPDATE tax_classifications SET \"isActive\"=false WHERE id='{GDS}'"
BASE = [cls(SVC, A, UA, "Healthcare services", "SERVICE", "9993"),
        cls(GDS, A, UA, "Medicaments", "GOODS", "3004")]
V1 = "33333333-0000-0000-0000-000000000001"
V2 = "33333333-0000-0000-0000-000000000002"
R1 = "44444444-0000-0000-0000-000000000001"
R2 = "44444444-0000-0000-0000-000000000002"
GSTIN_A = "27AAPFU0939F1ZV"

CASES = [
    # --- Classifications
    ("classification: service with SAC 9993", BASE[:1], "ok"),
    ("classification: goods with HSN 30049099", [cls(GDS, A, UA, "M", "GOODS", "30049099")], "ok"),
    ("classification: service code must start with 99", [cls(SVC, A, UA, "S", "SERVICE", "3004")], "tax_classifications_code_chk"),
    ("classification: goods code must not start with 99", [cls(GDS, A, UA, "G", "GOODS", "9993")], "tax_classifications_code_chk"),
    ("classification: code of 5 digits refused", [cls(SVC, A, UA, "S", "SERVICE", "99931")], "tax_classifications_code_chk"),
    ("classification: blank name refused", [cls(SVC, A, UA, "  ", "SERVICE", "9993")], "tax_classifications_name_chk"),
    ("classification: duplicate name in one hospital refused",
     BASE + [cls("11111111-0000-0000-0000-000000000009", A, UA, "Medicaments", "GOODS", "3004")], "tax_classifications_hospitalId_name_key"),
    ("classification: same name in another hospital allowed",
     BASE + [cls(SVC_B, B, UB, "Healthcare services", "SERVICE", "9993")], "ok"),
    ("classification: creator from another hospital refused",
     [cls(SVC, A, UB, "S", "SERVICE", "9993")], "tax_classifications_createdById_hospitalId_fkey"),
    ("classification: rename allowed", BASE + [f"UPDATE tax_classifications SET name='Health care' WHERE id='{SVC}'"], "ok"),
    ("classification: code change refused", BASE + [f"UPDATE tax_classifications SET \"hsnSac\"='999311' WHERE id='{SVC}'"], "Only the name and active flag"),
    ("classification: supply type change refused", BASE + [f"UPDATE tax_classifications SET \"supplyType\"='GOODS', \"hsnSac\"='3004' WHERE id='{SVC}'"], "Only the name and active flag"),
    ("classification: move to another hospital refused", BASE + [f"UPDATE tax_classifications SET \"hospitalId\"='{B}' WHERE id='{SVC}'"], "Only the name and active flag"),
    ("classification: delete refused", BASE + [f"DELETE FROM tax_classifications WHERE id='{SVC}'"], "never deleted"),

    # --- Versions
    ("version: taxable 5% price-inclusive from today", BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY)], "ok"),
    ("version: nil-rated 0% from today", BASE + [ver(V1, GDS, "NIL_RATED", 0, "false", TODAY)], "ok"),
    ("version: exempt with a rate refused", BASE + [ver(V1, SVC, "EXEMPT", 5, "false", TODAY)], "tax_classification_versions_rate_chk"),
    ("version: taxable at 0% refused", BASE + [ver(V1, GDS, "TAXABLE", 0, "true", TODAY)], "tax_classification_versions_rate_chk"),
    ("version: taxable above 40% refused", BASE + [ver(V1, GDS, "TAXABLE", 41, "false", TODAY)], "tax_classification_versions_rate_chk"),
    ("version: exempt with tax inside the price refused", BASE + [ver(V1, SVC, "EXEMPT", 0, "true", TODAY)], "tax_classification_versions_rate_chk"),
    ("version: backdated start refused", BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " - 1")], "cannot start before 2026-11-18"),
    ("version: two versions on one date refused",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " + 30"), ver(V2, GDS, "NIL_RATED", 0, "false", TODAY + " + 30")],
     "tax_classification_versions_classificationId_effectiveFrom_key"),
    ("version: in force today cannot be edited",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE tax_classification_versions SET \"ratePercent\"=12 WHERE id='{V1}'"], "cannot change (tax date 2026-11-18)"),
    ("version: in force today cannot be deleted",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"DELETE FROM tax_classification_versions WHERE id='{V1}'"], "cannot change (tax date 2026-11-18)"),
    ("version: future version can be edited",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"UPDATE tax_classification_versions SET \"ratePercent\"=5 WHERE id='{V1}'"], "ok"),
    ("version: future version cannot be moved into the past",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"UPDATE tax_classification_versions SET \"effectiveFrom\"={TODAY} - 1 WHERE id='{V1}'"], "can only be moved to a date after 2026-11-18"),
    ("version: future version cannot change classification",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"UPDATE tax_classification_versions SET \"classificationId\"='{SVC}' WHERE id='{V1}'"], "Only the treatment, rate"),
    ("version: future version can be deleted",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"DELETE FROM tax_classification_versions WHERE id='{V1}'"], "ok"),
    # --- Revision 2: the actual clock, the commit-time check and the freeze margin
    ("clock: tomorrow's version can still be edited at 23:45",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 1"), clock("2026-11-18 23:45"),
             f"UPDATE tax_classification_versions SET \"ratePercent\"=5 WHERE id='{V1}'"], "ok"),
    ("clock: tomorrow's version is frozen from 23:50 (10-minute margin)",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 1"), clock("2026-11-18 23:52"),
             f"UPDATE tax_classification_versions SET \"ratePercent\"=5 WHERE id='{V1}'"], "cannot change (tax date 2026-11-19)"),
    ("clock: an edit made at 23:45 is refused when the commit lands after midnight",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 1"), clock("2026-11-18 23:45"),
             f"UPDATE tax_classification_versions SET \"ratePercent\"=5 WHERE id='{V1}'",
             clock("2026-11-19 00:01"), COMMIT_CHECK], "cannot change (tax date 2026-11-19)"),
    ("clock: a delete made at 23:45 is refused when the commit lands after midnight",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 1"), clock("2026-11-18 23:45"),
             f"DELETE FROM tax_classification_versions WHERE id='{V1}'",
             clock("2026-11-19 00:01"), COMMIT_CHECK], "cannot change (tax date 2026-11-19)"),
    ("clock: a version started 'today' at 23:40 is refused when the commit lands tomorrow (backdating)",
     BASE + [clock("2026-11-18 23:40"), ver(V1, GDS, "TAXABLE", 5, "true", TODAY),
             clock("2026-11-19 00:01"), COMMIT_CHECK], "cannot start before 2026-11-19"),
    ("clock: the same insert committing before 23:50 is accepted",
     BASE + [clock("2026-11-18 23:40"), ver(V1, GDS, "TAXABLE", 5, "true", TODAY),
             clock("2026-11-18 23:41"), COMMIT_CHECK], "ok"),
    ("clock: from 23:50 a first version must start tomorrow",
     BASE + [clock("2026-11-18 23:55"), ver(V1, GDS, "TAXABLE", 5, "true", TODAY)], "cannot start before 2026-11-19"),
    ("clock: a second version cannot start today once one is in force",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY), ver(V2, GDS, "TAXABLE", 5, "true", TODAY + " + 0")],
     "already has a version in force"),
    ("clock: a second version cannot start today once an earlier one is in force",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY), clock("2026-11-19 12:00"),
             ver(V2, GDS, "TAXABLE", 5, "true", TODAY + " + 1")], "already has a version in force"),
    ("clock: a second version can start tomorrow",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY), ver(V2, GDS, "TAXABLE", 5, "true", TODAY + " + 1")], "ok"),
    ("clock: a future version cannot be moved to today",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 5"),
             f"UPDATE tax_classification_versions SET \"effectiveFrom\"={TODAY} WHERE id='{V1}'"], "can only be moved to a date after"),
    ("clock: a future version inserted and deleted in one transaction is not judged as an insert at commit",
     BASE + [clock("2026-11-18 23:40"), ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " + 1"),
             f"DELETE FROM tax_classification_versions WHERE id='{V1}'", clock("2026-11-18 23:42"), COMMIT_CHECK], "ok"),
    ("clock: a version in force cannot be deleted even in the transaction that inserted it",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"DELETE FROM tax_classification_versions WHERE id='{V1}'"],
     "cannot change (tax date 2026-11-18)"),

    ("version: classification of another hospital refused",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY, hosp=B, user=UB)], "tax_classification_versions_classificationId_hospitalId_fkey"),

    # --- Item classifications on existing tables
    ("lab test: service classification accepted", BASE + [f"UPDATE lab_tests SET \"taxClassificationId\"='{SVC}' WHERE id='{LAB}'"], "ok"),
    ("lab test: goods classification refused", BASE + [f"UPDATE lab_tests SET \"taxClassificationId\"='{GDS}' WHERE id='{LAB}'"], "lab_tests needs a service tax classification"),
    ("lab test: another hospital's classification refused",
     [cls(SVC_B, B, UB, "S", "SERVICE", "9993"), f"UPDATE lab_tests SET \"taxClassificationId\"='{SVC_B}' WHERE id='{LAB}'"], "lab_tests_taxClassificationId_hospitalId_fkey"),
    ("lab test: inactive classification refused",
     [cls(SVC, A, UA, "S", "SERVICE", "9993", active="false"), f"UPDATE lab_tests SET \"taxClassificationId\"='{SVC}' WHERE id='{LAB}'"], "inactive tax classification"),
    ("lab test: Phase 6 price update unaffected", [f"UPDATE lab_tests SET price=400 WHERE id='{LAB}'"], "ok"),
    ("medicine: goods classification accepted", BASE + [f"UPDATE medicines SET \"taxClassificationId\"='{GDS}' WHERE id='{MED}'"], "ok"),
    ("medicine: service classification refused", BASE + [f"UPDATE medicines SET \"taxClassificationId\"='{SVC}' WHERE id='{MED}'"], "medicines needs a goods tax classification"),
    ("medicine: Phase 7 reorder update unaffected", [f"UPDATE medicines SET \"reorderLevel\"=10 WHERE id='{MED}'"], "ok"),
    ("medicine: classification can be cleared", BASE + [f"UPDATE medicines SET \"taxClassificationId\"='{GDS}' WHERE id='{MED}'",
                                                         f"UPDATE medicines SET \"taxClassificationId\"=NULL WHERE id='{MED}'"], "ok"),
    ("room: NICU critical-care unit accepted", [f"UPDATE rooms SET \"criticalCareUnit\"='NICU' WHERE id='{ROOM}'"], "ok"),
    ("room: unknown critical-care unit refused", [f"UPDATE rooms SET \"criticalCareUnit\"='HDU' WHERE id='{ROOM}'"], "invalid input value for enum"),
    ("classification: referenced by a lab test cannot be deleted",
     BASE + [f"UPDATE lab_tests SET \"taxClassificationId\"='{SVC}' WHERE id='{LAB}'", f"DELETE FROM tax_classifications WHERE id='{SVC}'"], "never deleted"),

    # --- Defaults and confirmation
    ("default: consultation with a service classification",
     BASE + [f"INSERT INTO hospital_tax_defaults VALUES ('{A}','CONSULTATION','{SVC}','{UA}',now())"], "ok"),
    ("default: pharmacy kind refused",
     BASE + [f"INSERT INTO hospital_tax_defaults VALUES ('{A}','PHARMACY','{SVC}','{UA}',now())"], "hospital_tax_defaults_kind_chk"),
    ("default: goods classification refused",
     BASE + [f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{GDS}','{UA}',now())"], "hospital_tax_defaults needs a service"),
    ("default: another hospital's classification refused",
     [cls(SVC_B, B, UB, "S", "SERVICE", "9993"), f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC_B}','{UA}',now())"], "hospital_tax_defaults_classificationId_hospitalId_fkey"),
    ("default: second default for the same kind refused",
     BASE + [cls(SVC_B, A, UA, "S2", "SERVICE", "999311"),
             f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC}','{UA}',now())",
             f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC_B}','{UA}',now())"], "hospital_tax_defaults_pkey"),
    ("default: can point at another classification",
     BASE + [cls(SVC_B, A, UA, "S2", "SERVICE", "999311"),
             f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC}','{UA}',now())",
             f"UPDATE hospital_tax_defaults SET \"classificationId\"='{SVC_B}' WHERE \"hospitalId\"='{A}' AND kind='LAB'"], "ok"),
    ("default: cannot be removed",
     BASE + [f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC}','{UA}',now())",
             f"DELETE FROM hospital_tax_defaults WHERE \"hospitalId\"='{A}'"], "cannot be removed"),
    ("default: its classification cannot be deactivated",
     BASE + [f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC}','{UA}',now())",
             f"UPDATE tax_classifications SET \"isActive\"=false WHERE id='{SVC}'"], "used as a hospital default"),
    ("confirmation: by the hospital's own admin", [f"UPDATE hospitals SET \"taxSetupConfirmedAt\"=now(), \"taxSetupConfirmedById\"='{UA}' WHERE id='{A}'"], "ok"),
    ("confirmation: by another hospital's user refused", [f"UPDATE hospitals SET \"taxSetupConfirmedAt\"=now(), \"taxSetupConfirmedById\"='{UB}' WHERE id='{A}'"], "hospitals_taxSetupConfirmedById_id_fkey"),
    ("confirmation: time without a user refused", [f"UPDATE hospitals SET \"taxSetupConfirmedAt\"=now() WHERE id='{A}'"], "hospitals_tax_setup_confirmed_chk"),

    # --- GST registrations
    ("registration: regular with a valid GSTIN", [reg(R1, A, UA, "REGULAR", GSTIN_A, "Hospital A Pvt Ltd", "27")], "ok"),
    ("registration: unregistered without details", [reg(R1, A, UA, "UNREGISTERED", None, None, None)], "ok"),
    ("registration: unregistered with a GSTIN refused", [reg(R1, A, UA, "UNREGISTERED", GSTIN_A, None, None)], "hospital_gst_registrations_details_chk"),
    ("registration: wrong check character refused", [reg(R1, A, UA, "REGULAR", "27AAPFU0939F1ZW", "X", "27")], "hospital_gst_registrations_details_chk"),
    ("registration: lower case refused", [reg(R1, A, UA, "REGULAR", GSTIN_A.lower(), "X", "27")], "hospital_gst_registrations_details_chk"),
    ("registration: state code 39 refused even with a valid check character", [reg(R1, A, UA, "REGULAR", "39AAPFU0939F1ZQ", "X", "39")], "hospital_gst_registrations_details_chk"),
    ("registration: state code 00 refused", [reg(R1, A, UA, "REGULAR", "00AAPFU0939F1ZB", "X", "00")], "hospital_gst_registrations_details_chk"),
    ("registration: chosen state differs from the GSTIN refused", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "29")], "hospital_gst_registrations_details_chk"),
    ("registration: missing legal name refused", [reg(R1, A, UA, "REGULAR", GSTIN_A, None, "27")], "hospital_gst_registrations_details_chk"),
    ("registration: malformed PAN refused", [reg(R1, A, UA, "REGULAR", "27AAPF10939F1ZV", "X", "27")], "hospital_gst_registrations_details_chk"),
    ("registration: PAN holder type X refused (fourth PAN letter)", [reg(R1, A, UA, "REGULAR", "27AAPXU0939F1ZU", "X", "27")], "hospital_gst_registrations_details_chk"),
    ("registration: PAN sequence 0000 refused", [reg(R1, A, UA, "REGULAR", "27AAPFU0000F1ZJ", "X", "27")], "hospital_gst_registrations_details_chk"),
    ("registration: tax deductor format (D in place of Z) refused", [reg(R1, A, UA, "REGULAR", "08JDHA08253A1D4", "X", "08")], "hospital_gst_registrations_details_chk"),
    ("registration: backdated refused", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " - 1")], "cannot be backdated"),
    ("registration: never edited", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), f"UPDATE hospital_gst_registrations SET \"legalName\"='Y' WHERE id='{R1}'"], "never edited"),
    ("registration: in force cannot be deleted", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), f"DELETE FROM hospital_gst_registrations WHERE id='{R1}'"], "cannot be deleted"),
    ("registration: future one can be deleted", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 10"), f"DELETE FROM hospital_gst_registrations WHERE id='{R1}'"], "ok"),
    ("registration: two starting today refused", [reg(R1, A, UA, "UNREGISTERED", None, None, None), reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27")], "already in force"),
    ("registration: two on one future date refused", [reg(R1, A, UA, "UNREGISTERED", None, None, None, TODAY + " + 5"), reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 5")], "hospital_gst_registrations_hospitalId_effectiveFrom_key"),
    ("registration: same GSTIN later in the same hospital (composition to regular)",
     [reg(R1, A, UA, "COMPOSITION", GSTIN_A, "X", "27"), reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 1")], "ok"),
    ("registration: started 'today' at 23:40, refused when the commit lands tomorrow",
     [clock("2026-11-18 23:40"), reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), clock("2026-11-19 00:01"), COMMIT_CHECK],
     "cannot start before 2026-11-19"),
    ("registration: a future one deleted at 23:45 is refused when the commit lands after midnight",
     [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 1"), clock("2026-11-18 23:45"),
      f"DELETE FROM hospital_gst_registrations WHERE id='{R1}'", clock("2026-11-19 00:01"), COMMIT_CHECK],
     "cannot be deleted (tax date 2026-11-19)"),
    ("registration: tomorrow's one is frozen from 23:50",
     [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 1"), clock("2026-11-18 23:55"),
      f"DELETE FROM hospital_gst_registrations WHERE id='{R1}'"], "cannot be deleted"),
    ("registration: a second one cannot start today once one is in force",
     [reg(R1, A, UA, "UNREGISTERED", None, None, None), clock("2026-11-19 12:00"),
      reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 1")], "already in force"),
    ("registration: a second one can start tomorrow",
     [reg(R1, A, UA, "UNREGISTERED", None, None, None), reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 1")], "ok"),
    ("registration: Q1g A, same GSTIN in another hospital refused",
     [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), reg(R2, B, UB, "REGULAR", GSTIN_A, "Y", "27")], "hospital_gst_registrations_gstin_one_hospital"),
    ("registration: Q1g A holds even for a future row", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 5"), reg(R2, B, UB, "REGULAR", GSTIN_A, "Y", "27")], "hospital_gst_registrations_gstin_one_hospital"),
    ("registration: different GSTINs in two hospitals", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), reg(R2, B, UB, "REGULAR", "29AAPFU0939F1ZR", "Y", "29")], "ok"),
    ("registration: attested by another hospital's user refused", [reg(R1, A, UB, "REGULAR", GSTIN_A, "X", "27")], "hospital_gst_registrations_attestedById_hospitalId_fkey"),

    # --- Revision 2: time zone fixed once tax versions or registrations exist
    ("timezone: can change while the hospital has no tax versions or registrations",
     BASE + [f"UPDATE hospitals SET timezone='Asia/Dubai' WHERE id='{A}'"], "ok"),
    ("timezone: a classification alone does not fix it", BASE + [f"UPDATE hospitals SET timezone='Asia/Dubai' WHERE id='{A}'"], "ok"),
    ("timezone: the first version stamps the lock",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY),
             f"DO $$ BEGIN IF (SELECT \"taxTimezoneLockedAt\" FROM hospitals WHERE id='{A}') IS NULL THEN RAISE EXCEPTION 'not stamped'; END IF; END $$"], "ok"),
    ("timezone: cannot change once a version exists",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE hospitals SET timezone='America/Los_Angeles' WHERE id='{A}'"],
     "time zone of a hospital with tax versions or GST registrations cannot change"),
    ("timezone: cannot change once a registration exists",
     [reg(R1, A, UA, "UNREGISTERED", None, None, None, TODAY + " + 3"), f"UPDATE hospitals SET timezone='America/Los_Angeles' WHERE id='{A}'"],
     "cannot change"),
    ("timezone: stays fixed after the only (future) version is deleted",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " + 3"), f"DELETE FROM tax_classification_versions WHERE id='{V1}'",
             f"UPDATE hospitals SET timezone='America/Los_Angeles' WHERE id='{A}'"], "cannot change"),
    ("timezone: the lock cannot be cleared",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE hospitals SET \"taxTimezoneLockedAt\"=NULL WHERE id='{A}'"], "cannot change"),
    ("timezone: writing the same zone again is allowed",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE hospitals SET timezone='Asia/Kolkata' WHERE id='{A}'"], "ok"),
    ("timezone: other hospital settings still change",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE hospitals SET phone='9', \"defaultSlotMinutes\"=15 WHERE id='{A}'"], "ok"),
    ("timezone: another hospital is unaffected",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE hospitals SET timezone='Asia/Dubai' WHERE id='{B}'"], "ok"),
    ("timezone: a hospital locked in Kolkata cannot move west to reopen today's version",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), clock("2026-11-18 09:00"),
             f"UPDATE hospitals SET timezone='Pacific/Honolulu' WHERE id='{A}'"], "cannot change"),
    ("real clock: the production clock path accepts a version from the hospital's real today",
     [REAL_CLOCK] + BASE + ["INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") "
                            f"VALUES ('{V1}','{A}','{GDS}','TAXABLE',5,true,((clock_timestamp() + interval '10 minutes') AT TIME ZONE 'Asia/Kolkata')::date,'{UA}')",
                            COMMIT_CHECK], "ok"),
    ("real clock: and refuses yesterday",
     [REAL_CLOCK] + BASE + ["INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") "
                            f"VALUES ('{V1}','{A}','{GDS}','TAXABLE',5,true,((clock_timestamp() + interval '10 minutes') AT TIME ZONE 'Asia/Kolkata')::date - 1,'{UA}')"], "cannot start before"),

    # --- Statutory room rule
    ("room rule: seeded row is the 18 July 2022 rule",
     ["DO $$ BEGIN IF (SELECT count(*) FROM statutory_room_tax_rules WHERE \"effectiveFrom\"='2022-07-18' AND \"thresholdPerDay\"=5000.00 AND \"ratePercent\"=5.00 AND \"sacCode\"='9993' AND NOT \"priceIncludesTax\") <> 1 THEN RAISE EXCEPTION 'seed missing'; END IF; END $$"], "ok"),
    # --- Revision 4: inactive classifications get no new versions; recorded versions stay valid
    ("version: new version on an inactive classification refused",
     BASE + [DEACT_G, ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " + 1")], "cannot be added to an inactive classification"),
    ("version: deactivation allowed with versions recorded; both stay",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), ver(V2, GDS, "TAXABLE", 12, "true", TODAY + " + 5"), DEACT_G,
             f"DO $$ BEGIN IF (SELECT count(*) FROM tax_classification_versions WHERE \"classificationId\"='{GDS}') <> 2 THEN RAISE EXCEPTION 'versions lost'; END IF; END $$"], "ok"),
    ("version: future version of a deactivated classification can still be withdrawn",
     BASE + [ver(V2, GDS, "TAXABLE", 12, "true", TODAY + " + 5"), DEACT_G, f"DELETE FROM tax_classification_versions WHERE id='{V2}'"], "ok"),
    ("version: future version of a deactivated classification can still be corrected",
     BASE + [ver(V2, GDS, "TAXABLE", 12, "true", TODAY + " + 5"), DEACT_G, f"UPDATE tax_classification_versions SET \"ratePercent\"=18 WHERE id='{V2}'"], "ok"),
    ("version: in-force version of a deactivated classification still cannot change",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), DEACT_G, f"UPDATE tax_classification_versions SET \"ratePercent\"=18 WHERE id='{V1}'"], "cannot change"),
    ("version: reactivated classification accepts new versions",
     BASE + [DEACT_G, f"UPDATE tax_classifications SET \"isActive\"=true WHERE id='{GDS}'", ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " + 1")], "ok"),
    ("classification: assignment changes no classification value",
     BASE + [f"CREATE TEMP TABLE before_c AS SELECT * FROM tax_classifications WHERE id='{SVC}'",
             f"UPDATE lab_tests SET \"taxClassificationId\"='{SVC}' WHERE id='{LAB}'",
             f"INSERT INTO hospital_tax_defaults VALUES ('{A}','LAB','{SVC}','{UA}',now())",
             f"DO $$ BEGIN IF (SELECT to_jsonb(c) FROM tax_classifications c WHERE id='{SVC}') IS DISTINCT FROM (SELECT to_jsonb(b) FROM before_c b) THEN RAISE EXCEPTION 'classification changed'; END IF; END $$"], "ok"),
    ("room rule: cannot be edited", ["UPDATE statutory_room_tax_rules SET \"thresholdPerDay\"=7500"], "append-only"),
    ("room rule: cannot be deleted", ["DELETE FROM statutory_room_tax_rules"], "append-only"),
    ("room rule: bad SAC refused", ["INSERT INTO statutory_room_tax_rules (\"effectiveFrom\",\"thresholdPerDay\",\"ratePercent\",\"sacCode\",\"legalReference\") VALUES ('2030-01-01',5000,5,'3004','x')"], "statutory_room_tax_rules_values_chk"),

    # --- Phase 0-7 table that M-11a altered keeps working
    ("hospitals: ordinary update unaffected", [f"UPDATE hospitals SET phone='9' WHERE id='{A}'"], "ok"),
    ("hospitals: delete still refused by existing foreign keys", [f"DELETE FROM hospitals WHERE id='{A}'"], "violates foreign key constraint"),
]


def run(case):
    name, stmts, expect = case
    stmts = stmts[1:] if stmts and stmts[0] == REAL_CLOCK else [FIXTURE] + stmts
    sql = "BEGIN;\n" + ";\n".join(stmts) + ";\nROLLBACK;\n"
    p = subprocess.run(["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB],
                       input=sql, capture_output=True, text=True, cwd="/tmp")
    err = p.stderr.strip()
    if expect == "ok":
        good = p.returncode == 0
    else:
        # The error must come from the last statement, not an earlier set-up statement.
        good = p.returncode != 0 and expect in err
        if good and len(stmts) > 1:
            prefix = "BEGIN;\n" + ";\n".join(stmts[:-1]) + ";\nROLLBACK;\n"
            q = subprocess.run(["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB],
                               input=prefix, capture_output=True, text=True, cwd="/tmp")
            good = q.returncode == 0
    return good, err


failed = 0
for c in CASES:
    good, err = run(c)
    print(("PASS " if good else "FAIL ") + c[0])
    if not good:
        failed += 1
        print("     expected:", c[2], "\n     got:", err[:300] or "success")
print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
sys.exit(1 if failed else 0)
