# 0035 Sign out per device; ended sessions go to sign-in

- **Finding (hosted demo logs, 2026-11-18):** POS requests were succeeding. The failures were "Refresh Token Not Found" followed by 401s. Demo logins are shared by several devices, and Sign out used Supabase's default global scope, which ends every device's session for that account.
- **Sign out now uses `scope: 'local'`.** Ending a staff member's access everywhere stays an owner action: deactivate the employee or revoke the membership.
- **A 401 is classified as `session_expired`,** even when Postgres also reports 42501, instead of "You do not have permission".
- **On `session_expired`, the app tries one token refresh.** If that fails, it ends the session on this device and the sign-in page says "Your session ended". An unrequested `SIGNED_OUT` event does the same. Pending request keys stay in sessionStorage, so an uncertain write can still be checked after signing in again.
- **Unconfirmed:** the owner's exact error text at Provo was not available, so this fix addresses the most likely cause rather than a confirmed one.
