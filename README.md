# BSE IPO Transparency Automated Checker Extension

An automated browser extension that streamlines checking IPO allotment status on the BSE India website. It automatically handles fetching available IPOs, filling in PAN numbers, solving the visual captchas, and executing batch checks across multiple PANs.

## Features
- **Automated Captcha Solving** (via multi-layered extraction & OCR pipeline with Otsu's thresholding)
- **Multi-PAN Management** (check multiple accounts automatically)
- **Secure Local Storage** (PAN data is encrypted locally using AES-256)
- **Auto-Submissions & Error Handling** (including auto-refreshing captchas and scrolling to the execution status panel)
- **Sleek, Modern UI** with glassmorphism, special hover effects, and an interactive **WebGL Retro Dither background** that tracks mouse movements.
- **InvestorGain Integration** for quick access to Live GMP data.

---

## 🔍 Special Focus: Captcha Solving Automation

The most complex and powerful feature of this extension is the automated captcha solver. BSE implements a rotating, canvas-rendered visual captcha with noise, making basic text extraction impossible. Our extension uses a robust strategy to guarantee success and bypass aggressive Content Security Policies (CSP).

### 1. Canvas Context Interception (Tier 1 - Primary)
Rather than trying to read the final image, we intercept the captcha at the moment it is drawn. 
- A specialized file-based script (`captcha-interceptor.js`) is injected at `document_start`.
- It hooks into the browser's native `CanvasRenderingContext2D.fillText` and `CanvasRenderingContext2D.strokeText` prototypes.
- When BSE's JavaScript attempts to draw the captcha characters onto the canvas, our hook intercepts the raw text string, instantly filling the form before the image even finishes rendering.
- **Success Rate:** Near 100% (Instantaneous)

### 2. Offscreen Document OCR (Tier 2 - Fallback)
If the interception misses the draw (e.g., due to race conditions or framework obfuscation), the extension falls back to Optical Character Recognition (OCR).
- Because standard WebAssembly (WASM) is blocked by the target page's CSP, we capture the raw `dataUrl` of the captcha canvas.
- This image is sent via `chrome.runtime.sendMessage` to our Background Service Worker.
- The Service Worker spawns an **Offscreen Document** (`captcha.html`), which executes within the extension's own privileged environment, safely bypassing the website's CSP.
- The image undergoes aggressive preprocessing: **4x upscaling, white padding, Otsu's adaptive thresholding for binarization, and morphological erosion** to remove isolated noise pixels before being fed to Tesseract.js.
- **Global Worker Caching:** The Tesseract worker is instantiated once as a Blob URL globally within the offscreen document and reused across all subsequent captcha requests to prevent memory leaks and crashes.
- **Success Rate:** High accuracy on heavily noised captchas.

### 3. Automated Retry Loop
If OCR yields empty or incorrect results, the extension automatically clicks the captcha refresh button and triggers a retry loop (up to 3 attempts) before falling back to manual input.

### 4. Bypassing Framework Input Protection
BSE uses strict ASP.NET/AngularJS event listeners that clear input fields set programmatically. The extension dispatches a full, realistic sequence of keyboard events (`keydown`, `keypress`, `input`, `keyup`, `change`) to trick the framework into accepting the injected captcha value.

---

## Technical Stack
- **Framework:** React + Vite
- **Styling:** Tailwind CSS (Custom Glassmorphism + Special FX + Arial Typography)
- **Graphics:** Three.js + React Three Fiber + Postprocessing (for the WebGL Dither effect)
- **Security:** CryptoJS (AES-256 for local storage encryption)
- **Background Processes:** Chrome Manifest V3 (Service Workers, Offscreen Documents)
- **OCR Engine:** Tesseract.js (Alphanumeric Whitelist, PSM 7, Blob Worker instantiation)

## Building the Extension
To compile the extension from source:
```bash
npm install
npm run build
```
Once built, load the generated `dist` folder into Chrome/Brave via `chrome://extensions` using "Load unpacked".
