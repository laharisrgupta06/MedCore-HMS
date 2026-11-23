"""M-12 / M-13 / M-15 behaviour tests on a SCRATCH PostgreSQL 16 database only (never development).

Build the scratch database: every committed migration (M-12, M-13 and M-15 are in prisma/migrations
since 2026-11-23), then the M-11b validation seed (../../20261119220000_invoice_integrity/validation/seed.sql). Run:
    PSQL="psql -h <socket dir> -p <port> -U postgres" python3 m12_behaviour_tests.py <scratch db> [--with-m11b]
Reuses the M-11b fixtures and runner (each case in its own transaction, rolled back).
Result on 2026-11-22: 24/24, and the M-11b suite 111/111 on the same database.
"""
import os
import pathlib
import shlex
import sys

_m11b = pathlib.Path(__file__).resolve().parents[2] / "20261119220000_invoice_integrity/validation/behaviour_tests.py"
_src = _m11b.read_text().split("\nfailed = 0\n")[0]
_psql = shlex.split(os.environ.get("PSQL", "sudo -u postgres psql"))
_src = _src.replace('["sudo", "-u", "postgres", "psql",', repr(_psql)[:-1] + ",")
exec(compile(_src, str(_m11b), "exec"))  # fixtures, run(); DB from argv
M11B_CASES = CASES  # noqa: F821  (defined by the M-11b file)

P1, P2 = "77777777-0000-0000-0000-000000000001", "77777777-0000-0000-0000-000000000002"
FLAG = "SELECT set_config('medcore.payment_change', 'on', true)"

def pay(id_, amount, status="SUCCEEDED", method="CASH", inv=I1):
    provider = {"STRIPE_CARD": "'STRIPE'", "RAZORPAY_UPI": "'RAZORPAY'"}.get(method, "NULL")
    return (f"INSERT INTO payments (id,\"hospitalId\",\"invoiceId\",method,provider,amount,status,\"paidAt\",\"receivedById\",\"updatedAt\") "
            f"VALUES ('{id_}','{A}','{inv}','{method}',{provider},{amount},'{status}',now(),'{RC}',now())")

def status(s):
    return f"UPDATE invoices SET status='{s}' WHERE id='{I1}'"

def reverse(id_=P1):
    return (f"UPDATE payments SET status='REVERSED', \"reversedAt\"=now(), \"reversedById\"='{AC}', "
            f"\"reversalReason\"='Entered twice' WHERE id='{id_}'")

CASES = [
    # status guard (M-12 replaces the M-11b rule)
    ("issued status cannot change without the payment flag", ISSUED_A + [status("PARTIALLY_PAID")], "set by the payment rules (M-12)"),
    ("with the flag, status moves only between issued statuses", ISSUED_A + [FLAG, status("VOID")], "cannot be cancelled in MedCore"),
    ("the flag does not unfreeze other columns of an issued invoice", ISSUED_A + [FLAG, f"UPDATE invoices SET subtotal=1 WHERE id='{I1}'"], ""),
    # consistency at commit
    ("partial cash with the matching status commits", ISSUED_A + [pay(P1, 200), FLAG, status("PARTIALLY_PAID"), COMMIT_CHECK], "ok"),
    ("full cash with PAID commits", ISSUED_A + [pay(P1, 500), FLAG, status("PAID"), COMMIT_CHECK], "ok"),
    ("a payment without the status change fails at commit", ISSUED_A + [pay(P1, 200), COMMIT_CHECK], "does not match its payments"),
    ("payments above the total fail", ISSUED_A + [pay(P1, 300), pay(P2, 300), FLAG, status("PAID"), COMMIT_CHECK], "exceed the invoice total"),
    ("no payment on a draft", DRAFT_A + [pay(P1, 100), COMMIT_CHECK], "only on an issued invoice"),
    ("amount must be positive", ISSUED_A + [pay(P1, 0)], "payments_amount_chk"),
    # transitions
    ("a payment cannot start as FAILED", ISSUED_A + [pay(P1, 100, "FAILED")], "starts as an open checkout"),
    ("open checkout can succeed", ISSUED_A + [pay(P1, 500, "PENDING", "STRIPE_CARD"), f"UPDATE payments SET status='SUCCEEDED' WHERE id='{P1}'", FLAG, status("PAID"), COMMIT_CHECK], "ok"),
    ("a failed checkout cannot later succeed", ISSUED_A + [pay(P1, 500, "PENDING", "STRIPE_CARD"), f"UPDATE payments SET status='FAILED' WHERE id='{P1}'",
        f"UPDATE payments SET status='SUCCEEDED' WHERE id='{P1}'"], "Invalid payment status change"),
    ("amount cannot change", ISSUED_A + [pay(P1, 200), FLAG, status("PARTIALLY_PAID"), f"UPDATE payments SET amount=100 WHERE id='{P1}'"], "cannot be changed"),
    ("payments are never deleted", ISSUED_A + [pay(P1, 200), FLAG, status("PARTIALLY_PAID"), f"DELETE FROM payments WHERE id='{P1}'"], "never deleted"),
    # reversal (8-B5)
    ("reversal returns the balance and commits", ISSUED_A + [pay(P1, 500), FLAG, status("PAID"), reverse(), status("FINALISED"), COMMIT_CHECK], "ok"),
    ("reversal needs reason, who and when", ISSUED_A + [pay(P1, 500), FLAG, status("PAID"), f"UPDATE payments SET status='REVERSED' WHERE id='{P1}'"], "payments_reversal_complete"),
    ("a reconciled payment cannot be reversed", ISSUED_A + [pay(P1, 500), FLAG, status("PAID"),
        f"UPDATE payments SET \"reconciledAt\"=now(), \"reconciledById\"='{AC}' WHERE id='{P1}'", reverse()], "reconciled payment cannot be reversed"),
    ("reconciliation cannot be undone", ISSUED_A + [pay(P1, 500), FLAG, status("PAID"),
        f"UPDATE payments SET \"reconciledAt\"=now(), \"reconciledById\"='{AC}' WHERE id='{P1}'",
        f"UPDATE payments SET \"reconciledAt\"=NULL, \"reconciledById\"=NULL WHERE id='{P1}'"], "cannot be undone"),
    ("only a received payment can be reconciled", ISSUED_A + [pay(P1, 500, "PENDING", "STRIPE_CARD"),
        f"UPDATE payments SET \"reconciledAt\"=now(), \"reconciledById\"='{AC}' WHERE id='{P1}'"], "Only a received payment"),
    # M-13
    ("TPA settlement is a received payment", ISSUED_A + [pay(P1, 300, method="TPA_SETTLEMENT"), FLAG, status("PARTIALLY_PAID"), COMMIT_CHECK], "ok"),
    ("a CASH payment may not name a provider", ISSUED_A + [pay(P1, 100).replace(",NULL,", ",'STRIPE',", 1)], "payments_provider_chk"),
    ("an online payment must name its provider", ISSUED_A + [pay(P1, 100, "PENDING", "STRIPE_CARD").replace("'STRIPE'", "NULL", 1)], "payments_provider_chk"),
    # M-15
    ("one-time notification cannot be written twice",
        [f"INSERT INTO notifications (id,\"hospitalId\",\"recipientId\",type,title,body,\"dedupeKey\") VALUES (gen_random_uuid(),'{A}','{RC}','t','x','y','t:1')",
         f"INSERT INTO notifications (id,\"hospitalId\",\"recipientId\",type,title,body,\"dedupeKey\") VALUES (gen_random_uuid(),'{A}','{RC}','t','x','y','t:1')"],
        "notifications_recipientId_dedupeKey_key"),
    ("repeatable notifications (no key) are allowed",
        [f"INSERT INTO notifications (id,\"hospitalId\",\"recipientId\",type,title,body) VALUES (gen_random_uuid(),'{A}','{RC}','t','x','y')",
         f"INSERT INTO notifications (id,\"hospitalId\",\"recipientId\",type,title,body) VALUES (gen_random_uuid(),'{A}','{RC}','t','x','y')"], "ok"),
]

ALL = (M11B_CASES if "--with-m11b" in sys.argv else []) + CASES
failed = 0
for c in ALL:
    good, err = run(c)
    print(("PASS " if good else "FAIL ") + c[0])
    if not good:
        failed += 1
        print("     expected:", c[2] or "(any error)", "\n     got:", err[:300] or "success")
print(f"\n{len(ALL) - failed}/{len(ALL)} passed")
sys.exit(1 if failed else 0)
