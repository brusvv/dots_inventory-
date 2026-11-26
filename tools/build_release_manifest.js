#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const FORMAT = "dots-inventory-release/v1";
const MIN_UPDATER = "0.1.0";
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
function match(source, regex, label) {
  const found = source.match(regex);
  if (!found) throw new Error("Не удалось определить " + label + " из исходников.");
  return found[1];
}
function listAppsScriptFiles(sourceDir) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) throw new Error("Каталог Apps Script не найден: " + sourceDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  if (entries.some((e) => e.isDirectory() || e.isSymbolicLink())) throw new Error("src/apps_script должен содержать только обычные файлы верхнего уровня.");
  const names = entries.filter((e) => e.isFile() && e.name.endsWith(".gs")).map((e) => e.name).sort();
  if (!names.length) throw new Error("В src/apps_script не найдено ни одного .gs файла.");
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error("Имена .gs файлов не должны различаться только регистром.");
  return names;
}
function buildManifest({ repository, commit, tag, sourceDir, channel, sourceBranch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) throw new Error("GITHUB_REPOSITORY должен иметь формат owner/repository.");
  if (!/^[0-9a-f]{40}$/i.test(commit || "")) throw new Error("GITHUB_SHA должен содержать полный 40-символьный commit SHA.");
  const version = String(tag || "").match(/^dots-inventory-v(\d+\.\d+\.\d+(?:-preview\.\d+)?)$/);
  if (!version) throw new Error("Тег релиза должен иметь формат dots-inventory-vMAJOR.MINOR.PATCH или dots-inventory-vMAJOR.MINOR.PATCH-preview.N.");
  const inferredChannel = /-preview\.\d+$/.test(tag) ? "preview" : "stable";
  const releaseChannel = String(channel || inferredChannel).toLowerCase();
  if (releaseChannel !== inferredChannel) throw new Error("Канал релиза не соответствует суффиксу Git-тега.");
  const branch = String(sourceBranch || "").trim();
  if (releaseChannel === "preview" && (!branch || branch === "main" || branch === "master")) {
    throw new Error("Для Preview требуется явно указать исходную feature/release ветку, отличную от main.");
  }
  if (releaseChannel === "stable" && branch && branch !== "main") {
    throw new Error("Stable-релиз должен собираться из main.");
  }
  const config = fs.readFileSync(path.join(sourceDir, "00_DI3_AppConfig.gs"), "utf8");
  const schema = fs.readFileSync(path.join(sourceDir, "33_DI3_SchemaVersioning.gs"), "utf8");
  const timeZone = match(config, /TIME_ZONE\s*:\s*"([^"]+)"/, "DI3_APP_CONFIG.TIME_ZONE");
  const schemaVersion = Number(match(schema, /var\s+DI3_SCHEMA_VERSION\s*=\s*(\d+)\s*;/, "DI3_SCHEMA_VERSION"));
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error("DI3_SCHEMA_VERSION должен быть положительным целым числом.");
  const files = listAppsScriptFiles(sourceDir).map((name) => {
    const bytes = fs.readFileSync(path.join(sourceDir, name));
    if (bytes.includes(0)) throw new Error("NUL byte обнаружен в " + name);
    return { name, type: "SERVER_JS", source_path: "src/apps_script/" + name,
      raw_url: "https://raw.githubusercontent.com/" + repository + "/" + commit.toLowerCase() + "/src/apps_script/" + encodeURIComponent(name),
      size_bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { format: FORMAT, product: "Dots Inventory", release_version: version[1], git_tag: tag,
    git_commit: commit.toLowerCase(), target_schema_version: schemaVersion, application_time_zone: timeZone,
    minimum_updater_version: MIN_UPDATER, manifest_policy: "PRESERVE_TARGET_PROJECT_MANIFEST",
    source_policy: "PINNED_COMMIT_RAW_FILES", files };
}
function writeReleaseArtifacts(options) {
  const manifest = buildManifest(options);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(options.outputDir, "release-manifest.json"), bytes);
  fs.writeFileSync(path.join(options.outputDir, "release-manifest.sha256"), sha256(bytes) + "  release-manifest.json\n");
  fs.writeFileSync(path.join(options.outputDir, "SHA256SUMS.txt"), manifest.files.map((f) => f.sha256 + "  Apps_Script/" + f.name).join("\n") + "\n");
  return manifest;
}
if (require.main === module) {
  try {
    const manifest = writeReleaseArtifacts({ repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA,
      tag: process.env.GITHUB_REF_NAME, channel: process.env.RELEASE_CHANNEL, sourceBranch: process.env.RELEASE_SOURCE_BRANCH, sourceDir: path.resolve(process.env.SOURCE_DIR || "src/apps_script"),
      outputDir: path.resolve(process.env.OUTPUT_DIR || "dist/release-metadata") });
    process.stdout.write("Release manifest ready: " + manifest.git_tag + " | schema v" + manifest.target_schema_version + " | " + manifest.files.length + " Apps Script files\n");
  } catch (error) { process.stderr.write((error && error.stack) || String(error)); process.stderr.write("\n"); process.exitCode = 1; }
}
module.exports = { buildManifest, writeReleaseArtifacts, listAppsScriptFiles };
