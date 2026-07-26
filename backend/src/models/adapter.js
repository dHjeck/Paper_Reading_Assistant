/**
 * Model adapter — unified entry point for all model calls.
 *
 * This module abstracts the choice between the mock stub models
 * and a future real LLM provider.  Route handlers import from
 * here and never touch the underlying model modules directly.
 *
 * To wire a real LLM:
 *   1. Create a new provider module (e.g. models/openaiAdapter.js)
 *      that exports the same three functions with the same return shape.
 *   2. Set MODEL_PROVIDER=openai in the environment.
 *   3. Add the case to the switch below.
 */

import { config } from '../config.js';
import { getLogger } from '../logger.js';
import * as mockText from './textModel.js';
import * as mockFigure from './figureModel.js';
import * as mockFollowUp from './followUpModel.js';
import * as mockSummarize from './summarizeModel.js';
import * as openaiAdapter from './openaiAdapter.js';

const provider = config.modelProvider;

/**
 * Known model providers.  Adding a new provider requires:
 *   1. Create models/<provider>Adapter.js exporting explainText / explainFigure / followUp
 *   2. Add the case to the switch statements below
 *   3. Set MODEL_PROVIDER=<provider> in the environment
 */
const KNOWN_PROVIDERS = new Set(['mock', 'openai']);

if (provider !== 'mock' && !KNOWN_PROVIDERS.has(provider)) {
  getLogger().warn(
    { provider },
    `MODEL_PROVIDER="${provider}" is not recognised. Falling back to mock. Known providers: ${[...KNOWN_PROVIDERS].join(', ')}`
  );
}

function shouldUsePerRequestOpenAI(input) {
  const llmConfig = input && input.llmConfig;
  if (!llmConfig || typeof llmConfig !== 'object') {
    return false;
  }

  return !!(llmConfig.baseUrl || llmConfig.apiKey || llmConfig.model);
}

function resolveProvider(input) {
  if (shouldUsePerRequestOpenAI(input)) {
    return 'openai';
  }

  if (KNOWN_PROVIDERS.has(provider)) {
    return provider;
  }

  return 'mock';
}

export function getResolvedProvider(input) {
  return resolveProvider(input);
}

/**
 * Text explanation model.
 *
 * @param {Object} input
 * @param {Object} [input.llmConfig] - Per-request LLM provider config (from X-LLM-* headers).
 * @param {string|null} [input.llmConfig.baseUrl] - LLM provider base URL; null means use server default.
 * @param {string|null} [input.llmConfig.apiKey] - LLM provider API key; null means use server default.
 * @returns {Promise<{status: string, sections: Array, warnings: Array}>}
 */
export async function explainText(input) {
  switch (resolveProvider(input)) {
    case 'openai':
      return openaiAdapter.explainText(input);
    case 'mock':
      return mockText.explainText(input);
    default:
      return mockText.explainText(input);
  }
}

/**
 * Figure explanation model.
 *
 * @param {Object} input
 * @param {Object} [input.llmConfig] - Per-request LLM provider config (from X-LLM-* headers).
 * @param {string|null} [input.llmConfig.baseUrl] - LLM provider base URL; null means use server default.
 * @param {string|null} [input.llmConfig.apiKey] - LLM provider API key; null means use server default.
 * @returns {Promise<{status: string, sections: Array, warnings: Array}>}
 */
export async function explainFigure(input) {
  switch (resolveProvider(input)) {
    case 'openai':
      return openaiAdapter.explainFigure(input);
    case 'mock':
      return mockFigure.explainFigure(input);
    default:
      return mockFigure.explainFigure(input);
  }
}

/**
 * Follow-up model.
 *
 * @param {Object} input
 * @param {Object} [input.llmConfig] - Per-request LLM provider config (from X-LLM-* headers).
 * @param {string|null} [input.llmConfig.baseUrl] - LLM provider base URL; null means use server default.
 * @param {string|null} [input.llmConfig.apiKey] - LLM provider API key; null means use server default.
 * @returns {Promise<{status: string, sections: Array, warnings: Array}>}
 */
export async function followUp(input) {
  switch (resolveProvider(input)) {
    case 'openai':
      return openaiAdapter.followUp(input);
    case 'mock':
      return mockFollowUp.followUp(input);
    default:
      return mockFollowUp.followUp(input);
  }
}

/**
 * Document summarization model.
 *
 * @param {Object} input
 * @param {string} input.markdownText — converted document text
 * @param {string} [input.paperTitle]
 * @param {Object} [input.llmConfig]
 * @returns {Promise<{status: string, sections: Array, warnings: Array}>}
 */
export async function summarizeDocument(input) {
  switch (resolveProvider(input)) {
    case 'openai':
      return openaiAdapter.summarizeDocument(input);
    case 'mock':
      return mockSummarize.summarizeDocument(input);
    default:
      return mockSummarize.summarizeDocument(input);
  }
}
