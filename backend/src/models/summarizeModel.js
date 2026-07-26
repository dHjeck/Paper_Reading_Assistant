/**
 * Mock document summarization model.
 *
 * Returns a fixed 4-section summary for testing and development.
 * In production, the openaiAdapter.summarizeDocument handles
 * real LLM-based summarization.
 *
 * @typedef {Object} ModelOutput
 * @property {"success" | "partial_success"} status
 * @property {Array<{title: string, content: string}>} sections
 * @property {Array<{code: string, message: string}>} warnings
 */

import { normalizeText, truncate } from '../utils.js';

/**
 * @param {Object} input
 * @param {string} input.markdownText — converted document text
 * @param {string} [input.paperTitle]
 * @returns {ModelOutput}
 */
export function summarizeDocument(input) {
  const text = normalizeText(input.markdownText || '');
  const paperTitle = input.paperTitle || 'the paper';
  const _preview = truncate(text, 300);

  return {
    status: 'success',
    sections: [
      {
        title: 'Core Contributions',
        content: `This document "${paperTitle}" presents a study addressing a significant research problem. The authors propose a novel approach that advances the state of the art in its field.`,
      },
      {
        title: 'Methodology & Approach',
        content:
          'The authors employ a systematic methodology combining theoretical analysis with experimental evaluation. The approach is validated against established baselines using standard benchmarks.',
      },
      {
        title: 'Key Findings',
        content:
          'The main findings demonstrate improvements over prior methods, supported by detailed ablation studies that confirm the contribution of each component. The results are statistically significant across multiple evaluation metrics.',
      },
      {
        title: 'Limitations & Future Work',
        content:
          'The authors acknowledge certain limitations in their approach and suggest directions for future research, including extending the method to broader domains and addressing edge cases identified in the evaluation.',
      },
    ],
    warnings: [
      {
        code: 'MOCK_RESPONSE',
        message:
          'This is a scaffold response. Real document summarization will be provided by the LLM backend.',
      },
    ],
  };
}
