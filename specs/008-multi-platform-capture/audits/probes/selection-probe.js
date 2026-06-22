(() => {
  const selection = window.getSelection();
  const anchor = selection && selection.anchorNode;
  const anchorElement = anchor ? (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement) : null;
  const container = anchorElement ? anchorElement.closest([
    'article',
    '[role="article"]',
    '[data-testid="tweet"]',
    '[data-testid="postThreadItem"]',
    '[data-testid*="post" i]',
    '[data-testid*="note" i]',
    '[data-testid="twitterArticleReadView"]',
    '[data-testid="longformRichTextComponent"]'
  ].join(',')) : null;
  const selectedText = selection ? selection.toString().replace(/\s+/g, ' ').trim() : '';
  const out = {
    meta: {
      probe: 'selection',
      version: '2026-06-21',
      url: location.href,
      uiLang: document.documentElement.getAttribute('lang') || null
    },
    hasSelection: !!selection,
    isCollapsed: selection ? selection.isCollapsed : null,
    selectedText: selectedText.slice(0, 200),
    anchorElement: anchorElement ? {
      tag: anchorElement.tagName.toLowerCase(),
      nearestTestId: anchorElement.closest('[data-testid]') ? anchorElement.closest('[data-testid]').getAttribute('data-testid') : null,
      role: anchorElement.getAttribute('role')
    } : null,
    withinPostContent: !!container,
    matchedContainer: container ? {
      tag: container.tagName.toLowerCase(),
      testId: container.getAttribute('data-testid'),
      role: container.getAttribute('role')
    } : null,
    wouldBeHonored: !!(selection && !selection.isCollapsed && selectedText && container)
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();

