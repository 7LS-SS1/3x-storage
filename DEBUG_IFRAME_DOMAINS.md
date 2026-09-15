# Iframe domain access debug

## Confirmed cause
The stored `SystemConfig.allowAllDomains` policy controls authorization, poster access, and playback refresh. Previously its schema default and missing-config fallbacks were false, requiring an active assigned domain. Existing false policies require the new migration or enabling Allow all domains in the admin UI.

## Fix
- Default new configurations and missing-config fallbacks to allow all domains.
- Migration `20260916090000_default_allow_all_domains` enables the existing singleton policy and changes the database default.
- Existing explicit restricted-mode controls remain available.
- Signed media URLs, session tokens, video availability checks, and rate limits remain enforced.

## Observed runtime error
Attempting to enable the current database policy from the development machine failed:

```text
PrismaClientInitializationError
Can't reach database server at [configured database host]:5432
```

The connection did not succeed; the database update was not applied. The configured host is an internal-looking service hostname; reachability from the deployment network has not been tested. Credentials are omitted.

## Validation
- API suite: 10 test files, 37 tests passed in the original workspace.
- API TypeScript check: passed.
- Added coverage for an unregistered HTTPS domain with no SystemConfig row.
- Existing coverage includes HTTP origins, absent Referer, and restricted mode.
- Production deployment, SQL migration execution, and browser playback are not yet verified.

## Deployment
Deploy the commit and run Prisma migrate deploy in the deployment database network. The repository Dockerfile includes a migrate target; verify that the deployment executes it successfully. Pushing Git alone does not confirm migration execution.
