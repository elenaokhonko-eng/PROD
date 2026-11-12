# Harbor E2E release lanes

The suite has four evidence lanes:

- `playwright.config.ts`: local/static public routes, accessibility and reviewed visuals.
- `playwright.synthetic.config.ts`: router and provider-mocked recovery behavior.
- `playwright.preview.config.ts`: guarded, unauthenticated preview checks.
- `playwright.authenticated.config.ts`: guarded two-user and provider-delivered checks.

Live lanes never skip because credentials are absent. Configuration fails closed unless the exact SHA, preview identity, environment revision, worker version, fixture JSON and controlled credentials are present. Authenticated configuration also requires the exact preview Supabase host plus an explicit production-Supabase denylist. The authenticated fixture automatically aborts configured production origins in every browser context; direct API handshake probes disable redirects and inspect `Location` explicitly.

Three Clerk storage states are required: user A, user B, and a disposable deletion user. They must match the versioned release fixture; never substitute a production, customer or staff account. Storage states belong under `tests/e2e/.auth/` and must not be committed.

```powershell
$env:HARBOR_AUTH_STORAGE_STATE_USER_A = 'tests\e2e\.auth\harbor-user-a.json'
$env:HARBOR_AUTH_STORAGE_STATE_USER_B = 'tests\e2e\.auth\harbor-user-b.json'
$env:HARBOR_AUTH_STORAGE_STATE_DELETION_USER = 'tests\e2e\.auth\harbor-deletion-user.json'
```

Do not load `.env.local` implicitly. Supply the approved release environment explicitly. The full variable and command matrices are in `docs/release/harbor-release-handoff.md`.

Release evidence lanes do not retry: an initial external handshake or browser failure remains a failed required check. Authenticated traces may contain session and seeded case data. CI encrypts authenticated artifacts before upload. Never attach raw storage states, trace ZIPs, fixture JSON, service keys or bearer tokens to a pull request.
