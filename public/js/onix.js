/**
 * ONIX Generator — Client-side ONIX utilities
 * XML syntax highlighting for preview.
 * XML generation is done server-side in server.js.
 */

// Syntax highlight XML in preview panel
function highlightXml(xml) {
    return xml
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/(&lt;\/?)([\w:]+)/g, '$1<span class="xml-tag">$2</span>')
        .replace(/([\w-]+)(=)/g, '<span class="xml-attr">$1</span>$2')
        .replace(/(".*?")/g, '<span class="xml-value">$1</span>')
        .replace(/(&lt;!--.*?--&gt;)/gs, '<span class="xml-comment">$1</span>');
}

/**
 * Set XML content in the preview panel with syntax highlighting.
 * Stores raw XML in a data attribute for copy/download.
 */
function setXmlPreview(xml) {
    const output = document.getElementById('xml-output');
    if (!output) return;
    output.dataset.rawXml = xml;
    output.innerHTML = highlightXml(xml);
}

/**
 * Get raw XML from preview panel (for copy/download).
 */
function getRawXml() {
    const output = document.getElementById('xml-output');
    return output ? (output.dataset.rawXml || output.textContent) : '';
}
