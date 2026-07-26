/**
 * LLM prompt templates for all explanation actions.
 *
 * Each builder function returns { system, user } message strings
 * ready for an OpenAI-compatible /chat/completions request.
 *
 * All prompts constrain the output to structured JSON sections
 * and require the LLM to respond in the user's configured language.
 */

const LANGUAGE_NAMES = {
  en: 'English',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
};

/**
 * Explain action — rephrase selected text in accessible language.
 */
export function buildExplainPrompt({ text, context, paperTitle, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return {
    system: `You are an academic reading assistant. The user is reading a research paper and selected a passage for explanation.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 3 sections. Translate the following section titles into ${lang} as well:
  1. "Plain Explanation" — rephrase the passage in clear, accessible language.
  2. "Why It Matters" — explain why this passage is significant in the paper's context.
  3. "Key Terms" — identify and briefly define 2-4 important terms from the passage.
- Keep each section content concise (2-4 sentences).
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}
${context ? `\nSurrounding context:\n${context}\n` : ''}
Selected text:
${text}`,
  };
}

/**
 * Simplify action — rewrite selected text in plain, non-technical language.
 */
export function buildSimplifyPrompt({ text, context, paperTitle, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return {
    system: `You are an academic reading assistant. The user wants a simplified version of the selected passage from a research paper.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 2 sections. Translate the following section titles into ${lang} as well:
  1. "Simplified Explanation" — rewrite the passage in plain, non-technical language.
  2. "One-Sentence Takeaway" — one sentence capturing the core idea.
- Keep each section content concise.
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}
${context ? `\nSurrounding context:\n${context}\n` : ''}
Selected text to simplify:
${text}`,
  };
}

/**
 * Define action — define a selected term or phrase.
 */
export function buildDefinePrompt({ text, context, paperTitle, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return {
    system: `You are an academic reading assistant. The user selected a term or phrase from a research paper for definition.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 3 sections. Translate the following section titles into ${lang} as well:
  1. "Definition" — give the general/standard definition of the term.
  2. "Meaning In This Paper" — explain how the term is used in this specific paper's context.
  3. "Common Confusion" — note any commonly confused related concepts.
- Keep each section content concise (2-4 sentences).
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}
${context ? `\nSurrounding context:\n${context}\n` : ''}
Term/phrase to define:
${text}`,
  };
}

/**
 * Figure explanation — analyze a figure from a research paper.
 */
export function buildFigurePrompt({ caption, paperTitle, hasImage, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  const imageNote = hasImage
    ? ''
    : '\n- Note: no image was provided. Base your analysis solely on the caption and paper context.';
  return {
    system: `You are an academic reading assistant analyzing a figure from a research paper.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 3 sections. Translate the following section titles into ${lang} as well:
  1. "What This Figure Shows" — describe the figure's content and purpose.
  2. "How To Read It" — guide the reader on interpreting axes, labels, colors, or layout.
  3. "Main Takeaway" — state the key insight or conclusion from the figure.
- Keep each section concise (2-4 sentences).${imageNote}
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}
${caption ? `Figure caption: ${caption}` : 'No caption provided.'}`,
  };
}

/**
 * Follow-up — answer a contextual follow-up question.
 */
export function buildFollowUpPrompt({ question, originalText, previousResults, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  const prevSummary = (previousResults || [])
    .map(r => {
      const sectionText = (r.sections || []).map(s => `${s.title}: ${s.content}`).join('; ');
      return `[${r.action || 'result'}] ${sectionText}`;
    })
    .join('\n');

  return {
    system: `You are an academic reading assistant answering a follow-up question about a previously explained passage from a research paper.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 1 section titled "Answer" (translated into ${lang}).
- Ground your answer in the original text context provided below.
- Be concise (3-6 sentences) but thorough.
- Do NOT include any text outside the JSON object.`,
    user: `Original text:
${originalText || '(not available)'}

${prevSummary ? `Previous analysis:\n${prevSummary}\n` : ''}
Follow-up question:
${question}`,
  };
}

/**
 * Summarize — produce a structured 4-section summary of an entire document.
 * Used for short documents (≤ chunk threshold) that fit in one LLM call.
 */
export function buildSummarizePrompt({ markdownText, paperTitle, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return {
    system: `You are an academic reading assistant that produces structured summaries of research papers and documents.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 4 sections. Translate the following section titles into ${lang} as well:
  1. "Core Contributions" — what the paper proposes and its significance.
  2. "Methodology & Approach" — the methods, techniques, or framework used.
  3. "Key Findings" — main results, experimental outcomes, and discoveries.
  4. "Limitations & Future Work" — acknowledged limitations and suggested future directions.
- Each section should be 3-6 sentences, providing substantive content.
- Focus on factual extraction from the provided text. Do not invent information.
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}

Full document text:
${markdownText}`,
  };
}

/**
 * Chunk summarize — produce a summary for one chunk of a long document.
 * Used in the map phase of the map-reduce pipeline for long documents.
 */
export function buildChunkSummarizePrompt({
  chunkText,
  chunkIndex,
  totalChunks,
  paperTitle,
  language,
}) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return {
    system: `You are an academic reading assistant. You are summarizing part ${chunkIndex + 1} of ${totalChunks} of a research document.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 1 section titled "Summary" (translated into ${lang}).
- Capture the key ideas, arguments, methods, and findings from this chunk.
- Be thorough but concise (4-8 sentences).
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}

Document part ${chunkIndex + 1}/${totalChunks}:
${chunkText}`,
  };
}

/**
 * Final synthesis — combine chunk summaries into a structured 4-section result.
 * Used in the reduce phase of the map-reduce pipeline.
 */
export function buildFinalSynthesisPrompt({ chunkSummaries, paperTitle, language }) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  const summariesText = chunkSummaries.map((s, i) => `Part ${i + 1}: ${s}`).join('\n\n');

  return {
    system: `You are an academic reading assistant. You are given partial summaries of different sections of a research document. Synthesize them into a comprehensive structured summary.

Rules:
- You MUST respond in ${lang}. Never use any other language.
- Output ONLY valid JSON: { "sections": [{ "title": "...", "content": "..." }] }
- Produce exactly 4 sections. Translate the following section titles into ${lang} as well:
  1. "Core Contributions" — what the paper proposes and its significance.
  2. "Methodology & Approach" — the methods, techniques, or framework used.
  3. "Key Findings" — main results, experimental outcomes, and discoveries.
  4. "Limitations & Future Work" — acknowledged limitations and suggested future directions.
- Each section should be 3-6 sentences with substantive content drawn from the partial summaries.
- Eliminate redundancy across sections.
- Do NOT include any text outside the JSON object.`,
    user: `Paper: ${paperTitle || 'Untitled'}

Partial summaries from document sections:
${summariesText}`,
  };
}
