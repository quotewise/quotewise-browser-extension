/**
 * Service worker API message handler for Quotewise Chrome extension
 * Integrates QuotewiseApiClient with popup messaging system
 */

import type { ExtensionMessage } from '../types/index';
import type { QuotewiseApiClient } from '../types/api';
import { QuotewiseApiClientImpl } from '../api/quotewise-api';
import { getEnvironmentConfig, detectEnvironment } from '../config/environment';

/**
 * API Handler for Chrome extension service worker
 * Handles all API-related messages from popup and content scripts
 */
export class ApiHandler {
    private apiClient: QuotewiseApiClient;
    private environment: string;

    constructor() {
        this.environment = detectEnvironment();
        const config = getEnvironmentConfig(this.environment);
        this.apiClient = new QuotewiseApiClientImpl(config.apiBaseUrl);
    }
    
    /**
     * Handle incoming extension messages (called by service worker)
     */
    public async handleMessage(
        message: ExtensionMessage,
        _sender: chrome.runtime.MessageSender,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            
            switch (message.type) {
                case 'SEARCH_ORIGINATORS':
                    await this.handleSearchOriginators(message, sendResponse);
                    break;
                    
                case 'CHECK_DUPLICATE':
                    await this.handleCheckDuplicateQuote(message, sendResponse);
                    break;
                    
                case 'SUBMIT_QUOTE':
                    await this.handleSubmitQuote(message, sendResponse);
                    break;

                case 'LOOKUP_ORIGINATOR_BY_HANDLE':
                    await this.handleLookupOriginatorByHandle(message, sendResponse);
                    break;

                case 'PREFLIGHT_CHECK':
                    await this.handlePreflightCheck(message, sendResponse);
                    break;

                default:
                    console.warn('Unknown message type:', message.type);
                    sendResponse({ 
                        success: false, 
                        error: `Unknown message type: ${message.type}` 
                    });
            }
        } catch (error) {
            console.error('API handler error:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : 'API request failed'
            });
        }
    }
    
    /**
     * Handle originator search
     */
    private async handleSearchOriginators(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const { query, limit } = message.data || {};
            
            if (!query || typeof query !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Search query is required'
                });
                return;
            }
            
            const results = await this.apiClient.searchOriginators(
                query,
                typeof limit === 'number' ? limit : 10
            );
            
            sendResponse({
                success: true,
                results
            });
        } catch (error) {
            console.error('Error searching originators:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : 'Search failed',
                results: []
            });
        }
    }
    
    /**
     * Handle duplicate quote check
     */
    private async handleCheckDuplicateQuote(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            // Support both camelCase and snake_case field names
            const data = message.data || {};
            const text = data.text;
            const originatorId = data.originatorId ?? data.originator_id;
            const sourceUrl = data.sourceUrl ?? data.source_url;
            const socialHandle = data.socialHandle ?? data.social_handle;

            if (!text || typeof text !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Quote text is required'
                });
                return;
            }

            const duplicateResult = await this.apiClient.checkQuoteDuplicate(
                text,
                originatorId,
                sourceUrl,
                socialHandle
            );

            sendResponse({
                success: true,
                result: duplicateResult,
                ...duplicateResult
            });
        } catch (error) {
            console.error('Error checking duplicates:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : 'Duplicate check failed',
                hasDuplicates: false,
                duplicates: [],
                similarityThreshold: 0.8
            });
        }
    }
    
    /**
     * Handle quote submission
     */
    private async handleSubmitQuote(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const quoteData = message.data;
            
            if (!quoteData) {
                sendResponse({
                    success: false,
                    message: 'Quote data is required',
                    error: 'Quote data is required'
                });
                return;
            }
            
            const submissionResult = await this.apiClient.submitQuote(quoteData);
            sendResponse(submissionResult);
        } catch (error) {
            console.error('Error submitting quote:', error);
            sendResponse({
                success: false,
                message: error instanceof Error ? error.message : 'Quote submission failed',
                error: error instanceof Error ? error.message : 'Quote submission failed'
            });
        }
    }

    /**
     * Handle originator lookup by social media handle
     */
    private async handleLookupOriginatorByHandle(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const { handle, platform } = message.data || {};

            if (!handle || typeof handle !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Handle is required',
                    found: false
                });
                return;
            }

            const result = await this.apiClient.lookupOriginatorByHandle(
                handle,
                typeof platform === 'string' ? platform : 'twitter'
            );

            sendResponse({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Error looking up originator by handle:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : 'Lookup failed',
                found: false
            });
        }
    }

    /**
     * Handle preflight check (combined originator lookup + duplicate check)
     * Reduces round-trips from 2 API calls to 1 for faster feedback
     */
    private async handlePreflightCheck(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const { handle, platform, text, source_url } = message.data || {};

            if (!handle || typeof handle !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Handle is required'
                });
                return;
            }

            if (!text || typeof text !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Quote text is required'
                });
                return;
            }

            const result = await this.apiClient.preflightCheck(
                handle,
                typeof platform === 'string' ? platform : 'twitter',
                text,
                typeof source_url === 'string' ? source_url : ''
            );

            sendResponse({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Error in preflight check:', error);

            // Check if this is an authentication error (401)
            const isAuthError = error instanceof Error &&
                (error.name === 'AuthenticationError' ||
                 error.message.includes('401') ||
                 error.message.includes('Authentication'));

            sendResponse({
                success: false,
                authRequired: isAuthError,  // Flag for caller to handle auth state
                error: error instanceof Error ? error.message : 'Preflight check failed',
                originator: { found: false },
                duplicate_check: {
                    recommendation: 'new_quote',
                    confidence: 0.5,
                    in_quotewise: false,
                    matches: []
                }
            });
        }
    }

    /**
     * Get current environment info for debugging
     */
    public getEnvironmentInfo(): { environment: string; baseUrl: string } {
        return {
            environment: this.environment,
            baseUrl: this.apiClient.baseUrl
        };
    }
}

/**
 * Initialize API handler - called from service worker
 */
export function initializeApiHandler(): ApiHandler {
    return new ApiHandler();
}