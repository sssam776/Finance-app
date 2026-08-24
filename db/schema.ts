import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * v0 schema — the smallest set of tables needed for the first vertical slice
 * (entity registry, bank CSV import, single-app Xero OAuth/sync, cash position).
 * Written against the SQLite dialect so it can move to Cloudflare D1 with the
 * same schema and Drizzle's d1 driver later (see ADR-002). Tables required by
 * later phases (GST, intercompany, rules, write-back, payroll, multi-app
 * capacity/compliance tracking) are intentionally not created yet — see
 * docs/implementation-plan.md for the full Part XI.14 table list.
 */

function id(name = "id") {
  return text(name).primaryKey();
}

function timestamps() {
  return {
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  };
}

// ---------------------------------------------------------------------------
// 7. Entity registry
// ---------------------------------------------------------------------------

export const entities = sqliteTable("entities", {
  id: id(),
  legalName: text("legal_name").notNull(),
  shortCode: text("short_code").notNull().unique(),
  displayName: text("display_name").notNull(),
  entityType: text("entity_type").notNull(),
  status: text("status", { enum: ["active", "dormant", "excluded", "unverified"] })
    .notNull()
    .default("unverified"),
  xeroTenantId: text("xero_tenant_id"),
  xeroOrganisationName: text("xero_organisation_name"),
  financialYearEnd: text("financial_year_end"),
  reportingCurrency: text("reporting_currency").notNull().default("NZD"),
  gstRegistered: integer("gst_registered", { mode: "boolean" }),
  notes: text("notes"),
  ...timestamps(),
});

export const entityBankAccounts = sqliteTable(
  "entity_bank_accounts",
  {
    id: id(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    bankName: text("bank_name", { enum: ["ASB", "BNZ"] }).notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    currency: text("currency").notNull().default("NZD"),
    xeroAccountCode: text("xero_account_code"),
    isLoanFacility: integer("is_loan_facility", { mode: "boolean" }).notNull().default(false),
    ...timestamps(),
  },
  (t) => ({
    entityBankUnique: uniqueIndex("entity_bank_accounts_unique").on(t.entityId, t.accountNumber),
  })
);

// ---------------------------------------------------------------------------
// 14.3 Xero apps, OAuth and connections (single-app v0 shape)
// ---------------------------------------------------------------------------

export const xeroApps = sqliteTable("xero_apps", {
  id: id(),
  appKey: text("app_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  environment: text("environment", { enum: ["development", "staging", "production"] }).notNull(),
  purpose: text("purpose", {
    enum: ["read_core", "controlled_write", "payroll_draft", "demo", "migration"],
  }).notNull(),
  tier: text("tier", { enum: ["Starter", "Core", "Plus", "Advanced", "Custom Connection"] }).notNull(),
  connectionLimit: integer("connection_limit").notNull(),
  scopeProfile: text("scope_profile").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  clientIdSecretRef: text("client_id_secret_ref").notNull(),
  clientSecretSecretRef: text("client_secret_secret_ref").notNull(),
  operationalOwner: text("operational_owner"),
  complianceStatus: text("compliance_status", {
    enum: ["draft", "internal_review", "xero_confirmation_required", "approved", "rejected", "retired"],
  })
    .notNull()
    .default("draft"),
  approvalReference: text("approval_reference"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps(),
});

export const xeroAuthorizations = sqliteTable("xero_authorizations", {
  id: id(),
  xeroAppId: text("xero_app_id").notNull().references(() => xeroApps.id),
  encryptedTokenSet: text("encrypted_token_set").notNull(),
  encryptionKeyVersion: integer("encryption_key_version").notNull(),
  tokenExpiresAt: text("token_expires_at").notNull(),
  grantedScopes: text("granted_scopes").notNull(),
  refreshVersion: integer("refresh_version").notNull().default(0),
  status: text("status", { enum: ["active", "expired", "revoked", "error"] })
    .notNull()
    .default("active"),
  lastRefreshAt: text("last_refresh_at"),
  lastRefreshError: text("last_refresh_error"),
  authorisingUserEmail: text("authorising_user_email").notNull(),
  ...timestamps(),
});

export const xeroConnections = sqliteTable(
  "xero_connections",
  {
    id: id(),
    xeroAppId: text("xero_app_id").notNull().references(() => xeroApps.id),
    authorizationId: text("authorization_id").notNull().references(() => xeroAuthorizations.id),
    xeroTenantId: text("xero_tenant_id").notNull(),
    xeroTenantType: text("xero_tenant_type"),
    xeroOrganisationName: text("xero_organisation_name"),
    status: text("status", {
      enum: [
        "pending_authorisation",
        "healthy",
        "refresh_due",
        "reauthorisation_required",
        "permission_missing",
        "rate_limited",
        "sync_error",
        "disconnected",
        "disabled",
        "capacity_blocked",
        "compliance_blocked",
      ],
    })
      .notNull()
      .default("pending_authorisation"),
    firstConnectedAt: text("first_connected_at"),
    lastConnectedAt: text("last_connected_at"),
    lastSuccessfulCallAt: text("last_successful_call_at"),
    disconnectedAt: text("disconnected_at"),
    disconnectedReason: text("disconnected_reason"),
    ...timestamps(),
  },
  (t) => ({
    appTenantUnique: uniqueIndex("xero_connections_app_tenant_unique").on(t.xeroAppId, t.xeroTenantId),
  })
);

export const entityXeroAppAssignments = sqliteTable(
  "entity_xero_app_assignments",
  {
    id: id(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    purpose: text("purpose", {
      enum: ["read_core", "controlled_write", "payroll_draft", "demo", "migration"],
    }).notNull(),
    xeroAppId: text("xero_app_id").notNull().references(() => xeroApps.id),
    connectionId: text("connection_id").notNull().references(() => xeroConnections.id),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    status: text("status", { enum: ["active", "shadow_migration", "retired"] })
      .notNull()
      .default("active"),
    createdBy: text("created_by").notNull(),
    ...timestamps(),
  },
  (t) => ({
    activeAssignmentIdx: index("entity_xero_app_assignments_active_idx").on(
      t.entityId,
      t.purpose,
      t.status
    ),
  })
);

export const xeroOauthStates = sqliteTable("xero_oauth_states", {
  id: id(),
  xeroAppId: text("xero_app_id").notNull().references(() => xeroApps.id),
  state: text("state").notNull().unique(),
  initiatingUserEmail: text("initiating_user_email").notNull(),
  intendedEntityId: text("intended_entity_id"),
  intendedPurpose: text("intended_purpose").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// 14.4 Sync and lineage (minimal)
// ---------------------------------------------------------------------------

export const syncRuns = sqliteTable("sync_runs", {
  id: id(),
  xeroAppId: text("xero_app_id").references(() => xeroApps.id),
  connectionId: text("connection_id").references(() => xeroConnections.id),
  entityId: text("entity_id").references(() => entities.id),
  resource: text("resource").notNull(),
  status: text("status", { enum: ["queued", "running", "complete", "partial", "failed", "cancelled"] })
    .notNull()
    .default("queued"),
  recordsRead: integer("records_read").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  error: text("error"),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// 14.5 Xero reference data (minimal — accounts only for v0)
// ---------------------------------------------------------------------------

export const xeroAccounts = sqliteTable(
  "xero_accounts",
  {
    id: id(),
    entityId: text("entity_id").notNull().references(() => entities.id),
    xeroAppId: text("xero_app_id").notNull(),
    connectionId: text("connection_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    xeroAccountId: text("xero_account_id").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    type: text("type"),
    currentBalance: text("current_balance"),
    balanceAsAt: text("balance_as_at"),
    sourceUpdatedAt: text("source_updated_at"),
    syncRunId: text("sync_run_id").references(() => syncRuns.id),
    ...timestamps(),
  },
  (t) => ({
    entityXeroAccountUnique: uniqueIndex("xero_accounts_entity_account_unique").on(
      t.entityId,
      t.xeroAccountId
    ),
  })
);

// ---------------------------------------------------------------------------
// 14.8 Cash: bank imports and balance snapshots
// ---------------------------------------------------------------------------

export const bankImports = sqliteTable("bank_imports", {
  id: id(),
  entityId: text("entity_id").notNull().references(() => entities.id),
  bankName: text("bank_name", { enum: ["ASB", "BNZ"] }).notNull(),
  sourceFileKey: text("source_file_key").notNull(),
  sourceFileChecksum: text("source_file_checksum").notNull(),
  fileReceivedAt: text("file_received_at").notNull(),
  processedAt: text("processed_at"),
  importedByEmail: text("imported_by_email").notNull(),
  parserVersion: text("parser_version").notNull(),
  status: text("status", { enum: ["received", "parsed", "failed", "superseded"] })
    .notNull()
    .default("received"),
  error: text("error"),
  ...timestamps(),
});

export const bankBalanceSnapshots = sqliteTable("bank_balance_snapshots", {
  id: id(),
  bankImportId: text("bank_import_id").notNull().references(() => bankImports.id),
  entityBankAccountId: text("entity_bank_account_id").notNull().references(() => entityBankAccounts.id),
  balanceDate: text("balance_date").notNull(), // date-only, source institution's as-at date
  sourceTimezone: text("source_timezone").notNull().default("Pacific/Auckland"),
  closingBalance: text("closing_balance").notNull(), // decimal string
  currency: text("currency").notNull().default("NZD"),
  sourceRowRef: text("source_row_ref"),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// 14.7 Xero report snapshots and rows
// ---------------------------------------------------------------------------

/**
 * One table for every tabular Xero report, not one per module.
 *
 * Modules B, C and D each specified tables with these names and different
 * columns, so whichever was built first would have silently broken the other
 * two. This is the merged shape: C's period axis, D's evidence columns, B's
 * ordering.
 *
 * Immutable by run (spec 14.7). A refresh inserts a new snapshot rather than
 * updating one, so a board pack signed off in March still resolves to the
 * figures it was signed off on.
 */
export const REPORT_TYPES = [
  "profit_and_loss",
  "balance_sheet",
  "trial_balance",
  "bank_summary",
  "aged_receivables",
  "aged_payables",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const reportSnapshots = sqliteTable(
  "report_snapshots",
  {
    id: id(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    reportType: text("report_type", { enum: REPORT_TYPES }).notNull(),
    /** Date-only. The as-at date for a point-in-time report, the period end otherwise. */
    periodEnd: text("period_end").notNull(),

    // Lineage. Every synced row carries where it came from (spec 10.5).
    xeroAppId: text("xero_app_id").notNull(),
    connectionId: text("connection_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => syncRuns.id),

    sourceReportId: text("source_report_id"),
    reportTitle: text("report_title"),

    /**
     * SHA-256 of the raw response, and the key it was stored under. A parser
     * bug is then re-runnable against the original payload rather than
     * requiring a fresh sync that may no longer return the same figures.
     */
    payloadHash: text("payload_hash").notNull(),
    rawFileKey: text("raw_file_key"),
    parserVersion: text("parser_version").notNull(),

    /**
     * Trial balance only. False fails the sync run: a trial balance whose
     * debits and credits disagree means the parse is wrong, and every figure
     * derived from it is untrustworthy.
     */
    debitTotal: text("debit_total"),
    creditTotal: text("credit_total"),
    balanced: integer("balanced", { mode: "boolean" }),

    rowCount: integer("row_count").notNull().default(0),
    fetchedAt: text("fetched_at").notNull(),
    ...timestamps(),
  },
  (t) => ({
    reportSnapshotRunUnique: uniqueIndex("report_snapshots_run_unique").on(
      t.entityId,
      t.reportType,
      t.periodEnd,
      t.syncRunId
    ),
    reportSnapshotLookupIdx: index("report_snapshots_lookup_idx").on(
      t.entityId,
      t.reportType,
      t.periodEnd
    ),
  })
);

/**
 * One row per account per column, stored long rather than wide.
 *
 * `periodKey` is the column axis and records WHICH period a figure belongs to,
 * never how it is being viewed. A column stored as "prior_year" would be wrong
 * twelve months later when the same figure is two years back; the comparison
 * label is derived at read time by lib/periods.ts::relativeLabel.
 */
export const reportRows = sqliteTable(
  "report_rows",
  {
    id: id(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => reportSnapshots.id),

    /** Position in the source report. Xero's own ordering is meaningful. */
    rowOrder: integer("row_order").notNull(),
    sectionTitle: text("section_title"),
    /** Drives favourable/adverse: a cost increase is not the same as revenue rising. */
    sectionKind: text("section_kind", {
      enum: ["revenue", "expense", "asset", "liability", "equity", "other"],
    }),

    accountCode: text("account_code"),
    accountName: text("account_name").notNull(),
    /** Xero omits the account id on subtotal rows, so this is nullable. */
    xeroAccountId: text("xero_account_id"),

    /** `YYYY-MM` for a period column, a date-only for a point-in-time report. */
    periodKey: text("period_key").notNull(),
    amount: text("amount").notNull(), // decimal string
    currency: text("currency").notNull().default("NZD"),

    /**
     * Trial balance only. BS-003 requires preserving the source signs as
     * evidence, so the normalised debit-positive figure lives alongside them
     * rather than replacing them.
     */
    sourceDebit: text("source_debit"),
    sourceCredit: text("source_credit"),

    isSubtotal: integer("is_subtotal", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    reportRowsSnapshotIdx: index("report_rows_snapshot_idx").on(t.snapshotId, t.rowOrder),
    reportRowsAccountIdx: index("report_rows_account_idx").on(t.snapshotId, t.accountCode),
  })
);

/**
 * VAR-004: why a figure moved, in a person's words.
 *
 * Its own table, and nothing on the calculation path reads it. The variance
 * route returns commentary under a separate key from the figures so that no
 * amount of editing here can change a number there. `citedRowIds` records
 * which rows the explanation was written against, so a comment can be shown
 * as stale once those rows are superseded rather than quietly describing
 * figures that have since moved.
 */
export const varianceCommentary = sqliteTable(
  "variance_commentary",
  {
    id: id(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    /** `YYYY-MM`. */
    period: text("period").notNull(),
    comparison: text("comparison", {
      enum: ["prior_month", "prior_year_month", "prior_year_ytd", "budget", "custom"],
    }).notNull(),
    /** An account name, or the literal "*" for a whole-entity narrative. */
    accountKey: text("account_key").notNull(),
    origin: text("origin", { enum: ["user", "ai"] })
      .notNull()
      .default("user"),
    body: text("body").notNull(),
    /** JSON array of report_rows ids the explanation was written against. */
    citedRowIds: text("cited_row_ids"),
    authorEmail: text("author_email").notNull(),
    status: text("status", { enum: ["draft", "final", "superseded"] })
      .notNull()
      .default("draft"),
    ...timestamps(),
  },
  (t) => ({
    varianceCommentaryLookupIdx: index("variance_commentary_lookup_idx").on(
      t.entityId,
      t.period,
      t.accountKey
    ),
  })
);

export const WHOLE_ENTITY_COMMENTARY = "*";

// ---------------------------------------------------------------------------
// 15.1 Identity and access
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "viewer"] })
    .notNull()
    .default("viewer"),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  lastLoginAt: text("last_login_at"),
  ...timestamps(),
});

/**
 * `id` holds the SHA-256 of the session token, never the token itself — the
 * raw token only ever exists in the user's cookie. Read access to this table
 * therefore does not hand over live sessions.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    sessionsUserIdx: index("sessions_user_idx").on(t.userId),
  })
);

/**
 * Spec 14.1 / 31 — per-entity scoping.
 *
 * `users.role` is the capability axis (what a person may do); this table is
 * the scope axis (which entities they may do it to). Keeping them separate
 * avoids inventing a second identity system, which spec 31 forbids without
 * an ADR, while still allowing a preparer to be trusted with one entity and
 * not another.
 */
export const entityPermissions = sqliteTable(
  "entity_permissions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    grantedByEmail: text("granted_by_email").notNull(),
    ...timestamps(),
  },
  (t) => ({
    entityPermissionUnique: uniqueIndex("entity_permissions_unique").on(t.userId, t.entityId),
    entityPermissionUserIdx: index("entity_permissions_user_idx").on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// 18. CASH-005 — configurable variance exception thresholds
// ---------------------------------------------------------------------------

/**
 * `entityId` is the literal `"*"` for the group-wide default, otherwise an
 * entity id. It is deliberately NOT a foreign key and NOT nullable: SQLite
 * treats NULLs as distinct in a unique index, so a nullable "global" row
 * could silently be duplicated. A sentinel keeps one row per scope
 * enforceable by the database rather than by convention.
 */
export const GLOBAL_THRESHOLD_SCOPE = "*";

/**
 * `context` separates tolerances that happen to share a shape but mean
 * different things. A $1,000 cash variance tolerance is not $1,000 of
 * balance-sheet materiality: reusing one as the other marks every account
 * over $1,000 material and buries the ones that matter.
 *
 * Defaults to 'cash' so the existing CASH-005 rows and callers are unchanged.
 */
export const THRESHOLD_CONTEXTS = [
  "cash",
  "pnl_movement",
  "budget_variance",
  "balance_sheet",
] as const;

export type ThresholdContext = (typeof THRESHOLD_CONTEXTS)[number];

export const varianceThresholds = sqliteTable(
  "variance_thresholds",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    context: text("context", { enum: THRESHOLD_CONTEXTS }).notNull().default("cash"),
    absoluteAmount: text("absolute_amount").notNull(), // decimal string
    percent: text("percent"), // decimal string, optional second trigger
    updatedByEmail: text("updated_by_email").notNull(),
    ...timestamps(),
  },
  (t) => ({
    varianceThresholdScopeUnique: uniqueIndex("variance_thresholds_scope_context_unique").on(
      t.entityId,
      t.context
    ),
  })
);

// ---------------------------------------------------------------------------
// 15.5 Audit
// ---------------------------------------------------------------------------

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: id(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    entityId: text("entity_id"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    detail: text("detail"), // JSON string, no secrets
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    // The login throttle queries (action, actor_email, created_at) on every
    // attempt. Without this index that is a full scan of a table an
    // unauthenticated caller can grow.
    auditActionActorIdx: index("audit_events_action_actor_idx").on(
      t.action,
      t.actorEmail,
      t.createdAt
    ),
    // Supports the global failure window, which counts by action and time
    // across all addresses.
    auditActionCreatedIdx: index("audit_events_action_created_idx").on(t.action, t.createdAt),
  })
);
