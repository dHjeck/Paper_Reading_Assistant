/**
 * POST /api/explain-figure
 *
 * Generate a structured explanation for a selected figure or image region.
 * See backend-api-spec §7.
 */
import { Router } from 'express';
import { createValidator } from '../middleware/validate.js';
import { schemas } from '../schemas.js';
import { errors } from '../errors.js';
import { normalizeModelOutput } from '../model-output.js';
import { createId, nowIso } from '../utils.js';
import * as modelAdapter from '../models/adapter.js';

const router = Router();

/**
 * Business-rule validation for figure requests.
 * Checks bounding box dimensions for minimum image size.
 */
function validateFigureRules(req, _res, next) {
  const { figure } = req.body;

  // If a bounding box is present, enforce a minimum dimension
  // to avoid sending uselessly small crops to the model.
  if (figure.boundingBox) {
    const MIN_DIMENSION = 32;
    const { width, height } = figure.boundingBox;

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      return next(
        errors.imageTooSmall(
          `The selected region is too small (minimum ${MIN_DIMENSION}x${MIN_DIMENSION} pixels). Please select a larger area.`
        )
      );
    }
  }

  if (!figure.imageRef && !figure.imageData) {
    return next(
      errors.invalidRequest('Figure requests must include either imageRef or imageData.')
    );
  }

  next();
}

router.post(
  '/',
  createValidator(schemas.explainFigureRequest),
  validateFigureRules,
  async (req, res, next) => {
    try {
      const { paper, figure } = req.body;
      const modelInput = {
        imageRef: figure.imageRef,
        imageData: figure.imageData,
        caption: figure.caption,
        paperTitle: paper.title,
        llmConfig: req.llmConfig,
      };
      const resolvedProvider = modelAdapter.getResolvedProvider(modelInput);
      res.set('X-PRA-Resolved-Provider', resolvedProvider);

      // ── Call model layer ──
      const modelOutput = normalizeModelOutput(
        await modelAdapter.explainFigure(modelInput),
        'Figure explanation failed.'
      );

      // ── Shape response ──
      const createdAt = nowIso();
      const result = {
        resultId: createId('result'),
        threadId: createId('thread'),
        sourceType: 'figure',
        action: 'explain_figure',
        sections: modelOutput.sections,
        warnings: modelOutput.warnings,
        createdAt,
      };

      // ── Store thread for follow-up context ──
      const threadStore = req.app.locals.threadStore;
      threadStore.createThread({
        threadId: result.threadId,
        sourceType: 'figure',
        source: {
          imageRef: figure.imageRef,
          caption: figure.caption,
          pageNumber: figure.pageNumber,
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
