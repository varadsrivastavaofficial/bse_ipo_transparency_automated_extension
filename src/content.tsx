import { createRoot } from 'react-dom/client';
import { SidebarApp } from './sidebar';
import './index.css';
import { db } from './utils';

// EARLY INJECTION: Inject captcha-interceptor.js into the PAGE context immediately
// This MUST happen before BSE draws the captcha on canvas, so we hook fillText/strokeText early
// Using file-based script (not inline) to comply with BSE's CSP which blocks inline scripts
// but allows scripts from the extension's origin
(function injectInterceptorEarly() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('captcha-interceptor.js');
  script.onload = () => script.remove(); // Clean up after execution
  (document.head || document.documentElement).appendChild(script);
})();


const Selectors = {
  equityRadio: 'input[id*="chkType_0"], input[value="Equity"], input[type="radio"]:first-of-type',
  issueDropdown: 'select',
  panInput: 'input[id*="txtPanNo"], input[formcontrolname="panNumber"], input[placeholder*="PAN"]',
  resultTable: 'table[id*="gvData"], div[id*="divData"] table'
};

// Robustly find the submit button, avoiding generic buttons like "Skip to main content"
const getSubmitButton = (): HTMLElement | null => {
    // 1. Try specific attributes first
    const specificSelector = 'input[id*="btnSubmit" i], input[name*="btnSubmit" i], input[value="Submit" i], button[id*="btnSubmit" i], button[type="submit"]';
    let btn = document.querySelector<HTMLElement>(specificSelector);
    if (btn) return btn;
    
    // 2. Fallback to finding by visible text (most reliable for generic frameworks)
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"]'));
    return buttons.find(b => {
        const text = (b.textContent || (b as HTMLInputElement).value || '').toLowerCase().trim();
        return text === 'submit';
    }) || null;
};

const processWorkflowStep = async () => {
  const state = await db.getWorkflowState();
  if (!state.isRunning || state.targetIpos.length === 0) return;

  try {
    const currentIpo = state.targetIpos[state.ipoIndex];
    if (!currentIpo) {
      await db.setWorkflowState({ isRunning: false, status: 'Completed all IPOs!' });
      return;
    }

    // Check if the actual result tables are present by looking for exact headers
    const hasSuccess = document.querySelector(Selectors.resultTable) !== null || 
                       Array.from(document.querySelectorAll<HTMLElement>('td, th')).some(el => {
                          const t = el.innerText.toLowerCase().trim();
                          return t === 'bid id' || t === 'no of shares/debentures' || t === 'biding details@';
                       });
                       
    // The error text must be visible in a span/div (not just anywhere in the page)
    const hasNoRecord = Array.from(document.querySelectorAll('span, div, b, strong')).some(el => {
       if (!el.textContent) return false;
       const t = el.textContent.toLowerCase();
       // Make sure we only match the actual error message, not random text
       if (t.includes('record not found') || t.includes('no applications found') || t.includes('not bided')) {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
       }
       return false;
    });

    const hasInvalidCaptcha = Array.from(document.querySelectorAll('span, div, b, strong')).some(el => {
       if (!el.textContent) return false;
       const t = el.textContent.toLowerCase();
       if (t.includes('invalid captcha') || t.includes('captcha is invalid') || t.includes('incorrect captcha') || t.includes('captcha does not match')) {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
       }
       return false;
    });

    if (state.isAwaitingResult) {
      if (hasInvalidCaptcha) {
        await db.setWorkflowState({ isAwaitingResult: false, status: 'Invalid Captcha! Retrying...' });
        window.location.href = window.location.origin + window.location.pathname + '?r=' + Date.now();
        return;
      }

      // Prioritize positive result over negative, as error text might be hidden in DOM
      if (hasSuccess) {
        let appNo = '';
        let issueName = '';
        let sharesAllotted = '0';
        let price = '0';
        let investorName = '';

        const tables = document.querySelectorAll<HTMLElement>('table');
        tables.forEach(table => {
            const text = table.innerText.toLowerCase();
            if (text.includes('issue name')) {
                Array.from(table.querySelectorAll<HTMLElement>('tr')).forEach(r => {
                    const tds = r.querySelectorAll<HTMLElement>('td');
                    if (r.innerText.toLowerCase().includes('issue name') && tds.length >= 2) issueName = tds[1].innerText.trim();
                    if (r.innerText.toLowerCase().includes('application no') && tds.length >= 2) appNo = tds[1].innerText.trim();
                });
            }
            if (text.includes('no of shares')) {
               const headerCells = Array.from(table.querySelectorAll('tr')[0]?.querySelectorAll<HTMLElement>('th, td') || []).map(h => h.innerText.toLowerCase());
               if (!headerCells.some(h => h.includes('bid id'))) {
                   const dataRows = Array.from(table.querySelectorAll('tr')).slice(1);
                   if (dataRows.length > 0) {
                      const cells = Array.from(dataRows[0].querySelectorAll<HTMLElement>('td')).map(c => c.innerText.trim());
                      const sharesIdx = headerCells.findIndex(h => h.includes('no of shares'));
                      const priceIdx = headerCells.findIndex(h => h.includes('price'));
                      if (sharesIdx >= 0 && cells[sharesIdx]) sharesAllotted = cells[sharesIdx];
                      if (priceIdx >= 0 && cells[priceIdx]) price = cells[priceIdx];
                   }
               }
            }
        });

        // Ensure we properly default empty values to 0
        if (!sharesAllotted || sharesAllotted.trim() === '') sharesAllotted = '0';
        const allottedNum = parseInt(sharesAllotted.replace(/[^0-9]/g, '')) || 0;
        
        const pans = await db.getPans();
        const currentPan = pans[state.panIndex];
        if (currentPan) {
          await db.addHistoryEntry({ id: crypto.randomUUID(), ipoName: issueName || currentIpo.name, investorName: investorName || currentPan.name, panMasked: currentPan.pan.substring(0,2) + '******' + currentPan.pan.substring(8), applicationNumber: appNo, registrarName: "BSE", allotmentStatus: allottedNum > 0 ? "Allotted" : "Not Allotted", sharesAllotted, issuePrice: price, verificationTimestamp: Date.now() });
        }
        
        await db.setWorkflowState({ isAwaitingResult: false });
        advanceQueue(state, pans.length);
        return;
      }

      // Check for negative result
      if (hasNoRecord) {
        const pans = await db.getPans();
        const currentPan = pans[state.panIndex];
        if (currentPan) {
          await db.addHistoryEntry({ id: crypto.randomUUID(), ipoName: currentIpo.name, investorName: currentPan.name, panMasked: currentPan.pan.substring(0,2) + '******' + currentPan.pan.substring(8), applicationNumber: "", registrarName: "BSE", allotmentStatus: "Not Applied", sharesAllotted: "0", issuePrice: "0", verificationTimestamp: Date.now() });
        }
        await db.setWorkflowState({ isAwaitingResult: false });
        advanceQueue(state, pans.length);
        return;
      }
    }

    // No result found, fill the form
    
    // CRITICAL: Clean up any "ghost" results from previous searches in the DOM
    // This prevents the new check from instantly tripping on old hidden error messages
    const oldTables = document.querySelectorAll(Selectors.resultTable);
    oldTables.forEach(t => t.remove());
    const oldErrors = document.querySelectorAll('span, div, b, strong');
    oldErrors.forEach(el => {
        if (el.textContent) {
            const t = el.textContent.toLowerCase();
            if (t.includes('record not found') || t.includes('no applications found') || t.includes('not bided')) {
                el.remove();
            }
        }
    });

    const pans = await db.getPans();
    if (state.panIndex >= pans.length) return;
    
    const currentPan = pans[state.panIndex];
    await db.setWorkflowState({ status: `Checking ${currentIpo.name.substring(0, 15)}... (${currentPan.name}). Please enter CAPTCHA and Submit.` });

    const equityRadio = document.querySelector<HTMLInputElement>(Selectors.equityRadio);
    if (equityRadio && !equityRadio.checked) equityRadio.click();

    // BSE page usually requires selecting "PAN" radio instead of Application Number
    // Do this immediately so AJAX postbacks finish before the timeout sets the values
    const panRadio = document.querySelector<HTMLInputElement>('input[type="radio"][value*="PAN" i], input[type="radio"][id*="pan" i]');
    if (panRadio && !panRadio.checked) {
        panRadio.click();
        panRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Disable CAPTCHA temporarily so user doesn't type before the AJAX refresh completes
    const tempCaptcha = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]')).find(i => 
        (i.placeholder && i.placeholder.toLowerCase().includes('captcha')) || 
        i.id.toLowerCase().includes('captcha') || 
        i.name.toLowerCase().includes('captcha')
    );
    if (tempCaptcha) {
        tempCaptcha.disabled = true;
        tempCaptcha.placeholder = "Loading form...";
    }

    setTimeout(async () => {

      const setNativeValue = (element: HTMLInputElement, value: string) => {
          element.focus();
          element.value = value;
          const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          const prototype = Object.getPrototypeOf(element);
          const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (valueSetter && valueSetter !== prototypeValueSetter) prototypeValueSetter?.call(element, value);
          else valueSetter?.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          element.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select')).filter(s => s.getBoundingClientRect().width > 0);
      const issueDropdown = selects.find(s => s.options.length > 1);
      if (issueDropdown) { 
          issueDropdown.focus();
          issueDropdown.value = currentIpo.id; 
          issueDropdown.dispatchEvent(new Event('input', { bubbles: true }));
          issueDropdown.dispatchEvent(new Event('change', { bubbles: true }));
          issueDropdown.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
      const visibleInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(i => {
          if (['hidden', 'radio', 'checkbox', 'submit', 'button'].includes(i.type)) return false;
          const style = window.getComputedStyle(i);
          return style.display !== 'none' && style.visibility !== 'hidden' && i.getBoundingClientRect().width > 0;
      });
      
      // Find ALL inputs that might be the PAN input
      const panInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(i => {
          if (['hidden', 'radio', 'checkbox', 'submit', 'button'].includes(i.type)) return false;
          const id = i.id.toLowerCase();
          const name = i.name.toLowerCase();
          const placeholder = (i.placeholder || '').toLowerCase();
          const container = i.closest('tr') || i.closest('div.form-group') || i.parentElement;
          const containerText = container ? container.innerText.toLowerCase() : '';
          // Only include if it explicitly mentions PAN in attributes or adjacent text
          return id.includes('pan') || name.includes('pan') || placeholder.includes('pan') || containerText.includes('pan');
      });

      if (panInputs.length > 0) {
          // Fill all of them (covers mobile/desktop duplicate forms)
          panInputs.forEach(input => setNativeValue(input, currentPan.pan));
      } else if (visibleInputs.length >= 2) {
          // Ultimate fallback: assume the second visible input on the screen is the PAN
          setNativeValue(visibleInputs[1], currentPan.pan);
      } else {
          console.error("Could not locate PAN input field!");
      }

      // Automatically focus the Captcha input to make it easy for the user
      const captchaInput = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]')).find(i => 
          (i.placeholder && i.placeholder.toLowerCase().includes('captcha')) || 
          i.id.toLowerCase().includes('captcha') || 
          i.name.toLowerCase().includes('captcha')
      );      const handleSubmit = async () => {
          await db.setWorkflowState({ isAwaitingResult: true, status: 'Waiting 2 seconds for result...' });
          
          // Wait exactly 2 seconds before recording the results, as requested
          setTimeout(() => {
              processWorkflowStep();
          }, 2000);
      };

      // Hook the submit button so we know when the user submits manually
      const submitBtn = getSubmitButton();
      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          // Only trigger if we aren't already awaiting to prevent duplicate intervals
          db.getWorkflowState().then(s => {
              if (!s.isAwaitingResult) handleSubmit();
          });
        });
      }

      if (captchaInput) {
          captchaInput.disabled = true;
          captchaInput.placeholder = "Solving captcha...";
          await db.setWorkflowState({ status: 'Solving Captcha...' });

          // STRATEGY 1: Check if the early-injected interceptor already captured the captcha text
          // The interceptor was loaded at document_start and hooks fillText/strokeText
          // It fires '__bse_captcha_intercepted' events when it finds captcha text
          const interceptedText = await new Promise<string>((resolve) => {
              // Re-trigger the interceptor to check for already-captured text
              const script = document.createElement('script');
              script.src = chrome.runtime.getURL('captcha-interceptor.js');
              script.onload = () => script.remove();
              
              const onIntercepted = (e: any) => {
                  document.removeEventListener('__bse_captcha_intercepted', onIntercepted);
                  resolve(e.detail || '');
              };
              document.addEventListener('__bse_captcha_intercepted', onIntercepted);
              (document.head || document.documentElement).appendChild(script);
              
              // Timeout after 2 seconds if no response
              setTimeout(() => {
                  document.removeEventListener('__bse_captcha_intercepted', onIntercepted);
                  resolve('');
              }, 2000);
          });
          
          if (interceptedText && interceptedText.length >= 4) {
              console.log('[BSE-EXT] CAPTCHA INTERCEPTED directly from page context:', interceptedText);
              captchaInput.disabled = false;
              setNativeValue(captchaInput, interceptedText.toUpperCase());
              await db.setWorkflowState({ status: 'Captcha solved via interception! Submitting...' });
              
              // Auto-submit with a small delay to ensure Angular has bound its handlers
              setTimeout(async () => {
                  const btn = getSubmitButton();
                  console.log('[BSE-EXT] Auto-submit: btn found?', !!btn, btn?.tagName, btn?.id, btn?.textContent?.trim());
                  if (btn) {
                      const s = await db.getWorkflowState();
                      console.log('[BSE-EXT] Auto-submit: isAwaitingResult?', s.isAwaitingResult);
                      if (!s.isAwaitingResult) {
                          await handleSubmit();
                          btn.click();
                          console.log('[BSE-EXT] Auto-submit: clicked!');
                      }
                  } else {
                      console.error('[BSE-EXT] Auto-submit: Submit button NOT found!');
                  }
              }, 500);
              return; // Done! No OCR needed
          }
          
          console.log('[BSE-EXT] Canvas interception failed, falling back to OCR...');
          await db.setWorkflowState({ status: 'Extracting Captcha for OCR...' });

          // Wait 2 seconds for the captcha canvas/image to fully render
          setTimeout(async () => {
              const captchaRect = captchaInput.getBoundingClientRect();
              
              // Find the captcha source: canvas or img
              let captchaCanvas = Array.from(document.querySelectorAll('canvas')).find(c => 
                  (c.getAttribute('aria-label') || '').toLowerCase().includes('captcha')
              );
              
              // Also try to find canvas near the captcha input if aria-label search fails
              if (!captchaCanvas) {
                  captchaCanvas = Array.from(document.querySelectorAll('canvas')).find(c => {
                      const r = c.getBoundingClientRect();
                      return r.width > 40 && r.height > 15 && 
                             Math.abs(r.top - captchaRect.top) < 200 &&
                             Math.abs(r.left - captchaRect.left) < 400;
                  });
              }
              
              let dataUrl = '';
              
              if (captchaCanvas) {
                  // Send the RAW canvas image — let the OCR processor handle preprocessing
                  const cvs = document.createElement('canvas');
                  cvs.width = captchaCanvas.width;
                  cvs.height = captchaCanvas.height;
                  const ctx = cvs.getContext('2d', { willReadFrequently: true });
                  
                  if (ctx) {
                      ctx.fillStyle = '#FFFFFF';
                      ctx.fillRect(0, 0, cvs.width, cvs.height);
                      ctx.drawImage(captchaCanvas, 0, 0);
                      dataUrl = cvs.toDataURL('image/png');
                  }
              } else {
                  // Fallback: find <img> near the captcha input
                  let captchaImg: HTMLImageElement | null = null;
                  let minDistance = Infinity;
                  
                  for (const img of Array.from(document.querySelectorAll('img'))) {
                      const r = img.getBoundingClientRect();
                      if (r.width > 50 && r.width < 350 && r.height > 20 && r.height < 150) {
                          const dist = Math.abs(captchaRect.top - r.bottom);
                          if (dist < minDistance) {
                              minDistance = dist;
                              captchaImg = img;
                          }
                      }
                  }
                  
                  if (captchaImg) {
                      const cvs = document.createElement('canvas');
                      cvs.width = captchaImg.naturalWidth || captchaImg.width || 100;
                      cvs.height = captchaImg.naturalHeight || captchaImg.height || 50;
                      const ctx = cvs.getContext('2d', { willReadFrequently: true });
                      if (ctx) {
                          ctx.fillStyle = '#FFFFFF';
                          ctx.fillRect(0, 0, cvs.width, cvs.height);
                          ctx.drawImage(captchaImg, 0, 0);
                          dataUrl = cvs.toDataURL('image/png');
                      }
                  }
              }
              
              if (!dataUrl) {
                  await db.setWorkflowState({ status: 'Captcha image not found. Manual input required.' });
                  captchaInput.disabled = false;
                  captchaInput.placeholder = "Enter Captcha";
                  return;
              }
              
              console.log('[BSE-EXT] Captcha image captured, dataUrl length:', dataUrl.length);
              
              // VISUAL DEBUG: Show the captured captcha on the page
              const debugImg = document.createElement('img');
              debugImg.src = dataUrl;
              debugImg.style.border = '3px solid red';
              debugImg.style.marginTop = '10px';
              debugImg.style.width = '100px';
              debugImg.style.height = '50px';
              debugImg.style.display = 'block';
              if (captchaInput.parentElement) {
                  captchaInput.parentElement.appendChild(debugImg);
              }
              
              await db.setWorkflowState({ status: 'Running OCR...' });
              
              // STRATEGY 2: Use background service worker → offscreen document (most reliable for MV3)
              let ocrResult: any = null;
              
              try {
                  console.log('[BSE-EXT] Trying background/offscreen OCR approach...');
                  ocrResult = await new Promise((resolve, reject) => {
                      const timeout = setTimeout(() => reject(new Error('Background OCR timeout')), 45000);
                      chrome.runtime.sendMessage(
                          { type: 'PROCESS_CAPTCHA', dataUrl },
                          (response) => {
                              clearTimeout(timeout);
                              if (chrome.runtime.lastError) {
                                  console.warn('[BSE-EXT] Background OCR error:', chrome.runtime.lastError.message);
                                  reject(new Error(chrome.runtime.lastError.message || 'Runtime error'));
                              } else {
                                  resolve(response);
                              }
                          }
                      );
                  });
                  console.log('[BSE-EXT] Background OCR response:', JSON.stringify(ocrResult));
              } catch (bgErr: any) {
                  console.warn('[BSE-EXT] Background OCR failed:', bgErr.message, '— trying iframe fallback...');
              }
              
              // STRATEGY 3: Iframe fallback if background approach failed
              if (!ocrResult || !ocrResult.success || !ocrResult.text) {
                  try {
                      console.log('[BSE-EXT] Trying iframe OCR approach...');
                      const iframeUrl = chrome.runtime.getURL('captcha.html');
                      
                      ocrResult = await new Promise((resolve, reject) => {
                          const iframe = document.createElement('iframe');
                          iframe.src = iframeUrl;
                          iframe.style.display = 'none';
                          iframe.style.width = '0';
                          iframe.style.height = '0';
                          document.body.appendChild(iframe);
                          
                          const timeout = setTimeout(() => {
                              cleanup();
                              reject(new Error('Iframe OCR timeout after 45s'));
                          }, 45000);
                          
                          const cleanup = () => {
                              clearTimeout(timeout);
                              window.removeEventListener('message', onMessage);
                              try { document.body.removeChild(iframe); } catch(e) {}
                          };
                          
                          const onMessage = (event: MessageEvent) => {
                              if (event.data?.type === 'OCR_READY') {
                                  console.log('[BSE-EXT] OCR iframe ready, sending image...');
                                  iframe.contentWindow?.postMessage({ type: 'OCR_IMAGE', dataUrl }, '*');
                              }
                              if (event.data?.type === 'OCR_RESULT') {
                                  console.log('[BSE-EXT] Iframe OCR result:', JSON.stringify(event.data));
                                  cleanup();
                                  resolve(event.data);
                              }
                          };
                          
                          window.addEventListener('message', onMessage);
                      });
                  } catch (iframeErr: any) {
                      console.warn('[BSE-EXT] Iframe OCR also failed:', iframeErr.message);
                  }
              }
              
              // Process the OCR result from whichever strategy succeeded
              if (ocrResult && ocrResult.success && ocrResult.processedImage) {
                  debugImg.src = ocrResult.processedImage;
              }
              
              if (ocrResult && ocrResult.success && ocrResult.text) {
                  console.log('[BSE-EXT] OCR SUCCESS! Text:', ocrResult.text);
                  captchaInput.disabled = false;
                  setNativeValue(captchaInput, ocrResult.text);
                  await db.setWorkflowState({ status: `Captcha: ${ocrResult.text}. Submitting...` });
                  
                  const btn = getSubmitButton();
                  if (btn) {
                     const s = await db.getWorkflowState();
                     if (!s.isAwaitingResult) {
                         handleSubmit();
                         btn.click();
                     }
                  }
              } else {
                  console.log('[BSE-EXT] All OCR strategies failed. Response:', ocrResult);
                  await db.setWorkflowState({ status: `OCR Failed: ${ocrResult?.error || 'Empty text'}. Manual input required.` });
                  captchaInput.disabled = false;
                  captchaInput.placeholder = "Enter Captcha";
                  captchaInput.focus();
              }
          }, 2000);
      }
    }, 500);

  } catch (err: any) { await db.setWorkflowState({ status: `Error: ${err.message}` }); }
};

const advanceQueue = async (state: any, panCount: number) => {
  if (state.panIndex + 1 >= panCount) {
    if (state.ipoIndex + 1 >= state.targetIpos.length) {
      await db.setWorkflowState({ isRunning: false, status: 'Completed all checks!' });
    } else {
      await db.setWorkflowState({ ipoIndex: state.ipoIndex + 1, panIndex: 0, status: `Moving to next IPO...` });
      window.location.href = window.location.origin + window.location.pathname + '?r=' + Date.now();
    }
  } else {
    await db.setWorkflowState({ panIndex: state.panIndex + 1, status: `Moving to PAN ${state.panIndex + 2}...` });
    window.location.href = window.location.origin + window.location.pathname + '?r=' + Date.now();
  }
};

const injectSidebar = () => {
  if (document.getElementById('bse-ipo-sidebar-root')) return;
  const appContainer = document.createElement('div');
  appContainer.id = 'bse-ipo-sidebar-root';
  appContainer.style.cssText = 'position:fixed;top:0;right:0;width:400px;height:100vh;z-index:999999;background:white;box-shadow:-4px 0 15px rgba(0,0,0,0.1);overflow-y:auto;';
  document.body.appendChild(appContainer);
  createRoot(appContainer).render(<SidebarApp />);
  setTimeout(processWorkflowStep, 200); // Reduced delay to make it snappier
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectSidebar); else injectSidebar();
