import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

function repositoryPath(root, path, label) {
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must remain within the repository`);
  }
  return { absolutePath, relativePath };
}

export function normalizeLcovPaths(repositoryRoot, projectPath, reportPath) {
  const root = resolve(repositoryRoot);
  const project = repositoryPath(root, projectPath, "Project path");
  const report = repositoryPath(root, reportPath, "Coverage report");
  const contents = readFileSync(report.absolutePath, "utf8");
  const normalized = contents.replace(/^SF:(.*)$/gm, (_line, sourcePath) => {
    if (sourcePath.length === 0) {
      throw new Error("LCOV source paths must not be empty");
    }
    const source = repositoryPath(
      root,
      resolve(project.absolutePath, sourcePath),
      "LCOV source path",
    );
    return `SF:${source.relativePath.split(sep).join("/")}`;
  });
  writeFileSync(report.absolutePath, normalized);
}

function main() {
  const [projectPath, reportPath] = process.argv.slice(2);
  if (!projectPath || !reportPath) {
    throw new Error("Usage: normalize-lcov.mjs <project-path> <report-path>");
  }
  normalizeLcovPaths(process.cwd(), projectPath, reportPath);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
