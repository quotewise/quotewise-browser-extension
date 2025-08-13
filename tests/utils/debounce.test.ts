/**
 * Unit tests for debounce utility functions
 * Tests both regular debounce and async debounce functionality
 */

import { debounce, debounceAsync } from '../../src/utils/debounce';

// Mock timers for testing debounce behavior
jest.useFakeTimers();

describe('debounce', () => {
  let mockFunction: jest.Mock;

  beforeEach(() => {
    mockFunction = jest.fn();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('delays function execution by specified wait time', () => {
    const debouncedFn = debounce(mockFunction, 1000);
    
    debouncedFn('test');
    
    // Function should not be called immediately
    expect(mockFunction).not.toHaveBeenCalled();
    
    // Advance timers by less than wait time
    jest.advanceTimersByTime(500);
    expect(mockFunction).not.toHaveBeenCalled();
    
    // Advance timers to complete wait time
    jest.advanceTimersByTime(500);
    expect(mockFunction).toHaveBeenCalledWith('test');
    expect(mockFunction).toHaveBeenCalledTimes(1);
  });

  test('cancels previous calls when called multiple times', () => {
    const debouncedFn = debounce(mockFunction, 1000);
    
    debouncedFn('first');
    jest.advanceTimersByTime(500);
    
    debouncedFn('second');
    jest.advanceTimersByTime(500);
    
    debouncedFn('third');
    jest.advanceTimersByTime(1000);
    
    // Only the last call should execute
    expect(mockFunction).toHaveBeenCalledWith('third');
    expect(mockFunction).toHaveBeenCalledTimes(1);
  });

  test('can be canceled manually', () => {
    const debouncedFn = debounce(mockFunction, 1000);
    
    debouncedFn('test');
    
    // Cancel before execution
    debouncedFn.cancel();
    
    jest.advanceTimersByTime(1000);
    
    // Function should not be called
    expect(mockFunction).not.toHaveBeenCalled();
  });

  test('can be flushed manually', () => {
    const debouncedFn = debounce(mockFunction, 1000);
    
    debouncedFn('test');
    
    // Flush before normal execution
    debouncedFn.flush();
    
    // Function should be called immediately
    expect(mockFunction).toHaveBeenCalledWith('test');
    expect(mockFunction).toHaveBeenCalledTimes(1);
    
    // No additional calls after timer completes
    jest.advanceTimersByTime(1000);
    expect(mockFunction).toHaveBeenCalledTimes(1);
  });

  test('supports immediate execution option', () => {
    const debouncedFn = debounce(mockFunction, 1000, true);
    
    debouncedFn('test');
    
    // With immediate=true, function should be called immediately
    expect(mockFunction).toHaveBeenCalledWith('test');
    expect(mockFunction).toHaveBeenCalledTimes(1);
    
    // Subsequent calls should be debounced
    debouncedFn('second');
    jest.advanceTimersByTime(1000);
    
    // No additional calls during debounce period
    expect(mockFunction).toHaveBeenCalledTimes(1);
  });

  test('passes all arguments to the debounced function', () => {
    const debouncedFn = debounce(mockFunction, 100);
    
    debouncedFn('arg1', 'arg2', 'arg3');
    jest.advanceTimersByTime(100);
    
    expect(mockFunction).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
  });

  test('handles zero wait time', () => {
    const debouncedFn = debounce(mockFunction, 0);
    
    debouncedFn('test');
    
    // Even with 0 wait time, should still use setTimeout
    expect(mockFunction).not.toHaveBeenCalled();
    
    // Need to advance by at least 1ms to trigger setTimeout with 0 delay
    jest.advanceTimersByTime(1);
    expect(mockFunction).toHaveBeenCalledWith('test');
  });

  test('handles negative wait time', () => {
    const debouncedFn = debounce(mockFunction, -100);
    
    debouncedFn('test');
    
    // Negative wait time becomes 0, still need at least 1ms to trigger
    jest.advanceTimersByTime(1);
    expect(mockFunction).toHaveBeenCalledWith('test');
  });

  test('handles function that returns a value', () => {
    mockFunction.mockReturnValue('return value');
    const debouncedFn = debounce(mockFunction, 100);
    
    debouncedFn('test');
    jest.advanceTimersByTime(100);
    
    expect(mockFunction).toHaveBeenCalledWith('test');
  });

  test('handles function that throws an error', () => {
    mockFunction.mockImplementation(() => {
      throw new Error('Test error');
    });
    const debouncedFn = debounce(mockFunction, 100);
    
    debouncedFn('test');
    
    // The error should be thrown when the timer executes, not during setup
    expect(() => jest.advanceTimersByTime(100)).toThrow('Test error');
    
    expect(mockFunction).toHaveBeenCalledWith('test');
  });
});

describe('debounceAsync', () => {
  let mockAsyncFunction: jest.Mock;

  beforeEach(() => {
    mockAsyncFunction = jest.fn();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('delays async function execution by specified wait time', async () => {
    mockAsyncFunction.mockResolvedValue('result');
    const debouncedFn = debounceAsync(mockAsyncFunction, 1000);
    
    const promise = debouncedFn('test');
    
    // Function should not be called immediately
    expect(mockAsyncFunction).not.toHaveBeenCalled();
    
    // Advance timers
    jest.advanceTimersByTime(1000);
    
    // Wait for promise resolution
    const result = await promise;
    
    expect(mockAsyncFunction).toHaveBeenCalledWith('test');
    expect(result).toBe('result');
  });

  test('cancels previous async calls when called multiple times', async () => {
    mockAsyncFunction.mockResolvedValue('result');
    const debouncedFn = debounceAsync(mockAsyncFunction, 1000);
    
    const promise1 = debouncedFn('first');
    jest.advanceTimersByTime(500);
    
    const promise2 = debouncedFn('second');
    jest.advanceTimersByTime(500);
    
    const promise3 = debouncedFn('third');
    jest.advanceTimersByTime(1000);
    
    // Wait for the last promise to resolve
    const result = await promise3;
    
    // Only the last call should execute
    expect(mockAsyncFunction).toHaveBeenCalledWith('third');
    expect(mockAsyncFunction).toHaveBeenCalledTimes(1);
    expect(result).toBe('result');
    
    // Previous promises should not resolve
    await expect(promise1).resolves.toBeUndefined();
    await expect(promise2).resolves.toBeUndefined();
  });

  test('handles async function rejection', async () => {
    const error = new Error('Test error');
    mockAsyncFunction.mockRejectedValue(error);
    const debouncedFn = debounceAsync(mockAsyncFunction, 1000);
    
    const promise = debouncedFn('test');
    
    jest.advanceTimersByTime(1000);
    
    await expect(promise).rejects.toThrow('Test error');
    expect(mockAsyncFunction).toHaveBeenCalledWith('test');
  });

  test('resolves only current promise on rejection', async () => {
    const error = new Error('Test error');
    mockAsyncFunction.mockRejectedValue(error);
    const debouncedFn = debounceAsync(mockAsyncFunction, 1000);
    
    const promise1 = debouncedFn('first');
    jest.advanceTimersByTime(500);
    
    const promise2 = debouncedFn('second');
    jest.advanceTimersByTime(1000);
    
    // Only the current promise should reject
    await expect(promise2).rejects.toThrow('Test error');
    
    // Previous promise should resolve to undefined (canceled)
    await expect(promise1).resolves.toBeUndefined();
  });

  test('passes all arguments to the async function', async () => {
    mockAsyncFunction.mockResolvedValue('result');
    const debouncedFn = debounceAsync(mockAsyncFunction, 100);
    
    const promise = debouncedFn('arg1', 'arg2', 'arg3');
    jest.advanceTimersByTime(100);
    
    await promise;
    
    expect(mockAsyncFunction).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
  });

  test('maintains separate debounce state for different instances', async () => {
    const mockFn1 = jest.fn().mockResolvedValue('result1');
    const mockFn2 = jest.fn().mockResolvedValue('result2');
    
    const debouncedFn1 = debounceAsync(mockFn1, 1000);
    const debouncedFn2 = debounceAsync(mockFn2, 1000);
    
    const promise1 = debouncedFn1('test1');
    const promise2 = debouncedFn2('test2');
    
    jest.advanceTimersByTime(1000);
    
    const [result1, result2] = await Promise.all([promise1, promise2]);
    
    expect(mockFn1).toHaveBeenCalledWith('test1');
    expect(mockFn2).toHaveBeenCalledWith('test2');
    expect(result1).toBe('result1');
    expect(result2).toBe('result2');
  });
});