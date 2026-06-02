import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC_DIR = path.join(ROOT, "src");

const failures = [];

function listSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(absolutePath);
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) {
      return [];
    }
    return [absolutePath];
  });
}

function hasDocComment(sourceFile, node) {
  const comments = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  return comments.some(
    (comment) => comment.kind === ts.SyntaxKind.MultiLineCommentTrivia && sourceFile.text.startsWith("/**", comment.pos),
  );
}

function addFailure(sourceFile, node, label) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const relativePath = path.relative(ROOT, sourceFile.fileName);
  failures.push(`${relativePath}:${position.line + 1}:${position.character + 1} Missing docstring for ${label}`);
}

function isPrivateName(name) {
  return typeof name === "string" && name.startsWith("_");
}

function isPrivateMethod(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
}

function isFunctionValuedVariable(node) {
  return (
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  );
}

function checkNode(sourceFile, node) {
  if (ts.isFunctionDeclaration(node) && node.name && !isPrivateName(node.name.text) && !hasDocComment(sourceFile, node)) {
    addFailure(sourceFile, node, node.name.text);
  }
  if (
    ts.isMethodDeclaration(node) &&
    node.name &&
    !isPrivateMethod(node) &&
    !isPrivateName(node.name.getText(sourceFile)) &&
    !hasDocComment(sourceFile, node)
  ) {
    addFailure(sourceFile, node, node.name.getText(sourceFile));
  }
  if (ts.isConstructorDeclaration(node) && !isPrivateMethod(node) && !hasDocComment(sourceFile, node)) {
    addFailure(sourceFile, node, "constructor");
  }
  if (ts.isVariableDeclaration(node) && node.initializer && isFunctionValuedVariable(node) && !hasDocComment(sourceFile, node)) {
    addFailure(sourceFile, node, node.name.getText(sourceFile));
  }
  ts.forEachChild(node, (child) => checkNode(sourceFile, child));
}

for (const file of listSourceFiles(SRC_DIR)) {
  const sourceText = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  checkNode(sourceFile, sourceFile);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Docstring checks passed.");
