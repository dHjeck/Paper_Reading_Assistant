/**
 * GET /api/health
 *
 * Lightweight connectivity and service-status check.
 * See backend-api-spec §9.
 */
import { Router } from 'express';
import { nowIso } from '../utils.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    requestId: req.requestId || 'req_unknown',
    status: 'ok',
    service: 'paper-reading-assistant-api',
    time: nowIso(),
  });
});

export default router;
