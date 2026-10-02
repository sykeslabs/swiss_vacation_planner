// Every frontend module must at least parse: a SyntaxError in one module stops the
// whole app from loading, and DOM-bound modules aren't imported by the other tests.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const JS_DIR = fileURLToPath(new URL("../../public/js/", import.meta.url));

for (const file of readdirSync(JS_DIR).filter((f) => f.endsWith(".js"))) {
  test(`parses: ${file}`, () => {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ["--input-type=module", "--check"], {
        input: execFileSync(process.execPath, ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(join(JS_DIR, file))}, "utf8"))`]),
        stdio: ["pipe", "pipe", "pipe"],
      })
    );
  });
}
