/**
 * POST /api/follow-up
 *
 * Ask one contextual follow-up question about the latest result thread.
 * See backend-api-spec §8.
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
 * Business-rule validation for follow-up requests.
 * Checks question length limits.
 */
function validateFollowUpRules(req, _res, next) {
  const { question } = req.body;
  const normalized = normalizeText(question);

  if (normalized.length < 1) {
    return next(errors.invalidRequest('Follow-up question must not be empty.'));
  }

  if (normalized.length > config.limits.maxFollowUpLength) {
    return next(
      errors.invalidRequest(
        `Follow-up question is too long (maximum ${config.limits.maxFollowUpLength} characters).`
      )
    );
  }

  next();
}

router.post(
  '/',
  createValidator(schemas.followUpRequest),
  validateFollowUpRules,
  async (req, res, next) => {
    try {
      const { threadId, sourceResultId, question } = req.body;

      // ── Look up the thread for original context ──
      const threadStore = req.app.locals.threadStore;
      const thread = threadStore.getThread(threadId);
      if (!thread) {
        return next(errors.invalidRequest(`Thread "${threadId}" not found.`));
      }

      const modelInput = {
        question,
        threadId,
        sourceResultId,
        originalText: thread.source?.text,
        previousResults: thread.results,
        llmConfig: req.llmConfig,
      };
      const resolvedProvider = modelAdapter.getResolvedProvider(modelInput);
      res.set('X-PRA-Resolved-Provider', resolvedProvider);

      // ── Call model layer with original context ──
      const modelOutput = normalizeModelOutput(
        await modelAdapter.followUp(modelInput),
        'Follow-up generation failed.'
      );

      // ── Shape response ──
      const createdAt = nowIso();
      const followUpId = createId('fu');
      const response = {
        requestId: req.requestId,
        status: modelOutput.status,
        followUp: {
          followUpId,
          threadId,
          sourceResultId,
          question,
          sections: modelOutput.sections,
          warnings: modelOutput.warnings,
          createdAt,
        },
      };

      // ── Store follow-up in thread ──
      threadStore.addFollowUp(threadId, {
        followUpId,
        question,
        sections: modelOutput.sections,
        createdAt,
      });

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
