-- Fingerprint of every invoice row, all columns, in id order. Read-only.
SELECT md5(string_agg(i::text, E'\n' ORDER BY i.id)) FROM invoices i;
