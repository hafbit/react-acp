import { appendFileSync } from "node:fs";
import {
  assertReleaseManifest,
  assertReleaseTagGit,
  parseReleaseTag,
} from "./release-lib.mjs";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

try {
  const release = parseReleaseTag(tag);
  assertReleaseManifest(release.version);
  if (
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.RELEASE_VERIFY_GIT === "true"
  ) {
    assertReleaseTagGit(tag);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${release.version}\ndist_tag=${release.distTag}\nprerelease=${release.prerelease}\n`,
    );
  }
  console.log(
    `Release ${tag} is valid and will publish with npm dist-tag ${release.distTag}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
