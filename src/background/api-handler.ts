/**
 * Service worker API message handler for Quotewise Chrome extension
 * Integrates QuotewiseApiClient with popup messaging system
 */

import type { ExtensionMessage } from '../types/index';
import type { QuotewiseApiClient } from '../types/api';
import { QuotewiseApiClientImpl } from '../api/quotewise-api';
import { getEnvironmentConfig, detectEnvironment, debugLog } from '../config/environment';

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
        
        debugLog(`Initializing ApiHandler for ${this.environment} environment`, {
            apiBaseUrl: config.apiBaseUrl,
            sessionCookieName: config.sessionCookieName
        });
        
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
            debugLog('Handling API message:', { type: message.type, data: message.data });
            
            switch (message.type) {
                case 'CHECK_AUTH_STATUS':
                    await this.handleCheckAuthStatus(message, sendResponse);
                    break;
                    
                case 'SEARCH_ORIGINATORS':
                    await this.handleSearchOriginators(message, sendResponse);
                    break;
                    
                case 'CHECK_DUPLICATE':
                    await this.handleCheckDuplicateQuote(message, sendResponse);
                    break;
                    
                case 'SUBMIT_QUOTE':
                    await this.handleSubmitQuote(message, sendResponse);
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
     * Handle authentication status check
     */
    private async handleCheckAuthStatus(
        _message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const authResult = await this.apiClient.checkAuthStatus();
            
            // Transform API response to match AuthChecker format (used by AuthenticationMonitor)
            const transformedStatus = {
                isAuthenticated: authResult.authenticated,
                isStaff: authResult.is_admin || false,
                username: authResult.user?.username
            };
            
            debugLog('Sending auth status to popup:', transformedStatus);
            sendResponse(transformedStatus);
        } catch (error) {
            console.error('Error checking auth status:', error);
            sendResponse({
                isAuthenticated: false,
                isStaff: false,
                error: error instanceof Error ? error.message : 'Auth check failed'
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
            const { text, originatorId } = message.data || {};
            
            if (!text || typeof text !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Quote text is required'
                });
                return;
            }
            
            const duplicateResult = await this.apiClient.checkQuoteDuplicate(
                text,
                originatorId
            );
            
            sendResponse({
                success: true,
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
     * Handle tweet data request
     * Forwards to content script for data extraction
     */
    
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
    debugLog('Initializing API handler...');
    return new ApiHandler();
}