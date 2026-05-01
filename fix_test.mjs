import fs from 'fs';
let file = fs.readFileSync('src/__tests__/artifactDetector.test.ts', 'utf8');

file = file.replace(/const mockAddArtifacts = jest\.fn\(\);/g, "const mockAddArtifacts = import.meta.jest.fn();");
file = file.replace(/import \{ jest \} from '@jest\/globals';/g, "");

fs.writeFileSync('src/__tests__/artifactDetector.test.ts', file);
