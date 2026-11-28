#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/apps_script/43_DI3_GitHubDeploymentManager.gs"), "utf8");
const context = vm.createContext({
  console, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, isNaN,
  parseInt, parseFloat,
  DI3_APP_CONFIG: { TIME_ZONE: "Europe/Moscow", GITHUB_RELEASE: { REPOSITORY: "brusvv/dots_inventory-" } },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA-256", SHA_1: "SHA-1" },
    Charset: { UTF_8: "UTF-8" },
    computeDigest: (algorithm, value) => Array.from(
      crypto.createHash(algorithm === "SHA-1" ? "sha1" : "sha256").update(String(value), "utf8").digest()
    ).map((b) => b > 127 ? b - 256 : b),
    newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), "utf8")).map((b) => b > 127 ? b - 256 : b) })
  }
});
vm.runInContext(source, context, { filename: "43_DI3_GitHubDeploymentManager.gs", timeout: 5000 });

const branch = "test/n04-tree-fixtures";
const commit = "a".repeat(40);
const treeSha = "b".repeat(40);
const baseSources = {
  "src/apps_script/00_DI3_AppConfig.gs": 'var DI3_APP_CONFIG = Object.freeze({ TIME_ZONE: "Europe/Moscow" });\n',
  "src/apps_script/33_DI3_SchemaVersioning.gs": "var DI3_SCHEMA_VERSION = 4;\n",
  "src/apps_script/01_Module.gs": "function alpha() { return 1; }\n"
};
function entry(filePath, body, mode = "100644") {
  return {
    path: filePath, type: "blob", mode, size: Buffer.byteLength(body),
    sha: crypto.createHash("sha1").update("blob " + Buffer.byteLength(body) + String.fromCharCode(0) + body, "utf8").digest("hex")
  };
}
function validTree() {
  return Object.entries(baseSources).map(([filePath, body]) => entry(filePath, body));
}
function runManifest(tree, truncated = false) {
  let rawFetchCount = 0;
  context.di3FetchGitHubJson_ = (url) => {
    if (url.endsWith("/git/commits/" + commit)) {
      return { status: "OK", data: { sha: commit, tree: { sha: treeSha } } };
    }
    if (url.endsWith("/git/trees/" + treeSha + "?recursive=1")) {
      return { status: "OK", data: { tree, truncated } };
    }
    throw new Error("Unexpected GitHub API URL: " + url);
  };
  context.UrlFetchApp = {
    fetch: (url) => {
      rawFetchCount++;
      const name = decodeURIComponent(String(url).split("/").pop());
      const body = baseSources["src/apps_script/" + name];
      if (body == null) throw new Error("Unexpected raw source request: " + url);
      return { getResponseCode: () => 200, getContentText: () => body };
    }
  };
  try {
    const result = vm.runInContext(
      "di3GetGitHubBranchManifest_(" + JSON.stringify(branch) + "," + JSON.stringify(commit) + ")",
      context
    );
    return { result, rawFetchCount };
  } catch (error) {
    return { error, rawFetchCount };
  } finally {
    delete context.di3FetchGitHubJson_;
    delete context.UrlFetchApp;
  }
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  process.stdout.write("PASS " + name + "\n");
}

test("truncated recursive Git tree blocks before any raw source download", () => {
  const run = runManifest(validTree(), true);
  assert.match(run.error && run.error.message, /Git tree.*неполон/);
  assert.equal(run.rawFetchCount, 0);
});

test("case-insensitive duplicate Apps Script names block before any raw source download", () => {
  const tree = validTree();
  tree.push(entry("src/apps_script/01_module.gs", "function other() {}\n"));
  const run = runManifest(tree);
  assert.match(run.error && run.error.message, /Повторяющееся имя Apps Script файла/);
  assert.equal(run.rawFetchCount, 0);
});

test("symlink-mode Apps Script entry blocks before any raw source download", () => {
  const tree = validTree();
  tree[0] = { ...tree[0], mode: "120000" };
  const run = runManifest(tree);
  assert.match(run.error && run.error.message, /разрешены только обычные файлы/);
  assert.equal(run.rawFetchCount, 0);
});

test("more than 200 Apps Script files block before any raw source download", () => {
  const tree = Array.from({ length: 201 }, (_, i) =>
    entry("src/apps_script/" + String(i).padStart(3, "0") + ".gs", "function f" + i + "() {}\n")
  );
  const run = runManifest(tree);
  assert.match(run.error && run.error.message, /от 1 до 200/);
  assert.equal(run.rawFetchCount, 0);
});

test("valid complete Git tree proceeds to download exactly its three source files", () => {
  const run = runManifest(validTree(), false);
  assert.equal(run.error, undefined);
  assert.equal(run.result.status, "READY");
  assert.equal(run.result.manifest.git_commit, commit);
  assert.equal(run.rawFetchCount, 3);
});


test("downloaded source with a byte-size mismatch is rejected", () => {
  const tree = validTree();
  tree[0] = { ...tree[0], size: tree[0].size + 1 };
  const run = runManifest(tree);
  assert.match(run.error && run.error.message, /Размер исходника не совпадает с Git tree/);
  assert.equal(run.rawFetchCount, 3);
});

test("downloaded source with a Git blob SHA-1 mismatch is rejected", () => {
  const tree = validTree();
  tree[0] = { ...tree[0], sha: "f".repeat(40) };
  const run = runManifest(tree);
  assert.match(run.error && run.error.message, /Git blob SHA-1 исходника не совпадает/);
  assert.equal(run.rawFetchCount, 3);
});

test("branch manifest records SHA-256 calculated from the verified downloaded source", () => {
  const run = runManifest(validTree(), false);
  assert.equal(run.error, undefined);
  const file = run.result.manifest.files.find((item) => item.name === "00_DI3_AppConfig.gs");
  const expected = crypto.createHash("sha256")
    .update(baseSources["src/apps_script/00_DI3_AppConfig.gs"], "utf8").digest("hex");
  assert.equal(file.sha256, expected);
});

process.stdout.write("\n" + passed + " Git tree preflight fixture tests passed.\n");
