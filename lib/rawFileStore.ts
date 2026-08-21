import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Local-disk stand-in for Cloudflare R2 (spec 13.2 / REM-002). Raw source
 * files are stored by checksum so a re-uploaded identical file is detected
 * rather than silently duplicated. Swap this module for an R2 binding when
 * deploying to Cloudflare Workers — callers only depend on storeRawFile's
 * return shape, not on the local-disk implementation.
 */

const STORE_ROOT = process.env.RAW_FILE_STORE_PATH ?? path.join(process.cwd(), "data", "raw-files");

export interface StoredRawFile {
  key: string;
  checksum: string;
}

export async function storeRawFile(params: {
  entityId: string;
  originalFileName: string;
  contents: Buffer;
}): Promise<StoredRawFile> {
  const checksum = createHash("sha256").update(params.contents).digest("hex");
  const safeName = params.originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${params.entityId}/${checksum}-${safeName}`;
  const fullPath = path.join(STORE_ROOT, key);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, params.contents);

  return { key, checksum };
}
