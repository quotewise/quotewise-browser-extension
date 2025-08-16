/**
 * CSRF token utilities for Quotewise Chrome extension
 * Exact implementation from quotewise/static/js/quote_collection.js
 */

/**
 * Extract cookie value by name
 * Works in both content scripts (with document) and service workers (with chrome.cookies API)
 */
export async function getCookie(name: string): Promise<string | null> {
    // In content scripts, use document.cookie
    if (typeof document !== 'undefined' && document.cookie) {
        const cookie = document.cookie
            .split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(name + '='));
        
        return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
    }
    
    // In service workers, use chrome.cookies API
    if (typeof chrome !== 'undefined' && chrome.cookies) {
        try {
            // Get the current environment to determine the correct domain
            const manifestName = chrome.runtime.getManifest().name || '';
            let domain = 'quotosaurus.com';
            
            if (manifestName.includes('Staging')) {
                domain = 'staging.quotosaurus.com';
            } else if (manifestName.includes('dev')) {
                domain = 'localhost';
            }
            
            console.log(`Getting cookie '${name}' for domain: ${domain}`);
            
            const cookie = await chrome.cookies.get({
                url: `https://${domain}`,
                name: name
            });
            
            console.log(`Cookie result for '${name}':`, cookie);
            
            // Also try to get all cookies for debugging
            if (name === 'csrftoken') {
                const allCookies = await chrome.cookies.getAll({ domain: domain });
                console.log('All cookies for domain:', allCookies.map(c => ({ name: c.name, value: c.value.substring(0, 10) + '...', domain: c.domain, secure: c.secure, httpOnly: c.httpOnly })));
                
                // Also try without explicit domain to see all staging cookies
                const allStagingCookies = await chrome.cookies.getAll({ url: `https://${domain}` });
                console.log('All cookies for URL:', allStagingCookies.map(c => ({ name: c.name, value: c.value.substring(0, 10) + '...', domain: c.domain, secure: c.secure, httpOnly: c.httpOnly })));
            }
            
            return cookie ? cookie.value : null;
        } catch (error) {
            console.error('Error getting cookie via chrome.cookies:', error);
            return null;
        }
    }
    
    return null;
}

/**
 * Get CSRF token from cookie using Django's standard approach
 * Based on quotewise/static/js/quote_collection.js pattern
 */
export async function getCSRFToken(apiBaseUrl: string): Promise<string | null> {
    // Get from cookie first (Django standard approach)
    let token = await getCookie('csrftoken');
    
    if (!token) {
        // For extensions, we need to make a GET request to trigger cookie setting
        // Use the auth status endpoint which is available and safe to call
        try {
            const response = await fetch(`${apiBaseUrl}/api/v1/auth/status/`, {
                credentials: 'include',
                method: 'GET'
            });
            
            // Check again for cookie after the request
            token = await getCookie('csrftoken');
            
            if (!token) {
                console.warn('CSRF token not available after auth request');
                return null;
            }
        } catch (error) {
            console.error('Failed to get CSRF token:', error);
            return null;
        }
    }
    
    return token;
}

/**
 * Validate CSRF token format
 */
export function isValidCSRFToken(token: string | null): boolean {
    if (!token) return false;
    // Django CSRF tokens are typically 64 characters long
    return typeof token === 'string' && token.length >= 32 && /^[a-zA-Z0-9]+$/.test(token);
}

/**
 * Get default request headers with CSRF token
 */
export async function getDefaultHeaders(apiBaseUrl: string): Promise<HeadersInit> {
    const csrfToken = await getCSRFToken(apiBaseUrl);
    
    console.log('CSRF token for headers:', csrfToken);
    
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        // Add Referer header to make Django CSRF protection think request comes from the website
        'Referer': `${apiBaseUrl}/`
    };
    
    if (csrfToken) {
        // Line 736 pattern from quote_collection.js
        headers['X-CSRFToken'] = csrfToken;
        console.log('Added CSRF token to headers');
    } else {
        console.warn('No CSRF token available for headers');
    }
    
    console.log('Final headers:', headers);
    
    return headers;
}