# Deploying

The database is a SQLite file on disk, and that single fact decides everything
below. The app needs a **persistent volume**, and it must run as **exactly one
machine**. Two processes writing one SQLite file corrupt it; two machines each
mount their own volume and silently diverge.

That rules out Vercel, Netlify and Cloudflare Workers, none of which have a
writable disk that survives a request. `fly.toml` and the `Dockerfile` here
target Fly.io; Railway, Render and a plain VM work the same way.

## First deploy

```bash
fly launch --no-deploy          # keeps the committed fly.toml
fly volumes create ramwall_data --size 1 --region syd
```

Set the secrets. These are injected at runtime and never enter an image layer —
`.dockerignore` excludes every `.env` file for that reason.

```bash
fly secrets set \
  XERO_RAMWALL_READ_CORE_DEV_CLIENT_ID=... \
  XERO_RAMWALL_READ_CORE_DEV_CLIENT_SECRET=... \
  XERO_TOKEN_ENCRYPTION_KEY_V1=... \
  ADMIN_EMAIL=...
```

`XERO_TOKEN_ENCRYPTION_KEY_V1` must be **a new key**, not one that has been used
in development or pasted into a chat window. Generate it with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Losing that key means every Xero organisation has to reconnect, so store it
somewhere it can be recovered from.

```bash
fly deploy
fly scale count 1               # not optional, see below
```

## Then, in order

**1. Create the first administrator.** Nothing else works until this exists.

```bash
fly ssh console -C "npx tsx db/seed.ts"
```

It prints a generated password exactly once. Save it. Re-running the seed never
overwrites an existing account's password, so a lost one needs
`scripts/reset-admin-password.ts` instead.

**2. Point the Xero apps at the deployed URL.**

```bash
fly ssh console -C "npx tsx scripts/set-redirect-uri.ts https://<your-app>.fly.dev"
```

This step is easy to miss and fails confusingly. The redirect URI lives in
`xero_apps.redirect_uri`, copied from `XERO_REDIRECT_URI` when the row was
first seeded, and the seed uses `onConflictDoNothing` — so setting the
environment variable on the host does **nothing** to an existing row. Without
this, the consent URL keeps pointing at `localhost` and Xero refuses with
`invalid_redirect_uri`.

**3. Register the same URI on each Xero app** at
`https://developer.xero.com/app/manage`, under Configuration → Redirect URIs.
Xero compares it character for character, including scheme and trailing slash.

**4. Clear demo data** before connecting a real organisation, or invented
figures sit beside real ones in the same tables.

```bash
fly ssh console -C "npx tsx scripts/demo-data.ts --clear"
```

## Things that will bite

**Machine count.** `fly deploy` can add a machine. Check after every deploy:

```bash
fly status
fly scale count 1
```

**HTTPS is mandatory, not a nicety.** Session cookies are set `secure` when
`NODE_ENV=production` (`lib/session.ts`), so over plain HTTP the browser never
returns the cookie and nobody can sign in — the login form appears to succeed
and then nothing works. `force_https` in `fly.toml` handles this.

**Migrations run at container start**, not as a Fly `release_command`, because
the release machine does not mount the volume and this database exists only on
it. Drizzle records what it has applied, so restarts are a no-op.

**Backups.** One file at `/data/ramwall.db` holds every entity, encrypted token
and audit record. Nothing backs it up automatically.

```bash
fly ssh console -C "sqlite3 /data/ramwall.db '.backup /data/backup.db'"
fly sftp get /data/backup.db
```

**Machines are left running** (`auto_stop_machines = false`). A cold start
during the Xero consent round-trip can outlast the OAuth state's ten-minute
TTL. Setting it to `"stop"` lowers the bill and trades that away.

## Access

The app requires a login on every route, so a public URL is not public access —
an anonymous visitor gets a login page and nothing else. If the deployment
should not be reachable at all, put Cloudflare Access, Tailscale or host-level
IP allowlisting in front of it; the application's own authentication is
unaffected either way.
