// This script runs in the PAGE context (not content script context)
// It intercepts the captcha text from canvas rendering or Angular scope
(function() {
    'use strict';
    
    // Check if we already have intercepted text from a previous hook
    if (window.__bseCaptchaText) {
        document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: window.__bseCaptchaText }));
        return;
    }
    
    // Strategy A: Try to find the captcha value in Angular scope or page variables
    var canvases = document.querySelectorAll('canvas');
    for (var i = 0; i < canvases.length; i++) {
        var c = canvases[i];
        var label = (c.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('captcha') || label.includes('verify')) {
            try {
                // Try Angular scope (BSE uses Angular)
                if (typeof angular !== 'undefined') {
                    var scope = angular.element(c).scope();
                    if (scope) {
                        // Search for common captcha variable names
                        var possibleKeys = ['captchaText', 'captcha', 'captchaValue', 'CaptchaText', 
                                           'captchaCode', 'captchaStr', 'strCaptcha', 'txtCaptcha',
                                           'captchastring', 'captchatext', 'generateCaptcha'];
                        for (var k = 0; k < possibleKeys.length; k++) {
                            if (scope[possibleKeys[k]] && typeof scope[possibleKeys[k]] === 'string') {
                                window.__bseCaptchaText = scope[possibleKeys[k]];
                                document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: window.__bseCaptchaText }));
                                return;
                            }
                        }
                        
                        // Deep search: look through all scope properties for captcha-like strings
                        var keys = Object.keys(scope);
                        for (var j = 0; j < keys.length; j++) {
                            var key = keys[j];
                            if (key.startsWith('$') || key.startsWith('_')) continue; // skip Angular internals
                            var val = scope[key];
                            if (typeof val === 'string' && val.length >= 4 && val.length <= 8 && /^[A-Za-z0-9]+$/.test(val)) {
                                // Check if this value matches what's drawn on the canvas
                                // We store it as a candidate
                                if (!window.__bseCaptchaCandidates) window.__bseCaptchaCandidates = [];
                                window.__bseCaptchaCandidates.push({ key: key, value: val });
                            }
                        }
                        
                        // If we found candidates, use the first one
                        if (window.__bseCaptchaCandidates && window.__bseCaptchaCandidates.length > 0) {
                            window.__bseCaptchaText = window.__bseCaptchaCandidates[0].value;
                            document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: window.__bseCaptchaText }));
                            return;
                        }
                    }
                }
            } catch(e) {
                console.log('[BSE-INTERCEPTOR] Angular scope error:', e.message);
            }
            break;
        }
    }
    
    // Strategy B: Look for captcha value in common global variables
    var globalChecks = [
        'captchaText', 'captcha', 'captchaValue', 'CaptchaText',
        'strCaptcha', 'generatedCaptcha', 'captchaCode'
    ];
    for (var g = 0; g < globalChecks.length; g++) {
        try {
            var gVal = window[globalChecks[g]];
            if (gVal && typeof gVal === 'string' && gVal.length >= 4 && gVal.length <= 8 && /^[A-Za-z0-9]+$/.test(gVal)) {
                window.__bseCaptchaText = gVal;
                document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: window.__bseCaptchaText }));
                return;
            }
        } catch(e) {}
    }
    
    // Strategy C: Hook canvas text rendering for current and future captcha draws
    var origFillText = CanvasRenderingContext2D.prototype.fillText;
    var origStrokeText = CanvasRenderingContext2D.prototype.strokeText;
    
    CanvasRenderingContext2D.prototype.fillText = function(text) {
        if (text && typeof text === 'string' && text.length >= 4 && text.length <= 8 && /^[A-Za-z0-9]+$/.test(text)) {
            window.__bseCaptchaText = text;
            document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: text }));
        }
        return origFillText.apply(this, arguments);
    };
    
    CanvasRenderingContext2D.prototype.strokeText = function(text) {
        if (text && typeof text === 'string' && text.length >= 4 && text.length <= 8 && /^[A-Za-z0-9]+$/.test(text)) {
            window.__bseCaptchaText = text;
            document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: text }));
        }
        return origStrokeText.apply(this, arguments);
    };
    
    // Signal that hooks are set up but nothing found yet
    document.dispatchEvent(new CustomEvent('__bse_captcha_intercepted', { detail: '' }));
})();
