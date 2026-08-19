-- ==============================================================================
-- 01_multi_tenant_schema.sql
-- LinkedFlow SaaS Multi-Tenancy & Safety Settings Database Migration
-- ==============================================================================

-- 1. Organizations Table (Tenants)
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    max_linkedin_accounts INT DEFAULT 1,
    max_monthly_prospects INT DEFAULT 500,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Organization Memberships (Team Roles)
CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member', -- 'owner', 'admin', 'member'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- 3. Account Safety & Rate Limit Settings Table (User Configurable)
CREATE TABLE IF NOT EXISTS public.account_safety_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID UNIQUE NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    max_daily_invites INT DEFAULT 25,
    max_daily_messages INT DEFAULT 50,
    max_daily_profile_visits INT DEFAULT 80,
    jitter_delay_min_minutes INT DEFAULT 4,
    jitter_delay_max_minutes INT DEFAULT 12,
    working_hours_start VARCHAR(10) DEFAULT '09:00',
    working_hours_end VARCHAR(10) DEFAULT '18:00',
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Add organization_id to core data tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='campaigns' AND column_name='organization_id') THEN
        ALTER TABLE public.campaigns ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prospects' AND column_name='organization_id') THEN
        ALTER TABLE public.prospects ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prospect_lists' AND column_name='organization_id') THEN
        ALTER TABLE public.prospect_lists ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='campaign_templates' AND column_name='organization_id') THEN
        ALTER TABLE public.campaign_templates ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='unipile_accounts' AND column_name='organization_id') THEN
        ALTER TABLE public.unipile_accounts ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;
