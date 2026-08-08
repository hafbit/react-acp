import { writeFileSync } from "node:fs";
import {
  assertCleanWorkingTree,
  assertReleaseManifest,
  manifestPath,
  parseReleaseVersion,
  readManifest,
} from "./release-lib.mjs";

const input = process.argv[2];
if (!input || process.argv.length !== 3) {
  console.error(
    "Usage: pnpm release:version <X.Y.Z|X.Y.Z-alpha.N|X.Y.Z-beta.N|X.Y.Z-rc.N>",
  );
  process.exit(1);
}

try {
  assertCleanWorkingTree();
  const { version } = parseReleaseVersion(input);
  const manifest = assertReleaseManifest(undefined, readManifest());
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated ${manifest.name} to ${version}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
