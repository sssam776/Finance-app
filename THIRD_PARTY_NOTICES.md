# Third-Party Notices

## xero-node

- Source: https://github.com/XeroAPI/xero-node
- Licence: MIT (verify current licence text at the repository above before
  any redistribution beyond internal use)
- Used as an npm dependency (not forked or vendored) for Xero OAuth 2.0 and
  Accounting API access — see `lib/xero/appRegistry.ts`, `lib/xero/gateway.ts`.
- No code was copied from the repository; only the published package is
  consumed via `import { XeroClient } from "xero-node"`.

No other third-party source code has been copied into this repository.
Standard npm dependencies (Next.js, React, Drizzle ORM, decimal.js,
csv-parse, date-fns, zod, nanoid) are consumed as published packages under
their own licences and are not modified or vendored.
