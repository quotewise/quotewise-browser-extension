/**
 * Debounce utility for Chrome extension
 * Delays execution of a function until after wait milliseconds have elapsed
 * since the last time it was invoked.
 */

/**
 * Debounce function that delays execution until after wait milliseconds
 * @param func The function to debounce
 * @param wait The number of milliseconds to delay
 * @param immediate Trigger the function on the leading edge, instead of the trailing
 * @returns Debounced function
 */
export interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel(): void;
  flush(): void;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate = false
): DebouncedFunction<T> {
  let timeout: NodeJS.Timeout | null = null;
  let lastArgs: Parameters<T> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let result: ReturnType<T>;

  const debounced = (...args: Parameters<T>): void => {
    lastArgs = args; // Store arguments for flush method
    
    const later = () => {
      timeout = null;
      if (!immediate) {
        result = func(...args);
      }
    };

    const callNow = immediate && !timeout;
    
    if (timeout) {
      clearTimeout(timeout);
    }
    
    // Handle edge cases: ensure minimum timeout of 0
    const safeWait = Math.max(0, wait);
    timeout = setTimeout(later, safeWait);
    
    if (callNow) {
      result = func(...args);
    }
  };

  // Add cancel method to clear pending execution
  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  // Add flush method to immediately execute pending function with last arguments
  debounced.flush = () => {
    if (timeout && lastArgs) {
      clearTimeout(timeout);
      result = func(...lastArgs); // Use stored arguments
      timeout = null;
    }
  };

  return debounced as DebouncedFunction<T>;
}

/**
 * Debounce function specifically for async operations
 * Cancels previous promise if a new one is triggered
 */
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeout: NodeJS.Timeout | null = null;
  let currentResolve: ((value: ReturnType<T>) => void) | null = null;
  let currentReject: ((reason?: any) => void) | null = null;
  
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return new Promise<ReturnType<T>>((resolve, reject) => {
      // Cancel previous promise by resolving it to undefined
      if (currentResolve) {
        currentResolve(undefined as any);
      }
      
      // Clear existing timeout
      if (timeout) {
        clearTimeout(timeout);
      }
      
      // Store current resolvers
      currentResolve = resolve;
      currentReject = reject;
      
      // Handle edge cases: ensure minimum timeout of 0
      const safeWait = Math.max(0, wait);
      
      // Set new timeout
      timeout = setTimeout(async () => {
        try {
          const result = await func(...args);
          // Only resolve if this is still the current promise
          if (currentResolve === resolve) {
            resolve(result);
            currentResolve = null;
            currentReject = null;
          }
        } catch (error) {
          // Only reject if this is still the current promise
          if (currentReject === reject) {
            reject(error);
            currentResolve = null;
            currentReject = null;
          }
        } finally {
          timeout = null;
        }
      }, safeWait);
    });
  };
}