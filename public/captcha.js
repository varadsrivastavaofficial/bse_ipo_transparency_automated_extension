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
        if (message.type === 'OCR_IMAGE_FOR_OFFSCREEN') {
            console.log('[CAPTCHA OCR] Received OCR_IMAGE_FOR_OFFSCREEN via chrome.runtime');
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

let globalWorker = null;

async function processCaptcha(dataUrl) {
    return new Promise((resolve, reject) => {
        let img = new Image();
        img.onload = async () => {
            try {
                statusEl.innerText = "Processing canvas...";
                
                // Scale up 4x and add white padding for better OCR accuracy
                const SCALE = 4;
                const PADDING = 20;
                canvas.width = (img.width * SCALE) + (PADDING * 2);
                canvas.height = (img.height * SCALE) + (PADDING * 2);
                ctx.imageSmoothingEnabled = false;
                
                // Fill white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, PADDING, PADDING, img.width * SCALE, img.height * SCALE);

                // Convert to pure black text on white background using Otsu's method
                let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let data = imageData.data;
                
                // 1. Convert to grayscale and build histogram
                const hist = new Array(256).fill(0);
                const grays = new Uint8Array(data.length / 4);
                for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                    let r = data[i], g = data[i+1], b = data[i+2];
                    let gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                    grays[j] = gray;
                    hist[gray]++;
                }
                
                // 2. Otsu's threshold calculation
                let total = grays.length;
                let sum = 0;
                for (let i = 0; i < 256; i++) sum += i * hist[i];
                let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 0;
                for (let i = 0; i < 256; i++) {
                    wB += hist[i];
                    if (wB === 0) continue;
                    wF = total - wB;
                    if (wF === 0) break;
                    sumB += i * hist[i];
                    let mB = sumB / wB;
                    let mF = (sum - sumB) / wF;
                    let varBetween = wB * wF * (mB - mF) * (mB - mF);
                    if (varBetween > varMax) {
                        varMax = varBetween;
                        threshold = i;
                    }
                }
                
                // 3. Binarize
                for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                    let val = grays[j] < threshold ? 0 : 255;
                    data[i] = val; data[i+1] = val; data[i+2] = val; data[i+3] = 255;
                }
                
                // 4. Morphological erosion (remove isolated noise pixels)
                const output = new Uint8ClampedArray(data);
                const width = canvas.width, height = canvas.height;
                const getPixel = (x, y) => {
                    if (x < 0 || x >= width || y < 0 || y >= height) return 255;
                    return data[(y * width + x) * 4];
                };
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const idx = (y * width + x) * 4;
                        if (data[idx] === 0) {
                            let neighbors = 0;
                            if (getPixel(x-1, y) === 0) neighbors++;
                            if (getPixel(x+1, y) === 0) neighbors++;
                            if (getPixel(x, y-1) === 0) neighbors++;
                            if (getPixel(x, y+1) === 0) neighbors++;
                            if (getPixel(x-1, y-1) === 0) neighbors++;
                            if (getPixel(x+1, y+1) === 0) neighbors++;
                            if (getPixel(x-1, y+1) === 0) neighbors++;
                            if (getPixel(x+1, y-1) === 0) neighbors++;
                            // If less than 2 black neighbors, it's noise
                            if (neighbors < 2) {
                                output[idx] = 255; output[idx+1] = 255; output[idx+2] = 255;
                            }
                        }
                    }
                }
                for (let i = 0; i < output.length; i++) data[i] = output[i];
                
                ctx.putImageData(imageData, 0, 0);

                statusEl.innerText = "Initializing Tesseract...";
                const processedDataUrl = canvas.toDataURL('image/png');
                
                if (!globalWorker) {
                    console.log('[CAPTCHA OCR] Creating global worker...');
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

                    globalWorker = await Tesseract.createWorker('eng', 1, {
                        workerPath,
                        corePath,
                        langPath,
                        logger: m => {
                            console.log('[CAPTCHA OCR]', m.status, Math.round((m.progress || 0) * 100) + '%');
                            statusEl.innerText = `${m.status}: ${Math.round((m.progress || 0) * 100)}%`;
                        }
                    });

                    await globalWorker.setParameters({
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                        tessedit_pageseg_mode: '7',
                    });
                }

                console.log('[CAPTCHA OCR] Worker ready, recognizing...');
                const result = await globalWorker.recognize(processedDataUrl);
                console.log('[CAPTCHA OCR] Raw text:', JSON.stringify(result.data.text), 'confidence:', result.data.confidence);
                
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
