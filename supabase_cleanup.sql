-- ====================================================================
-- SUPABASE DATABASE CLEANUP & TENANT AUDIT SCRIPT
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard
-- ====================================================================

-- 1. INSPECT CURRENT PROFILES TABLE
SELECT 
    id,
    profile_key,
    display_name,
    user_email,
    organization_id,
    unipile_account_id,
    session_active,
    created_at
FROM profiles;

-- 2. BACKFILL MISSING organization_id ON PROFILES BASED ON user_email
UPDATE profiles
SET organization_id = 'org_' || regexp_replace(lower(user_email), '[^a-z0-9]', '_', 'g')
WHERE (organization_id IS NULL OR organization_id = '') AND user_email IS NOT NULL AND user_email != '';

-- 3. REMOVE ORPHAN / DEMO PROFILES THAT DO NOT BELONG TO ANY VALID TENANT USER
DELETE FROM profiles
WHERE (organization_id IS NULL OR organization_id = '')
  AND (user_email IS NULL OR user_email = '')
  AND (display_name = 'Fatima Maqsood' OR unipile_account_id = 'zXneBg9WRZ-m7iFuKULo1Q');

-- 4. VERIFY USER ACCOUNTS TABLE MULTI-TENANCY
SELECT 
    id,
    email,
    role,
    organization_id,
    created_at
FROM user_accounts;

-- 5. FINAL SANITY AUDIT - LIST ALL ACTIVE PROFILES WITH THEIR TENANTS
SELECT 
    p.id as profile_id,
    p.display_name,
    p.user_email,
    p.organization_id,
    p.unipile_account_id,
    p.session_active,
    u.role as user_role
FROM profiles p
LEFT JOIN user_accounts u ON lower(p.user_email) = lower(u.email);
