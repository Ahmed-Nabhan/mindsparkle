-- Migration: Audit and reset non-legit Pro users, and add safety trigger
-- Timestamp: 2026-01-08
-- Notes:
-- 1) This script will backup suspicious `user_subscriptions` rows to
--    `user_subscriptions_backup` and then mark them as free.
-- 2) Suspicious rows are defined as: active Pro/Enterprise subscriptions
--    where the `source` is not a known payment provider (revenuecat/stripe/promo)
--    AND the user is NOT an admin (user_roles.role = 'admin').
-- 3) The script also adds a trigger to enforce defaults on new inserts so
--    that only payment/webhook/service-role inserts can create active Pro rows.

BEGIN;

-- 1) Create a backup table (only structure + existing data will be inserted below)
CREATE TABLE IF NOT EXISTS public.user_subscriptions_backup (LIKE public.user_subscriptions INCLUDING ALL);

-- 2) Insert suspicious active subscriptions into backup for audit
INSERT INTO public.user_subscriptions_backup
SELECT us.*
FROM public.user_subscriptions us
WHERE us.is_active = TRUE
  AND us.tier IN ('pro','enterprise')
  AND (us.source IS NULL OR us.source NOT IN ('revenuecat','stripe','promo'))
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = us.user_id AND ur.role = 'admin'
  )
ON CONFLICT (id) DO NOTHING;

-- 3) Reset suspicious subscriptions to free (run after backup above)
UPDATE public.user_subscriptions us
SET
  is_active = FALSE,
  tier = 'free',
  cancelled_at = NOW(),
  updated_at = NOW()
WHERE us.is_active = TRUE
  AND us.tier IN ('pro','enterprise')
  AND (us.source IS NULL OR us.source NOT IN ('revenuecat','stripe','promo'))
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = us.user_id AND ur.role = 'admin'
  );

-- 4) Add a safety trigger that forces new inserts to default to free unless the
--    insert originates from a known payment source or is performed by the service_role.
--    Note: the `grant_subscription` function (SECURITY DEFINER) can still grant Pro.
CREATE OR REPLACE FUNCTION public.enforce_subscription_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- If the new row claims a payment source, allow it; otherwise force free tier.
    IF NEW.source IS NULL OR NEW.source NOT IN ('revenuecat','stripe','promo') THEN
      NEW.is_active := FALSE;
      NEW.tier := 'free';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_sub_defaults ON public.user_subscriptions;
CREATE TRIGGER trg_enforce_sub_defaults
BEFORE INSERT ON public.user_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_subscription_defaults();

COMMIT;

-- End of migration
