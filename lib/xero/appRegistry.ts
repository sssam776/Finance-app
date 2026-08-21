import { XeroClient } from "xero-node";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { xeroApps } from "@/db/schema";
import { resolveScopes } from "./scopeProfiles";

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

export function buildXeroClient(app: XeroAppRow, state?: string): XeroClient {
  return new XeroClient({
    clientId: readSecret(app.clientIdSecretRef),
    clientSecret: readSecret(app.clientSecretSecretRef),
    redirectUris: [app.redirectUri],
    scopes: resolveScopes(app.scopeProfile),
    state,
  });
}
