-- ==============================================================================
-- 02_row_level_security.sql
-- LinkedFlow Row-Level Security (RLS) & Isolation Policies
-- ==============================================================================

-- Enable RLS on core tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_safety_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unipile_accounts ENABLE ROW LEVEL SECURITY;

-- Helper Function: Check if auth user is a member of the organization
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = org_id AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for Organizations
CREATE POLICY "Users can view their organizations"
ON public.organizations FOR SELECT USING (
    id IN (SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid())
);

-- RLS Policies for Organization Members
CREATE POLICY "Users can view members of their organizations"
ON public.organization_members FOR SELECT USING (
    public.is_org_member(organization_id)
);

-- RLS Policies for Account Safety Settings
CREATE POLICY "Users can view safety settings of their org"
ON public.account_safety_settings FOR SELECT USING (
    public.is_org_member(organization_id)
);

CREATE POLICY "Admins/Owners can update safety settings"
ON public.account_safety_settings FOR UPDATE USING (
    organization_id IN (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
);

-- RLS Policies for Campaigns
CREATE POLICY "Tenant campaigns select policy"
ON public.campaigns FOR SELECT USING (
    organization_id IS NULL OR public.is_org_member(organization_id)
);

CREATE POLICY "Tenant campaigns insert policy"
ON public.campaigns FOR INSERT WITH CHECK (
    organization_id IS NULL OR public.is_org_member(organization_id)
);

CREATE POLICY "Tenant campaigns update policy"
ON public.campaigns FOR UPDATE USING (
    organization_id IS NULL OR public.is_org_member(organization_id)
);

-- RLS Policies for Prospects
CREATE POLICY "Tenant prospects select policy"
ON public.prospects FOR SELECT USING (
    organization_id IS NULL OR public.is_org_member(organization_id)
);

CREATE POLICY "Tenant prospects insert policy"
ON public.prospects FOR INSERT WITH CHECK (
    organization_id IS NULL OR public.is_org_member(organization_id)
);

CREATE POLICY "Tenant prospects update policy"
ON public.prospects FOR UPDATE USING (
    organization_id IS NULL OR public.is_org_member(organization_id)
);
