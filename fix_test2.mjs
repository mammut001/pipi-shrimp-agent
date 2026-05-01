import fs from 'fs';
let file = fs.readFileSync('src/__tests__/artifactDetector.test.ts', 'utf8');

file = "import { jest } from '@jest/globals';\n" + file;
file = file.replace(/import\.meta\.jest\.fn\(\)/g, "jest.fn()");

fs.writeFileSync('src/__tests__/artifactDetector.test.ts', file);
