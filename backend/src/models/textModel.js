/**
 * Mock text explanation model.
 *
 * Generates structured sections based on the action type
 * (explain / simplify / define).  In a production deployment,
 * this module would be replaced by a real LLM adapter that
 * calls an external API and returns the same shape.
 *
 * @typedef {Object} ModelOutput
 * @property {"success" | "partial_success"} status
 * @property {Array<{title: string, content: string}>} sections
 * @property {Array<{code: string, message: string}>} warnings
 */

import { escapeHtml, normalizeText, truncate } from '../utils.js';

/**
 * @param {Object} input
 * @param {string} input.action      — "explain" | "simplify" | "define"
 * @param {string} input.text        — selected text (already validated)
 * @param {string} [input.context]   — nearby paragraph text
 * @param {string} [input.paperTitle]
 * @returns {ModelOutput}
 */
export function explainText(input) {
  const action = input.action;
  const text = normalizeText(input.text);
  // Escape user input before interpolation to prevent XSS
  const snippet = escapeHtml(truncate(text, 200));
  const paperTitle = escapeHtml(input.paperTitle || 'the paper');

  let sections = [];

  if (action === 'simplify') {
    sections = [
      {
        title: 'Simplified Explanation',
        content: `In simpler terms, this passage says: ${snippet}`,
      },
      {
        title: 'One-Sentence Takeaway',
        content: `This section of ${paperTitle} describes a core idea that the reader should grasp before continuing.`,
      },
    ];
  } else if (action === 'define') {
    sections = [
      {
        title: 'Definition',
        content: `The selected term or phrase refers to a concept used in the local context of ${paperTitle}.`,
      },
      {
        title: 'Meaning In This Paper',
        content: `Here, the authors use it to support the current argument or method description in ${paperTitle}.`,
      },
      {
        title: 'Common Confusion',
        content:
          'Readers sometimes confuse this term with a related but distinct concept. Always check the surrounding sentence for disambiguation.',
      },
    ];
  } else {
    // default: explain
    sections = [
      {
        title: 'Plain Explanation',
        content: `This selected passage is saying: ${snippet}`,
      },
      {
        title: 'Why It Matters',
        content: `This likely matters because it supports the method, assumption, or result interpretation in ${paperTitle}.`,
      },
      {
        title: 'Key Terms',
        content:
          'Important terms in this passage should be interpreted using the local paragraph and section context rather than a generic dictionary definition.',
      },
    ];
  }

  return {
    status: 'success',
    sections,
    warnings: [],
  };
}
