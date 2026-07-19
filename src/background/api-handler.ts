/**
 * Service worker API message handler for Quotewise Chrome extension
 * Integrates QuotewiseApiClient with popup messaging system
 */

import type { ExtensionMessage } from '../types/index';
import type { CollectionsListResponse, QuotewiseApiClient } from '../types/api';
import { QuotewiseApiClientImpl } from '../api/quotewise-api';
import { getEnvironmentConfig, detectEnvironment } from '../config/environment';

const COLLECTIONS_CACHE_KEY = 'collectionsCache';
const COLLECTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

interface CollectionsCache extends CollectionsListResponse {
    ts: number;
}

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

    private isAuthenticationError(error: unknown): boolean {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        return error instanceof Error &&
            (error.name === 'AuthenticationError' ||
             message.includes('401') ||
             message.includes('403') ||
             message.includes('authentication') ||
             message.includes('insufficient'));
    }

    private authFailureType(error: unknown): 'session_expired' | 'insufficient_privileges' {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (
            message.includes('403') ||
            message.includes('insufficient') ||
            message.includes('permission')
        ) {
            return 'insufficient_privileges';
        }

        return 'session_expired';
    }

    private authFailureFields(error: unknown): {
        authRequired?: boolean;
        authFailureType?: 'session_expired' | 'insufficient_privileges';
    } {
        if (!this.isAuthenticationError(error)) {
            return {};
        }

        return {
            authRequired: true,
            authFailureType: this.authFailureType(error),
        };
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

                case 'ADD_QUOTE_TO_COLLECTION':
                    await this.handleAddQuoteToCollection(message, sendResponse);
                    break;

                case 'LOOKUP_ORIGINATOR_BY_HANDLE':
                    await this.handleLookupOriginatorByHandle(message, sendResponse);
                    break;

                case 'PREFLIGHT_CHECK':
                    await this.handlePreflightCheck(message, sendResponse);
                    break;

                case 'LIST_COLLECTIONS':
                    await this.handleListCollections(message, sendResponse);
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
                ...this.authFailureFields(error),
                error: error instanceof Error ? error.message : 'API request failed'
            });
        }
    }

    private isFreshCollectionsCache(value: unknown): value is CollectionsCache {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const cache = value as Partial<CollectionsCache>;
        return (
            Array.isArray(cache.collections) &&
            cache.collections.every(collection => (
                !!collection &&
                typeof collection.slug === 'string' &&
                collection.slug.trim().length > 0
            )) &&
            typeof cache.ts === 'number' &&
            Date.now() - cache.ts < COLLECTIONS_CACHE_TTL_MS
        );
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
                ...this.authFailureFields(error),
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
            const originatorSlug = data.originatorSlug ?? data.originator_slug;
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
                originatorSlug,
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
                ...this.authFailureFields(error),
                error: error instanceof Error ? error.message : 'Duplicate check failed',
                hasDuplicates: false,
                duplicates: []
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
                ...this.authFailureFields(error),
                message: error instanceof Error ? error.message : 'Quote submission failed',
                error: error instanceof Error ? error.message : 'Quote submission failed'
            });
        }
    }

    private async handleAddQuoteToCollection(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const data = message.data || {};
            const collectionSlug = data.collectionSlug ?? data.collection_slug;
            const quoteId = data.quoteId ?? data.quote_id;

            if (typeof collectionSlug !== 'string' || !collectionSlug) {
                sendResponse({
                    success: false,
                    error: 'Collection slug is required'
                });
                return;
            }

            if (typeof quoteId !== 'string' || !quoteId) {
                sendResponse({
                    success: false,
                    error: 'Quote ID is required'
                });
                return;
            }

            const result = await this.apiClient.addQuoteToCollection(collectionSlug, quoteId);
            sendResponse(result);
        } catch (error) {
            console.error('Error adding quote to collection:', error);
            sendResponse({
                success: false,
                ...this.authFailureFields(error),
                error: error instanceof Error ? error.message : 'Unable to add quote to collection'
            });
        }
    }

    /**
     * Handle collections list for options page
     */
    private async handleListCollections(
        message: ExtensionMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendResponse: (response: any) => void
    ): Promise<void> {
        try {
            const forceRefresh = message.data &&
                typeof message.data === 'object' &&
                (message.data as { forceRefresh?: unknown }).forceRefresh === true;
            if (!forceRefresh) {
                const storage = await chrome.storage.local.get([COLLECTIONS_CACHE_KEY]);
                const cache = storage[COLLECTIONS_CACHE_KEY];
                if (this.isFreshCollectionsCache(cache)) {
                    sendResponse({
                        success: true,
                        collections: cache.collections,
                        default_collection_id: cache.default_collection_id,
                        fromCache: true
                    });
                    return;
                }
            }

            const result = await this.apiClient.listCollections();
            await chrome.storage.local.set({
                [COLLECTIONS_CACHE_KEY]: {
                    ...result,
                    ts: Date.now()
                }
            });
            sendResponse({
                success: true,
                ...result,
                fromCache: false
            });
        } catch (error) {
            console.error('Error listing collections:', error);
            sendResponse({
                success: false,
                ...this.authFailureFields(error),
                error: error instanceof Error ? error.message : 'Unable to list collections',
                collections: [],
                default_collection_id: null
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
                ...this.authFailureFields(error),
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
            const duplicateProbe = typeof text === 'string' ? text : source_url;

            if (!handle || typeof handle !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Handle is required'
                });
                return;
            }

            if (!duplicateProbe || typeof duplicateProbe !== 'string') {
                sendResponse({
                    success: false,
                    error: 'Quote text is required'
                });
                return;
            }

            const result = await this.apiClient.preflightCheck(
                handle,
                typeof platform === 'string' ? platform : 'twitter',
                duplicateProbe,
                typeof source_url === 'string' ? source_url : ''
            );

            sendResponse({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Error in preflight check:', error);

            sendResponse({
                success: false,
                ...this.authFailureFields(error),
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
