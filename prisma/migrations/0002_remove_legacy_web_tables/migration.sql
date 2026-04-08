-- Remove legacy lower-case tables/types from the old web prototype schema.
-- This intentionally does not touch Supabase auth/storage schemas.
-- The new mobile API uses Prisma's PascalCase tables created in 0001_initial.

DROP TABLE IF EXISTS
  public.vehicle_documents,
  public.mileage_entries,
  public.mileage_logs,
  public.insurance_policies,
  public.service_records,
  public.notifications,
  public.notification_preferences,
  public.reminders,
  public.jobs,
  public.documents,
  public.vehicles,
  public.profiles,
  public.accounts,
  public.sessions,
  public.users
CASCADE;

DROP TYPE IF EXISTS public.subscription_tier CASCADE;
DROP TYPE IF EXISTS public.subscription_status CASCADE;
DROP TYPE IF EXISTS public.job_status CASCADE;
DROP TYPE IF EXISTS public.job_priority CASCADE;
