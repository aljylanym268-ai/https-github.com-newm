-- =====================================================================
-- MISAR SYSTEMS — استعادة كلمة المرور عبر رمز تحقق يُرسل للهاتف
-- جدول معزول: لا يقرؤه ولا يعدّله أي عميل (RLS بلا سياسات = رفض للجميع).
-- الوصول إليه حصرياً من Edge Function misar-auth-otp بمفتاح الخدمة.
-- =====================================================================

create table if not exists public.password_reset_otps (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    email text not null,
    phone text not null,
    code_hash text not null,
    token_hash text,
    attempts int not null default 0,
    verified boolean not null default false,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    verified_expires_at timestamptz
);

create index if not exists password_reset_otps_user_idx on public.password_reset_otps (user_id, created_at desc);
create index if not exists password_reset_otps_phone_idx on public.password_reset_otps (phone, created_at desc);

alter table public.password_reset_otps enable row level security;

-- لا تُضف أي Policy: anon/authenticated مرفوضون تماماً.

-- دالة بحث آمنة عن مستخدم auth بالإيميل (تستخدمها Edge Function فقط بمفتاح الخدمة)
create or replace function public.misar_find_auth_user_by_email(p_email text)
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
    select u.id, u.email
    from auth.users u
    where lower(btrim(u.email)) = lower(btrim(p_email))
    limit 1;
$$;

revoke all on function public.misar_find_auth_user_by_email(text) from public;
revoke all on function public.misar_find_auth_user_by_email(text) from anon;
revoke all on function public.misar_find_auth_user_by_email(text) from authenticated;
grant execute on function public.misar_find_auth_user_by_email(text) to service_role;
