import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  assertPackedFiles,
  assertPackedManifest,
  assertReleaseManifest,
  repoRoot,
} from "./release-lib.mjs";

const artifactDir = resolve(repoRoot, "release-artifacts");
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit", ...options });

try {
  const sourceManifest = assertReleaseManifest();
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });
  run("pnpm", ["build"]);
  run("pnpm", ["pack", "--pack-destination", artifactDir]);

  const tarballs = readdirSync(artifactDir)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => resolve(artifactDir, file));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one release tarball, found ${tarballs.length}.`);
  }

  const tarball = tarballs[0];
  const packedManifest = JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  assertPackedManifest(packedManifest, sourceManifest);
  assertPackedFiles(files);

  writeFileSync(
    resolve(artifactDir, "manifest.json"),
    `${JSON.stringify(
      {
        version: sourceManifest.version,
        packageName: sourceManifest.name,
        tarball: `./release-artifacts/${basename(tarball)}`,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Validated release artifact ${basename(tarball)}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
