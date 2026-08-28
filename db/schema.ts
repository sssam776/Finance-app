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

// ---------------------------------------------------------------------------
// 14.9 Balance-sheet reconciliation (Module D)
// ---------------------------------------------------------------------------

/**
 * BS-001: the close state for one entity and one period.
 *
 * Its own table rather than a column on each workpaper, because locking has to
 * be one atomic fact with one owner and one place to pin the trial balance it
 * was locked against. Spread across N rows there is no single source of truth,
 * and a reopen has nowhere to record its reason.
 */
export const reconciliationPeriods = sqliteTable(
  "reconciliation_periods",
  {
    id: id(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    /** Date-only period end. */
    periodEnd: text("period_end").notNull(),
    status: text("status", { enum: ["open", "in_review", "locked"] })
      .notNull()
      .default("open"),
    /** The trial balance this period is reconciled against. Pinned, not re-read. */
    tbSnapshotId: text("tb_snapshot_id")
      .notNull()
      .references(() => reportSnapshots.id),
    lockedByEmail: text("locked_by_email"),
    lockedAt: text("locked_at"),
    /**
     * Set only when an admin locks over material accounts that are not
     * settled. Recorded so a close that skipped its own gate is visible
     * afterwards rather than indistinguishable from a clean one.
     */
    lockAcknowledgedUnresolved: integer("lock_acknowledged_unresolved", { mode: "boolean" })
      .notNull()
      .default(false),
    reopenedByEmail: text("reopened_by_email"),
    reopenedAt: text("reopened_at"),
    reopenReason: text("reopen_reason"),
    ...timestamps(),
  },
  (t) => ({
    reconciliationPeriodUnique: uniqueIndex("reconciliation_periods_unique").on(
      t.entityId,
      t.periodEnd
    ),
  })
);

/**
 * BS-001 in one row: the trial balance figure, what supports it, the
 * difference, and who prepared and reviewed it.
 *
 * `substantiatedAmount` and `difference` are stored at preparation time rather
 * than recomputed on read. A live recomputation would let a later bank import
 * silently change a workpaper somebody already signed off.
 */
export const reconciliationWorkpapers = sqliteTable(
  "reconciliation_workpapers",
  {
    id: id(),
    periodId: text("period_id")
      .notNull()
      .references(() => reconciliationPeriods.id),
    /** Denormalised so entity-access filtering happens before a row is built. */
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),

    accountCode: text("account_code").notNull(),
    accountName: text("account_name").notNull(),
    xeroAccountId: text("xero_account_id"),
    /** Points at the exact trial balance line this came from. */
    tbRowId: text("tb_row_id").references(() => reportRows.id),
    tbAmount: text("tb_amount").notNull(),

    substantiationType: text("substantiation_type", {
      enum: [
        "bank_balance",
        "intercompany",
        "aged_receivables",
        "aged_payables",
        "gst_control",
        "loan_register",
        "wip_schedule",
        "fixed_assets",
        "manual_schedule",
        "none",
      ],
    })
      .notNull()
      .default("none"),
    /** Null means nothing has substantiated this. Never conflate with zero. */
    substantiatedAmount: text("substantiated_amount"),
    substantiationSourceRef: text("substantiation_source_ref"),
    substantiationAvailability: text("substantiation_availability", {
      enum: ["available", "partial", "unavailable", "counterparty_unavailable"],
    })
      .notNull()
      .default("unavailable"),

    difference: text("difference"),
    currency: text("currency").notNull().default("NZD"),

    status: text("status", {
      enum: [
        "not_started",
        "in_progress",
        "reconciled",
        "reconciled_with_timing_difference",
        "unresolved",
        "unsubstantiated",
        "partial",
        "reviewed",
        "locked",
      ],
    })
      .notNull()
      .default("not_started"),
    isMaterial: integer("is_material", { mode: "boolean" }).notNull().default(false),
    timingDifferenceNote: text("timing_difference_note"),

    preparerEmail: text("preparer_email"),
    preparedAt: text("prepared_at"),
    reviewerEmail: text("reviewer_email"),
    reviewedAt: text("reviewed_at"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => ({
    workpaperPeriodAccountUnique: uniqueIndex("reconciliation_workpapers_unique").on(
      t.periodId,
      t.accountCode
    ),
    workpaperEntityStatusIdx: index("reconciliation_workpapers_entity_status_idx").on(
      t.entityId,
      t.status
    ),
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

// ---------------------------------------------------------------------------
// Canonical portfolio layer — lenders, facilities, security pools, properties
// ---------------------------------------------------------------------------

/**
 * The debt and property side of the group, which until now lived only in
 * Master_Finance_Schedule.xlsx and in an HTML dashboard with its figures
 * hard-coded into the page.
 *
 * Every table here is an input register or an effective-dated rule. Nothing
 * stores a derived figure: LVR, headroom, debt yield, ICR and the sale-release
 * result are all computed from these rows on read. The workbook's own
 * precomputed totals are the reason its tabs could disagree with each other,
 * and a stored ratio would reintroduce exactly that.
 *
 * Money and rates are Decimal strings for the same reason they are everywhere
 * else in this schema — a covenant tested at 65.0% must not fail because a
 * float landed on 0.6500000000000001.
 */

export const lenders = sqliteTable("lenders", {
  id: id(),
  name: text("name").notNull().unique(),
  /**
   * Senior lenders (ASB, BNZ) fund the investment book. Second-tier debt
   * (GH Invest) funds development, capitalises its interest and carries no
   * serviceable income, so it has to be separable from senior debt in every
   * ratio rather than blended into the group figure.
   */
  lenderType: text("lender_type", { enum: ["senior", "second_tier", "related_party", "other"] })
    .notNull()
    .default("senior"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  ...timestamps(),
});

/**
 * A cross-collateralised security pool. This is the single most consequential
 * modelling choice in the portfolio: ASB and BNZ debt is secured against a pool
 * of properties, not allocated property by property, so a covenant is tested on
 * whatever remains in the pool after a sale. It is why releasing one property
 * depends on every other property in the same pool.
 */
export const lenderPools = sqliteTable(
  "lender_pools",
  {
    id: id(),
    lenderId: text("lender_id")
      .notNull()
      .references(() => lenders.id),
    name: text("name").notNull(),
    /** The LVR the lender will release security back down to. Decimal fraction: "0.65". */
    targetLvr: text("target_lvr").notNull(),
    /**
     * The rate used for management stress testing, held per pool because it is
     * an internal assumption rather than a term of the facility. Decimal
     * fraction: "0.07".
     */
    stressRate: text("stress_rate").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    lenderPoolNameUnique: uniqueIndex("lender_pools_lender_name_unique").on(t.lenderId, t.name),
  })
);

export const PROPERTY_STATUSES = ["investment", "development", "held_for_sale"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/**
 * `status` drives which figures a property is allowed to appear in. Development
 * stock sits outside the investment LVR entirely — blending it in produced a
 * group figure of 54.7% that flattered the investment book, when the investment
 * book on its own was at 58.5% and far closer to its ceiling.
 */
export const properties = sqliteTable(
  "properties",
  {
    id: id(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    address: text("address"),
    assetType: text("asset_type"),
    status: text("status", { enum: PROPERTY_STATUSES }).notNull().default("investment"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => ({
    propertyEntityNameUnique: uniqueIndex("properties_entity_name_unique").on(t.entityId, t.name),
    propertyStatusIdx: index("properties_status_idx").on(t.status),
  })
);

export const VALUATION_BASES = ["bank", "market", "council"] as const;
export type ValuationBasis = (typeof VALUATION_BASES)[number];

/**
 * Valuations are append-only and dated, so a covenant can be re-tested on the
 * basis that applied at the time rather than on today's number.
 *
 * The three bases are deliberately not interchangeable. Bank value is what the
 * lender holds the security at and is the covenant basis; market value is the
 * expected sale price; council value is the rating valuation. Using a market
 * value where a covenant means bank value is the specific mistake this
 * separation exists to prevent — the repayment required to release a security
 * is set by the bank's number, so it does not move when the sale price does.
 */
export const propertyValuations = sqliteTable(
  "property_valuations",
  {
    id: id(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id),
    basis: text("basis", { enum: VALUATION_BASES }).notNull(),
    value: text("value").notNull(),
    currency: text("currency").notNull().default("NZD"),
    /** Date-only. Null is permitted because 36 properties currently have none. */
    valuationDate: text("valuation_date"),
    valuer: text("valuer"),
    sourceLineageId: text("source_lineage_id").references(() => sourceLineage.id),
    ...timestamps(),
  },
  (t) => ({
    valuationLookupIdx: index("property_valuations_lookup_idx").on(
      t.propertyId,
      t.basis,
      t.valuationDate
    ),
  })
);

/**
 * Normalised annual net operating income per property, dated. Held separately
 * from valuations because income and value move on different cycles and are
 * sourced differently — value from a valuer, income from the rent roll.
 */
export const propertyNoiSnapshots = sqliteTable(
  "property_noi_snapshots",
  {
    id: id(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id),
    annualNoi: text("annual_noi").notNull(),
    currency: text("currency").notNull().default("NZD"),
    /** Date-only. */
    asOfDate: text("as_of_date").notNull(),
    /**
     * Whether this property's income is actually flowing into the pool figures.
     * Trust-held rentals are known to be missing from the current mapping, which
     * understates one lender's coverage. An unmapped property must read as a
     * mapping gap, not as a lender with no income.
     */
    mappingStatus: text("mapping_status", { enum: ["mapped", "unmapped", "partial"] })
      .notNull()
      .default("mapped"),
    sourceLineageId: text("source_lineage_id").references(() => sourceLineage.id),
    ...timestamps(),
  },
  (t) => ({
    noiLookupIdx: index("property_noi_snapshots_lookup_idx").on(t.propertyId, t.asOfDate),
  })
);

/**
 * Which pool a property secures, and when. Effective-dated because properties
 * move between pools on refinance, and a covenant tested for a past date has to
 * see the pool as it stood then. `effectiveTo` null means current.
 */
export const propertyPoolMemberships = sqliteTable(
  "property_pool_memberships",
  {
    id: id(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id),
    poolId: text("pool_id")
      .notNull()
      .references(() => lenderPools.id),
    /**
     * Share of the property's value contributed to the pool, as a Decimal
     * fraction. Almost always "1", but a property can be partially charged.
     */
    contributionShare: text("contribution_share").notNull().default("1"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    ...timestamps(),
  },
  (t) => ({
    membershipPropertyIdx: index("property_pool_memberships_property_idx").on(
      t.propertyId,
      t.effectiveFrom
    ),
    membershipPoolIdx: index("property_pool_memberships_pool_idx").on(t.poolId, t.effectiveFrom),
  })
);

export const loanFacilities = sqliteTable(
  "loan_facilities",
  {
    id: id(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    lenderId: text("lender_id")
      .notNull()
      .references(() => lenders.id),
    /** Null for an unsecured or unpooled facility. */
    poolId: text("pool_id").references(() => lenderPools.id),
    facilityReference: text("facility_reference").notNull(),
    facilityType: text("facility_type", {
      enum: ["term_loan", "revolving_credit", "overdraft", "development", "other"],
    })
      .notNull()
      .default("term_loan"),
    /**
     * Limit and drawn are separate because available revolving liquidity is
     * limit minus drawn. Treating a facility's balance as if it were cash on
     * hand overstates liquidity by the amount already borrowed.
     */
    facilityLimit: text("facility_limit"),
    drawnAmount: text("drawn_amount").notNull().default("0"),
    currency: text("currency").notNull().default("NZD"),
    /** Decimal fraction: "0.08" for 8.00% p.a. */
    interestRate: text("interest_rate"),
    rateType: text("rate_type", { enum: ["fixed", "floating", "capitalised", "unknown"] })
      .notNull()
      .default("unknown"),
    /**
     * Interest that capitalises is not serviced out of income, so including the
     * facility in an interest-cover calculation understates every other
     * lender's coverage. Excluded from ICR rather than silently averaged in.
     */
    interestCapitalised: integer("interest_capitalised", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Undrawn headroom counts as liquidity only when it is genuinely available
     * to draw. Set explicitly by an administrator, never inferred from the
     * facility type.
     */
    includeInAvailableLiquidity: integer("include_in_available_liquidity", { mode: "boolean" })
      .notNull()
      .default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => ({
    /**
     * Scoped to the entity as well as the lender.
     *
     * Keyed on lender and reference alone, this forbade a shape that is
     * ordinary in a property group: two SPVs each holding an ASB facility
     * referenced "1". A reference is only ever unique within one borrower's
     * arrangements with one lender.
     */
    facilityReferenceUnique: uniqueIndex("loan_facilities_entity_lender_reference_unique").on(
      t.entityId,
      t.lenderId,
      t.facilityReference
    ),
    facilityPoolIdx: index("loan_facilities_pool_idx").on(t.poolId),
    facilityEntityIdx: index("loan_facilities_entity_idx").on(t.entityId),
  })
);

/**
 * Rate re-fixes and term expiries as dated rows rather than parsed out of a
 * free-text notes column at read time. The workbook holds these as prose in
 * several date formats, which is why they are normalised on the way in.
 */
export const facilityEvents = sqliteTable(
  "facility_events",
  {
    id: id(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => loanFacilities.id),
    eventType: text("event_type", { enum: ["rate_refix", "term_expiry", "review", "drawdown"] })
      .notNull(),
    /** Date-only. */
    eventDate: text("event_date").notNull(),
    /**
     * A date that has passed is not automatically a problem — a term loan may
     * have been rolled without the register being updated. Confirmed status is
     * recorded so an unconfirmed past date reads as needing a check rather than
     * as a default.
     */
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    source: text("source"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => ({
    facilityEventIdx: index("facility_events_facility_date_idx").on(t.facilityId, t.eventDate),
    facilityEventDateIdx: index("facility_events_date_idx").on(t.eventDate),
  })
);

export const COVENANT_METRICS = ["lvr", "icr", "dscr", "debt_yield"] as const;
export type CovenantMetric = (typeof COVENANT_METRICS)[number];

/**
 * Covenant thresholds, effective-dated.
 *
 * The dating is not decoration. One lender's interest-cover test steps up from
 * 1.75x to 1.95x on a known future date, and current cover sits just under the
 * higher figure. A single stored threshold would either hide that today or
 * report a breach that has not happened yet; the pair of dates lets the engine
 * answer for whichever date it is asked about.
 *
 * `lenderId` is always set because a covenant is always a term of someone's
 * facility. `poolId` narrows it to one security pool when the test is pooled;
 * left null the rule applies to the lender's whole exposure.
 */
export const covenantRules = sqliteTable(
  "covenant_rules",
  {
    id: id(),
    lenderId: text("lender_id")
      .notNull()
      .references(() => lenders.id),
    poolId: text("pool_id").references(() => lenderPools.id),
    metric: text("metric", { enum: COVENANT_METRICS }).notNull(),
    operator: text("operator", { enum: ["lte", "gte"] }).notNull(),
    /** Decimal. "0.65" for a 65% LVR ceiling, "1.95" for a 1.95x cover floor. */
    threshold: text("threshold").notNull(),
    /**
     * Which valuation basis the test is measured against. A ratio is meaningless
     * without it, and lenders do not all use the same one.
     */
    valuationBasis: text("valuation_basis", { enum: VALUATION_BASES }),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    /**
     * Distinguishes a term of the facility from an internal management test.
     * A lender with no express financial covenant is monitored, and reporting
     * that as a breach would be wrong.
     */
    ruleType: text("rule_type", { enum: ["covenant", "monitoring", "management_stress"] })
      .notNull()
      .default("covenant"),
    sourceLineageId: text("source_lineage_id").references(() => sourceLineage.id),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => ({
    covenantLookupIdx: index("covenant_rules_lookup_idx").on(
      t.lenderId,
      t.metric,
      t.effectiveFrom
    ),
  })
);

/**
 * Where a hand-entered figure came from, so a number on a board pack can be
 * traced to the workbook cell or document behind it.
 *
 * Bank and Xero figures already carry their own lineage — a file checksum and
 * import record, or a sync run. This covers the rest: valuations, NOI and
 * covenant terms, which arrive as spreadsheet cells and letters and would
 * otherwise be the only figures on screen that could not be sourced.
 */
export const sourceLineage = sqliteTable("source_lineage", {
  id: id(),
  sourceType: text("source_type", {
    enum: ["workbook", "document", "manual_entry", "bank_import", "xero_sync"],
  }).notNull(),
  sourceName: text("source_name").notNull(),
  sheetName: text("sheet_name"),
  cellOrRowRef: text("cell_or_row_ref"),
  /** Date-only. The as-at date of the source itself, not when it was entered. */
  sourceAsOfDate: text("source_as_of_date"),
  /** Set when the source was a bank CSV, linking back to that import record. */
  bankImportId: text("bank_import_id").references(() => bankImports.id),
  recordedByEmail: text("recorded_by_email").notNull(),
  ...timestamps(),
});
