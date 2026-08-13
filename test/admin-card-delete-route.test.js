import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("admin collection-card deletion imports its delete handler", async () => {
  const worker = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(worker, /createImport,\s*deleteContact,\s*expandContactContent,/);
  assert.match(worker, /await deleteContact\(env\.DB,env\.MEDIA,existing\.scanner_user_id,cardId\)/);
});