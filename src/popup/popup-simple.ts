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
import { AuthChecker } from '../auth/auth-checker';
import { LoginHandler } from '../auth/login-handler';
import type { AuthStatus, AuthError } from '../types/auth';
import { apiClient } from '../api/quotewise-api';
import { OriginatorSearch, SearchState } from '../search/originator-search';
import type { OriginatorSearchResult } from '../types/api';
import { DuplicateChecker, DuplicateState } from '../duplicate/duplicate-checker';
import { DuplicateDisplay } from '../duplicate/duplicate-display';

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
  currentView: 'loading' | 'auth-required' | 'insufficient-privileges' | 'quote-capture' | 'error' | 'success' | 'login-in-progress';
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

interface PopupState {
  auth: AuthenticationState;
  tweet: TweetDataState;
  ui: UIState;
  originator: OriginatorState;
  submission: SubmissionState;
  duplicate: DuplicateState;
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
      }
    };
  }

  setState(updates: PartialPopupState): void {
    Object.keys(updates).forEach(key => {
      const section = key as keyof PopupState;
      if (updates[section]) {
        this.state[section] = { ...this.state[section], ...updates[section] } as any;
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
    
    this.init();
  }

  private async init(): Promise<void> {
    console.log('Initializing Quotewise popup');
    
    try {
      this.setupEventListeners();
      this.initializeOriginatorSearch();
      this.initializeDuplicateChecker();
      this.stateManager.subscribe(this.onStateChange.bind(this));
      
      await this.checkAuthStatus();
      await this.loadTweetData();
      
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
  }

  private updateView(currentView: string): void {
    const sections = [
      'auth-required', 
      'insufficient-privileges', 
      'quote-capture', 
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

  private updateOriginatorState(state: PopupState): void {
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
    console.log('Login button clicked');
    
    try {
      this.stateManager.setState({
        auth: { loginInProgress: true },
        ui: { 
          currentView: 'login-in-progress',
          loadingMessage: 'Opening login page...'
        }
      });

      // Open login page
      await this.loginHandler.openLoginPage();

      this.stateManager.setState({
        ui: { loadingMessage: 'Waiting for login...' }
      });

      // Wait for authentication to complete
      const authStatus = await this.authChecker.waitForAuthChange(60000); // 1 minute timeout

      console.log('Login completed, auth status:', authStatus);
      
      // Handle the authentication result
      this.handleAuthSuccess(authStatus);

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

  private updateAuthUI(currentView: string): void {
    const state = this.stateManager.getState();
    
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
    
    try {
      await this.duplicateChecker.checkForDuplicates(
        quoteText, 
        state.originator.selectedOriginator.id.toString(),
        sourceUrl
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
  }

  private triggerAutomaticDuplicateCheck(): void {
    const state = this.stateManager.getState();
    const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
    const quoteText = quoteTextArea?.value?.trim();
    
    if (!quoteText || !state.originator.selectedOriginator) {
      return;
    }

    const sourceUrl = state.tweet.data?.url || '';
    
    this.duplicateChecker.checkForDuplicatesDebounced(
      quoteText,
      state.originator.selectedOriginator.id.toString(),
      sourceUrl
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
        quote_text: quoteText,
        originator_id: state.originator.selectedOriginator?.id,
        sighting_url: state.tweet.data.url,
        platform_code: 'TX',
        likes_count: state.tweet.data.likes || 0,
        post_date: state.tweet.data.date || undefined,
        attribution_type: attributionType,
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
    this.stateManager.setState({
      auth: { checkInProgress: true },
      ui: { 
        currentView: 'loading',
        loadingMessage: 'Checking authentication...' 
      }
    });

    try {
      const authResult = await this.authChecker.checkAuthStatus();

      if ('type' in authResult) {
        // Authentication error
        this.handleAuthError(authResult);
      } else {
        // Valid authentication status
        this.handleAuthSuccess(authResult);
      }

    } catch (error) {
      console.error('Error checking auth status:', error);
      this.stateManager.setState({
        auth: { 
          isAuthenticated: false,
          isStaff: false,
          checkInProgress: false,
          authError: {
            type: 'network_error',
            message: 'Failed to check authentication status',
            requiresLogin: false
          }
        },
        ui: { 
          currentView: 'error',
          loadingMessage: 'Failed to check authentication status'
        }
      });
    }
  }

  private handleAuthError(authError: AuthError): void {
    console.log('Authentication error:', authError);
    
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
    console.log('Authentication success:', authStatus);

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
  }

  private async loadTweetData(): Promise<void> {
    this.stateManager.setState({
      tweet: { isLoading: true }
    });

    try {
      const response = await this.messageHandler.sendMessage({
        type: MessageType.GET_TWEET_DATA
      });

      if (response.success && response.data) {
        this.stateManager.setState({
          tweet: {
            data: response.data,
            isLoading: false,
            error: undefined
          }
        });
        
        // Populate the form
        const quoteTextArea = document.getElementById('quote-text') as HTMLTextAreaElement;
        if (quoteTextArea && !quoteTextArea.value) {
          quoteTextArea.value = response.data.text;
          this.handleQuoteTextChange(); // Trigger validation
        }
        
      } else {
        this.stateManager.setState({
          tweet: {
            data: null,
            isLoading: false,
            error: 'No tweet data found. Make sure you are on a tweet page.'
          },
          ui: { 
            currentView: 'error',
            loadingMessage: 'No tweet data found. Make sure you are on a tweet page.'
          }
        });
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
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  try {
    new SimpleQuotewisePopup();
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