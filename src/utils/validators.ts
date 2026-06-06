/**
 * Input validation utilities for content script data
 * Security hardening for MV3 service worker
 */

import { MessageType, type TwitterData, type ExtensionMessage } from '../types/chrome';

/**
 * Custom validation error for rejected input
 */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Sanitize string input - remove potentially dangerous characters
 */
export function sanitizeString(value: string, maxLength: number = 10000): string {
  if (typeof value !== 'string') {
    return '';
  }
  // Trim and limit length
  return value.trim().slice(0, maxLength);
}

/**
 * Validate URL format and protocol
 */
function isValidUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;

  try {
    const parsed = new URL(url);
    // Only allow https URLs (and http for localhost in dev)
    return parsed.protocol === 'https:' ||
           (parsed.protocol === 'http:' && parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Validate Twitter/X URL specifically
 */
function isValidTwitterUrl(url: unknown): url is string {
  if (!isValidUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const validHosts = ['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com'];
    return validHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate non-negative number
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= 0;
}

/**
 * Validate author object structure
 */
function validateAuthor(author: unknown): author is TwitterData['author'] {
  if (!author || typeof author !== 'object') return false;

  const a = author as Record<string, unknown>;

  // Required fields
  if (typeof a.username !== 'string' || a.username.length === 0 || a.username.length > 100) {
    return false;
  }
  if (typeof a.displayName !== 'string' || a.displayName.length > 200) {
    return false;
  }

  // Optional fields validation
  if (a.verified !== undefined && typeof a.verified !== 'boolean') {
    return false;
  }
  if (a.profileUrl !== undefined && a.profileUrl !== null && !isValidTwitterUrl(a.profileUrl)) {
    return false;
  }
  if (a.avatarUrl !== undefined && a.avatarUrl !== null && !isValidUrl(a.avatarUrl)) {
    return false;
  }

  return true;
}

/**
 * Validate platform_data object structure
 */
function validatePlatformData(data: unknown): data is TwitterData['platform_data'] {
  if (!data || typeof data !== 'object') return false;

  const d = data as Record<string, unknown>;

  // tweet_id can be string or null
  if (d.tweet_id !== null && typeof d.tweet_id !== 'string') {
    return false;
  }

  // Required numeric fields
  if (!isNonNegativeNumber(d.reply_count)) return false;
  if (!isNonNegativeNumber(d.retweet_count)) return false;
  if (!isNonNegativeNumber(d.bookmark_count)) return false;
  if (!isNonNegativeNumber(d.view_count)) return false;

  // Optional numeric field
  if (d.quote_count !== undefined && !isNonNegativeNumber(d.quote_count)) {
    return false;
  }

  // Optional boolean field
  if (d.is_protected !== undefined && typeof d.is_protected !== 'boolean') {
    return false;
  }

  // Optional numeric field
  if (d.thread_position !== undefined && !isNonNegativeNumber(d.thread_position)) {
    return false;
  }

  // Optional boolean field
  if (d.has_media !== undefined && typeof d.has_media !== 'boolean') {
    return false;
  }

  return true;
}

/**
 * Type guard to validate TwitterData from content script
 * Rejects malformed or suspicious data with clear error messages
 */
export function validateTwitterData(data: unknown): data is TwitterData {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Twitter data must be a non-null object', 'root');
  }

  const d = data as Record<string, unknown>;

  // Required text field
  if (typeof d.text !== 'string') {
    throw new ValidationError('Tweet text must be a string', 'text');
  }
  if (d.text.length === 0) {
    throw new ValidationError('Tweet text cannot be empty', 'text');
  }
  if (d.text.length > 10000) {
    throw new ValidationError('Tweet text exceeds maximum length', 'text');
  }

  // Author validation
  if (!validateAuthor(d.author)) {
    throw new ValidationError('Invalid author data structure', 'author');
  }

  // URL validation
  if (!isValidTwitterUrl(d.url)) {
    throw new ValidationError('Tweet URL must be a valid Twitter/X URL', 'url');
  }

  // Date can be string or null
  if (d.date !== null && typeof d.date !== 'string') {
    throw new ValidationError('Tweet date must be a string or null', 'date');
  }

  // Numeric fields validation
  if (!isNonNegativeNumber(d.likes)) {
    throw new ValidationError('Likes must be a non-negative number', 'likes');
  }
  if (!isNonNegativeNumber(d.retweets)) {
    throw new ValidationError('Retweets must be a non-negative number', 'retweets');
  }
  if (!isNonNegativeNumber(d.replies)) {
    throw new ValidationError('Replies must be a non-negative number', 'replies');
  }
  if (!isNonNegativeNumber(d.views)) {
    throw new ValidationError('Views must be a non-negative number', 'views');
  }
  if (!isNonNegativeNumber(d.bookmarks)) {
    throw new ValidationError('Bookmarks must be a non-negative number', 'bookmarks');
  }

  // Tweet type validation
  const validTweetTypes = ['original', 'reply', 'retweet', 'quote'];
  if (typeof d.tweetType !== 'string' || !validTweetTypes.includes(d.tweetType)) {
    throw new ValidationError('Invalid tweet type', 'tweetType');
  }

  // Optional language field
  if (d.language !== undefined && typeof d.language !== 'string') {
    throw new ValidationError('Language must be a string', 'language');
  }

  // Optional isProtected field
  if (d.isProtected !== undefined && typeof d.isProtected !== 'boolean') {
    throw new ValidationError('isProtected must be a boolean', 'isProtected');
  }

  // Platform data validation
  if (!validatePlatformData(d.platform_data)) {
    throw new ValidationError('Invalid platform_data structure', 'platform_data');
  }

  // Optional retweeter validation
  if (d.retweeter !== undefined && d.retweeter !== null) {
    const rt = d.retweeter as Record<string, unknown>;
    if (typeof rt.username !== 'string' || typeof rt.displayName !== 'string') {
      throw new ValidationError('Invalid retweeter data structure', 'retweeter');
    }
  }

  return true;
}

/**
 * Safe wrapper that returns boolean instead of throwing
 */
export function isValidTwitterData(data: unknown): data is TwitterData {
  try {
    return validateTwitterData(data);
  } catch {
    return false;
  }
}

/**
 * Validate extension message structure
 */
export function validateExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== 'object') {
    throw new ValidationError('Message must be a non-null object', 'root');
  }

  const m = message as Record<string, unknown>;

  // Type field is required and must be a valid MessageType
  if (typeof m.type !== 'string') {
    throw new ValidationError('Message type must be a string', 'type');
  }

  // Validate that the type is a known MessageType value
  const validMessageTypes: string[] = Object.values(MessageType);

  if (!validMessageTypes.includes(m.type as string)) {
    throw new ValidationError(`Unknown message type: ${m.type}`, 'type');
  }

  // requestId is optional but must be a string if present
  if (m.requestId !== undefined && typeof m.requestId !== 'string') {
    throw new ValidationError('requestId must be a string', 'requestId');
  }

  return true;
}

/**
 * Safe wrapper for message validation
 */
export function isValidExtensionMessage(message: unknown): message is ExtensionMessage {
  try {
    return validateExtensionMessage(message);
  } catch {
    return false;
  }
}
