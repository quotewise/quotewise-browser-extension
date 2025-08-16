// Minimal test service worker
console.log('Test service worker starting...');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Test extension installed:', details.reason);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Test message received:', message.type);
  sendResponse({ success: true, test: true });
  return true;
});

console.log('Test service worker initialized');