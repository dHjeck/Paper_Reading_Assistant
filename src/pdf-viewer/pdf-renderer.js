/**
 * Paper Reading Assistant — PDF Renderer
 *
 * Renders a single PDF page onto an HTML canvas element,
 * handling HiDPI screen scaling and smooth zoom transitions.
 *
 * Loaded via <script> tag in pdf-viewer.html.
 * Exposes globalThis.PraPdfRenderer.
 */
(function () {
  /**
   * Render a specific page of a pdf.js document onto a canvas.
   *
   * @param {PDFDocumentProxy} pdfDoc  - The loaded pdf.js document.
   * @param {number} pageNumber        - 1-based page number.
   * @param {number} scale            - Zoom scale (1.0 = 100%).
   * @param {HTMLCanvasElement} canvas - The target canvas element.
   * @returns {Promise<{width:number, height:number}>} CSS pixel dimensions.
   */
  async function renderPage(pdfDoc, pageNumber, scale, canvas) {
    var page = await pdfDoc.getPage(pageNumber);
    var viewport = page.getViewport({ scale });

    var outputScale = window.devicePixelRatio || 1;

    var context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to get 2D canvas context.');
    }

    // Set the drawing buffer to physical pixels for HiDPI clarity,
    // but keep CSS dimensions at logical CSS pixels.
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    var transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

    var renderContext = {
      canvasContext: context,
      transform,
      viewport,
    };

    var renderTask = page.render(renderContext);
    await renderTask.promise;

    // Clean up the page proxy to free memory.
    page.cleanup();

    return {
      width: Math.floor(viewport.width),
      height: Math.floor(viewport.height),
    };
  }

  /**
   * Compute the scale needed to fit a page width to a container width.
   *
   * @param {PDFDocumentProxy} pdfDoc - The loaded document.
   * @param {number} pageNumber       - Page number (1-based).
   * @param {number} containerWidth   - Available width in CSS pixels.
   * @returns {Promise<number>} The fit-to-width scale.
   */
  async function getFitToWidthScale(pdfDoc, pageNumber, containerWidth) {
    var page = await pdfDoc.getPage(pageNumber);
    var viewport = page.getViewport({ scale: 1.0 });
    page.cleanup();

    if (viewport.width <= 0 || containerWidth <= 0) {
      return 1.0;
    }

    // Leave a 48px padding margin.
    var usableWidth = containerWidth - 48;
    return Math.max(0.2, usableWidth / viewport.width);
  }

  /**
   * Render selectable text items from a PDF page into a container element.
   * Creates an invisible text layer overlaying the canvas so the user can
   * select text with the native browser selection.
   *
   * Requires pdf.js v3.x UMD build (pdfjsLib.renderTextLayer).
   *
   * @param {PDFDocumentProxy} pdfDoc    - The loaded pdf.js document.
   * @param {number} pageNumber          - 1-based page number.
   * @param {number} scale              - Zoom scale (must match canvas render).
   * @param {HTMLElement} container      - Container to populate with text spans.
   * @returns {Promise<void>}
   */
  async function renderTextLayer(pdfDoc, pageNumber, scale, container) {
    var pdfjsLib = globalThis.pdfjsLib;

    // Clear any previous text layer content.
    container.textContent = '';

    if (!pdfjsLib || typeof pdfjsLib.renderTextLayer !== 'function') {
      // Text layer rendering unavailable in this pdf.js build.
      return;
    }

    var page = await pdfDoc.getPage(pageNumber);
    var viewport = page.getViewport({ scale });

    var textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    // pdf.js v3.x requires --scale-factor on the container to match viewport.scale.
    textLayerDiv.style.setProperty('--scale-factor', String(scale));
    container.appendChild(textLayerDiv);

    var textContent = await page.getTextContent();

    await pdfjsLib.renderTextLayer({
      textContent,
      container: textLayerDiv,
      viewport,
      textDivs: [],
    }).promise;

    page.cleanup();
  }

  globalThis.PraPdfRenderer = {
    renderPage,
    renderTextLayer,
    getFitToWidthScale,
  };
})();
