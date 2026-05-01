import fs from 'fs';
let file = fs.readFileSync('src/__tests__/artifactDetector.test.ts', 'utf8');

file = file.replace(/store\.addArtifacts\.mockClear\(\);/g, "if (store.addArtifacts.mockClear) store.addArtifacts.mockClear();");

fs.writeFileSync('src/__tests__/artifactDetector.test.ts', file);
