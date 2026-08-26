import { XeroClient } from "xero-node";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroApps } from "@/db/schema";
import { resolveScopes } from "./scopeProfiles";
import { assertXeroAppUsable, type ComplianceContext } from "./compliance";

/**
 * All Xero client construction goes through this module (spec 10.4/8.2):
 * no route or domain service builds a XeroClient from process-global
 * credentials directly. The client ID/secret env var *names* live in the
 * xero_apps registry row; only the registry's own record decides which
 * env vars are read, never a value taken directly from a request.
 */

export type XeroAppRow = typeof xeroApps.$inferSelect;

export async function resolveXeroApp(appKey: string): Promise<XeroAppRow> {
  const app = db.select().from(xeroApps).where(eq(xeroApps.appKey, appKey)).get();
  if (!app) {
    throw new Error(`Unknown Xero app key "${appKey}"`);
  }
  if (!app.enabled) {
    throw new Error(`Xero app "${appKey}" is disabled`);
  }
  return app;
}

export async function resolveXeroAppById(xeroAppId: string): Promise<XeroAppRow> {
  const app = db.select().from(xeroApps).where(eq(xeroApps.id, xeroAppId)).get();
  if (!app) {
    throw new Error(`Unknown Xero app id "${xeroAppId}"`);
  }
  return app;
}

function readSecret(envVarName: string): string {
  const value = process.env[envVarName];
  if (!value) {
    throw new Error(`Missing secret "${envVarName}" — set it before using this Xero app.`);
  }
  return value;
}

function complianceContext(): ComplianceContext {
  const enabledProductionApps = db
    .select({ id: xeroApps.id })
    .from(xeroApps)
    .where(and(eq(xeroApps.environment, "production"), eq(xeroApps.enabled, true)))
    .all();

  return {
    multiAppEnabled: process.env.XERO_MULTI_APP_ENABLED === "true",
    enabledProductionAppCount: enabledProductionApps.length,
  };
}

/**
 * The single choke point for every Xero API call in the codebase — OAuth
 * start, OAuth callback and the sync gateway all construct their client here.
 * That makes it the right place for the spec 9.6 compliance gate: one guard
 * covers every caller, including `resolveXeroAppById`, which does not check
 * `enabled` on its own.
 */
export function buildXeroClient(app: XeroAppRow, state?: string): XeroClient {
  assertXeroAppUsable(app, complianceContext());

  return new XeroClient({
    clientId: readSecret(app.clientIdSecretRef),
    clientSecret: readSecret(app.clientSecretSecretRef),
    redirectUris: [app.redirectUri],
    scopes: resolveScopes(app.scopeProfile),
    state,
  });
}
