/**
 * Paper Reading Assistant — PDF Loader
 *
 * Wraps pdf.js getDocument to provide a clean async API for
 * loading PDF documents from File / ArrayBuffer inputs.
 *
 * Loaded via <script> tag in pdf-viewer.html.
 * Exposes globalThis.PraPdfLoader.
 */
(function () {
  var pdfjsLib = globalThis.pdfjsLib;

  /**
   * Load a PDF document from a File or ArrayBuffer.
   *
   * @param {File|ArrayBuffer} source - The PDF file or raw buffer.
   * @returns {Promise<PDFDocumentProxy>} Resolved with the pdf.js document proxy.
   */
  async function loadDocument(source) {
    if (!pdfjsLib) {
      throw new Error('pdf.js library is not loaded.');
    }

    var data;
    if (source instanceof File) {
      data = await source.arrayBuffer();
    } else if (source instanceof ArrayBuffer) {
      data = source;
    } else {
      throw new Error('Unsupported source type for PDF loading.');
    }

    // pdf.js transfers the underlying ArrayBuffer to the worker.
    // Pass a copy so the caller's buffer remains intact.
    var loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(data.slice(0)),
    });

    var pdfDoc = await loadingTask.promise;

    return {
      doc: pdfDoc,
      numPages: pdfDoc.numPages,
      loadingTask,
    };
  }

  /**
   * Clean up a loaded document, releasing pdf.js resources.
   *
   * @param {object} handle - The handle returned by loadDocument.
   */
  function destroyDocument(handle) {
    if (handle && handle.loadingTask) {
      handle.loadingTask.destroy();
    }
  }

  globalThis.PraPdfLoader = {
    loadDocument,
    destroyDocument,
  };
})();
