/**
 * Tests the toolbar click recovery path for already-open tweet tabs.
 *
 * Bug: after extension reload/install or when the unpacked extension path changed,
 * tweet tabs can exist without a running content script. The action click handler
 * must inject content/index.js and retry SHOW_OVERLAY instead of only logging
 * "Receiving end does not exist".
 */

describe('Toolbar click content-script recovery - structural verification', () => {
  test('action click handler injects content script and retries missing receivers', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/background/service-worker'),
      'utf8'
    );

    expect(source).toContain("const CONTENT_SCRIPT_FILE = 'content/index.js'");
    expect(source).toContain('function isMissingContentScriptError');
    expect(source).toContain('async function showOverlayInTab');

    const helperIndex = source.indexOf('async function showOverlayInTab');
    expect(helperIndex).toBeGreaterThan(-1);

    const nextFunctionIndex = source.indexOf('\nfunction ', helperIndex + 1);
    const helperBlock = source.substring(
      helperIndex,
      nextFunctionIndex === -1 ? source.length : nextFunctionIndex
    );

    expect(helperBlock).toContain('chrome.tabs.sendMessage');
    expect(helperBlock).toContain('chrome.scripting.executeScript');
    expect(helperBlock).toContain('files: [CONTENT_SCRIPT_FILE]');
    expect(helperBlock).toContain('MessageType.SHOW_OVERLAY');

    const clickIndex = source.indexOf('chrome.action.onClicked.addListener');
    expect(clickIndex).toBeGreaterThan(-1);

    const clickBlock = source.substring(clickIndex, source.indexOf('// Handle messages', clickIndex));
    expect(clickBlock).toContain('await showOverlayInTab(tab)');
  });
});
