# MISAR SYSTEMS Security Review

**Review date:** 2026-10-20  
**Scope:** Static review of local SQL policy scripts, Supabase Edge Functions, and Push notification flows. No SQL was executed and no remote Supabase configuration was inspected.

## Remediation status

- The daily report endpoint now fails closed if `REPORT_CRON_SECRET` is missing, accepts the secret only through `x-cron-secret`, and only accepts POST requests. The deployed endpoint must be redeployed and its secret configured for this protection to take effect.
- The app now attempts to synchronize a registered Push subscription when an authenticated user opens or resumes the app. If a subscription changes while no app window is open, synchronization occurs the next time the user opens the app.
- A local, unapplied migration (`supabase/migrations/20261020_user_data_security_hardening.sql`) now removes existing `user_data` policies and replaces them with owner, order-party, founder/admin, and permission-scoped general-manager access. It also protects privileged account fields, validates order participants against the product owner, and permits only an approved same-center courier to claim or release an order. This change has not been run against Supabase.
- The founder/admin helper in the general-manager migration no longer treats every active general manager as a founder/admin. General-manager access remains controlled by the existing per-section permissions.
- Obsolete order/profile RLS scripts that could recreate broad participant update policies or recursive checks are now diagnostic-only. The diagnostic output is local and does not inspect the live Supabase project.
- Courier in-app notifications are now created by the authenticated Push Edge Function using its server-side client, rather than by a client-side query for all couriers' profile rows.
- No database changes or deployments were performed. The live RLS state, schema compatibility, and deployment secrets remain unverified.

## Security findings

### High — Self-service role escalation

- **Evidence:** Older `msaar` SQL files and `supabase/migrations/20261007_general_manager_system.sql`; proposed controls are in `supabase/migrations/20261020_user_data_security_hardening.sql`.
- **Risk:** If older permissive policies/triggers are already active in Supabase, they may still permit self-service role escalation until the reviewed hardening migration is applied. Local source changes do not alter deployed policies.
- **Local fix:** The proposed trigger rejects self-service role/status changes, prevents non-founders from editing/deleting privileged accounts, and rejects privileged-role creation. The older emergency scripts in `msaar` are diagnostic-only.
- **Verification needed:** Compare the migration with the live schema and active policies, then apply it through the approved Supabase process and test with client, seller, courier, general-manager, founder, and service-role identities.

### High — Public access to user data

- **Evidence:** Historical versions of `msaar/fix_rls_emergency.sql` and `fix_user_data_and_founder_rls.sql`; the local security hardening migration drops all existing `user_data` policies and creates scoped policies.
- **Risk:** If an unrestricted `anon` policy was applied earlier, unauthenticated visitors may still read profile data until the new policy set is applied.
- **Local fix:** The local emergency scripts are diagnostic-only, and the proposed migration does not grant `anon` access. Public store profiles continue to use the project's public RPC/view paths rather than a full-table fallback.
- **Verification needed:** Inspect `pg_policies` in the live project and test anonymous reads after an approved migration.

### Medium — Daily report endpoint (local fix made; deployment required)

- **Evidence:** `supabase/functions/misar-daily-report/index.ts:24-26,61-65,83-91` and `supabase/config.toml:35-38`.
- **Risk before fix:** JWT verification is disabled for this function, while `REPORT_CRON_SECRET` was optional. Without the secret, unauthenticated callers could invoke the service-role-backed report and receive aggregate order or sales information.
- **Local fix:** The function now requires a configured secret, checks it using the `x-cron-secret` header, rejects other HTTP methods, and fails closed if the secret is missing. Query-string secrets are no longer accepted.
- **Deployment required:** The fix does not affect the deployed function until it is redeployed and a high-entropy `REPORT_CRON_SECRET` is set. No remote settings were inspected or changed.

## Operational note (local recovery added)

- **Push subscription renewal:** `sw.js:124-133` forwards a changed subscription only to currently open windows. The page now attempts to upsert the browser's current subscription after an authenticated app startup or resume, repairing a missed renewal when the user next opens the app. A subscription that changes while no page is open cannot be synchronized until then.
- **Courier notifications:** The Push function now queries eligible couriers server-side and creates their in-app notifications; the client no longer reads all courier profile IDs. Verify the function is redeployed and its service-role/VAPID secrets are configured before relying on it.

## Review limitations

- This is a static review of files in the local workspace. It does not establish which SQL scripts were applied, inspect live RLS policies, or validate deployed function secrets.
- No SQL or remote settings were changed during the review.
