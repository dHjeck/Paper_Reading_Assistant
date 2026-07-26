/**
 * Quick smoke test for all API endpoints.
 * Run: node test-smoke.js
 *
 * Validates status codes and response structure for each endpoint,
 * including success paths and common error cases.
 */
const BASE = 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} — ${detail || 'assertion failed'}`);
  }
}

async function test(name, method, path, body, expectedStatus, opts) {
  const opts_ = opts || {};
  const fetchOpts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) {
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, fetchOpts);
  const json = await res.json();

  console.log(`\n── ${name} ──`);
  console.log(`  Status: ${res.status}`);

  if (expectedStatus !== undefined) {
    assert(
      `${name}: status is ${expectedStatus}`,
      res.status === expectedStatus,
      `expected ${expectedStatus}, got ${res.status}`
    );
  }

  if (!opts_.skipRequestId) {
    assert(`${name}: has requestId`, typeof json.requestId === 'string');
  }
  assert(`${name}: has status field`, typeof json.status === 'string');

  return json;
}

async function main() {
  // 1. Health
  const health = await test('Health', 'GET', '/api/health', null, 200);
  assert('Health: status is ok', health.status === 'ok');
  assert('Health: has requestId', typeof health.requestId === 'string');
  assert('Health: has service', typeof health.service === 'string');
  assert('Health: has time', typeof health.time === 'string');

  // 2. Explain Text (explain)
  const explain = await test(
    'Explain Text',
    'POST',
    '/api/explain-text',
    {
      paper: {
        paperId: 'paper_123',
        title: 'Attention Is All You Need',
        url: 'https://example.com/paper.pdf',
        sourceType: 'pdf',
        pageNumber: 4,
      },
      selection: {
        selectionId: 'sel_123',
        text: 'The Transformer uses multi-head attention to attend to different positions.',
        context: 'Full nearby paragraph text.',
        pageNumber: 4,
      },
      action: 'explain',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    200
  );
  assert('Explain Text: status is success', explain.status === 'success');
  assert('Explain Text: has result', !!explain.result);
  assert('Explain Text: result has sections array', Array.isArray(explain.result?.sections));
  assert('Explain Text: result has threadId', typeof explain.result?.threadId === 'string');
  assert('Explain Text: sections non-empty', (explain.result?.sections?.length || 0) > 0);

  // 3. Explain Text (simplify)
  const simplify = await test(
    'Simplify Text',
    'POST',
    '/api/explain-text',
    {
      paper: {
        title: 'Attention Is All You Need',
        url: 'https://example.com/paper.pdf',
        sourceType: 'pdf',
      },
      selection: {
        selectionId: 'sel_456',
        text: 'Multi-head attention allows the model to jointly attend to information from different representation subspaces.',
      },
      action: 'simplify',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    200
  );
  assert('Simplify Text: status is success', simplify.status === 'success');
  assert('Simplify Text: has sections', (simplify.result?.sections?.length || 0) > 0);

  // 4. Explain Text (define)
  const define = await test(
    'Define Text',
    'POST',
    '/api/explain-text',
    {
      paper: {
        title: 'Attention Is All You Need',
        url: 'https://example.com/paper.pdf',
        sourceType: 'pdf',
      },
      selection: {
        selectionId: 'sel_789',
        text: 'multi-head attention',
      },
      action: 'define',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    200
  );
  assert('Define Text: status is success', define.status === 'success');

  // 5. Explain Figure
  const figure = await test(
    'Explain Figure',
    'POST',
    '/api/explain-figure',
    {
      paper: {
        paperId: 'paper_123',
        title: 'Attention Is All You Need',
        url: 'https://example.com/paper.pdf',
        sourceType: 'pdf',
        pageNumber: 5,
      },
      figure: {
        figureId: 'fig_123',
        imageData: {
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        },
        caption: 'Figure 2: Model architecture',
        pageNumber: 5,
        boundingBox: { x: 120, y: 300, width: 420, height: 260 },
      },
      action: 'explain_figure',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    200
  );
  assert(
    'Explain Figure: status is partial_success or success',
    figure.status === 'partial_success' || figure.status === 'success'
  );
  assert('Explain Figure: has result', !!figure.result);

  // 6. Follow-Up (use threadId from the explain-text response)
  const realThreadId = explain.result?.threadId || 'thread_unknown';
  const realResultId = explain.result?.resultId || 'result_unknown';
  const followUp = await test(
    'Follow-Up',
    'POST',
    '/api/follow-up',
    {
      threadId: realThreadId,
      sourceResultId: realResultId,
      question: 'Why is this important?',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    200
  );
  assert('Follow-Up: status is success', followUp.status === 'success');
  assert('Follow-Up: has followUp', !!followUp.followUp);
  assert('Follow-Up: followUp has sections', Array.isArray(followUp.followUp?.sections));

  // 6b. Follow-Up with non-existent threadId -> INVALID_REQUEST
  const badThread = await test(
    'Follow-Up: Bad thread',
    'POST',
    '/api/follow-up',
    {
      threadId: 'thread_nonexistent',
      sourceResultId: 'result_123',
      question: 'Why?',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    400
  );
  assert('Bad thread: error code is INVALID_REQUEST', badThread.error?.code === 'INVALID_REQUEST');

  // 7. Error: Invalid Request (missing required field)
  const missingField = await test(
    'Error: Missing field',
    'POST',
    '/api/explain-text',
    {
      paper: { title: 'Test', url: 'https://example.com', sourceType: 'pdf' },
      selection: { text: 'Some text here.' },
      action: 'explain',
      // missing client
    },
    400
  );
  assert('Missing field: status is error', missingField.status === 'error');
  assert(
    'Missing field: error code is INVALID_REQUEST',
    missingField.error?.code === 'INVALID_REQUEST'
  );

  // 8. Error: Invalid Selection (too short)
  const tooShort = await test(
    'Error: Too short',
    'POST',
    '/api/explain-text',
    {
      paper: { title: 'Test', url: 'https://example.com', sourceType: 'pdf' },
      selection: { text: 'a' },
      action: 'explain',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    400
  );
  assert('Too short: status is error', tooShort.status === 'error');

  // 9. Error: Invalid action
  const badAction = await test(
    'Error: Invalid action',
    'POST',
    '/api/explain-text',
    {
      paper: { title: 'Test', url: 'https://example.com', sourceType: 'pdf' },
      selection: { text: 'Some text here.' },
      action: 'summarize',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    400
  );
  assert('Invalid action: status is error', badAction.status === 'error');

  // 10. Error: 404
  const notFound = await test('Error: 404', 'GET', '/api/nonexistent', null, 404);
  assert('404: status is error', notFound.status === 'error');

  // 11. Error: Malformed JSON
  const malformedRes = await fetch(`${BASE}/api/explain-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ this is not valid json',
  });
  const malformedJson = await malformedRes.json();
  console.log('\n── Error: Malformed JSON ──');
  console.log(`  Status: ${malformedRes.status}`);
  assert(
    'Malformed JSON: status is 400',
    malformedRes.status === 400,
    `expected 400, got ${malformedRes.status}`
  );
  assert('Malformed JSON: status is error', malformedJson.status === 'error');

  // 12. Error: Payload Too Large (413 -> INVALID_REQUEST)
  // Default maxPayloadBytes is 524288 (512 KB); send slightly more to trigger 413.
  const hugeBody = { text: 'x'.repeat(524288 + 1024) };
  const hugeRes = await fetch(`${BASE}/api/explain-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hugeBody),
  });
  const hugeJson = await hugeRes.json();
  console.log('\n── Error: Payload Too Large ──');
  console.log(`  Status: ${hugeRes.status}`);
  assert(
    'Payload too large: status is 413',
    hugeRes.status === 413,
    `expected 413, got ${hugeRes.status}`
  );
  assert(
    'Payload too large: error code is INVALID_REQUEST',
    hugeJson.error && hugeJson.error.code === 'INVALID_REQUEST',
    `expected INVALID_REQUEST, got ${hugeJson.error && hugeJson.error.code}`
  );

  // 13. LLM headers: request with X-LLM-Base-Url / X-LLM-Api-Key should still succeed (mock ignores them)
  console.log('\n── LLM Headers ──');
  const llmRes = await fetch(`${BASE}/api/explain-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LLM-Base-Url': 'http://127.0.0.1:1',
      'X-LLM-Api-Key': 'sk-test-key-12345',
    },
    body: JSON.stringify({
      paper: {
        title: 'Attention Is All You Need',
        url: 'https://example.com/paper.pdf',
        sourceType: 'pdf',
      },
      selection: { selectionId: 'sel_llm', text: 'The Transformer uses multi-head attention.' },
      action: 'explain',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    }),
  });
  const llmJson = await llmRes.json();
  console.log(`  Status: ${llmRes.status}`);
  assert('LLM Headers: status is 502', llmRes.status === 502, `expected 502, got ${llmRes.status}`);
  assert('LLM Headers: status is error', llmJson.status === 'error');
  assert(
    'LLM Headers: uses OpenAI adapter',
    llmJson.error && llmJson.error.code === 'UPSTREAM_MODEL_ERROR'
  );
  assert('LLM Headers: has requestId', typeof llmJson.requestId === 'string');

  // 14. Test LLM: missing base URL -> 400 INVALID_REQUEST
  console.log('\n── Test LLM: Missing Base URL ──');
  const noBaseRes = await fetch(`${BASE}/api/test-llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const noBaseJson = await noBaseRes.json();
  console.log(`  Status: ${noBaseRes.status}`);
  assert(
    'Test LLM no base: status is 400',
    noBaseRes.status === 400,
    `expected 400, got ${noBaseRes.status}`
  );
  assert(
    'Test LLM no base: error code is INVALID_REQUEST',
    noBaseJson.error && noBaseJson.error.code === 'INVALID_REQUEST',
    `expected INVALID_REQUEST, got ${noBaseJson.error && noBaseJson.error.code}`
  );

  // 15. Test LLM: unreachable URL -> 502 UPSTREAM_MODEL_ERROR
  console.log('\n── Test LLM: Unreachable URL ──');
  const unreachableRes = await fetch(`${BASE}/api/test-llm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LLM-Base-Url': 'http://127.0.0.1:1',
      'X-LLM-Api-Key': 'sk-test',
      'X-LLM-Model': 'gpt-4o',
    },
    body: JSON.stringify({}),
  });
  const unreachableJson = await unreachableRes.json();
  console.log(`  Status: ${unreachableRes.status}`);
  assert(
    'Test LLM unreachable: status is 502',
    unreachableRes.status === 502,
    `expected 502, got ${unreachableRes.status}`
  );
  assert(
    'Test LLM unreachable: error code is UPSTREAM_MODEL_ERROR',
    unreachableJson.error && unreachableJson.error.code === 'UPSTREAM_MODEL_ERROR',
    `expected UPSTREAM_MODEL_ERROR, got ${unreachableJson.error && unreachableJson.error.code}`
  );
  assert('Test LLM unreachable: has requestId', typeof unreachableJson.requestId === 'string');

  // ═══ Summarize Tests ═══════════════════════════════════════

  // 16. Summarize: HTML short document (mock mode)
  const summarizeHtml = await test(
    'Summarize HTML',
    'POST',
    '/api/summarize',
    {
      paper: {
        paperId: 'paper_sum_1',
        title: 'Attention Is All You Need',
        url: 'https://arxiv.org/abs/1706.03762',
        sourceType: 'html',
      },
      document: {
        kind: 'html',
        html:
          '<article><h1>Attention Is All You Need</h1><p>The Transformer architecture uses multi-head attention mechanisms to process sequences in parallel, eliminating the need for recurrence.</p><p>This paper introduces a model relying entirely on self-attention to compute representations of its input and output. It achieves strong machine translation results while being highly parallelizable and captures long-range dependencies more effectively than recurrent architectures.</p></article>',
        fullText:
          'The Transformer architecture uses multi-head attention mechanisms to process sequences in parallel, eliminating the need for recurrence. This paper introduces the Transformer model which relies entirely on self-attention to compute representations of its input and output. The model achieves state-of-the-art results on machine translation tasks while being more parallelizable and requiring significantly less time to train. The attention mechanism allows the model to focus on different parts of the input sequence when producing each part of the output, enabling it to capture long-range dependencies more effectively than recurrent architectures.',
        charCount: 520,
        extractionMethod: 'semantic',
      },
      action: 'summarize',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    200
  );
  assert('Summarize HTML: status is success', summarizeHtml.status === 'success');
  assert('Summarize HTML: has result', !!summarizeHtml.result);
  assert('Summarize HTML: sourceType is document', summarizeHtml.result?.sourceType === 'document');
  assert('Summarize HTML: action is summarize', summarizeHtml.result?.action === 'summarize');
  assert('Summarize HTML: has 4 sections', (summarizeHtml.result?.sections?.length || 0) === 4);
  assert('Summarize HTML: has threadId', typeof summarizeHtml.result?.threadId === 'string');
  assert(
    'Summarize HTML: sections have titles',
    summarizeHtml.result?.sections?.every(s => typeof s.title === 'string')
  );

  // 17. Summarize: empty document -> EMPTY_DOCUMENT
  const emptyDoc = await test(
    'Summarize: Empty document',
    'POST',
    '/api/summarize',
    {
      paper: { title: 'Test', url: 'https://example.com', sourceType: 'html' },
      document: {
        kind: 'html',
        fullText: 'ab',
      },
      action: 'summarize',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    400
  );
  assert('Empty doc: status is error', emptyDoc.status === 'error');
  assert('Empty doc: error code is EMPTY_DOCUMENT', emptyDoc.error?.code === 'EMPTY_DOCUMENT');

  // 18. Summarize: missing document field -> INVALID_REQUEST
  const missingDoc = await test(
    'Summarize: Missing document',
    'POST',
    '/api/summarize',
    {
      paper: { title: 'Test', url: 'https://example.com', sourceType: 'html' },
      action: 'summarize',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    400
  );
  assert('Missing doc: status is error', missingDoc.status === 'error');
  assert(
    'Missing doc: error code is INVALID_REQUEST',
    missingDoc.error?.code === 'INVALID_REQUEST'
  );

  // 19. Summarize: PDF with base64 data (mock mode — no real conversion)
  const summarizePdf = await test('Summarize PDF', 'POST', '/api/summarize', {
    paper: {
      paperId: 'paper_pdf_1',
      title: 'BERT Paper',
      url: 'https://example.com/bert.pdf',
      sourceType: 'pdf',
    },
    document: {
      kind: 'pdf_file',
      fileData:
        'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoK',
      filename: 'bert.pdf',
      fileSize: 1024,
      pageCount: 15,
    },
    action: 'summarize',
    client: { platform: 'chrome-extension', version: '0.1.0' },
  });
  // In mock mode without markitdown, PDF conversion may fail or succeed
  // depending on environment. We just verify the response structure.
  assert('Summarize PDF: has requestId', typeof summarizePdf.requestId === 'string');
  assert('Summarize PDF: has status', typeof summarizePdf.status === 'string');

  // 20. Summarize: wrong action value -> INVALID_REQUEST
  const badSummarizeAction = await test(
    'Summarize: Wrong action',
    'POST',
    '/api/summarize',
    {
      paper: { title: 'Test', url: 'https://example.com', sourceType: 'html' },
      document: { kind: 'html', fullText: 'Some text content here that is long enough.' },
      action: 'explain',
      client: { platform: 'chrome-extension', version: '0.1.0' },
    },
    400
  );
  assert('Wrong action: status is error', badSummarizeAction.status === 'error');

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    console.log('✗ Some tests FAILED.');
    process.exit(1);
  }
  console.log('✓ All smoke tests passed.\n');
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
