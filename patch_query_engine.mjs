import fs from 'fs';
let file = fs.readFileSync('src/core/QueryEngine.ts', 'utf8');

const comment = `  // [ROUND ACCOUNTING CONTRACT]
  // Current Behavior: Every iteration of this loop increments \`round\` by 1, regardless of whether it's
  // a true model reasoning step, a tool retry, or polling/waiting. If a tool fails transiently or polling 
  // requires many checks, these eat into the single \`maxRounds\` limit indiscriminately.
  // 
  // Target Behavior: We need an Explicit Execution Budget distinguishing:
  // 1. Model reasoning rounds (maxModelRounds)
  // 2. Tool execution attempts (maxToolExecutions)
  // 3. Tool wall-clock timeouts & Retries
  // This will prevent slow or polling tools from prematurely exhausting the agent loop budget.
`;

file = file.replace('  while (!isTurnComplete && round < maxRounds) {', comment + '\n  while (!isTurnComplete && round < maxRounds) {');

fs.writeFileSync('src/core/QueryEngine.ts', file);
