import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function usage() {
  console.error("Usage: node scripts/build-private-d1-import.mjs <json-path|git:revision:path> <output.sql>");
  process.exit(2);
}

function readSource(source) {
  if (source.startsWith("git:")) {
    const object = source.slice(4);
    if (!/^[A-Za-z0-9._/-]+:.+/.test(object)) throw new Error("Invalid git object reference");
    return execFileSync("git", ["show", object], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  }
  return readFileSync(source, "utf8");
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

const [source, outputPath] = process.argv.slice(2);
if (!source || !outputPath) usage();

const sourceText = readSource(source);
const dataset = JSON.parse(sourceText);
if (!Array.isArray(dataset.assets) || !dataset.league || !dataset.datasetVersion) {
  throw new Error("Source is not a recognized GM's Locker Fantrax dataset");
}
if (Number(dataset.counts?.totalPlayers) !== dataset.assets.length) {
  throw new Error(`Asset count mismatch: expected ${dataset.counts?.totalPlayers}, received ${dataset.assets.length}`);
}

const digest = createHash("sha256").update(sourceText).digest("hex");
const datasetId = `${dataset.datasetVersion}:${digest.slice(0, 16)}`;
const chunkSize = 200;
const chunks = [];
for (let index = 0; index < dataset.assets.length; index += chunkSize) {
  chunks.push(dataset.assets.slice(index, index + chunkSize));
}

const statements = [
  "PRAGMA foreign_keys = ON;",
  `INSERT INTO league_datasets (id, schema_version, dataset_version, source, league_json, counts_json, is_active) VALUES (${sqlString(datasetId)}, ${Number(dataset.schemaVersion || 1)}, ${sqlString(dataset.datasetVersion)}, ${sqlString(dataset.source || "")}, ${sqlString(JSON.stringify(dataset.league))}, ${sqlString(JSON.stringify(dataset.counts || {}))}, 0) ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, dataset_version = excluded.dataset_version, source = excluded.source, league_json = excluded.league_json, counts_json = excluded.counts_json, is_active = 0, imported_at = CURRENT_TIMESTAMP;`,
  `DELETE FROM league_dataset_chunks WHERE dataset_id = ${sqlString(datasetId)};`
];

chunks.forEach((chunk, chunkIndex) => {
  statements.push(`INSERT INTO league_dataset_chunks (dataset_id, chunk_index, assets_json) VALUES (${sqlString(datasetId)}, ${chunkIndex}, ${sqlString(JSON.stringify(chunk))});`);
});
statements.push("UPDATE league_datasets SET is_active = 0;");
statements.push(`UPDATE league_datasets SET is_active = 1, imported_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(datasetId)};`);

writeFileSync(outputPath, `${statements.join("\n")}\n`, { mode: 0o600 });
console.log(JSON.stringify({ datasetVersion: dataset.datasetVersion, assets: dataset.assets.length, chunks: chunks.length, outputPath }));
