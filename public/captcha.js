const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const outputText = document.getElementById('output-text');
const statusEl = document.getElementById('status');

// Listen for messages from the parent page (content script's iframe)
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'OCR_IMAGE') {
        console.log('[CAPTCHA OCR] Received OCR_IMAGE via postMessage');
        processCaptcha(event.data.dataUrl)
            .then(res => {
                console.log('[CAPTCHA OCR] Sending result back, text:', res.text);
                event.source.postMessage({ type: 'OCR_RESULT', success: true, text: res.text, processedImage: res.processedImage }, '*');
            })
            .catch(error => {
                console.error('[CAPTCHA OCR] Error:', error);
                event.source.postMessage({ type: 'OCR_RESULT', success: false, error: error.message }, '*');
            });
    }
});

// Also keep the chrome.runtime listener for the offscreen document approach
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'OCR_IMAGE') {
            console.log('[CAPTCHA OCR] Received OCR_IMAGE via chrome.runtime');
            processCaptcha(message.dataUrl)
                .then(res => sendResponse({ success: true, text: res.text, processedImage: res.processedImage }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        }
    });
}

// Signal that we're ready
console.log('[CAPTCHA OCR] captcha.js loaded and ready');
if (window.parent !== window) {
    window.parent.postMessage({ type: 'OCR_READY' }, '*');
}

async function processCaptcha(dataUrl) {
    return new Promise((resolve, reject) => {
        let img = new Image();
        img.onload = async () => {
            try {
                statusEl.innerText = "Processing canvas...";
                
                // Scale up 3x for better OCR accuracy
                const SCALE = 3;
                canvas.width = img.width * SCALE;
                canvas.height = img.height * SCALE;
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Fill white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Convert to pure black text on white background
                let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                    let r = data[i], g = data[i+1], b = data[i+2];
                    
                    // Calculate perceived brightness
                    let brightness = (0.299 * r) + (0.587 * g) + (0.114 * b);
                    
                    // Dark pixels (text) → pure black, everything else → pure white
                    // BSE captcha text is typically dark blue/black
                    if (brightness < 128) {
                        data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
                    } else {
                        data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
                    }
                }
                ctx.putImageData(imageData, 0, 0);

                statusEl.innerText = "Initializing Tesseract...";
                const processedDataUrl = canvas.toDataURL('image/png');
                
                // Load worker script as text and create a Blob URL.
                // This avoids importScripts CSP restrictions because
                // a Blob URL worker inherits the extension's origin.
                const workerScriptUrl = chrome.runtime.getURL('tesseract/worker.min.js');
                const corePath = chrome.runtime.getURL('tesseract/tesseract-core.wasm.js');
                const langPath = chrome.runtime.getURL('tesseract/');

                let workerPath;
                try {
                    const resp = await fetch(workerScriptUrl);
                    const workerText = await resp.text();
                    const blob = new Blob([workerText], { type: 'application/javascript' });
                    workerPath = URL.createObjectURL(blob);
                } catch (e) {
                    console.warn('[CAPTCHA OCR] Blob worker failed, falling back to direct path', e);
                    workerPath = workerScriptUrl;
                }

                console.log('[CAPTCHA OCR] Creating worker with Blob URL...');

                const worker = await Tesseract.createWorker('eng', 1, {
                    workerPath,
                    corePath,
                    langPath,
                    logger: m => {
                        console.log('[CAPTCHA OCR]', m.status, Math.round((m.progress || 0) * 100) + '%');
                        statusEl.innerText = `${m.status}: ${Math.round((m.progress || 0) * 100)}%`;
                    }
                });

                // Configure Tesseract for single-line alphanumeric captcha
                await worker.setParameters({
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                    tessedit_pageseg_mode: '7', // Single text line
                });

                console.log('[CAPTCHA OCR] Worker ready, recognizing...');
                const result = await worker.recognize(processedDataUrl);
                console.log('[CAPTCHA OCR] Raw text:', JSON.stringify(result.data.text), 'confidence:', result.data.confidence);
                console.log('[CAPTCHA OCR] Words:', JSON.stringify(result.data.words?.map(w => w.text)));
                await worker.terminate();

                // Clean up the result: keep only alphanumeric, uppercase
                const text = result.data.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || "";
                outputText.innerText = text || "(No text found)";
                statusEl.innerText = "Done: " + (text || "empty");
                resolve({ text, processedImage: processedDataUrl });
            } catch (err) {
                console.error('[CAPTCHA OCR] EXCEPTION:', err);
                statusEl.innerText = "Error: " + err.message;
                reject(err);
            }
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = dataUrl;
    });
}
