import { appendFileSync } from "node:fs";
import {
  assertJsrRepairGit,
  assertReleaseManifests,
  parseReleaseVersion,
} from "./release-lib.mjs";

const versionInput = process.argv[2];
const sourceRef = process.argv[3];

try {
  if (!versionInput || !sourceRef || process.argv.length !== 4) {
    throw new Error(
      "Usage: pnpm release:jsr-repair-check <version> <source_ref>",
    );
  }
  const release = parseReleaseVersion(versionInput);
  assertReleaseManifests(release.version);
  assertJsrRepairGit(release.version, sourceRef);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${release.version}\ndist_tag=${release.distTag}\nprerelease=${release.prerelease}\n`,
    );
  }
  console.log(
    `JSR repair ${release.version} from ${sourceRef} is valid; npm existence is checked by the workflow.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
