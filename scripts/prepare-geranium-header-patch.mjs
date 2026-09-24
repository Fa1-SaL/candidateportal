import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const functionOpening = "function geraniumAllocatedCheck(row, field, parser) {";
const originalLookup = "  const value = geraniumRead(row, field);";
const followingLine = "  const key = geraniumComparable(value);";

// This is a local review-patch preparer, not a workflow importer or executor.
// Do not broaden the accepted source fields or status vocabulary here without
// current source evidence and a separate semantic review.
// The explicit opt-in below implements the source owner's 22 Sep decision.
// Deploy only alongside the scoped canonical-filter acceptance and UI label.
const approvedAwaitingInputLine = "  if (field === 'Spring Verify' && geraniumComparable(value) === 'awaiting input') return 'awaiting_input';";
const replacementLines = [
  "  const value = (() => {",
  "    let aliases;",
  "    switch (field) {",
  "      case 'Spring Verify': aliases = ['Spring Verify', 'SpringVerify Status']; break;",
  "      case 'RemoFirst Verification': aliases = ['RemoFirst Verification', 'Remofirst Verification status']; break;",
  "      case 'Contract': aliases = ['Contract']; break;",
  "      default: throw new Error('Geranium Allocated ECs: unsupported check field');",
  "    }",
  "    if (row === null || typeof row !== 'object' || Array.isArray(row)) {",
  "      throw new Error('Geranium Allocated ECs: invalid check row');",
  "    }",
  "    const normalizeHeader = (header) => header.trim().toLowerCase().replace(/\\s+/g, ' ');",
  "    const approved = new Set(aliases.map(normalizeHeader));",
  "    const columns = Object.keys(row).filter((column) => approved.has(normalizeHeader(column)));",
  "    if (columns.length === 0) throw new Error('Geranium Allocated ECs: missing check header');",
  "    if (columns.length !== 1) throw new Error('Geranium Allocated ECs: ambiguous check headers');",
  "    return row[columns[0]];",
  "  })();",
];

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function proveExecutableTarget(source, openingIndex, lookupStart, newline) {
  // Text in a comment/string/template is not executable evidence. Use the
  // installed compiler's public JS parser rather than a home-grown lexer.
  const ast = ts.createSourceFile("geranium-code.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node))
      && node.name?.text === "geraniumAllocatedCheck") functions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const target = functions[0];
  if (functions.length !== 1 || !ts.isFunctionDeclaration(target)
    || target.getStart(ast) !== openingIndex || !target.body
    || target.body.getStart(ast) !== openingIndex + functionOpening.length - 1) {
    throw new Error("Geranium patch preparation: target is not the unique expected executable function.");
  }
  function exactConstCall(statement, name, callee, args, start, line) {
    if (!statement || !ts.isVariableStatement(statement)
      || statement.getStart(ast) !== start + 2 || statement.end !== start + line.length
      || !(statement.declarationList.flags & ts.NodeFlags.Const)
      || statement.declarationList.declarations.length !== 1) return false;
    const declaration = statement.declarationList.declarations[0];
    const call = declaration.initializer;
    return ts.isIdentifier(declaration.name) && declaration.name.text === name
      && call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)
      && call.expression.text === callee && call.arguments.length === args.length
      && call.arguments.every((argument, index) => ts.isIdentifier(argument) && argument.text === args[index]);
  }
  const lookupIndex = target.body.statements.findIndex(statement => statement.getStart(ast) === lookupStart + 2);
  if (lookupIndex < 0
    || !exactConstCall(target.body.statements[lookupIndex], "value", "geraniumRead", ["row", "field"], lookupStart, originalLookup)
    || !exactConstCall(target.body.statements[lookupIndex + 1], "key", "geraniumComparable", ["value"],
      lookupStart + originalLookup.length + newline.length, followingLine)) {
    throw new Error("Geranium patch preparation: lookup is not the exact executable const statement in the expected function.");
  }
}

export function prepareGeraniumHeaderPatch(source, { awaitingInput = false } = {}) {
  if (typeof source !== "string") throw new Error("Geranium patch preparation: source must be text.");
  if (typeof awaitingInput !== "boolean") throw new Error("Geranium patch preparation: awaitingInput must be an explicit boolean.");
  if (occurrences(source, functionOpening) !== 1 || occurrences(source, originalLookup) !== 1) {
    throw new Error("Geranium patch preparation: expected function and lookup must each occur exactly once.");
  }
  const openingIndex = source.indexOf(functionOpening);
  // Preserve the source's exact newline convention and all bytes outside the
  // single lookup replacement. Unexpected function layout must be reviewed.
  const afterOpening = openingIndex + functionOpening.length;
  const newline = source.startsWith("\r\n", afterOpening) ? "\r\n" : "\n";
  const expectedBlock = originalLookup + newline + followingLine;
  if (occurrences(source, expectedBlock) !== 1) {
    throw new Error("Geranium patch preparation: function structure drifted; manual review required.");
  }
  const lookupStart = source.indexOf(originalLookup);
  proveExecutableTarget(source, openingIndex, lookupStart, newline);
  const lines = awaitingInput ? [...replacementLines, approvedAwaitingInputLine] : replacementLines;
  const patched = source.slice(0, lookupStart) + lines.join(newline)
    + source.slice(lookupStart + originalLookup.length);
  try {
    // Compilation only. Never invoke this function: an n8n Code body can contain
    // operational instructions and depends on its authenticated runtime.
    new Function(patched);
  } catch {
    throw new Error("Geranium patch preparation: patched code did not compile.");
  }
  return patched;
}

function cli(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/prepare-geranium-header-patch.mjs --input <exported-code.js> --output <new-review-code.js> [--include-awaiting-input]");
    console.log("Requires the verified live Code-node body; refuses in-place edits and existing output files. Does not execute or upload code.");
    console.log("The opt-in preserves the approved Geranium SpringVerify state; requires coordinated canonical-filter and dashboard support before release.");
    return;
  }
  const awaitingInput = args.length === 5 && args[4] === "--include-awaiting-input";
  if ((args.length !== 4 && !awaitingInput) || args[0] !== "--input" || args[2] !== "--output" || !args[1] || !args[3]) {
    throw new Error("Geranium patch preparation: provide explicit --input and --output paths; see --help.");
  }
  const input = resolve(args[1]);
  const output = resolve(args[3]);
  const compare = path => process.platform === "win32" ? path.toLowerCase() : path;
  if (compare(input) === compare(output)) throw new Error("Geranium patch preparation: in-place edits are forbidden.");
  let bytes;
  try {
    if (!statSync(input).isFile()) throw new Error();
    bytes = readFileSync(input);
  } catch {
    throw new Error("Geranium patch preparation: unable to read the explicit input file.");
  }
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error("Geranium patch preparation: input is not valid UTF-8.");
  const patched = prepareGeraniumHeaderPatch(source, { awaitingInput });
  try {
    // Exclusive creation also refuses same-file aliases and symbolic links.
    writeFileSync(output, patched, { encoding: "utf8", flag: "wx" });
  } catch {
    throw new Error("Geranium patch preparation: output must be a new writable file; no existing file was replaced.");
  }
  console.log(awaitingInput
    ? "Prepared a local review patch including the approved Geranium SpringVerify awaiting_input state. Canonical-filter/UI support must be released together; no workflow was executed or uploaded."
    : "Prepared a local review patch. No workflow was executed or uploaded; status mappings are unchanged.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
