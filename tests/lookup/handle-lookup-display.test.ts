/**
 * Unit tests for HandleLookupDisplay component
 */

import { HandleLookupDisplay } from '../../src/lookup/handle-lookup-display';
import type { HandleLookupState } from '../../src/lookup/handle-lookup';

describe('HandleLookupDisplay', () => {
  let container: HTMLElement;
  let display: HandleLookupDisplay;
  let mockOnSelectOriginator: jest.Mock;
  let mockOnDismiss: jest.Mock;

  beforeEach(() => {
    container = document.createElement('div');
    container.classList.add('hidden');
    document.body.appendChild(container);

    mockOnSelectOriginator = jest.fn();
    mockOnDismiss = jest.fn();

    display = new HandleLookupDisplay({
      container,
      onSelectOriginator: mockOnSelectOriginator,
      onDismiss: mockOnDismiss
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('updateDisplay', () => {
    describe('empty state', () => {
      it('should hide container for initial state', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: false,
          result: null,
          matchedOriginator: null,
          createUrl: null,
          matchedHandle: null,
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.innerHTML).toBe('');
        expect(container.classList.contains('hidden')).toBe(true);
      });
    });

    describe('looking state', () => {
      it('should show loading spinner and handle', () => {
        const state: HandleLookupState = {
          isLooking: true,
          hasLookedUp: false,
          result: null,
          matchedOriginator: null,
          createUrl: null,
          matchedHandle: 'testuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.classList.contains('hidden')).toBe(false);
        expect(container.innerHTML).toContain('Looking up @testuser');
        expect(container.innerHTML).toContain('lookup-spinner');
      });

      it('should escape HTML in handle', () => {
        const state: HandleLookupState = {
          isLooking: true,
          hasLookedUp: false,
          result: null,
          matchedOriginator: null,
          createUrl: null,
          matchedHandle: '<script>alert("xss")</script>',
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.innerHTML).not.toContain('<script>');
        expect(container.innerHTML).toContain('&lt;script&gt;');
      });
    });

    describe('found state', () => {
      it('should show originator details and action buttons', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'found',
          matchedOriginator: {
            id: 123,
            unique_id: 'test-user',
            full_name: 'Test User',
            sort_name_display: 'User, Test',
            confidence: 1.0
          },
          createUrl: null,
          matchedHandle: 'testuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.classList.contains('hidden')).toBe(false);
        expect(container.innerHTML).toContain('Found: Test User');
        expect(container.innerHTML).toContain('@testuser');
        expect(container.innerHTML).toContain('User, Test');
        expect(container.innerHTML).toContain('Use This Originator');
        expect(container.innerHTML).toContain('Search Manually');
      });

      it('should call onSelectOriginator when use button clicked', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'found',
          matchedOriginator: {
            id: 123,
            unique_id: 'test-user',
            full_name: 'Test User',
            sort_name_display: 'User, Test',
            confidence: 1.0
          },
          createUrl: null,
          matchedHandle: 'testuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        const useButton = container.querySelector('[data-action="use"]') as HTMLButtonElement;
        useButton?.click();

        expect(mockOnSelectOriginator).toHaveBeenCalled();
      });

      it('should call onDismiss when dismiss button clicked', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'found',
          matchedOriginator: {
            id: 123,
            unique_id: 'test-user',
            full_name: 'Test User',
            sort_name_display: 'User, Test',
            confidence: 1.0
          },
          createUrl: null,
          matchedHandle: 'testuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        const dismissButton = container.querySelector('[data-action="dismiss"]') as HTMLButtonElement;
        dismissButton?.click();

        expect(mockOnDismiss).toHaveBeenCalled();
      });
    });

    describe('not_found state', () => {
      it('should show not found message with create link', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'not_found',
          matchedOriginator: null,
          createUrl: 'https://quotewise.io/originators/create/?suggested_handle=unknownuser',
          matchedHandle: 'unknownuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.classList.contains('hidden')).toBe(false);
        expect(container.innerHTML).toContain('No originator found for @unknownuser');
        expect(container.innerHTML).toContain('Create on Quotewise');
        expect(container.innerHTML).toContain('href="https://quotewise.io/originators/create/?suggested_handle=unknownuser"');
        expect(container.innerHTML).toContain('Search Manually');
      });

      it('should hide create link if no create_url', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'not_found',
          matchedOriginator: null,
          createUrl: null,
          matchedHandle: 'unknownuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.innerHTML).not.toContain('Create on Quotewise');
        expect(container.innerHTML).toContain('Search Manually');
      });

      it('should open create link in new tab', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'not_found',
          matchedOriginator: null,
          createUrl: 'https://quotewise.io/originators/create/',
          matchedHandle: 'unknownuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        const createLink = container.querySelector('a.create-link');
        expect(createLink?.getAttribute('target')).toBe('_blank');
        expect(createLink?.getAttribute('rel')).toBe('noopener noreferrer');
      });
    });

    describe('error state', () => {
      it('should show error message', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'error',
          matchedOriginator: null,
          createUrl: null,
          matchedHandle: 'testuser',
          errorMessage: 'Network error occurred'
        };

        display.updateDisplay(state);

        expect(container.classList.contains('hidden')).toBe(false);
        expect(container.innerHTML).toContain('Lookup failed');
        expect(container.innerHTML).toContain('Network error occurred');
        expect(container.innerHTML).toContain('Search Manually');
      });

      it('should show generic error if no errorMessage', () => {
        const state: HandleLookupState = {
          isLooking: false,
          hasLookedUp: true,
          result: 'error',
          matchedOriginator: null,
          createUrl: null,
          matchedHandle: 'testuser',
          errorMessage: null
        };

        display.updateDisplay(state);

        expect(container.innerHTML).toContain('Lookup failed');
      });
    });
  });

  describe('setContainer', () => {
    it('should update container reference', () => {
      const newContainer = document.createElement('div');
      document.body.appendChild(newContainer);

      display.setContainer(newContainer);

      const state: HandleLookupState = {
        isLooking: true,
        hasLookedUp: false,
        result: null,
        matchedOriginator: null,
        createUrl: null,
        matchedHandle: 'testuser',
        errorMessage: null
      };

      display.updateDisplay(state);

      // Original container should be empty
      expect(container.innerHTML).toBe('');
      // New container should have content
      expect(newContainer.innerHTML).toContain('Looking up @testuser');

      document.body.removeChild(newContainer);
    });
  });
});
