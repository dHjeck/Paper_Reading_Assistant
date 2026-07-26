/**
 * POST /api/explain-text
 *
 * Generate a structured explanation for selected text.
 * See backend-api-spec §6.
 */
import { Router } from 'express';
import { createValidator } from '../middleware/validate.js';
import { schemas } from '../schemas.js';
import { config } from '../config.js';
import { errors } from '../errors.js';
import { normalizeModelOutput } from '../model-output.js';
import { createId, nowIso, normalizeText } from '../utils.js';
import * as modelAdapter from '../models/adapter.js';

const router = Router();

/**
 * Business-rule validation that runs after schema validation.
 * Checks selection text length limits.
 */
function validateSelectionRules(req, _res, next) {
  const { text } = req.body.selection;
  const normalized = normalizeText(text);

  if (normalized.length < config.limits.minSelectionLength) {
    return next(
      errors.invalidSelection(
        `Selection is too short (minimum ${config.limits.minSelectionLength} characters).`
      )
    );
  }

  if (normalized.length > config.limits.maxSelectionLength) {
    return next(
      errors.invalidSelection(
        `Selection is too long (maximum ${config.limits.maxSelectionLength} characters). Please narrow the scope.`
      )
    );
  }

  next();
}

router.post(
  '/',
  createValidator(schemas.explainTextRequest),
  validateSelectionRules,
  async (req, res, next) => {
    try {
      const { paper, selection, action } = req.body;
      const modelInput = {
        action,
        text: selection.text,
        context: selection.context,
        paperTitle: paper.title,
        llmConfig: req.llmConfig,
      };
      const resolvedProvider = modelAdapter.getResolvedProvider(modelInput);
      res.set('X-PRA-Resolved-Provider', resolvedProvider);

      // ── Call model layer ──
      const modelOutput = normalizeModelOutput(
        await modelAdapter.explainText(modelInput),
        'Text explanation failed.'
      );

      // ── Shape response ──
      const createdAt = nowIso();
      const result = {
        resultId: createId('result'),
        threadId: createId('thread'),
        sourceType: 'text',
        action,
        sections: modelOutput.sections,
        warnings: modelOutput.warnings,
        createdAt,
      };

      // ── Store thread for follow-up context ──
      const threadStore = req.app.locals.threadStore;
      threadStore.createThread({
        threadId: result.threadId,
        sourceType: 'text',
        source: {
          text: selection.text,
          context: selection.context,
          pageNumber: selection.pageNumber,
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

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
