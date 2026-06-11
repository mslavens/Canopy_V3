const fs = require('fs');
const ts = require('typescript');

const fileName = '/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/canopy-ui/src/pages/ObjectsPage.tsx';
const code = fs.readFileSync(fileName, 'utf8');

const sourceFile = ts.createSourceFile(
  fileName,
  code,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

const diagnostics = sourceFile.parseDiagnostics;

if (diagnostics.length > 0) {
  console.log("Syntax Errors Found:");
  diagnostics.forEach(diagnostic => {
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, diagnostic.start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    console.log(`Line ${line + 1}, Char ${character + 1}: ${message}`);
  });
} else {
  console.log("No syntax errors found by TypeScript parser!");
}
