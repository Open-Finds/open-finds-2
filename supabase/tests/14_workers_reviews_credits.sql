\set QUIET on
SET client_min_messages TO notice;

-- Super admin Rob, manager Meg, workers Wes and Wil, users Uli and Una.
INSERT INTO auth.users (id, email) VALUES
  ('14000000-0000-0000-0000-00000000000a', 'rob@x.com'),
  ('14000000-0000-0000-0000-00000000000b', 'meg@x.com'),
  ('14000000-0000-0000-0000-00000000000c', 'wes@x.com'),
  ('14000000-0000-0000-0000-00000000000d', 'wil@x.com'),
  ('14000000-0000-0000-0000-00000000000e', 'uli@x.com'),
  ('14000000-0000-0000-0000-00000000000f', 'una@x.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES
  ('14000000-0000-0000-0000-00000000000a', 'Rob'),
  ('14000000-0000-0000-0000-00000000000b', 'Meg'),
  ('14000000-0000-0000-0000-00000000000c', 'Wes'),
  ('14000000-0000-0000-0000-00000000000d', 'Wil'),
  ('14000000-0000-0000-0000-00000000000e', 'Uli'),
  ('14000000-0000-0000-0000-00000000000f', 'Una')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET role = 'admin' WHERE id = '14000000-0000-0000-0000-00000000000a';
UPDATE profiles SET role = 'manager' WHERE id = '14000000-0000-0000-0000-00000000000b';
UPDATE profiles SET role = 'staff' WHERE id IN ('14000000-0000-0000-0000-00000000000c', '14000000-0000-0000-0000-00000000000d');

SET ROLE authenticated;

-- Wes, a worker, submits a venue.
DO $$
DECLARE ok boolean; v venue_partners%ROWTYPE;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000c', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO venue_partners (id, business_name, address, type, contact_name, contact_email, contact_phone, visit_rate_cents, approved)
  VALUES ('14000000-0000-0000-0000-0000000000f1', 'Wes Ramen', '1 Wes St', 'food', 'Kai', 'kai@x.com', '0400 000 000', 50, false);
  SELECT * INTO v FROM venue_partners WHERE id = '14000000-0000-0000-0000-0000000000f1';
  PERFORM rep('W1 a worker''s venue goes live straight away, at their rate, as theirs',
    v.approved AND v.active AND v.visit_rate_cents = 50 AND v.account_manager = '14000000-0000-0000-0000-00000000000c' AND v.contact_phone = '0400 000 000');

  UPDATE venue_partners SET visit_rate_cents = 60, contact_name = 'Kai Lee' WHERE id = v.id;
  PERFORM rep('W2 a worker edits their own venue, rate included',
    (SELECT visit_rate_cents = 60 AND contact_name = 'Kai Lee' FROM venue_partners WHERE id = v.id));

  BEGIN
    UPDATE venue_partners SET approved = false, rejection_reason = 'x' WHERE id = v.id;
    ok := false;
  EXCEPTION WHEN others THEN ok := position('manager' in SQLERRM) > 0; END;
  PERFORM rep('W3 a worker can''t approve or reject', ok);

  BEGIN
    PERFORM admin_team();
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('W4 a worker can''t see the team or the dashboard numbers', ok);

  BEGIN
    PERFORM admin_set_role('uli@x.com', 'staff');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('W5 a worker can''t change roles', ok);

  BEGIN
    INSERT INTO venue_reviews (venue_id, rating, body) VALUES (v.id, 5, 'Reviewing my own venue');
    ok := false;
  EXCEPTION WHEN others THEN ok := position('row-level security' in SQLERRM) > 0; END;
  PERFORM rep('W6 a worker can''t review a venue they manage', ok);
END $$;

-- Wil, another worker, sees none of Wes's.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000d', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM rep('W7 workers don''t see each other''s venues or commission',
    NOT EXISTS (SELECT 1 FROM venue_partners WHERE id = '14000000-0000-0000-0000-0000000000f1')
    AND jsonb_array_length(admin_partner_overview()) = 0
    AND (my_sales_summary()->>'clients')::int = 0);
END $$;

-- Uli, a user, reviews it: a credit and a billed visit.
DO $$
DECLARE ok boolean; n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000e', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM rep('R1 sponsored venues list live partners without contact details',
    EXISTS (SELECT 1 FROM jsonb_array_elements(sponsored_venues()) e WHERE e->>'business_name' = 'Wes Ramen' AND e->'contact_email' IS NULL));

  INSERT INTO venue_reviews (venue_id, rating, body) VALUES ('14000000-0000-0000-0000-0000000000f1', 4, 'Great broth, quick service.');
  PERFORM rep('R2 a review earns a credit', my_credits() = 1);

  BEGIN
    INSERT INTO venue_reviews (venue_id, rating, body) VALUES ('14000000-0000-0000-0000-0000000000f1', 5, 'Second review, same venue');
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  PERFORM rep('R3 one review per venue each', ok);

  DELETE FROM venue_reviews WHERE venue_id = '14000000-0000-0000-0000-0000000000f1' AND user_id = auth.uid();
  INSERT INTO venue_reviews (venue_id, rating, body) VALUES ('14000000-0000-0000-0000-0000000000f1', 5, 'Posted again after deleting');
  PERFORM rep('R4 deleting and posting again doesn''t earn a second credit', my_credits() = 1);

  UPDATE venue_reviews SET rating = 3, venue_id = '14000000-0000-0000-0000-0000000000f2' WHERE user_id = auth.uid();
  PERFORM rep('R5 an edit changes the stars but not the venue',
    (SELECT rating = 3 AND venue_id = '14000000-0000-0000-0000-0000000000f1' FROM venue_reviews WHERE user_id = auth.uid()));

  PERFORM rep('R6 reviews list who wrote them',
    (SELECT lower(e->>'name') = 'uli' AND (e->>'mine')::boolean FROM jsonb_array_elements(venue_reviews_for('14000000-0000-0000-0000-0000000000f1')) e LIMIT 1));

  BEGIN
    INSERT INTO venue_reviews (venue_id, rating, body) VALUES ('14000000-0000-0000-0000-0000000000f1', 5, 'short');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R7 a review needs a few words', ok);

  BEGIN
    INSERT INTO venue_events (venue_id, event_type, auth_uid, user_id)
    VALUES ('14000000-0000-0000-0000-0000000000f1', 'visited', auth.uid(), auth.uid()::text);
    ok := false;
  EXCEPTION WHEN others THEN ok := position('row-level security' in SQLERRM) > 0; END;
  PERFORM rep('R8 the app can''t record a visit by itself', ok);

  PERFORM record_venue_events(ARRAY['14000000-0000-0000-0000-0000000000f1'::uuid], 'impression');
  PERFORM record_venue_events(ARRAY['14000000-0000-0000-0000-0000000000f1'::uuid], 'impression');
  BEGIN
    PERFORM record_venue_events(ARRAY['14000000-0000-0000-0000-0000000000f1'::uuid], 'visited');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R9 views are recorded once a day, visits never this way', ok);

  BEGIN
    PERFORM spend_credit(auth.uid(), 'extract');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R10 the app can''t spend credits itself', ok);

  BEGIN
    INSERT INTO credit_ledger (user_id, delta, reason) VALUES (auth.uid(), 100, 'admin');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('R11 the app can''t give itself credits', ok);
END $$;

-- ai-proxy (service role) spends and refunds.
RESET ROLE;
DO $$
DECLARE left_ int; none int;
BEGIN
  left_ := spend_credit('14000000-0000-0000-0000-00000000000e', 'extract');
  none := spend_credit('14000000-0000-0000-0000-00000000000e', 'discover');
  PERFORM refund_credit('14000000-0000-0000-0000-00000000000e');
  PERFORM rep('C1 a credit is spent once, then there are none, and a refund gives it back',
    left_ = 0 AND none IS NULL
    AND (SELECT SUM(delta) FROM credit_ledger WHERE user_id = '14000000-0000-0000-0000-00000000000e') = 1);
END $$;

-- Five reviews a day.
INSERT INTO venue_partners (id, business_name, address, type, contact_name, contact_email, approved)
SELECT ('14000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'Spot ' || i, i || ' St', 'food', 'C', 'c@x.com', true
FROM generate_series(1, 6) i;
SET ROLE authenticated;
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000f', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO venue_reviews (venue_id, rating, body)
  SELECT ('14000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 4, 'Lovely spot, would go again'
  FROM generate_series(1, 5) i;
  BEGIN
    INSERT INTO venue_reviews (venue_id, rating, body) VALUES ('14000000-0000-0000-0000-000000000106', 4, 'Lovely spot, would go again');
    ok := false;
  EXCEPTION WHEN others THEN ok := position('5 reviews a day' in SQLERRM) > 0; END;
  PERFORM rep('R12 at most 5 reviews a day', ok AND my_credits() = 5);
END $$;
RESET ROLE;

-- Meg, a manager: everyone's venues, reject with a reason, the team's numbers.
SET ROLE authenticated;
DO $$
DECLARE ok boolean; wes jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000b', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM rep('M1 a manager sees every venue',
    EXISTS (SELECT 1 FROM jsonb_array_elements(admin_partner_overview()) e WHERE e->>'business_name' = 'Wes Ramen'));

  SELECT e->'sales' INTO wes FROM jsonb_array_elements(admin_team()) e WHERE e->>'email' = 'wes@x.com';
  PERFORM rep('M2 the team shows each worker''s venues, visits, billing and 10% commission',
    (wes->>'clients')::int = 1 AND (wes->>'live')::int = 1 AND (wes->>'visits')::int = 1
    AND (wes->>'impressions')::int = 1 AND (wes->>'total_billed_cents')::int = 60
    AND (wes->>'commission_percent')::numeric = 10 AND (wes->>'total_commission_cents')::int = 6
    AND (wes->>'unpaid_cents')::int = 6);

  UPDATE venue_partners SET approved = false, rejection_reason = 'Closed down' WHERE id = '14000000-0000-0000-0000-0000000000f1';
  PERFORM rep('M3 a manager rejects with a reason',
    (SELECT NOT approved AND rejection_reason = 'Closed down' FROM venue_partners WHERE id = '14000000-0000-0000-0000-0000000000f1'));

  BEGIN
    PERFORM admin_set_role('uli@x.com', 'staff');
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('M4 a manager can''t change roles', ok);

  BEGIN
    PERFORM admin_record_payout('14000000-0000-0000-0000-00000000000c', 6);
    ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  PERFORM rep('M5 a manager can''t mark commission paid', ok);
END $$;

-- Wes sees the rejection; the venue is off the sponsored list.
DO $$
DECLARE s jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000c', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  s := my_sales_summary();
  PERFORM rep('W8 a worker sees their venue was rejected and why',
    (s->>'rejected')::int = 1
    AND (SELECT rejection_reason = 'Closed down' FROM venue_partners WHERE id = '14000000-0000-0000-0000-0000000000f1')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(sponsored_venues()) e WHERE e->>'business_name' = 'Wes Ramen'));
END $$;

-- Rob, super admin: pays Wes, gives roles including manager.
DO $$
DECLARE wes jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000a', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM admin_record_payout('14000000-0000-0000-0000-00000000000c', 5, 'Bank transfer');
  SELECT e->'sales' INTO wes FROM jsonb_array_elements(admin_team()) e WHERE e->>'email' = 'wes@x.com';
  PERFORM rep('P1 paid and still owed', (wes->>'paid_cents')::int = 5 AND (wes->>'unpaid_cents')::int = 1);

  PERFORM admin_set_role('una@x.com', 'manager');
  PERFORM rep('P2 a super admin makes someone a manager',
    EXISTS (SELECT 1 FROM jsonb_array_elements(admin_team()) e WHERE e->>'email' = 'una@x.com' AND e->>'role' = 'manager'));
END $$;

-- Wes sees his own payout, not anyone else's.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000d', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM rep('P3 workers don''t see each other''s payouts', (SELECT count(*) FROM commission_payouts) = 0);
  PERFORM set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-00000000000c', true);
  PERFORM rep('P4 a worker sees their own payouts', (SELECT count(*) FROM commission_payouts) = 1);
END $$;
RESET ROLE;
