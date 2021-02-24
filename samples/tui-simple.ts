function _removeCodeblockFirstLine(node: Node) {
    const sq = this.wwe.getEditor();
    const preNode = node.nodeName === 'PRE' ? node : node.parentNode;
    const codeContent = preNode.textContent.replace("FIND_ZWS_RX", '');

    sq.modifyBlocks(() => {
      const newFrag = sq.getDocument().createDocumentFragment();
      const strArray = codeContent.split('\n');

      const firstDiv = document.createElement('div');
      const firstLine = strArray.shift();

      firstDiv.innerHTML = `${sanitizeHtmlCode(firstLine)}<br>`;
      newFrag.appendChild(firstDiv);

      if (strArray.length) {
        const newPreNode = preNode.cloneNode();

        newPreNode.textContent = strArray.join('\n');
        newFrag.appendChild(newPreNode);
      }

      return newFrag;
    });
}

const tagEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  };

function sanitizeHtmlCode(code: string) {
    return code ? code.replace(/[<>&]/g, tag => tagEntities[tag] || tag) : '';
}