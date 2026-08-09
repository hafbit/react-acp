import { writeFileSync } from "node:fs";
import {
  assertCleanWorkingTree,
  jsrManifestPath,
  manifestPath,
  versionSourcePath,
  readManifest,
  readJsrManifest,
  updateReleaseManifests,
} from "./release-lib.mjs";

const input = process.argv[2];
if (!input || process.argv.length !== 3) {
  console.error("Usage: pnpm release:version <X.Y.Z|X.Y.Z-alpha.N|X.Y.Z-beta.N|X.Y.Z-rc.N>");
  process.exit(1);
}

try {
  assertCleanWorkingTree();
  const { npmManifest, jsrManifest, sourceVersion } = updateReleaseManifests(
    input,
    readManifest(),
    readJsrManifest(),
  );
  writeFileSync(manifestPath, `${JSON.stringify(npmManifest, null, 2)}\n`);
  writeFileSync(jsrManifestPath, `${JSON.stringify(jsrManifest, null, 2)}\n`);
  writeFileSync(
    versionSourcePath,
    `/** Package version used for the default ACP client identity. */\nexport const REACT_ACP_VERSION = "${sourceVersion}";\n`,
  );
  console.log(`Updated ${npmManifest.name} npm and JSR manifests to ${npmManifest.version}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
