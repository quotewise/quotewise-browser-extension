export function selectTextWithin(root: Node, text: string): void {
  const found = findTextPosition(root, text);
  if (!found) {
    throw new Error(`Could not select "${text}"`);
  }
  const range = ownerDocumentOf(root).createRange();
  range.setStart(found.node, found.offset);
  range.setEnd(found.node, found.offset + text.length);
  applyRange(range);
}

export function selectContents(element: Element): void {
  const range = ownerDocumentOf(element).createRange();
  range.selectNodeContents(element);
  applyRange(range);
}

export function selectBetween(
  start: Text,
  startOffset: number,
  end: Text,
  endOffset: number,
): void {
  const range = ownerDocumentOf(start).createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  applyRange(range);
}

export function textNodesWithin(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = ownerDocumentOf(root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function findTextPosition(root: Node, text: string): { node: Text; offset: number } | null {
  for (const node of textNodesWithin(root)) {
    const offset = node.data.indexOf(text);
    if (offset >= 0) return { node, offset };
  }
  return null;
}

function applyRange(range: Range): void {
  const selection = range.startContainer.ownerDocument?.defaultView?.getSelection()
    ?? window.getSelection();
  if (!selection) throw new Error('window.getSelection() returned null');
  selection.removeAllRanges();
  selection.addRange(range);
}

function ownerDocumentOf(node: Node): Document {
  if (node.nodeType === Node.DOCUMENT_NODE) return node as Document;
  const owner = node.ownerDocument;
  if (!owner) throw new Error('Node has no document');
  return owner;
}
