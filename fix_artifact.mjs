import fs from 'fs';
let code = fs.readFileSync('src/services/artifactDetector.ts', 'utf8');
code = code.replace(/}\n}\n\n\/\*\*\n \* Manually add/, "}\n\n/**\n * Manually add");
fs.writeFileSync('src/services/artifactDetector.ts', code);
