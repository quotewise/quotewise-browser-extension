/**
 * Simplified popup interface for Quotewise Chrome extension
 * State-managed UI with component architecture
 */

import {
  MessageType,
  TwitterData,
  ExtensionMessage,
  QuoteSubmissionRequest,
  AttributionType
} from '../types/index';
import type { Collection } from '../types/api';
import { AuthChecker } from '../auth/auth-checker';
import { LoginHandler } from '../auth/login-handler';
import type { AuthStatus, AuthError } from '../types/auth';
import { apiClient } from '../api/quotewise-api';
import { OriginatorSearch, SearchState } from '../search/originator-search';
import type { OriginatorSearchResult } from '../types/api';
import { DuplicateChecker, DuplicateState } from '../duplicate/duplicate-checker';
import { DuplicateDisplay } from '../duplicate/duplicate-display';
import { HandleLookup, HandleLookupState } from '../lookup/handle-lookup';
import { HandleLookupDisplay } from '../lookup/handle-lookup-display';
import { debugLog } from '../config/environment';
import { AuthState, AuthStateData } from '../auth/auth-state-machine';

// State Management Interfaces
interface AuthenticationState {
  isAuthenticated: boolean;
  isStaff: boolean;
  userInfo?: {
    username: string;
    isAdmin: boolean;
  };
  sessionExpiry?: Date;
  sessionAge?: number;
  checkInProgress: boolean;
  authError?: AuthError;
  loginInProgress: boolean;
}

interface TweetDataState {
  data: TwitterData | null;
  isLoading: boolean;
  error?: string;
  validationErrors: string[];
}

interface UIState {
  currentView: 'loading' | 'auth-required' | 'insufficient-privileges' | 'quote-capture' | 'not-tweet-page' | 'error' | 'success' | 'login-in-progress';
  isFormValid: boolean;
  isDuplicateChecked: boolean;
  showOriginatorResults: boolean;
  loadingMessage?: string;
}

interface OriginatorState {
  searchQuery: string;
  searchResults: OriginatorSearchResult[];
  selectedOriginator: OriginatorSearchResult | null;
  isSearching: boolean;
  searchHistory: OriginatorSearchResult[];
}

interface SubmissionState {
  isSubmitting: boolean;
  lastSubmissionResult?: {
    success: boolean;
    message: string;
    quoteId?: string;
  };
  progress?: {
    step: string;
    percentage: number;
  };
}

interface CollectionsState {
  collections: Collection[];
  selectedCollectionId?: string;
  addToCollection: boolean;
  isLoading: boolean;
  error?: string;
}

interface PopupState {
  auth: AuthenticationState;
  tweet: TweetDataState;
  ui: UIState;
  originator: OriginatorState;
  submission: SubmissionState;
  duplicate: DuplicateState;
  collections: CollectionsState;
  handleLookup: HandleLookupState;
}

type PartialPopupState = {
  [K in keyof PopupState]?: Partial<PopupState[K]>;
};

type StateListener = (state: PopupState) => void;

// Simple State Manager
class SimplePopupStateManager {
  private state: PopupState;
  private listeners: StateListener[] = [];

  constructor() {
    this.state = {
      auth: {
        isAuthenticated: false,
        isStaff: false,
        checkInProgress: false,
        loginInProgress: false
      },
      tweet: {
        data: null,
        isLoading: false,
        validationErrors: []
      },
      ui: {
        currentView: 'loading',
        isFormValid: false,
        isDuplicateChecked: false,
        showOriginatorResults: false
      },
      originator: {
        searchQuery: '',
        searchResults: [],
        selectedOriginator: null,
        isSearching: false,
        searchHistory: []
      },
      submission: {
        isSubmitting: false
      },
      duplicate: {
        isChecking: false,
        hasChecked: false,
        result: null,
        userOverride: false,
        lastCheckText: '',
        lastCheckOriginator: '',
        lastCheckUrl: ''
      },
      collections: {
        collections: [],
        addToCollection: true, // Default to checked
        isLoading: false
      },
      handleLookup: {
        isLooking: false,
        hasLookedUp: false,
        result: null,
        matchedOriginator: null,
        createUrl: null,
        matchedHandle: null,
        errorMessage: null
      }
    };
  }

  setState(updates: PartialPopupState): void {
    Object.keys(updates).forEach(key => {
      const section = key as keyof PopupState;
      if (updates[section]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.state as any)[section] = { ...this.state[section], ...updates[section] };
      }
    });
    this.notifyListeners();
  }

  getState(): PopupState {
    return { ...this.state };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('Error in state listener:', error);
      }
    });
  }
}

// Message Handler
class SimpleMessageHandler {
  constructor(private stateManager: SimplePopupStateManager) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendMessage(message: ExtensionMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Runtime error'));
          return;
        }
        resolve(response);
      });
    });
  }
}

// Simplified Popup Controller
class SimpleQuotewisePopup {
  private stateManager: SimplePopupStateManager;
  private messageHandler: SimpleMessageHandler;
  private authChecker: AuthChecker;
  private loginHandler: LoginHandler;
  private originatorSearch: OriginatorSearch;
  private duplicateChecker: DuplicateChecker;
  private duplicateDisplay: DuplicateDisplay;
  private handleLookup: HandleLookup;
  private handleLookupDisplay: HandleLookupDisplay;
  private navigationCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.stateManager = new SimplePopupStateManager();
    this.messageHandler = new SimpleMessageHandler(this.stateManager);
    this.authChecker = new AuthChecker(apiClient);
    this.loginHandler = new LoginHandler();
    this.originatorSearch = new OriginatorSearch({
      minQueryLength: 2,
      debounceDelay: 300,
      maxResults: 10
    });
    this.duplicateChecker = new DuplicateChecker(1000); // 1 second debounce
    
    // Initialize duplicate display with a placeholder - will be set up properly in init()
    this.duplicateDisplay = new DuplicateDisplay({
      container: document.createElement('div'), // Temporary container
      onOverride: () => this.handleDuplicateOverride(),
      onEditQuote: () => this.focusQuoteText(),
      onChangeOriginator: () => this.focusOriginatorSearch()
    });

    // Initialize handle lookup components
    this.handleLookup = new HandleLookup();
    this.handleLookupDisplay = new HandleLookupDisplay({
      container: document.createElement('div'), // Temporary container
      onSelectOriginator: () => this.handleUseFoundOriginator(),
      onDismiss: () => this.handleDismissHandleLookup()
    });

    this.init();
  }

  private async init(): Promise<void> {
    debugLog('Initializing Quotewise popup v1.0.1');
    
    try {
      debugLog('Setting up event listeners...');
      this.setupEventListeners();
      
      debugLog('Initializing originator search...');
      this.initializeOriginatorSearch();
      
      debugLog('Initializing duplicate checker...');
      this.initializeDuplicateChecker();

      debugLog('Initializing handle lookup...');
      this.initializeHandleLookup();

      debugLog('Setting up state manager subscription...');
      this.stateManager.subscribe(this.onStateChange.bind(this));
      
      debugLog('About to check auth status...');
      await this.checkAuthStatus();
      
      // Only load tweet data after auth check completes successfully
      const currentState = this.stateManager.getState();
      if (currentState.auth.isAuthenticated && currentState.ui.currentView !== 'error') {
        debugLog('About to load tweet data...');
        await this.loadTweetData();
      } else {
        debugLog('Skipping tweet data load - not authenticated or auth error occurred');
      }
      
      debugLog('Popup initialization completed successfully');
      
    } catch (error) {
      console.error('Error initializing popup:', error);
      this.stateManager.setState({
        ui: { 
          currentView: 'error',
          loadingMessage: 'Failed to initialize popup'
        }
      });
    }
  }

  private onStateChange(state: PopupState): void {
    this.updateView(state.ui.currentView);
    this.updateFormValidation(state);
    this.updateLoadingState(state);
    this.updateOriginatorState(state);
    this.updateDuplicateState(state);
    this.updateCollectionsState(state);
    this.updateHandleLookupState(state);
  }

  private updateView(currentView: string): void {
    // Handle navigation monitoring based on current view
    this.handleNavigationMonitoring(currentView);
    const sections = [
      'auth-required', 
      'insufficient-privileges', 
      'quote-capture', 
      'not-tweet-page',
      'error-state', 
      'success-state', 
      'loading-state',
      'login-in-progress'
    ];
    
    sections.forEach(sectionId => {
      const element = document.getElementById(sectionId);
      if (element) {
        const shouldShow = (
          (currentView === 'auth-required' && sectionId === 'auth-required') ||
          (currentView === 'insufficient-privileges' && sectionId === 'insufficient-privileges') ||
          (currentView === 'quote-capture' && sectionId === 'quote-capture') ||
          (currentView === 'not-tweet-page' && sectionId === 'not-tweet-page') ||
          (currentView === 'error' && sectionId === 'error-state') ||
          (currentView === 'success' && sectionId === 'success-state') ||
          (currentView === 'loading' && sectionId === 'loading-state') ||
          (currentView === 'login-in-progress' && sectionId === 'login-in-progress')
        );
        
        if (shouldShow) {
          element.classList.remove('hidden');
        } else {
          element.classList.add('hidden');
        }
      }
    });

    // Update auth-specific UI elements
    this.updateAuthUI(currentView);
  }

  private updateFormValidation(state: PopupState): void {
    const submitButton = document.getElementById('submit-quote') as HTMLButtonElement;
    const checkDuplicateButton = document.getElementById('check-duplicate') as HTMLButtonElement;
    
    if (submitButton) {
      const hasRequiredFields = state.originator.selectedOriginator && this.hasValidQuoteText();
      const canSubmit = (
        hasRequiredFields &&
        this.duplicateChecker.canSubmit() &&
        !state.submission.isSubmitting &&
        !state.duplicate.isChecking
      );
      submitButton.disabled = !canSubmit;
    }
    
    if (checkDuplicateButton) {
      const hasRequiredFields = state.originator.selectedOriginator && this.hasValidQuoteText();
      const canCheck = (
        hasRequiredFields &&
        !state.submission.isSubmitting &&
        !state.duplicate.isChecking
      );
      checkDuplicateButton.disabled = !canCheck;
    }
  }

  private updateLoadingState(state: PopupState): void {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage && state.ui.loadingMessage) {
      loadingMessage.textContent = state.ui.loadingMessage;
    }
  }

  private setupEventListeners(): void {
    // Login button
    const loginButton = document.getElementById('login-button');
    loginButton?.addEventListener('click', this.handleLogin.bind(this));

    // Refresh authentication button
    const refreshAuthButton = document.getElementById('refresh-auth');
    refreshAuthButton?.addEventListener('click', this.checkAuthStatus.bind(this));

    // Duplicate check
    const checkDuplicateButton = document.getElementById('check-duplicate');
    checkDuplicateButton?.addEventListener('click', this.handleDuplicateCheck.bind(this));

    // Submit quote
    const submitButton = document.getElementById('submit-quote');
    submitButton?.addEventListener('click', this.handleSubmitQuote.bind(this));

    // Retry button
    const retryButton = document.getElementById('retry-button');
    retryButton?.addEventListener('click', this.init.bind(this));

    // Close button
    const closeButton = document.getElementById('close-button');
    closeButton?.addEventListener('click', () => window.close());

    // Quote text changes
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    quoteTextArea?.addEventListener('input', this.handleQuoteTextChange.bind(this));

    // Collections dropdown
    const collectionSelect = document.getElementById('collection-select') as HTMLSelectElement;
    collectionSelect?.addEventListener('change', this.handleCollectionChange.bind(this));

    // Add to collection checkbox
    const addToCollectionCheckbox = document.getElementById('add-to-collection') as HTMLInputElement;
    addToCollectionCheckbox?.addEventListener('change', this.handleAddToCollectionToggle.bind(this));

    // Refresh page check button (for not-tweet-page state)
    const refreshPageCheckButton = document.getElementById('refresh-page-check');
    refreshPageCheckButton?.addEventListener('click', this.handleRefreshPageCheck.bind(this));

    // Cleanup when popup closes
    window.addEventListener('beforeunload', () => {
      this.destroy();
    });

    // Listen for auth state changes from AuthStateManager
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === MessageType.AUTH_STATE_CHANGED) {
        this.handleAuthStateChanged(message.data as AuthStateData);
      }
    });
  }

  /**
   * Handle auth state change broadcast from AuthStateManager
   */
  private handleAuthStateChanged(stateData: AuthStateData): void {
    debugLog('Received AUTH_STATE_CHANGED:', stateData.state);

    switch (stateData.state) {
      case AuthState.AUTHENTICATED:
        this.handleAuthSuccess({
          isAuthenticated: true,
          isStaff: stateData.scopes?.includes('quotes:write') ?? false,
          username: stateData.username,
          scopes: stateData.scopes,
        });
        break;

      case AuthState.UNAUTHENTICATED:
      case AuthState.SESSION_EXPIRED:
        this.handleAuthError({
          type: stateData.state === AuthState.SESSION_EXPIRED ? 'session_expired' : 'not_authenticated',
          message: stateData.error || 'Please log in to Quotewise',
          requiresLogin: true,
        });
        break;

      case AuthState.INSUFFICIENT_PRIVILEGES:
        this.stateManager.setState({
          auth: {
            isAuthenticated: true,
            isStaff: false,
            checkInProgress: false,
          },
          ui: { currentView: 'insufficient-privileges' },
        });
        break;

      case AuthState.AUTHENTICATING:
        this.stateManager.setState({
          auth: { loginInProgress: true },
          ui: { currentView: 'login-in-progress', loadingMessage: 'Logging in...' },
        });
        break;

      case AuthState.CHECKING:
        this.stateManager.setState({
          auth: { checkInProgress: true },
          ui: { currentView: 'loading', loadingMessage: 'Checking authentication...' },
        });
        break;

      // UNKNOWN state - do nothing, wait for next state
      default:
        break;
    }
  }

  private initializeOriginatorSearch(): void {
    const searchInput = document.getElementById('originator-search') as HTMLInputElement;
    const resultsContainer = document.getElementById('originator-results') as HTMLElement;
    const selectedContainer = document.getElementById('selected-originator') as HTMLElement;
    const historyContainer = document.getElementById('search-history') as HTMLElement;
    const loadingIndicator = document.getElementById('search-loading') as HTMLElement;

    if (searchInput && resultsContainer && selectedContainer) {
      this.originatorSearch.initialize({
        searchInput,
        resultsContainer,
        selectedContainer,
        historyContainer,
        loadingIndicator
      });

      // Listen for search state changes
      this.originatorSearch.addListener((searchState: SearchState) => {
        this.handleOriginatorSearchChange(searchState);
      });
    } else {
      console.error('Could not find required originator search elements');
    }
  }

  private handleOriginatorSearchChange(searchState: SearchState): void {
    this.stateManager.setState({
      originator: {
        searchQuery: searchState.query,
        searchResults: searchState.results,
        selectedOriginator: searchState.selectedOriginator,
        isSearching: searchState.isSearching,
        searchHistory: []  // This is managed by the search component
      }
    });

    // Update form validation when originator changes
    this.validateForm();

    // Trigger automatic duplicate checking when originator is selected
    if (searchState.selectedOriginator) {
      this.triggerAutomaticDuplicateCheck();
    }
  }

  private updateOriginatorState(_state: PopupState): void {
    // The originator search component manages its own UI state
    // We just need to ensure form validation is updated
    this.validateForm();
  }

  private validateForm(): void {
    // Form validation is now handled by updateFormValidation method
    // which is called from onStateChange
    this.updateFormValidation(this.stateManager.getState());
  }

  private hasValidQuoteText(): boolean {
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    const quoteText = quoteTextArea?.value?.trim();
    return !!quoteText && quoteText.length >= 10;
  }

  private async handleLogin(): Promise<void> {
    debugLog('Login button clicked');

    try {
      this.stateManager.setState({
        auth: { loginInProgress: true },
        ui: {
          currentView: 'login-in-progress',
          loadingMessage: 'Opening login...'
        }
      });

      // Initiate OAuth login flow
      const result = await this.loginHandler.login();

      if (!result.success) {
        throw new Error(result.error || 'Login failed');
      }

      debugLog('OAuth login completed successfully');

      // Check auth status to get full details
      const authStatus = await this.authChecker.checkAuthStatus();

      if ('isAuthenticated' in authStatus && authStatus.isAuthenticated) {
        // Handle the authentication result
        this.handleAuthSuccess(authStatus);
      } else {
        throw new Error('Login completed but authentication check failed');
      }

    } catch (error) {
      console.error('Login error:', error);

      this.stateManager.setState({
        auth: {
          loginInProgress: false,
          authError: {
            type: 'network_error',
            message: `Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            requiresLogin: true
          }
        },
        ui: {
          currentView: 'auth-required',
          loadingMessage: undefined
        }
      });
    }
  }

  private updateAuthUI(_currentView: string): void {
    const state = this.stateManager.getState();
    
    // Update header status text
    const statusTextElement = document.getElementById('status-text');
    if (statusTextElement) {
      if (state.auth.checkInProgress) {
        statusTextElement.textContent = 'Checking...';
      } else if (state.auth.isAuthenticated) {
        if (state.auth.userInfo) {
          const roleText = state.auth.userInfo.isAdmin ? 'Admin' : 'User';
          statusTextElement.textContent = `${roleText}: ${state.auth.userInfo.username}`;
        } else {
          statusTextElement.textContent = 'Authenticated';
        }
      } else if (state.auth.authError) {
        statusTextElement.textContent = 'Not authenticated';
      } else {
        statusTextElement.textContent = 'Ready';
      }
    }
    
    // Update login button text and state
    const loginButton = document.getElementById('login-button') as HTMLButtonElement;
    if (loginButton) {
      if (state.auth.loginInProgress) {
        loginButton.disabled = true;
        loginButton.textContent = state.ui.loadingMessage || 'Logging in...';
      } else {
        loginButton.disabled = false;
        loginButton.textContent = 'Login to Quotewise';
      }
    }

    // Update auth status display
    const authStatusElement = document.getElementById('auth-status');
    if (authStatusElement && state.auth.userInfo) {
      const statusText = this.authChecker.getStatusSummary(
        state.auth.authError || {
          isAuthenticated: state.auth.isAuthenticated,
          isStaff: state.auth.isStaff,
          username: state.auth.userInfo.username,
          sessionAge: state.auth.sessionAge
        }
      );
      authStatusElement.textContent = statusText;
    }

    // Update error messages
    const errorElement = document.getElementById('auth-error-message');
    if (errorElement) {
      if (state.auth.authError) {
        errorElement.textContent = state.auth.authError.message;
        errorElement.classList.remove('hidden');
      } else {
        errorElement.classList.add('hidden');
      }
    }

    // Show session expiry warning if needed
    const sessionWarning = document.getElementById('session-warning');
    if (sessionWarning) {
      const authStatus: AuthStatus = {
        isAuthenticated: state.auth.isAuthenticated,
        isStaff: state.auth.isStaff,
        username: state.auth.userInfo?.username,
        sessionAge: state.auth.sessionAge
      };
      
      if (state.auth.isAuthenticated && this.authChecker.isSessionNearExpiry(authStatus)) {
        const minutes = Math.floor((state.auth.sessionAge || 0) / 60);
        sessionWarning.textContent = `Session expires in ${minutes} minutes`;
        sessionWarning.classList.remove('hidden');
      } else {
        sessionWarning.classList.add('hidden');
      }
    }
  }

  private handleQuoteTextChange(): void {
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    if (!quoteTextArea) return;

    const text = quoteTextArea.value.trim();
    const errors: string[] = [];
    
    if (!text) {
      errors.push('Quote text is required');
    } else if (text.length < 10) {
      errors.push('Quote text is too short (minimum 10 characters)');
    } else if (text.length > 1000) {
      errors.push('Quote text is too long (maximum 1000 characters)');
    }
    
    this.stateManager.setState({
      tweet: { validationErrors: errors }
    });

    // Update form validation
    this.validateForm();

    // Update character count
    this.updateCharacterCount(text.length);

    // Trigger automatic duplicate checking
    this.triggerAutomaticDuplicateCheck();
  }

  private updateCharacterCount(length: number): void {
    const characterCount = document.getElementById('character-count');
    if (characterCount) {
      characterCount.textContent = `${length}/1000`;
      
      // Add visual indicators for character count
      characterCount.className = 'character-count';
      if (length > 900) {
        characterCount.classList.add('warning');
      } else if (length === 1000) {
        characterCount.classList.add('error');
      }
    }
  }

  private async handleDuplicateCheck(): Promise<void> {
    const state = this.stateManager.getState();
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    const quoteText = quoteTextArea?.value?.trim();
    
    if (!quoteText || !state.originator.selectedOriginator) {
      console.error('Cannot check duplicates: missing quote text or originator');
      return;
    }

    const sourceUrl = state.tweet.data?.url || '';
    const socialHandle = state.tweet.data?.author?.username;
    
    try {
      await this.duplicateChecker.checkForDuplicates(
        quoteText, 
        state.originator.selectedOriginator.id.toString(),
        sourceUrl,
        socialHandle
      );
    } catch (error) {
      console.error('Error checking duplicates:', error);
      // Error handling is done within the DuplicateChecker
    }
  }

  private initializeDuplicateChecker(): void {
    // Set up duplicate checker state listener
    this.duplicateChecker.addListener((duplicateState) => {
      this.stateManager.setState({
        duplicate: duplicateState
      });
    });

    // Re-initialize duplicate display with the real container
    const duplicateContainer = document.getElementById('duplicate-display');
    if (duplicateContainer) {
      this.duplicateDisplay = new DuplicateDisplay({
        container: duplicateContainer,
        onOverride: () => this.handleDuplicateOverride(),
        onEditQuote: () => this.focusQuoteText(),
        onChangeOriginator: () => this.focusOriginatorSearch()
      });
    }
  }

  private updateDuplicateState(state: PopupState): void {
    // Update duplicate display component
    this.duplicateDisplay.updateDisplay(state.duplicate);
    
    // Update collection badge based on duplicate check results
    this.updateCollectionBadge(state);
  }

  private updateCollectionsState(state: PopupState): void {
    // Update collections UI based on state
    const collectionSelect = document.getElementById('collection-select') as HTMLSelectElement;
    const addToCollectionCheckbox = document.getElementById('add-to-collection') as HTMLInputElement;
    const collectionsSection = document.querySelector('.collections-section') as HTMLElement;

    if (collectionSelect && state.collections.selectedCollectionId) {
      collectionSelect.value = state.collections.selectedCollectionId;
    }

    if (addToCollectionCheckbox) {
      addToCollectionCheckbox.checked = state.collections.addToCollection;
    }

    // Update disabled state based on checkbox
    if (collectionsSection) {
      if (state.collections.addToCollection) {
        collectionsSection.classList.remove('disabled');
        if (collectionSelect) {
          collectionSelect.disabled = false;
        }
      } else {
        collectionsSection.classList.add('disabled');
        if (collectionSelect) {
          collectionSelect.disabled = true;
        }
      }
    }
  }

  /**
   * Initialize handle lookup component
   */
  private initializeHandleLookup(): void {
    const lookupContainer = document.getElementById('handle-lookup-display');
    if (lookupContainer) {
      this.handleLookupDisplay.setContainer(lookupContainer);

      // Listen for handle lookup state changes
      this.handleLookup.addListener((lookupState: HandleLookupState) => {
        this.stateManager.setState({
          handleLookup: lookupState
        });
      });
    } else {
      debugLog('Handle lookup container not found - feature will be disabled');
    }
  }

  /**
   * Update handle lookup display state
   */
  private updateHandleLookupState(state: PopupState): void {
    this.handleLookupDisplay.updateDisplay(state.handleLookup);
  }

  /**
   * Trigger automatic handle lookup when tweet data loads
   */
  private async triggerHandleLookup(handle: string): Promise<void> {
    if (!handle?.trim()) {
      return;
    }

    // Don't lookup if originator is already selected
    const state = this.stateManager.getState();
    if (state.originator.selectedOriginator) {
      debugLog('Skipping handle lookup - originator already selected');
      return;
    }

    debugLog(`Triggering handle lookup for @${handle}`);
    await this.handleLookup.lookupByHandle(handle, 'twitter');
  }

  /**
   * Handle using the found originator from handle lookup
   */
  private handleUseFoundOriginator(): void {
    const matchedOriginator = this.handleLookup.getMatchedOriginator();
    if (matchedOriginator) {
      debugLog('Using found originator:', matchedOriginator.full_name);
      this.originatorSearch.selectOriginator(matchedOriginator);
      this.handleLookup.dismiss();
    }
  }

  /**
   * Handle dismissing the lookup result
   */
  private handleDismissHandleLookup(): void {
    this.handleLookup.dismiss();
    this.focusOriginatorSearch();
  }

  private triggerAutomaticDuplicateCheck(): void {
    const state = this.stateManager.getState();
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    const quoteText = quoteTextArea?.value?.trim();
    
    if (!quoteText) {
      return;
    }

    const sourceUrl = state.tweet.data?.url || '';
    const socialHandle = state.tweet.data?.author?.username;
    
    // If originator is selected, include it; otherwise check without originator for smart suggestions
    const originatorId = state.originator.selectedOriginator?.id.toString();
    
    this.duplicateChecker.checkForDuplicatesDebounced(
      quoteText,
      originatorId,
      sourceUrl,
      socialHandle
    );
  }

  private handleDuplicateOverride(): void {
    this.duplicateChecker.overrideRecommendation();
  }

  private focusQuoteText(): void {
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    if (quoteTextArea) {
      quoteTextArea.focus();
      quoteTextArea.select();
    }
  }

  private focusOriginatorSearch(): void {
    const searchInput = document.getElementById('originator-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  private async handleSubmitQuote(): Promise<void> {
    const state = this.stateManager.getState();
    
    if (!state.tweet.data) {
      this.stateManager.setState({
        ui: { 
          currentView: 'error',
          loadingMessage: 'No tweet data available'
        }
      });
      return;
    }

    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    const quoteText = quoteTextArea?.value?.trim();
    const attributionType = (document.getElementById('attribution-type') as HTMLSelectElement)?.value as AttributionType;

    if (!quoteText) {
      this.stateManager.setState({
        ui: { 
          currentView: 'error',
          loadingMessage: 'Quote text is required'
        }
      });
      return;
    }

    this.stateManager.setState({
      submission: { 
        isSubmitting: true,
        progress: { step: 'Submitting quote...', percentage: 50 }
      },
      ui: { 
        currentView: 'loading',
        loadingMessage: 'Submitting quote...' 
      }
    });

    try {
      const submissionData: QuoteSubmissionRequest = {
        text: quoteText,
        originator_id: state.originator.selectedOriginator?.id,
        source_url: state.tweet.data.url,
        platform_code: 'TX',
        likes_count: state.tweet.data.likes || 0,
        quote_date: state.tweet.data.date || undefined,
        attribution_type: attributionType,
        // Backend dependency: API should accept platform_data.is_protected to flag private/limited visibility posts (feature parity pending)
        platform_data: state.tweet.data.platform_data
      };

      const response = await this.messageHandler.sendMessage({
        type: MessageType.SUBMIT_QUOTE,
        data: submissionData
      });

      if (response.success) {
        this.stateManager.setState({
          submission: {
            isSubmitting: false,
            lastSubmissionResult: {
              success: true,
              message: 'Quote added successfully!',
              quoteId: response.quoteId
            }
          },
          ui: { currentView: 'success' }
        });
      } else {
        this.stateManager.setState({
          submission: {
            isSubmitting: false,
            lastSubmissionResult: {
              success: false,
              message: response.error || 'Failed to submit quote'
            }
          },
          ui: { 
            currentView: 'error',
            loadingMessage: response.error || 'Failed to submit quote'
          }
        });
      }

    } catch (error) {
      console.error('Error submitting quote:', error);
      this.stateManager.setState({
        submission: {
          isSubmitting: false,
          lastSubmissionResult: {
            success: false,
            message: 'Failed to submit quote'
          }
        },
        ui: { 
          currentView: 'error',
          loadingMessage: 'Failed to submit quote'
        }
      });
    }
  }

  private async checkAuthStatus(): Promise<void> {
    debugLog('checkAuthStatus: Starting auth check');

    this.stateManager.setState({
      auth: { checkInProgress: true },
      ui: {
        currentView: 'loading',
        loadingMessage: 'Checking authentication...'
      }
    });

    try {
      debugLog('checkAuthStatus: Sending AUTH_STATE_GET message to service worker');

      // Set a reasonable timeout for auth check
      const authPromise = chrome.runtime.sendMessage({ type: 'AUTH_STATE_GET' });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Auth check timeout')), 10000)
      );

      const response = await Promise.race([authPromise, timeoutPromise]);

      debugLog('checkAuthStatus: Received response from service worker:', response);

      if (chrome.runtime.lastError) {
        console.error('checkAuthStatus: Chrome runtime error:', chrome.runtime.lastError);
        throw new Error(chrome.runtime.lastError.message);
      }

      // Validate AUTH_STATE_GET response format
      if (response && typeof response === 'object' && response.success && response.data) {
        const authState = response.data.state;

        if (authState === 'AUTHENTICATED') {
          debugLog('checkAuthStatus: User is authenticated, calling handleAuthSuccess');
          this.handleAuthSuccess({
            isAuthenticated: true,
            isStaff: false, // OAuth doesn't provide staff status
            username: response.data.username
          });
        } else {
          debugLog('checkAuthStatus: User is not authenticated (state: ' + authState + '), calling handleAuthError');
          this.handleAuthError({
            type: 'not_authenticated',
            message: response.data.error || 'Please log in to Quotewise',
            requiresLogin: true
          });
        }
      } else {
        console.error('checkAuthStatus: Invalid response format:', response);
        // Try direct API fallback for invalid responses
        await this.fallbackAuthCheck();
      }

    } catch (error) {
      console.error('checkAuthStatus: Error occurred:', error);

      // For timeout or network errors, try direct API fallback
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('network'))) {
        debugLog('checkAuthStatus: Attempting direct API fallback due to network/timeout error');
        await this.fallbackAuthCheck();
      } else {
        this.handleAuthError({
          type: 'network_error',
          message: 'Failed to check authentication status',
          requiresLogin: false
        });
      }
    }
  }

  /**
   * Fallback authentication check using direct API call
   */
  private async fallbackAuthCheck(): Promise<void> {
    try {
      debugLog('fallbackAuthCheck: Attempting direct API auth check');
      const authChecker = new AuthChecker(apiClient);
      const authResult = await authChecker.checkAuthStatus();
      
      if ('type' in authResult) {
        // AuthError
        this.handleAuthError(authResult);
      } else {
        // AuthStatus
        debugLog('fallbackAuthCheck: Direct API auth successful:', authResult);
        this.handleAuthSuccess(authResult);
      }
    } catch (error) {
      console.error('fallbackAuthCheck: Direct API auth also failed:', error);
      this.handleAuthError({
        type: 'network_error',
        message: 'Unable to verify authentication status',
        requiresLogin: false
      });
    }
  }

  private handleAuthError(authError: AuthError): void {
    debugLog('Authentication error:', authError);
    
    this.stateManager.setState({
      auth: {
        isAuthenticated: false,
        isStaff: false,
        checkInProgress: false,
        authError: authError
      },
      ui: {
        currentView: 'auth-required'
      }
    });
  }

  private handleAuthSuccess(authStatus: AuthStatus): void {
    debugLog('Authentication success:', authStatus);

    // Check if user has sufficient privileges
    const privilegeError = this.authChecker.validatePrivileges(authStatus);
    
    if (privilegeError) {
      if (privilegeError.type === 'insufficient_privileges') {
        this.stateManager.setState({
          auth: {
            isAuthenticated: authStatus.isAuthenticated,
            isStaff: authStatus.isStaff,
            userInfo: authStatus.username ? { 
              username: authStatus.username, 
              isAdmin: authStatus.isStaff 
            } : undefined,
            sessionExpiry: authStatus.sessionExpiry ? new Date(authStatus.sessionExpiry) : undefined,
            sessionAge: authStatus.sessionAge,
            checkInProgress: false,
            authError: privilegeError
          },
          ui: {
            currentView: 'insufficient-privileges'
          }
        });
        return;
      } else {
        // Other privilege errors (session expired, etc.)
        this.handleAuthError(privilegeError);
        return;
      }
    }

    // User is fully authenticated with proper privileges
    this.stateManager.setState({
      auth: {
        isAuthenticated: authStatus.isAuthenticated,
        isStaff: authStatus.isStaff,
        userInfo: authStatus.username ? { 
          username: authStatus.username, 
          isAdmin: authStatus.isStaff 
        } : undefined,
        sessionExpiry: authStatus.sessionExpiry ? new Date(authStatus.sessionExpiry) : undefined,
        sessionAge: authStatus.sessionAge,
        checkInProgress: false,
        authError: undefined
      },
      ui: {
        currentView: 'quote-capture'
      }
    });

    // Load user's collections after successful authentication
    this.loadCollections();
  }

  private async loadTweetData(): Promise<void> {
    this.stateManager.setState({
      tweet: { isLoading: true }
    });

    try {
      const response = await this.messageHandler.sendMessage({
        type: MessageType.GET_TWEET_DATA
      });

      if (response && response.success && response.data) {
        this.stateManager.setState({
          tweet: {
            data: response.data,
            isLoading: false,
            error: undefined
          }
        });
        
        // Populate the form
        const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
        if (quoteTextArea && !quoteTextArea.value.trim()) {
          quoteTextArea.value = response.data.text;
          this.handleQuoteTextChange(); // Trigger validation
        }

        // Populate tweet information display
        this.populateTweetInfo(response.data);

        // Auto-trigger handle lookup for the tweet author
        if (response.data.author?.username) {
          this.triggerHandleLookup(response.data.author.username);
        }

        // Auto-trigger duplicate check with social handle
        this.triggerAutomaticDuplicateCheck();
        
      } else {
        // No tweet data, but check if user is authenticated
        const currentState = this.stateManager.getState();
        if (currentState.auth.isAuthenticated) {
          // User is authenticated but not on a tweet page
          this.stateManager.setState({
            tweet: {
              data: null,
              isLoading: false,
              error: 'Not on a tweet page'
            },
            ui: { 
              currentView: 'not-tweet-page',
              loadingMessage: ''
            }
          });
        } else {
          // Not authenticated - this shouldn't happen since we check auth first
          // but handle it just in case
          this.stateManager.setState({
            tweet: {
              data: null,
              isLoading: false,
              error: 'No tweet data found'
            },
            ui: { 
              currentView: 'error',
              loadingMessage: 'No tweet data found'
            }
          });
        }
      }
    } catch (error) {
      console.error('Error loading tweet data:', error);
      this.stateManager.setState({
        tweet: {
          data: null,
          isLoading: false,
          error: 'Failed to load tweet data'
        },
        ui: { 
          currentView: 'error',
          loadingMessage: 'Failed to load tweet data'
        }
      });
    }
  }

  private async loadCollections(): Promise<void> {
    this.stateManager.setState({
      collections: { isLoading: true }
    });

    try {
      // Load user preferences first
      await this.loadCollectionsPreferences();

      // Fetch collections from API
      const response = await apiClient.listCollections();
      
      this.stateManager.setState({
        collections: {
          collections: response.collections,
          selectedCollectionId: this.stateManager.getState().collections.selectedCollectionId || response.default_collection_id || undefined,
          isLoading: false,
          error: undefined
        }
      });

      // Update the UI
      this.updateCollectionsUI(response.collections, response.default_collection_id);

    } catch (error) {
      console.error('Error loading collections:', error);
      this.stateManager.setState({
        collections: {
          collections: [],
          isLoading: false,
          error: 'Failed to load collections'
        }
      });
    }
  }

  private async loadCollectionsPreferences(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['addToCollection', 'selectedCollectionId']);
      
      this.stateManager.setState({
        collections: {
          addToCollection: result.addToCollection !== undefined ? result.addToCollection : true,
          selectedCollectionId: result.selectedCollectionId
        }
      });

      // Update UI elements with saved preferences
      const addToCollectionCheckbox = document.getElementById('add-to-collection') as HTMLInputElement;
      if (addToCollectionCheckbox) {
        addToCollectionCheckbox.checked = this.stateManager.getState().collections.addToCollection;
      }

    } catch (error) {
      console.error('Error loading collections preferences:', error);
    }
  }

  private async saveCollectionsPreferences(): Promise<void> {
    try {
      const state = this.stateManager.getState().collections;
      await chrome.storage.local.set({
        addToCollection: state.addToCollection,
        selectedCollectionId: state.selectedCollectionId
      });
    } catch (error) {
      console.error('Error saving collections preferences:', error);
    }
  }

  private updateCollectionsUI(collections: Collection[], defaultCollectionId?: string | null): void {
    const collectionSelect = document.getElementById('collection-select') as HTMLSelectElement;
    if (!collectionSelect) return;

    // Clear existing options
    collectionSelect.innerHTML = '';

    if (collections.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No collections available';
      option.disabled = true;
      collectionSelect.appendChild(option);
      return;
    }

    // Add collections to dropdown
    collections.forEach(collection => {
      const option = document.createElement('option');
      option.value = collection.id;
      
      let displayText = collection.name;
      if (collection.is_default) {
        displayText += ' (default)';
      }
      if (collection.quote_count > 0) {
        displayText += ` (${collection.quote_count} quotes)`;
      }
      
      option.textContent = displayText;
      collectionSelect.appendChild(option);
    });

    // Set selected collection
    const state = this.stateManager.getState().collections;
    if (state.selectedCollectionId) {
      collectionSelect.value = state.selectedCollectionId;
    } else if (defaultCollectionId) {
      collectionSelect.value = defaultCollectionId;
      this.stateManager.setState({
        collections: { selectedCollectionId: defaultCollectionId }
      });
    }
  }

  private handleCollectionChange(): void {
    const collectionSelect = document.getElementById('collection-select') as HTMLSelectElement;
    if (!collectionSelect) return;

    this.stateManager.setState({
      collections: { selectedCollectionId: collectionSelect.value }
    });

    // Save preference
    this.saveCollectionsPreferences();
  }

  private handleAddToCollectionToggle(): void {
    const addToCollectionCheckbox = document.getElementById('add-to-collection') as HTMLInputElement;
    if (!addToCollectionCheckbox) return;

    this.stateManager.setState({
      collections: { addToCollection: addToCollectionCheckbox.checked }
    });

    // Save preference
    this.saveCollectionsPreferences();
    
    // Trigger immediate UI update
    this.updateCollectionsState(this.stateManager.getState());
  }

  private async handleRefreshPageCheck(): Promise<void> {
    // Re-check the current page for tweet data
    debugLog('Refreshing page check...');
    
    this.stateManager.setState({
      ui: { 
        currentView: 'loading',
        loadingMessage: 'Checking current page...' 
      }
    });

    try {
      // Force reload tweet data
      await this.loadTweetData();
    } catch (error) {
      console.error('Error during refresh page check:', error);
      this.stateManager.setState({
        ui: { 
          currentView: 'error',
          loadingMessage: 'Failed to check current page'
        }
      });
    }
  }

  private populateTweetInfo(tweetData: TwitterData): void {
    
    // Tweet info (date, URL)
    const tweetInfoElement = document.getElementById('tweet-info');
    if (tweetInfoElement && tweetData.date) {
      const date = new Date(tweetData.date);
      tweetInfoElement.innerHTML = `
        <div class="tweet-date">Posted: ${date.toLocaleDateString()}</div>
        <div class="tweet-url"><a href="${tweetData.url}" target="_blank">View Tweet</a></div>
      `;
    }

    // Author info
    const authorInfoElement = document.getElementById('author-info');
    if (authorInfoElement && tweetData.author) {
      let authorHtml = `
        <div class="author-name">@${tweetData.author.username}</div>
        <div class="author-display">${tweetData.author.displayName || tweetData.author.username}</div>
      `;
      
      // Add retweeter info if this is a retweet
      if (tweetData.retweeter && tweetData.tweetType === 'retweet') {
        authorHtml += `
          <div class="retweet-context">
            <span class="retweet-indicator">🔄 Retweeted by @${tweetData.retweeter.username}</span>
          </div>
        `;
      }
      
      authorInfoElement.innerHTML = authorHtml;
    }

    // Metrics info
    const metricsInfoElement = document.getElementById('metrics-info');
    if (metricsInfoElement) {
      metricsInfoElement.innerHTML = `
        <div class="metrics">
          <span class="likes">❤️ ${tweetData.likes || 0}</span>
          <span class="retweets">🔄 ${tweetData.retweets || 0}</span>
          <span class="replies">💬 ${tweetData.replies || 0}</span>
        </div>
      `;
    }
  }

  /**
   * Update collection badge based on duplicate check results
   */
  private updateCollectionBadge(state: PopupState): void {
    const badgeInfo = this.determineCollectionBadgeState(state);
    
    // Send message to service worker to update badge
    chrome.runtime.sendMessage({
      type: 'UPDATE_COLLECTION_BADGE',
      data: badgeInfo
    }).catch(error => {
      console.error('Error sending badge update message:', error);
    });
  }

  /**
   * Determine collection badge state from duplicate check results
   */
  private determineCollectionBadgeState(state: PopupState): import('../types/chrome').CollectionBadgeInfo {
    const duplicate = state.duplicate;
    const tweet = state.tweet.data;
    
    // Default state - ready but not processed
    if (!duplicate.hasChecked || !duplicate.result) {
      return {
        state: duplicate.isChecking ? 'processing' : 'ready',
        quoteText: tweet?.text?.substring(0, 50)
      };
    }

    const result = duplicate.result;
    
    // Check if any exact matches are in user's collections
    const inUserCollections = result.matches.some(match => 
      match.similarity >= 95 && match.in_user_collections
    );
    
    if (inUserCollections) {
      return {
        state: 'already_collected',
        quoteText: tweet?.text?.substring(0, 50)
      };
    }

    // Check if quote exists in Quotewise but not in user collections
    const exactMatchExists = result.matches.some(match => match.similarity >= 95);

    if (result.in_quotewise || exactMatchExists) {
      return {
        state: 'exists_not_collected',
        quoteText: tweet?.text?.substring(0, 50)
      };
    }

    // New quote not in Quotewise
    return {
      state: 'new_quote',
      quoteText: tweet?.text?.substring(0, 50)
    };
  }

  /**
   * Handle navigation monitoring based on current view
   */
  private handleNavigationMonitoring(currentView: string): void {
    if (currentView === 'not-tweet-page') {
      // Start monitoring for navigation changes
      this.startNavigationMonitoring();
    } else {
      // Stop monitoring when not needed
      this.stopNavigationMonitoring();
    }
  }

  /**
   * Start monitoring for navigation changes to tweet pages
   */
  private startNavigationMonitoring(): void {
    if (this.navigationCheckInterval) return; // Already monitoring
    
    debugLog('Starting navigation monitoring...');
    this.navigationCheckInterval = setInterval(() => {
      this.checkForNavigationChange();
    }, 1000); // Check every 1 second for faster response
  }

  /**
   * Stop navigation monitoring
   */
  private stopNavigationMonitoring(): void {
    if (this.navigationCheckInterval) {
      debugLog('Stopping navigation monitoring...');
      clearInterval(this.navigationCheckInterval);
      this.navigationCheckInterval = null;
    }
  }

  /**
   * Check if user has navigated to a tweet page
   */
  private async checkForNavigationChange(): Promise<void> {
    try {
      debugLog('Checking for navigation change...');
      
      // Force the content script to re-extract data by requesting it fresh
      await this.messageHandler.sendMessage({
        type: MessageType.EXTRACT_TWEET_DATA
      });

      // Then check if we got tweet data
      const dataResponse = await this.messageHandler.sendMessage({
        type: MessageType.GET_TWEET_DATA
      });

      if (dataResponse && dataResponse.success && dataResponse.data) {
        debugLog('Navigation detected: Found tweet data, switching to quote capture');
        // Found tweet data! Stop monitoring and switch to quote capture
        this.stopNavigationMonitoring();
        await this.loadTweetData();
      } else {
        debugLog('Still no tweet data found');
      }
    } catch (error) {
      debugLog('Error during navigation check:', error);
      // Continue monitoring even if there's an error
    }
  }

  /**
   * Cleanup when popup is being destroyed
   */
  destroy(): void {
    this.stopNavigationMonitoring();
    this.handleLookup.destroy();
  }
}

// Global variable to prevent double initialization
let popupInstance: SimpleQuotewisePopup | null = null;

// Fix for Chrome extension popup width issue on Mac
function fixPopupWidthOnMac(): void {
  chrome.runtime.getPlatformInfo(info => {
    if (info.os === 'mac') {
      setTimeout(() => {
        // Force redraw by increasing width by 1px to fix Mac rendering bug
        const currentWidth = document.body.clientWidth;
        document.body.style.width = `${currentWidth + 1}px`;
        debugLog('Applied Mac width fix:', currentWidth, '→', currentWidth + 1);
      }, 250); // Allow popup animation to complete
    }
  });
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Prevent double initialization
  if (popupInstance) {
    debugLog('Popup already initialized, skipping...');
    return;
  }

  try {
    debugLog('Starting popup initialization...');
    
    // Apply Mac width fix
    fixPopupWidthOnMac();
    
    popupInstance = new SimpleQuotewisePopup();
  } catch (error) {
    console.error('Failed to initialize popup:', error);
    
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
      errorElement.textContent = 'Failed to initialize popup. Please refresh and try again.';
    }
    
    const errorSection = document.getElementById('error-state');
    if (errorSection) {
      errorSection.classList.remove('hidden');
    }
  }
});
