/**
 * Server entry point.
 *
 * Boots the Express app and listens on the configured port.
 * Usage:  npm start   |   npm run dev
 */
import app from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const PORT = config.port;

// ── Startup Safety Checks ──────────────────────────────────

if (config.isProduction && !config.apiKey) {
  logger.fatal('API_KEY is required in production. Set API_KEY in environment.');
  process.exit(1);
}
if (!config.apiKey) {
  logger.warn('No API_KEY set. Authentication is DISABLED.');
}

const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, modelProvider: config.modelProvider },
    `Paper Reading Assistant API running on http://localhost:${PORT}`
  );
  logger.info(`Health check: http://localhost:${PORT}/api/health`);
});

// ── Graceful Shutdown ─────────────────────────────────────────
//
// In containerized deployments (Docker, Kubernetes), the orchestrator
// sends SIGTERM.  We stop accepting new connections and wait for
// in-flight requests to finish before exiting.

const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  server.close(err => {
    if (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
    logger.info('All connections closed. Exiting.');
    process.exit(0);
  });

  // Force exit after timeout if connections don't close
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout. Some connections may have been dropped.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
