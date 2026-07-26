/**
 * Document conversion service.
 *
 * Converts HTML and PDF documents to markdown using the project's
 * Python bridge. HTML is piped via stdin; PDFs are processed via
 * temporary files.
 *
 * All temporary files are cleaned up in try/finally blocks.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { config } from '../config.js';
import { getLogger } from '../logger.js';

const SCRIPT_DIR = fileURLToPath(new URL('../../scripts/', import.meta.url));
const CONVERTER_SCRIPT = join(SCRIPT_DIR, 'convert_document.py');

/**
 * Check whether the markitdown CLI is available on the system.
 * @returns {Promise<boolean>}
 */
export async function isMarkitdownAvailable() {
  return new Promise(resolve => {
    let settled = false;
    const proc = spawn(config.conversion.pythonBin, [CONVERTER_SCRIPT, '--check'], {
      stdio: 'ignore',
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    const finish = available => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    const timer = setTimeout(() => {
      proc.kill();
      finish(false);
    }, 5000);
    proc.on('error', () => finish(false));
    proc.on('close', code => finish(code === 0));
  });
}

/**
 * Run a child process with stdin and capture stdout.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {Object} opts
 * @param {string} [opts.stdin] — data to write to stdin
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runProcess(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let outputTooLarge = false;
    const maxOutputBytes = config.conversion.maxOutputBytes;
    const timer = setTimeout(() => {
      if (!settled) {
        proc.kill();
        settled = true;
        reject(new Error('CONVERSION_TIMEOUT'));
      }
    }, opts.timeoutMs || config.conversion.timeoutMs);

    function appendOutput(current, chunk) {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > maxOutputBytes) {
        outputTooLarge = true;
        proc.kill();
      }
      return next;
    }

    proc.stdout.on('data', chunk => {
      stdout = appendOutput(stdout, chunk);
    });

    proc.stderr.on('data', chunk => {
      stderr = appendOutput(stderr, chunk);
    });

    proc.on('error', err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    proc.on('close', code => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (outputTooLarge) {
        reject(new Error('CONVERSION_OUTPUT_TOO_LARGE'));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });

    if (opts.stdin) {
      proc.stdin.write(opts.stdin);
    }
    proc.stdin.end();
  });
}

/**
 * Convert HTML text to markdown.
 *
 * Uses the convert_html.py wrapper which reads HTML from stdin
 * and writes markdown to stdout.
 *
 * @param {string} html — raw HTML content
 * @returns {Promise<string>} — markdown text
 * @throws {Error} — if conversion fails
 */
export async function convertHtmlToMarkdown(html) {
  const logger = getLogger();
  const startTime = Date.now();
  logger.info({ inputSize: html.length, script: CONVERTER_SCRIPT }, 'Converting HTML to markdown');

  let result;
  try {
    result = await runProcess(config.conversion.pythonBin, [CONVERTER_SCRIPT, '--format', 'html'], {
      stdin: html,
      timeoutMs: config.conversion.timeoutMs,
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    logger.error({ err: message }, 'HTML conversion process failed to spawn');
    if (message === 'CONVERSION_TIMEOUT') {
      throw new Error(message);
    }
    throw new Error(`CONVERSION_UNAVAILABLE: ${message}`);
  }

  const duration = Date.now() - startTime;

  if (result.exitCode !== 0) {
    logger.error(
      { exitCode: result.exitCode, stderr: result.stderr, duration },
      'HTML conversion failed'
    );
    throw new Error(`CONVERSION_FAILED: ${result.stderr || 'Unknown error'}`);
  }

  logger.info(
    {
      duration,
      inputSize: html.length,
      outputSize: result.stdout.length,
    },
    'HTML conversion completed'
  );

  return result.stdout;
}

/**
 * Convert a PDF file (base64 data URL) to markdown.
 *
 * Writes the decoded PDF to a temporary file, runs markitdown,
 * and cleans up the temp file in a try/finally block.
 *
 * @param {string} fileData — base64 data URL (data:application/pdf;base64,...)
 * @param {string} [filename] — original filename for logging
 * @returns {Promise<string>} — markdown text
 * @throws {Error} — if conversion fails
 */
export async function convertPdfToMarkdown(fileData, filename) {
  const logger = getLogger();
  const startTime = Date.now();

  // Decode base64 data URL
  let base64Data = fileData;
  if (base64Data.includes(',')) {
    base64Data = base64Data.split(',')[1];
  }
  const pdfBuffer = Buffer.from(base64Data, 'base64');

  const tmpFile = join(
    tmpdir(),
    `pra-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
  );

  logger.info(
    {
      filename: filename || 'unknown',
      fileSize: pdfBuffer.length,
      tmpFile,
    },
    'Converting PDF to markdown'
  );

  try {
    await writeFile(tmpFile, pdfBuffer);

    let result;
    try {
      result = await runProcess(
        config.conversion.pythonBin,
        [CONVERTER_SCRIPT, '--input', tmpFile],
        {
        timeoutMs: config.conversion.timeoutMs,
        }
      );
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      logger.error({ err: message }, 'PDF conversion process failed to spawn');
      if (message === 'CONVERSION_TIMEOUT') {
        throw new Error(message);
      }
      throw new Error(`CONVERSION_UNAVAILABLE: ${message}`);
    }

    const duration = Date.now() - startTime;

    if (result.exitCode !== 0) {
      logger.error(
        { exitCode: result.exitCode, stderr: result.stderr, duration },
        'PDF conversion failed'
      );
      throw new Error(`CONVERSION_FAILED: ${result.stderr || 'Unknown error'}`);
    }

    logger.info(
      {
        duration,
        inputSize: pdfBuffer.length,
        outputSize: result.stdout.length,
      },
      'PDF conversion completed'
    );

    return result.stdout;
  } finally {
    try {
      await unlink(tmpFile);
    } catch {
      // Best-effort cleanup; ignore if already removed
    }
  }
}
