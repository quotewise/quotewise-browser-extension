/**
 * Service worker API message handler for Quotewise Chrome extension
 * Integrates QuotewiseApiClient with popup messaging system
 */

import type { ExtensionMessage, MessageType } from '../types/index';
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
        
        console.log(`Initializing ApiHandler for ${this.environment} environment`, {
            apiBaseUrl: config.apiBaseUrl,
            sessionCookieName: config.sessionCookieName
        });
        
        this.apiClient = new QuotewiseApiClientImpl(config.apiBaseUrl);
        
        // Set up message listener
        this.setupMessageListener();
    }
    
    /**
     * Set up Chrome runtime message listener
     */
    private setupMessageListener(): void {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            // Handle async responses properly
            this.handleMessage(message, sender, sendResponse).catch(error => {
                console.error('Error handling message:', error);
                sendResponse({
                    success: false,
                    error: error.message || 'Internal error occurred'
                });
            });
            
            // Return true to indicate async response
            return true;
        });
    }
    
    /**
     * Handle incoming extension messages
     */
    private async handleMessage(
        message: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            console.log('Handling API message:', { type: message.type, data: message.data });
            
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
                    
                case 'GET_TWEET_DATA':
                    await this.handleGetTweetData(message, sendResponse);
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
        message: ExtensionMessage,
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const authStatus = await this.apiClient.checkAuthStatus();
            sendResponse(authStatus);
        } catch (error) {
            console.error('Error checking auth status:', error);
            sendResponse({
                isAuthenticated: false,
                error: error instanceof Error ? error.message : 'Auth check failed'
            });
        }
    }
    
    /**
     * Handle originator search
     */
    private async handleSearchOriginators(
        message: ExtensionMessage,
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
    private async handleGetTweetData(
        message: ExtensionMessage,
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            // Query active tab for tweet data
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tabs[0]?.id) {
                sendResponse({
                    success: false,
                    error: 'No active tab found',
                    data: null
                });
                return;
            }
            
            // Send message to content script
            const response = await chrome.tabs.sendMessage(tabs[0].id, {
                type: 'GET_TWEET_DATA'
            });
            
            if (response && response.success) {
                sendResponse({
                    success: true,
                    data: response.data
                });
            } else {
                sendResponse({
                    success: false,
                    error: response?.error || 'Failed to extract tweet data',
                    data: null
                });
            }
        } catch (error) {
            console.error('Error getting tweet data:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get tweet data',
                data: null
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
    console.log('Initializing API handler...');
    return new ApiHandler();
}