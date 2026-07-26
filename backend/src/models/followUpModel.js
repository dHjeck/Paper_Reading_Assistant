/**
 * Mock follow-up model.
 *
 * Returns a structured answer section for a follow-up question
 * scoped to an existing result thread.  Replace with a real LLM
 * adapter that passes the original context + question to the model.
 *
 * @typedef {Object} ModelOutput
 * @property {"success" | "partial_success"} status
 * @property {Array<{title: string, content: string}>} sections
 * @property {Array<{code: string, message: string}>} warnings
 */

import { escapeHtml } from '../utils.js';

/**
 * @param {Object} input
 * @param {string} input.question        — the follow-up question
 * @param {string} input.threadId        — thread the question belongs to
 * @param {string} input.sourceResultId  — original result being followed up on
 * @returns {ModelOutput}
 */
export function followUp(input) {
  // Escape user input to prevent XSS if rendered via innerHTML
  const question = escapeHtml(input.question);

  const sections = [
    {
      title: 'Answer',
      content: `This follow-up answer addresses "${question}" in the context of the current result thread. When a real model adapter is connected, this section will contain the model's contextual answer grounded in the original selection.`,
    },
  ];

  return {
    status: 'success',
    sections,
    warnings: [],
  };
}
