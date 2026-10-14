import { spawn } from 'node:child_process';

/** One isolated process per invocation. Settlement follows stdio/process close. */
export function invokeProcess({ command, args = [], input, signal, cwd,
  timeoutMs = 120000, maxOutputBytes = 2_000_000, maxInputBytes = 2_000_000,
  spawnProcess = spawn }) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) {
    throw new TypeError('Invalid process connector configuration.');
  }
  const bytes = Buffer.from(input);
  if (bytes.byteLength > maxInputBytes) throw new RangeError('Connector input exceeds byte limit.');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { shell: false, cwd,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let outputBytes = 0, error, terminating = false, killTimer;
    const kill = signalName => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signalName);
        else child.kill(signalName);
      } catch { /* Process/group may already be gone. */ }
    };
    const stop = cause => {
      error ??= cause;
      if (terminating) return;
      terminating = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 250);
    };
    const abort = () => stop(signal.reason ?? new Error('Connector cancelled.'));
    const timer = setTimeout(() => stop(new Error('Connector timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const receive = (target, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) { stop(new Error('Connector output exceeds byte limit.')); return; }
      target.push(chunk);
    };
    child.stdout.on('data', chunk => receive(stdout, chunk));
    child.stderr.on('data', chunk => receive(stderr, chunk));
    child.on('error', stop);
    child.stdin.on('error', stop);
    child.stdout.on('error', stop);
    child.stderr.on('error', stop);
    child.once('close', code => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (error) { reject(error); return; }
      if (signal?.aborted) { reject(signal.reason ?? new Error('Connector cancelled.')); return; }
      if (code !== 0) { reject(new Error(`Connector exited with status ${code}.`)); return; }
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.end(bytes);
  });
}
