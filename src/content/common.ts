/**
 * Common utilities for content scripts
 */

import { MessageType, ExtensionMessage } from '../types/index';

/**
 * Send message to service worker with error handling
 */
export function sendMessageToBackground(message: ExtensionMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      if (response && response.error) {
        reject(new Error(response.error));
        return;
      }
      
      resolve(response);
    });
  });
}

/**
 * Clean URL by removing tracking parameters
 */
export function cleanUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Remove common tracking parameters
    const trackingParams = [
      's', 't', 'ref_src', 'ref_url', 'utm_source', 'utm_medium',
      'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'
    ];
    
    trackingParams.forEach(param => {
      urlObj.searchParams.delete(param);
    });
    
    return urlObj.toString();
  } catch (error) {
    console.error('Error cleaning URL:', error);
    return url;
  }
}

/**
 * Wait for element to appear in DOM
 */
export function waitForElement(
  selector: string, 
  timeout: number = 5000
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver((mutations) => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Timeout after specified time
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

/**
 * Extract text content from element, handling nested elements
 */
export function extractTextContent(element: Element): string {
  if (!element) return '';
  
  // Clone the element to avoid modifying the original
  const clone = element.cloneNode(true) as Element;
  
  // Remove script and style elements
  const scripts = clone.querySelectorAll('script, style');
  scripts.forEach(script => script.remove());
  
  // Get text content and clean it up
  return clone.textContent?.trim() || '';
}

/**
 * Parse date string to ISO format
 */
export function parseDate(dateString: string): string | null {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  } catch (error) {
    console.error('Error parsing date:', error);
    return null;
  }
}

/**
 * Parse number from string, handling formatted numbers
 */
export function parseNumber(numberString: string): number {
  if (!numberString) return 0;
  
  // Remove all non-digit characters except decimal points
  const cleaned = numberString.replace(/[^\d.]/g, '');
  const number = parseFloat(cleaned);
  
  return isNaN(number) ? 0 : number;
}

/**
 * Debounce function to limit API calls
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Check if current page is a supported platform
 */
export function detectPlatform(): 'twitter' | 'unknown' {
  const hostname = window.location.hostname;
  
  if (hostname === 'twitter.com' || hostname === 'x.com') {
    return 'twitter';
  }
  
  return 'unknown';
}

/**
 * Log debug information (only in development)
 */
export function debugLog(message: string, data?: any): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Quotewise] ${message}`, data || '');
  }
}

/**
 * Safe DOM query with error handling
 */
export function safeQuerySelector<T extends Element = Element>(
  selector: string,
  parent: Element | Document = document
): T | null {
  try {
    return parent.querySelector<T>(selector);
  } catch (error) {
    console.error('Error in querySelector:', error);
    return null;
  }
}

/**
 * Safe DOM query all with error handling
 */
export function safeQuerySelectorAll<T extends Element = Element>(
  selector: string,
  parent: Element | Document = document
): NodeListOf<T> | [] {
  try {
    return parent.querySelectorAll<T>(selector);
  } catch (error) {
    console.error('Error in querySelectorAll:', error);
    return [] as any;
  }
}