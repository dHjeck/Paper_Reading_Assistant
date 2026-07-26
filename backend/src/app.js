/**
 * Express application configuration.
 *
 * This file wires up middleware, mounts route handlers, and
 * registers the error handler.  It is kept separate from the
 * server bootstrap (index.js) so the app can be imported in
 * tests without starting a listening socket.
 */
import express from 'express';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger, runWithLogger } from './logger.js';
import { InMemoryThreadStore } from './store/threadStore.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandlerMiddleware } from './middleware/errorHandler.js';
import {
  authMiddleware,
  rateLimitMiddleware,
  securityHeadersMiddleware,
} from './middleware/security.js';
import { llmConfigMiddleware } from './middleware/llmConfig.js';
import { ApiError } from './errors.js';
import healthRouter from './routes/health.js';
import explainTextRouter from './routes/explainText.js';
import explainFigureRouter from './routes/explainFigure.js';
import followUpRouter from './routes/followUp.js';
import testLlmRouter from './routes/testLlm.js';
import summarizeRouter from './routes/summarize.js';

const app = express();

// ── Thread Store ────────────────────────────────────────────
const threadStore = new InMemoryThreadStore(config.threadStore);
app.locals.threadStore = threadStore;

// ── Structured Logger (pino-http) ───────────────────────────
const httpLogger = pinoHttp({
  logger,
  customProps: req => ({ requestId: req.requestId }),
  genReqId: req => req.requestId || 'unknown',
});

// ── Global Middleware ──────────────────────────────────────

// Security headers (before anything else)
app.use(securityHeadersMiddleware);

// CORS — configured from environment (config.corsOrigins)
app.use((req, res, next) => {
  const origins = config.corsOrigins;
  const origin = req.get('Origin');

  if (origins === '*') {
    res.set('Access-Control-Allow-Origin', '*');
  } else if (
    origin &&
    origins
      .split(',')
      .map(o => o.trim())
      .includes(origin)
  ) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }

  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Request-Id, X-API-Key, X-LLM-Base-Url, X-LLM-Api-Key, X-LLM-Model, X-LLM-Language'
  );
  res.set('Access-Control-Expose-Headers', 'X-Request-Id, X-PRA-Resolved-Provider');
  res.set('Access-Control-Max-Age', '86400');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(requestIdMiddleware);

// Structured logging — wraps the rest of the middleware chain
// in an AsyncLocalStorage context so all downstream code can
// call getLogger() to access the request-scoped pino child logger.
app.use((req, res, next) => {
  httpLogger(req, res);
  runWithLogger(req.log, next);
});

// Health check — before body parsing, rate-limit, and auth
// so infrastructure probes (k8s liveness/readiness) are not affected.
app.use('/api/health', healthRouter);

// Parse summarize requests first with a larger limit. PDF data is base64
// encoded, so its JSON representation is larger than the original file.
// Express middleware is order-sensitive: the smaller global parser below
// must not see this route first or it will reject valid PDF requests.
app.use(
  '/api/summarize',
  express.json({
    limit:
      config.limits.maxSummarizePayloadBytes ||
      Math.ceil((config.limits.maxPdfFileSize || 31457280) * 4 / 3) + 1048576,
  })
);

// Body parsing with the normal API size limit
app.use(express.json({ limit: config.limits.maxPayloadBytes }));

// Rate limiting (after CORS, before routes)
app.use(rateLimitMiddleware);

// Authentication (after rate limit so brute-forcing keys is also rate-limited)
app.use(authMiddleware);

// LLM provider config (extract per-request X-LLM-* headers into req.llmConfig)
app.use(llmConfigMiddleware);

// ── Routes ─────────────────────────────────────────────────

// Summarize route — needs larger body parser for PDF base64 (up to 30MB)
app.use(
  '/api/summarize',
  summarizeRouter
);

app.use('/api/explain-text', explainTextRouter);
app.use('/api/explain-figure', explainFigureRouter);
app.use('/api/follow-up', followUpRouter);
app.use('/api/test-llm', testLlmRouter);

// ── 404 Handler — delegate to central error handler ────────

app.use((req, _res, next) => {
  next(
    new ApiError('INVALID_REQUEST', `Route not found: ${req.method} ${req.path}`, {
      statusCode: 404,
      retryable: false,
    })
  );
});

// ── Error Handler (must be last) ───────────────────────────

app.use(errorHandlerMiddleware);

export default app;
