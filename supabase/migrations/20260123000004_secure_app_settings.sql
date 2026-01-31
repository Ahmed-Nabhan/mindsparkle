-- Secure app_settings so it cannot be read/modified from client roles

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke privileges from common client roles
REVOKE ALL ON TABLE public.app_settings FROM anon;
REVOKE ALL ON TABLE public.app_settings FROM authenticated;
