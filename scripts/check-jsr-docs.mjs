import path from "node:path";
import process from "node:process";
import ts from "typescript";

const entrypoints = ["src/index.ts", "src/core/index.ts", "src/primitives/index.ts"];

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json was not found");

const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
  throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
}

const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const absoluteEntrypoints = entrypoints.map((entrypoint) => path.resolve(entrypoint));
const program = ts.createProgram(absoluteEntrypoints, {
  ...parsed.options,
  noEmit: true,
});
const checker = program.getTypeChecker();
const failures = [];

for (const [index, absoluteEntrypoint] of absoluteEntrypoints.entries()) {
  const entrypoint = entrypoints[index];
  const sourceFile = program.getSourceFile(absoluteEntrypoint);
  if (!sourceFile) {
    failures.push(`${entrypoint}: entrypoint was not loaded`);
    continue;
  }

  const leadingComment = sourceFile.getFullText().match(/^\s*\/\*\*[\s\S]*?\*\//)?.[0];
  if (!leadingComment?.includes("@module")) {
    failures.push(`${entrypoint}: missing a leading @module JSDoc comment`);
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    failures.push(`${entrypoint}: module symbol was not resolved`);
    continue;
  }

  const undocumented = checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => symbol.name !== "default")
    .filter((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return !ts.displayPartsToString(target.getDocumentationComment(checker)).trim();
    })
    .map((symbol) => symbol.name)
    .sort();

  const exportedCount = checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => symbol.name !== "default").length;
  if (undocumented.length) {
    failures.push(`${entrypoint}: undocumented exports: ${undocumented.join(", ")}`);
  } else {
    console.log(`${entrypoint}: ${exportedCount}/${exportedCount} exports documented`);
  }
}

if (failures.length) {
  console.error("JSR documentation coverage check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("All JSR entrypoints have module docs and 100% symbol documentation.");
