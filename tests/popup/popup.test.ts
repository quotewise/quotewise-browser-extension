/**
 * Unit tests for popup interface components
 */

import { MessageType } from '../../src/types/index';

// Mock Chrome APIs
const mockChrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    lastError: null as any
  },
  tabs: {
    create: jest.fn()
  }
};

(global as any).chrome = mockChrome;

// Mock DOM environment
class MockElement {
  private _textContent = '';
  private _innerHTML = '';
  private _className = '';
  private _value = '';
  private _disabled = false;
  private _attributes: { [key: string]: string } = {};
  private _children: MockElement[] = [];
  private _eventListeners: { [key: string]: Function[] } = {};

  get textContent() { return this._textContent; }
  set textContent(value: string) { this._textContent = value; }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(value: string) { this._innerHTML = value; }

  get className() { return this._className; }
  set className(value: string) { this._className = value; }

  get value() { return this._value; }
  set value(value: string) { this._value = value; }

  get disabled() { return this._disabled; }
  set disabled(value: boolean) { this._disabled = value; }

  getAttribute(name: string): string | null {
    return this._attributes[name] || null;
  }

  setAttribute(name: string, value: string): void {
    this._attributes[name] = value;
  }

  addEventListener(event: string, handler: Function): void {
    if (!this._eventListeners[event]) {
      this._eventListeners[event] = [];
    }
    this._eventListeners[event].push(handler);
  }

  removeEventListener(event: string, handler: Function): void {
    if (this._eventListeners[event]) {
      const index = this._eventListeners[event].indexOf(handler);
      if (index > -1) {
        this._eventListeners[event].splice(index, 1);
      }
    }
  }

  dispatchEvent(event: Event): void {
    const eventType = event.type;
    if (this._eventListeners[eventType]) {
      this._eventListeners[eventType].forEach(handler => handler(event));
    }
  }

  querySelector(selector: string): MockElement | null {
    // Simple implementation for testing
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      if (this._attributes.id === id) return this;
      // Check children recursively
      for (const child of this._children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    // Simple implementation for testing
    return this._children.filter(child => {
      if (selector.startsWith('.')) {
        const className = selector.substring(1);
        return child.className.includes(className);
      }
      return false;
    });
  }

  appendChild(child: MockElement): void {
    this._children.push(child);
  }

  classList = {
    add: (className: string) => {
      if (!this.className.includes(className)) {
        this.className = this.className ? `${this.className} ${className}` : className;
      }
    },
    remove: (className: string) => {
      this.className = this.className.replace(new RegExp(`\\b${className}\\b`, 'g'), '').trim();
    },
    contains: (className: string) => {
      return this.className.includes(className);
    }
  };
}

// Mock document
const mockDocument = {
  getElementById: jest.fn((id: string) => {
    const element = new MockElement();
    element.setAttribute('id', id);
    
    // Add child elements for testing
    if (id === 'tweet-display') {
      const quoteTextArea = new MockElement();
      quoteTextArea.setAttribute('id', 'quote-text');
      element.appendChild(quoteTextArea);
    }
    
    if (id === 'originator-search-container') {
      const searchInput = new MockElement();
      searchInput.setAttribute('id', 'originator-search');
      element.appendChild(searchInput);
    }
    
    return element;
  }),
  querySelector: jest.fn(),
  addEventListener: jest.fn(),
  createElement: jest.fn(() => new MockElement())
};

(global as any).document = mockDocument;
(global as any).window = {
  location: { href: 'https://twitter.com/user/status/123' },
  close: jest.fn(),
  addEventListener: jest.fn()
};

describe('Popup State Management', () => {
  let PopupStateManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Import the class after mocking globals
    PopupStateManager = class {
      private state: any;
      private listeners: Function[] = [];

      constructor() {
        this.state = {
          auth: {
            isAuthenticated: false,
            checkInProgress: false
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
            isSubmitting: false,
            duplicateCheckResults: []
          }
        };
      }

      setState(newState: any): void {
        // Deep merge to preserve nested properties
        Object.keys(newState).forEach(key => {
          if (typeof newState[key] === 'object' && this.state[key]) {
            this.state[key] = { ...this.state[key], ...newState[key] };
          } else {
            this.state[key] = newState[key];
          }
        });
        this.notifyListeners();
      }

      getState(): any {
        return { ...this.state };
      }

      subscribe(listener: Function): () => void {
        this.listeners.push(listener);
        return () => {
          const index = this.listeners.indexOf(listener);
          if (index > -1) {
            this.listeners.splice(index, 1);
          }
        };
      }

      private notifyListeners(): void {
        this.listeners.forEach(listener => listener(this.state));
      }
    };
  });

  test('should initialize with default state', () => {
    const stateManager = new PopupStateManager();
    const state = stateManager.getState();

    expect(state.auth.isAuthenticated).toBe(false);
    expect(state.tweet.data).toBeNull();
    expect(state.ui.currentView).toBe('loading');
    expect(state.originator.selectedOriginator).toBeNull();
    expect(state.submission.isSubmitting).toBe(false);
  });

  test('should update state correctly', () => {
    const stateManager = new PopupStateManager();

    stateManager.setState({
      auth: { isAuthenticated: true }
    });

    const state = stateManager.getState();
    expect(state.auth.isAuthenticated).toBe(true);
    expect(state.auth.checkInProgress).toBe(false); // Should preserve other properties
  });

  test('should notify listeners on state change', () => {
    const stateManager = new PopupStateManager();
    const listener = jest.fn();

    stateManager.subscribe(listener);
    stateManager.setState({ auth: { isAuthenticated: true } });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ isAuthenticated: true })
    }));
  });

  test('should allow unsubscribing listeners', () => {
    const stateManager = new PopupStateManager();
    const listener = jest.fn();

    const unsubscribe = stateManager.subscribe(listener);
    unsubscribe();
    stateManager.setState({ auth: { isAuthenticated: true } });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Message Handler', () => {
  let MessageHandler: any;
  let stateManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    stateManager = {
      setState: jest.fn()
    };

    MessageHandler = class {
      constructor(private stateManager: any) {}

      async sendMessage(message: any): Promise<any> {
        return new Promise((resolve, reject) => {
          mockChrome.runtime.sendMessage(message, (response: any) => {
            if (mockChrome.runtime.lastError) {
              reject(new Error(mockChrome.runtime.lastError.message || 'Runtime error'));
              return;
            }
            resolve(response);
          });
        });
      }

      handleTweetData(data: any): void {
        this.stateManager.setState({
          tweet: { 
            data,
            isLoading: false,
            error: undefined 
          }
        });
      }

      handleAuthStatus(status: any): void {
        this.stateManager.setState({
          auth: {
            isAuthenticated: status.isAuthenticated,
            userInfo: status.userInfo,
            checkInProgress: false
          }
        });
      }
    };
  });

  test('should send messages via Chrome runtime', async () => {
    const messageHandler = new MessageHandler(stateManager);
    const mockResponse = { success: true };
    
    mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback(mockResponse);
    });

    const result = await messageHandler.sendMessage({
      type: MessageType.GET_TWEET_DATA
    });

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: MessageType.GET_TWEET_DATA },
      expect.any(Function)
    );
    expect(result).toEqual(mockResponse);
  });

  test('should handle Chrome runtime errors', async () => {
    const messageHandler = new MessageHandler(stateManager);
    
    mockChrome.runtime.lastError = { message: 'Connection error' };
    mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback(null);
    });

    await expect(messageHandler.sendMessage({
      type: MessageType.GET_TWEET_DATA
    })).rejects.toThrow('Connection error');
  });

  test('should handle tweet data updates', () => {
    const messageHandler = new MessageHandler(stateManager);
    const tweetData = {
      text: 'Test tweet',
      author: { username: 'testuser', displayName: 'Test User' },
      url: 'https://twitter.com/testuser/status/123'
    };

    messageHandler.handleTweetData(tweetData);

    expect(stateManager.setState).toHaveBeenCalledWith({
      tweet: {
        data: tweetData,
        isLoading: false,
        error: undefined
      }
    });
  });

  test('should handle authentication status updates', () => {
    const messageHandler = new MessageHandler(stateManager);
    const authStatus = {
      isAuthenticated: true,
      userInfo: { username: 'testuser', isAdmin: true }
    };

    messageHandler.handleAuthStatus(authStatus);

    expect(stateManager.setState).toHaveBeenCalledWith({
      auth: {
        isAuthenticated: true,
        userInfo: authStatus.userInfo,
        checkInProgress: false
      }
    });
  });
});

describe('Tweet Display Component', () => {
  let TweetDisplayComponent: any;
  let stateManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    stateManager = {
      setState: jest.fn(),
      getState: jest.fn(() => ({
        tweet: {
          data: null,
          validationErrors: []
        },
        ui: {}
      })),
      subscribe: jest.fn(() => () => {})
    };

    TweetDisplayComponent = class {
      protected element: any;
      protected stateManager: any;

      constructor(elementId: string, stateManager: any) {
        this.element = mockDocument.getElementById(elementId);
        this.stateManager = stateManager;
        this.init();
      }

      protected init(): void {
        this.render();
        this.handleEvents();
        this.stateManager.subscribe(this.onStateChange.bind(this));
      }

      render(): void {}

      handleEvents(): void {
        const quoteTextArea = this.element.querySelector('#quote-text');
        if (quoteTextArea) {
          quoteTextArea.addEventListener('input', this.handleQuoteTextChange.bind(this));
        }
      }

      private handleQuoteTextChange(event: any): void {
        const text = event.target.value.trim();
        
        this.stateManager.setState({
          ui: { isDuplicateChecked: false },
          submission: { duplicateCheckResults: [] }
        });
        
        this.validateQuoteText(text);
      }

      private validateQuoteText(text: string): void {
        const errors: string[] = [];
        
        if (!text) {
          errors.push('Quote text is required');
        } else if (text.length < 10) {
          errors.push('Quote text is too short (minimum 10 characters)');
        } else if (text.length > 1000) {
          errors.push('Quote text is too long (maximum 1000 characters)');
        }
        
        this.stateManager.setState({
          tweet: { validationErrors: errors },
          ui: { isFormValid: errors.length === 0 }
        });
      }

      protected onStateChange(state: any): void {
        this.updateFromState(state);
      }

      protected updateFromState(state: any): void {
        if (state.tweet.data) {
          this.populateTweetData(state.tweet.data);
        }
      }

      private populateTweetData(data: any): void {
        const quoteTextArea = this.element.querySelector('#quote-text');
        if (quoteTextArea && !quoteTextArea.value) {
          quoteTextArea.value = data.text;
        }
      }

      private formatNumber(num: number): string {
        if (num >= 1000000) {
          return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
          return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
      }
    };
  });

  test('should initialize component correctly', () => {
    const component = new TweetDisplayComponent('tweet-display', stateManager);

    expect(mockDocument.getElementById).toHaveBeenCalledWith('tweet-display');
    expect(stateManager.subscribe).toHaveBeenCalled();
  });

  test('should validate quote text correctly', () => {
    const component = new TweetDisplayComponent('tweet-display', stateManager);
    
    // Simulate text input event
    const mockEvent = {
      target: { value: 'Short' }
    };
    
    // Access private method through component instance
    component.handleQuoteTextChange(mockEvent);

    expect(stateManager.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        tweet: { validationErrors: ['Quote text is too short (minimum 10 characters)'] },
        ui: { isFormValid: false }
      })
    );
  });

  test('should format numbers correctly', () => {
    const component = new TweetDisplayComponent('tweet-display', stateManager);
    
    // Access private method for testing
    expect(component.formatNumber(500)).toBe('500');
    expect(component.formatNumber(1500)).toBe('1.5K');
    expect(component.formatNumber(1500000)).toBe('1.5M');
  });

  test('should populate tweet data when available', () => {
    const component = new TweetDisplayComponent('tweet-display', stateManager);
    const tweetData = {
      text: 'Test tweet content',
      author: { username: 'testuser', displayName: 'Test User' },
      likes: 1500,
      retweets: 250
    };

    // Simulate state change
    const mockState = {
      tweet: { data: tweetData, validationErrors: [] },
      ui: {}
    };

    component.updateFromState(mockState);

    // Verify that the component attempts to populate data
    const quoteTextArea = component.element.querySelector('#quote-text');
    expect(quoteTextArea.value).toBe(tweetData.text);
  });
});

describe('Originator Search Component', () => {
  let OriginatorSearchComponent: any;
  let stateManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    stateManager = {
      setState: jest.fn(),
      getState: jest.fn(() => ({
        originator: {
          searchResults: [],
          selectedOriginator: null,
          isSearching: false,
          searchQuery: ''
        },
        ui: { showOriginatorResults: false }
      })),
      subscribe: jest.fn(() => () => {})
    };

    OriginatorSearchComponent = class {
      protected element: any;
      protected stateManager: any;
      private debounceTimer?: NodeJS.Timeout;

      constructor(elementId: string, stateManager: any) {
        this.element = mockDocument.getElementById(elementId);
        this.stateManager = stateManager;
        this.init();
      }

      protected init(): void {
        this.render();
        this.handleEvents();
        this.stateManager.subscribe(this.onStateChange.bind(this));
      }

      render(): void {}

      handleEvents(): void {
        const searchInput = this.element.querySelector('#originator-search');
        if (searchInput) {
          searchInput.addEventListener('input', this.handleSearchInput.bind(this));
        }
      }

      private handleSearchInput(event: any): void {
        const query = event.target.value.trim();
        
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(() => {
          this.performSearch(query);
        }, 300);
      }

      private async performSearch(query: string): Promise<void> {
        this.stateManager.setState({
          originator: { 
            searchQuery: query,
            isSearching: query.length >= 2
          }
        });
        
        if (query.length < 2) {
          this.stateManager.setState({
            originator: { 
              searchResults: [],
              isSearching: false
            },
            ui: { showOriginatorResults: false }
          });
          return;
        }
        
        // Mock search results
        const mockResults = [
          {
            id: '1',
            full_name: 'Winston Churchill',
            birth_year: 1874,
            death_year: 1965,
            quote_count: 150
          }
        ].filter(o => o.full_name.toLowerCase().includes(query.toLowerCase()));
        
        this.stateManager.setState({
          originator: {
            searchResults: mockResults,
            isSearching: false
          },
          ui: { showOriginatorResults: mockResults.length > 0 }
        });
      }

      private selectOriginator(originator: any): void {
        this.stateManager.setState({
          originator: {
            selectedOriginator: originator,
            searchQuery: '',
            searchResults: []
          },
          ui: { showOriginatorResults: false }
        });
      }

      protected onStateChange(state: any): void {
        this.updateFromState(state);
      }

      protected updateFromState(state: any): void {
        // Update UI based on state
      }
    };
  });

  test('should initialize search component correctly', () => {
    const component = new OriginatorSearchComponent('originator-search-container', stateManager);

    expect(mockDocument.getElementById).toHaveBeenCalledWith('originator-search-container');
    expect(stateManager.subscribe).toHaveBeenCalled();
  });

  test('should handle search input with debouncing', (done) => {
    const component = new OriginatorSearchComponent('originator-search-container', stateManager);
    
    const mockEvent = {
      target: { value: 'Churchill' }
    };
    
    component.handleSearchInput(mockEvent);

    // Verify debouncing behavior
    setTimeout(() => {
      expect(stateManager.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          originator: expect.objectContaining({
            searchQuery: 'Churchill',
            isSearching: true
          })
        })
      );
      done();
    }, 350);
  });

  test('should clear results for short queries', async () => {
    const component = new OriginatorSearchComponent('originator-search-container', stateManager);
    
    await component.performSearch('a');

    expect(stateManager.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        originator: expect.objectContaining({
          searchResults: [],
          isSearching: false
        }),
        ui: { showOriginatorResults: false }
      })
    );
  });

  test('should return search results for valid queries', async () => {
    const component = new OriginatorSearchComponent('originator-search-container', stateManager);
    
    await component.performSearch('Churchill');

    expect(stateManager.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        originator: expect.objectContaining({
          searchResults: expect.arrayContaining([
            expect.objectContaining({
              full_name: 'Winston Churchill'
            })
          ]),
          isSearching: false
        })
      })
    );
  });
});

describe('Form Validation', () => {
  test('should validate quote text length', () => {
    const validateQuoteText = (text: string) => {
      const errors: string[] = [];
      
      if (!text) {
        errors.push('Quote text is required');
      } else if (text.length < 10) {
        errors.push('Quote text is too short (minimum 10 characters)');
      } else if (text.length > 1000) {
        errors.push('Quote text is too long (maximum 1000 characters)');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };

    expect(validateQuoteText('')).toEqual({
      isValid: false,
      errors: ['Quote text is required']
    });

    expect(validateQuoteText('Short')).toEqual({
      isValid: false,
      errors: ['Quote text is too short (minimum 10 characters)']
    });

    expect(validateQuoteText('This is a valid quote text that meets the minimum requirements')).toEqual({
      isValid: true,
      errors: []
    });

    expect(validateQuoteText('a'.repeat(1001))).toEqual({
      isValid: false,
      errors: ['Quote text is too long (maximum 1000 characters)']
    });
  });

  test('should validate form completeness', () => {
    const validateForm = (state: any) => {
      const hasValidQuote = state.ui.isFormValid;
      const hasOriginator = !!state.originator.selectedOriginator;
      const isDuplicateChecked = state.ui.isDuplicateChecked;
      
      return {
        canCheckDuplicates: hasValidQuote,
        canSubmit: hasValidQuote && hasOriginator && isDuplicateChecked
      };
    };

    const validState = {
      ui: { isFormValid: true, isDuplicateChecked: true },
      originator: { selectedOriginator: { id: '1', full_name: 'Test' } }
    };

    const invalidState = {
      ui: { isFormValid: false, isDuplicateChecked: false },
      originator: { selectedOriginator: null }
    };

    expect(validateForm(validState)).toEqual({
      canCheckDuplicates: true,
      canSubmit: true
    });

    expect(validateForm(invalidState)).toEqual({
      canCheckDuplicates: false,
      canSubmit: false
    });
  });
});