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

export const varianceThresholds = sqliteTable(
  "variance_thresholds",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    absoluteAmount: text("absolute_amount").notNull(), // decimal string
    percent: text("percent"), // decimal string, optional second trigger
    updatedByEmail: text("updated_by_email").notNull(),
    ...timestamps(),
  },
  (t) => ({
    varianceThresholdScopeUnique: uniqueIndex("variance_thresholds_scope_unique").on(t.entityId),
  })
);

// ---------------------------------------------------------------------------
// 15.5 Audit
// ---------------------------------------------------------------------------

export const auditEvents = sqliteTable("audit_events", {
  id: id(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  entityId: text("entity_id"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  detail: text("detail"), // JSON string, no secrets
  createdAt: text("created_at").notNull(),
});
