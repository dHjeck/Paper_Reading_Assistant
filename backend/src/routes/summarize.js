/**
 * POST /api/summarize
 *
 * Summarize a full document (HTML page or PDF file).
 * The document is first converted to markdown via the
 * documentConverter service, then passed to the model
 * layer for structured summarization.
 */
import { Router } from 'express';
import { createValidator } from '../middleware/validate.js';
import { schemas } from '../schemas.js';
import { config } from '../config.js';
import { errors } from '../errors.js';
import { normalizeModelOutput } from '../model-output.js';
import { createId, nowIso, normalizeText } from '../utils.js';
import { getLogger } from '../logger.js';
import * as modelAdapter from '../models/adapter.js';
import {
  convertHtmlToMarkdown,
  convertPdfToMarkdown,
  isMarkitdownAvailable,
} from '../services/documentConverter.js';

const router = Router();

/**
 * Business-rule validation for summarize requests.
 * Validates document content constraints.
 */
function validateDocumentRules(req, _res, next) {
  const { document } = req.body;

  if (document.kind === 'html') {
    const text = document.fullText || '';
    if (text.length < config.limits.minFullTextChars) {
      return next(
        errors.emptyDocument(
          `Document text is too short (minimum ${config.limits.minFullTextChars} characters).`
        )
      );
    }
  }

  if (document.kind === 'pdf_file') {
    if (!document.fileData) {
      return next(errors.invalidRequest('PDF document requires fileData.'));
    }
    if (document.fileSize && document.fileSize > config.limits.maxPdfFileSize) {
      return next(
        errors.documentTooLarge(
          `PDF file exceeds maximum size of ${config.limits.maxPdfFileSize} bytes.`
        )
      );
    }
  }

  next();
}

router.post(
  '/',
  createValidator(schemas.summarizeRequest),
  validateDocumentRules,
  async (req, res, next) => {
    try {
      const logger = getLogger();
      const { paper, document, _action } = req.body;
      const warnings = [];

      // ── Step 1: Convert document to markdown ──
      let markdownText;
      const conversionStart = Date.now();

      if (document.kind === 'pdf_file') {
        // PDF: check markitdown availability
        const available = await isMarkitdownAvailable();
        if (!available) {
          logger.warn('MarkItDown Python environment not available');
          return next(
            errors.conversionUnavailable(
              'The document conversion service is unavailable. Run "npm run setup:python" in the backend directory.'
            )
          );
        }

        try {
          markdownText = await convertPdfToMarkdown(document.fileData, document.filename);
        } catch (convErr) {
          const msg = convErr && convErr.message ? convErr.message : String(convErr);
          if (msg.startsWith('CONVERSION_UNAVAILABLE')) {
            return next(errors.conversionUnavailable(msg));
          }
          if (msg.startsWith('CONVERSION_TIMEOUT')) {
            return next(errors.conversionTimeout(msg));
          }
          return next(errors.conversionFailed(msg));
        }
      } else {
        // HTML: prefer cleaned markup and retain extracted plain text as a
        // reliable fallback when the converter is unavailable.
        const htmlText = document.html || '';
        const fallbackText = document.fullText || '';

        if (htmlText) {
          try {
            markdownText = await convertHtmlToMarkdown(htmlText);
          } catch (convErr) {
            const msg = convErr && convErr.message ? convErr.message : String(convErr);
            logger.warn({ err: msg }, 'HTML conversion failed, using extracted plain text');
            warnings.push({
              code: 'HTML_CONVERSION_FALLBACK',
              message: 'HTML conversion failed; the summary used extracted plain text instead.',
            });
            markdownText = fallbackText;
          }
        } else {
          // Compatibility with clients that only provide extracted plain text.
          markdownText = fallbackText;
        }
      }

      const conversionDuration = Date.now() - conversionStart;
      logger.info(
        {
          documentKind: document.kind,
          conversionDuration,
          outputLength: markdownText.length,
        },
        'Document conversion completed'
      );

      // Validate converted text
      const normalizedText = normalizeText(markdownText);
      if (normalizedText.length < config.limits.minFullTextChars) {
        return next(
          errors.emptyDocument(
            `Converted document text is too short (${normalizedText.length} chars, minimum ${config.limits.minFullTextChars}).`
          )
        );
      }

      // Truncate warning for very long documents
      if (normalizedText.length > config.summarize.maxInputChars) {
        warnings.push({
          code: 'DOCUMENT_TRUNCATED',
          message: `Document was truncated to ${config.summarize.maxInputChars} characters for processing.`,
        });
        markdownText = normalizedText.slice(0, config.summarize.maxInputChars);
      } else {
        markdownText = normalizedText;
      }

      // ── Step 2: Call model layer ──
      const modelInput = {
        markdownText,
        paperTitle: paper.title,
        llmConfig: req.llmConfig,
      };

      const resolvedProvider = modelAdapter.getResolvedProvider(modelInput);
      res.set('X-PRA-Resolved-Provider', resolvedProvider);

      const modelOutput = normalizeModelOutput(
        await modelAdapter.summarizeDocument(modelInput),
        'Document summarization failed.'
      );

      // ── Step 3: Shape response ──
      const createdAt = nowIso();
      const allWarnings = [...warnings, ...modelOutput.warnings];

      const result = {
        resultId: createId('result'),
        threadId: createId('thread'),
        sourceType: 'document',
        action: 'summarize',
        sections: modelOutput.sections,
        warnings: allWarnings,
        createdAt,
      };

      // Store thread for potential follow-up
      const threadStore = req.app.locals.threadStore;
      threadStore.createThread({
        threadId: result.threadId,
        sourceType: 'document',
        source: {
          documentKind: document.kind,
          fullText: document.fullText ? document.fullText.slice(0, 1000) : undefined,
          pageCount: document.pageCount,
        },
        results: [result],
        followUps: [],
        createdAt,
        updatedAt: createdAt,
      });

      const response = {
        requestId: req.requestId,
        status: modelOutput.status,
        result,
      };

      logger.info(
        {
          sections: result.sections.length,
          warnings: allWarnings.length,
          provider: resolvedProvider,
        },
        'Summarize request completed'
      );

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
