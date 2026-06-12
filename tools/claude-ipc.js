#!/usr/bin/env node

/**
 * Claude Code IPC Script
 *
 * Provides a programmatic interface to Claude Code CLI
 * Supports chat mode, command execution, and conversation management
 *
 * Usage:
 *   node claude-ipc.js chat "Your message here"
 *   node claude-ipc.js execute "ls -la"
 *   node claude-ipc.js session-start
 *   node claude-ipc.js session-send <session_id> "Message"
 *   node claude-ipc.js session-stop <session_id>
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

// Configuration
const CLAUDE_BIN = 'claude';
const DEFAULT_TIMEOUT = 300000; // 5 minutes

// Session storage
const sessions = new Map();

/**
 * Execute a command with Claude Code
 */
function executeCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      cwd = process.cwd(),
      env = {},
      timeout = DEFAULT_TIMEOUT
    } = options;

    const args = ['code', '--print', '--silent', '-p', command];

    const proc = spawn(CLAUDE_BIN, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Command timed out'));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Start an interactive Claude session
 */
function startSession(sessionId, systemPrompt = null) {
  return new Promise((resolve, reject) => {
    const args = ['code', '--print', '--silent'];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const proc = spawn(CLAUDE_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    sessions.set(sessionId, { proc, started: Date.now() });

    proc.on('error', reject);
    proc.on('close', (code) => {
      sessions.delete(sessionId);
      resolve({ sessionId, exitCode: code });
    });

    // Send initial prompt
    proc.stdin.write(`Session started: ${sessionId}\n`);
    proc.stdin.end();

    resolve({ sessionId, pid: proc.pid });
  });
}

/**
 * Send message to existing session
 */
function sendToSession(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) {
    return Promise.reject(new Error(`Session ${sessionId} not found`));
  }

  return new Promise((resolve, reject) => {
    let response = '';

    session.proc.stdout.on('data', (data) => {
      response += data.toString();
    });

    session.proc.stdin.write(`${message}\n`);
    session.proc.stdin.end();

    // Wait for response
    setTimeout(() => {
      resolve({ sessionId, response });
    }, 1000);
  });
}

/**
 * Stop a session
 */
function stopSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return Promise.resolve({ sessionId, stopped: false });
  }

  session.proc.kill();
  sessions.delete(sessionId);
  return Promise.resolve({ sessionId, stopped: true });
}

/**
 * Check Claude availability
 */
function checkAvailability() {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Get Claude version
 */
function getVersion() {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let version = '';
    let error = '';

    proc.stdout.on('data', (data) => {
      version += data.toString();
    });

    proc.stderr.on('data', (data) => {
      error += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(version.trim());
      } else {
        reject(new Error(error || `Failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case 'chat':
        if (!args[1]) {
          console.error('Error: Message required');
          process.exit(1);
        }
        const chatResult = await executeCommand(args[1]);
        console.log(chatResult.stdout);
        break;

      case 'execute':
        if (!args[1]) {
          console.error('Error: Command required');
          process.exit(1);
        }
        const execResult = await executeCommand(args.slice(1).join(' '));
        console.log(execResult.stdout);
        break;

      case 'session-start':
        const sessionId = args[1] || `session-${Date.now()}`;
        const startResult = await startSession(sessionId);
        console.log(JSON.stringify(startResult));
        break;

      case 'session-send':
        if (!args[1] || !args[2]) {
          console.error('Error: Session ID and message required');
          process.exit(1);
        }
        const sendResult = await sendToSession(args[1], args.slice(2).join(' '));
        console.log(sendResult.response);
        break;

      case 'session-stop':
        if (!args[1]) {
          console.error('Error: Session ID required');
          process.exit(1);
        }
        const stopResult = await stopSession(args[1]);
        console.log(JSON.stringify(stopResult));
        break;

      case 'available':
        const available = await checkAvailability();
        console.log(available ? 'true' : 'false');
        break;

      case 'version':
        const version = await getVersion();
        console.log(version);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Available commands: chat, execute, session-start, session-send, session-stop, available, version');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
