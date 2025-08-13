/**
 * CSRF token utilities for Quotewise Chrome extension
 * Exact implementation from quotewise/static/js/quote_collection.js
 */

/**
 * Extract cookie value by name
 * Based on quotewise/static/js/quote_collection.js lines 175-182
 */
export function getCookie(name: string): string | null {
    if (!document.cookie) return null;
    
    const cookie = document.cookie
        .split(';') // Split cookies
        .map(c => c.trim()) // Trim whitespace
        .find(c => c.startsWith(name + '=')); // Find the correct cookie
    
    return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
}

/**
 * Get CSRF token from cookie or fetch from Django endpoint
 * Based on quotewise/static/js/quote_collection.js pattern
 */
export async function getCSRFToken(apiBaseUrl: string): Promise<string | null> {
    // Get from cookie first (line 729 pattern)
    let token = getCookie('csrftoken');
    
    if (!token) {
        // Fetch from Django if cookie unavailable
        try {
            const response = await fetch(`${apiBaseUrl}/csrf/`, {
                credentials: 'include',
                method: 'GET'
            });
            
            if (!response.ok) {
                console.error('Failed to fetch CSRF token:', response.status, response.statusText);
                return null;
            }
            
            const data = await response.json();
            token = data.csrfToken;
        } catch (error) {
            console.error('Failed to fetch CSRF token:', error);
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
    
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    };
    
    if (csrfToken) {
        // Line 736 pattern from quote_collection.js
        headers['X-CSRFToken'] = csrfToken;
    }
    
    return headers;
}