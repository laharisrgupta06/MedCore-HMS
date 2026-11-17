"""M-11a behaviour tests on a scratch PostgreSQL 16 database.

Each case runs in its own transaction that is rolled back, so cases are independent. A case is a
list of statements: all but the last must succeed; the last must succeed (expect "ok") or fail with
an error containing the expected text.
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
TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date"

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
    ("version: backdated start refused", BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " - 1")], "cannot start before today"),
    ("version: two versions on one date refused",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY + " + 30"), ver(V2, GDS, "NIL_RATED", 0, "false", TODAY + " + 30")],
     "tax_classification_versions_classificationId_effectiveFrom_key"),
    ("version: in force today cannot be edited",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"UPDATE tax_classification_versions SET \"ratePercent\"=12 WHERE id='{V1}'"], "has taken effect cannot change"),
    ("version: in force today cannot be deleted",
     BASE + [ver(V1, GDS, "TAXABLE", 5, "true", TODAY), f"DELETE FROM tax_classification_versions WHERE id='{V1}'"], "has taken effect cannot change"),
    ("version: future version can be edited",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"UPDATE tax_classification_versions SET \"ratePercent\"=5 WHERE id='{V1}'"], "ok"),
    ("version: future version cannot be moved into the past",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"UPDATE tax_classification_versions SET \"effectiveFrom\"={TODAY} - 1 WHERE id='{V1}'"], "cannot start before today"),
    ("version: future version cannot change classification",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"UPDATE tax_classification_versions SET \"classificationId\"='{SVC}' WHERE id='{V1}'"], "Only the treatment, rate"),
    ("version: future version can be deleted",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 30"), f"DELETE FROM tax_classification_versions WHERE id='{V1}'"], "ok"),
    # Tomorrow in India is already today at UTC+14, so moving the hospital there makes the version take effect.
    ("version: becomes immutable once its date arrives in the hospital's time zone",
     BASE + [ver(V1, GDS, "TAXABLE", 12, "true", TODAY + " + 1"),
             f"UPDATE hospitals SET timezone='Pacific/Kiritimati' WHERE id='{A}'",
             f"DELETE FROM tax_classification_versions WHERE id='{V1}'"], "has taken effect cannot change"),
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
    ("registration: backdated refused", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " - 1")], "cannot be backdated"),
    ("registration: never edited", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), f"UPDATE hospital_gst_registrations SET \"legalName\"='Y' WHERE id='{R1}'"], "never edited"),
    ("registration: in force cannot be deleted", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), f"DELETE FROM hospital_gst_registrations WHERE id='{R1}'"], "cannot be deleted"),
    ("registration: future one can be deleted", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 10"), f"DELETE FROM hospital_gst_registrations WHERE id='{R1}'"], "ok"),
    ("registration: two on one date refused", [reg(R1, A, UA, "UNREGISTERED", None, None, None), reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27")], "hospital_gst_registrations_hospitalId_effectiveFrom_key"),
    ("registration: same GSTIN later in the same hospital (composition to regular)",
     [reg(R1, A, UA, "COMPOSITION", GSTIN_A, "X", "27"), reg(R2, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 1")], "ok"),
    ("registration: Q1g A, same GSTIN in another hospital refused",
     [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), reg(R2, B, UB, "REGULAR", GSTIN_A, "Y", "27")], "hospital_gst_registrations_gstin_one_hospital"),
    ("registration: Q1g A holds even for a future row", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27", TODAY + " + 5"), reg(R2, B, UB, "REGULAR", GSTIN_A, "Y", "27")], "hospital_gst_registrations_gstin_one_hospital"),
    ("registration: different GSTINs in two hospitals", [reg(R1, A, UA, "REGULAR", GSTIN_A, "X", "27"), reg(R2, B, UB, "REGULAR", "29AAPFU0939F1ZR", "Y", "29")], "ok"),
    ("registration: attested by another hospital's user refused", [reg(R1, A, UB, "REGULAR", GSTIN_A, "X", "27")], "hospital_gst_registrations_attestedById_hospitalId_fkey"),

    # --- Statutory room rule
    ("room rule: seeded row is the 18 July 2022 rule",
     ["DO $$ BEGIN IF (SELECT count(*) FROM statutory_room_tax_rules WHERE \"effectiveFrom\"='2022-07-18' AND \"thresholdPerDay\"=5000.00 AND \"ratePercent\"=5.00 AND \"sacCode\"='9993' AND NOT \"priceIncludesTax\") <> 1 THEN RAISE EXCEPTION 'seed missing'; END IF; END $$"], "ok"),
    ("room rule: cannot be edited", ["UPDATE statutory_room_tax_rules SET \"thresholdPerDay\"=7500"], "append-only"),
    ("room rule: cannot be deleted", ["DELETE FROM statutory_room_tax_rules"], "append-only"),
    ("room rule: bad SAC refused", ["INSERT INTO statutory_room_tax_rules (\"effectiveFrom\",\"thresholdPerDay\",\"ratePercent\",\"sacCode\",\"legalReference\") VALUES ('2030-01-01',5000,5,'3004','x')"], "statutory_room_tax_rules_values_chk"),

    # --- Phase 0-7 table that M-11a altered keeps working
    ("hospitals: ordinary update unaffected", [f"UPDATE hospitals SET phone='9' WHERE id='{A}'"], "ok"),
    ("hospitals: delete still refused by existing foreign keys", [f"DELETE FROM hospitals WHERE id='{A}'"], "violates foreign key constraint"),
]


def run(case):
    name, stmts, expect = case
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
