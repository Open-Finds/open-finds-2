-- Optional target-environment inventory for review. NOT executed by this task.
-- Returns aggregate category/tag usage only; no account/contact data.
SELECT type, count(*) FROM public.saved_venues GROUP BY type ORDER BY type;
SELECT tag, count(*) FROM public.saved_venues,
  LATERAL unnest(COALESCE(tags, ARRAY[]::text[])) tag
GROUP BY tag ORDER BY count(*) DESC, tag;
SELECT type, count(*) FROM public.venue_partners GROUP BY type ORDER BY type;
SELECT type, count(*) FROM public.plans GROUP BY type ORDER BY type;
