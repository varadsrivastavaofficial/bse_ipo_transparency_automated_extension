import { db } from './utils';

chrome.runtime.onInstalled.addListener(() => {
  db.setWorkflowState({ isRunning: false, targetIpos: [], ipoIndex: 0, panIndex: 0, status: 'Idle' });
});

// Optionally open dashboard when clicking extension icon
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

let creating: Promise<void> | null = null; // A global promise to avoid concurrency issues

async function setupOffscreenDocument(path: string) {
  // Check if an offscreen document is already open
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: 'To run Tesseract.js OCR in a DOM environment'
    });
    await creating;
    creating = null;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // IMPORTANT: Ignore messages that we forward to the offscreen document.
  // chrome.runtime.sendMessage broadcasts to ALL listeners in the extension,
  // including this background script. Without this guard, the background
  // script would consume its own forwarded message and never let the
  // offscreen document respond.
  if (message.type === 'OCR_IMAGE_FOR_OFFSCREEN') {
    return false; // Not handled here — let the offscreen document handle it
  }

  if (message.type === 'PROCESS_CAPTCHA') {
    console.log('[BG] Received PROCESS_CAPTCHA, dataUrl length:', message.dataUrl?.length);
    (async () => {
      try {
        await setupOffscreenDocument('captcha.html');
        console.log('[BG] Offscreen document ready, waiting 2s for Tesseract init...');
        // Wait for the offscreen document to fully initialize Tesseract WASM
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('[BG] Forwarding OCR_IMAGE to offscreen document...');

        // Forward the message to the offscreen document via chrome.runtime.sendMessage.
        // The offscreen document's listener picks up OCR_IMAGE_FOR_OFFSCREEN,
        // while the guard above prevents this background script from re-handling it.
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'OCR_IMAGE_FOR_OFFSCREEN',
            dataUrl: message.dataUrl
          });
          console.log('[BG] Got response from offscreen:', JSON.stringify(response));
          sendResponse(response);
        } catch (msgErr: any) {
          console.warn('[BG] Offscreen communication error:', msgErr?.message || msgErr);
          sendResponse({ success: false, error: msgErr?.message || 'Could not communicate with offscreen OCR' });
        }
      } catch (err: any) {
        console.error('[BG] Error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep the message channel open for async response
  }
});
