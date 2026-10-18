-- One atomic statement; InsForge rawsql disallows explicit transactions.
-- Disable legacy credentials without deleting payment audit rows, changing
-- balances/caps, resetting Inkbox, or touching Google-linked accounts.
with safe as (
  select not exists (
    select 1 from tasks t join agents b on b.id=t.buyer_id
    left join agents s on s.id=t.seller_id
    where (b.owner_user_id is null or (s.id is not null and s.owner_user_id is null))
      and t.status not in ('APPROVED','REJECTED','CANCELLED','EXPIRED')
  ) as ready
), suspended as (
  update sellers set status='SUSPENDED'
  where (select ready from safe)
    and agent_id in (select id from agents where kind='seller' and owner_user_id is null)
  returning agent_id
), retired as (
  update agents set api_key_hash='retired:' || api_key_hash
  where (select ready from safe)
    and kind in ('buyer','seller') and owner_user_id is null and api_key_hash not like 'retired:%'
  returning kind
)
select (select ready from safe) as no_active_legacy_tasks,
  (select count(*)::int from suspended) as suspended_sellers,
  (select count(*)::int from retired where kind='buyer') as retired_buyers,
  (select count(*)::int from retired where kind='seller') as retired_sellers;
