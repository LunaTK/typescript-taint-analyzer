import * as ts from "typescript";
import * as path from "path";

const program = ts.createProgram(['./samples/example1.ts'], {
    allowJs: true,
    declaration: true,
    noEmitOnError: true,
    noImplicitAny: true,
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS
});

const emitResult = program.emit();

let allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

allDiagnostics.forEach(diagnostic => {
if (diagnostic.file) {
  let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
  let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
} else {
  console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}
});
