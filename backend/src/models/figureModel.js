/**
 * Mock figure explanation model.
 *
 * Returns structured sections for a figure explanation request.
 * When wiring a real multimodal model, replace the body of this
 * function with an actual API call — the return shape stays the same.
 *
 * @typedef {Object} ModelOutput
 * @property {"success" | "partial_success"} status
 * @property {Array<{title: string, content: string}>} sections
 * @property {Array<{code: string, message: string}>} warnings
 */

/**
 * @param {Object} input
 * @param {string} [input.imageRef]  image reference identifier or remote URL
 * @param {{mimeType: string, dataUrl: string}} [input.imageData]  inline image payload
 * @param {string} [input.caption]  optional figure caption
 * @param {string} [input.paperTitle]
 * @returns {ModelOutput}
 */
export function explainFigure(input) {
  const caption = input.caption || '';
  const paperTitle = input.paperTitle || 'the paper';
  const hasCaption = caption.length > 0;
  const sourceLabel = input.imageData ? 'captured image region' : 'referenced figure image';

  const sections = [
    {
      title: 'What This Figure Shows',
      content: hasCaption
        ? `Based on the caption "${caption}", this ${sourceLabel} in ${paperTitle} appears to present a visual comparison, architecture diagram, or experimental result.`
        : `This selected ${sourceLabel} in ${paperTitle} appears to contain a visual comparison, architecture diagram, or experimental result.`,
    },
    {
      title: 'How To Read It',
      content:
        'Read the visible blocks, labels, or chart elements from left to right (or top to bottom) and compare the main visual groups. Look for axes labels, legends, and color coding.',
    },
    {
      title: 'Main Takeaway',
      content: `The figure is likely intended to make the method or experimental result in ${paperTitle} easier to interpret than text alone.`,
    },
  ];

  // Mock adapter simulates partial confidence since it cannot
  // truly analyze the image content.
  const warnings = [
    {
      code: 'LOW_IMAGE_CONFIDENCE',
      message:
        'This is a mock response. Real image analysis will be available when a multimodal model adapter is connected.',
    },
  ];

  return {
    status: 'partial_success',
    sections,
    warnings,
  };
}
