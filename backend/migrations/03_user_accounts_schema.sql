-- ==============================================================================
-- 03_user_accounts_schema.sql
-- Super-Admin Managed User Accounts & Credentials Table
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_text VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'owner',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

-- Allow super admin and service role full access
CREATE POLICY "Super-admin full access on user_accounts"
ON public.user_accounts FOR ALL USING (true);
