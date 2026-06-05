describe('Content extraction message wiring', () => {
  test('EXTRACT_TWEET_DATA returns data without showing the overlay', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/content/index'),
      'utf8'
    );

    const messageIndex = source.indexOf('message.type === MessageType.EXTRACT_TWEET_DATA');
    expect(messageIndex).toBeGreaterThan(-1);

    const blockEnd = source.indexOf('const handler = this.activeAdapter', messageIndex);
    const extractBlock = source.substring(messageIndex, blockEnd);

    expect(extractBlock).toContain('this.extractLatestData(true)');
    expect(extractBlock).toContain('sendResponse({ success: true, data })');
    expect(extractBlock).not.toContain('this.showOverlay');
  });
});
