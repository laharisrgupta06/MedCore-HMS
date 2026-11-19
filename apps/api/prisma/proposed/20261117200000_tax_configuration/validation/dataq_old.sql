select md5(string_agg(t::text, '|' order by t::text)) from (
 select to_jsonb(x) - 'taxSetupConfirmedAt' - 'taxSetupConfirmedById' - 'taxTimezoneLockedAt' t from hospitals x
 union all select to_jsonb(x) - 'taxClassificationId' from lab_tests x
 union all select to_jsonb(x) - 'taxClassificationId' from medicines x
 union all select to_jsonb(x) - 'criticalCareUnit' from rooms x
 union all select to_jsonb(x) from users x union all select to_jsonb(x) from staff_profiles x) s;
