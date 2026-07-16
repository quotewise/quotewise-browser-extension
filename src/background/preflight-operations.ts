/**
 * In-flight preflight/icon operation state and persistence.
 *
 * Owns the per-tab in-flight operation map plus the identity helpers
 * (operation ids, timeout alarm names) and the session-storage persistence that
 * lets automatic preflights survive an MV3 service-worker restart. The recursive
 * lifecycle that ties an operation to the originator probe and the toolbar icon
 * lives in the service worker; it mutates this state through the exported map
 * and calls the persistence helpers here, so there is exactly one operation map.
 *
 * This module is a cycle-free leaf: it depends only on the capture layer,
 * diagnostic types, and environment logging — never back on the worker.
 */

import type { CapturePlatform } from '../types/index';
import type { DiagnosticTrigger } from './diagnostics';
import { captureIdentityFromUrl, isSameCaptureUrl } from '../platforms/capture';
import { debugLog } from '../config/environment';

export interface InFlightIconOperation {
  tabId: number;
  url: string;
  platform?: CapturePlatform;
  statusId: string;
  operationId: string;
  trigger: DiagnosticTrigger;
  startedAt: number;
  timeoutAt?: number;
  handle?: string;
  cacheWriteEpoch?: number;
}

const PREFLIGHT_OPERATION_STORAGE_KEY = 'automaticPreflightOperations';
export const PREFLIGHT_TIMEOUT_ALARM_PREFIX = 'automatic-preflight-timeout:';

/**
 * The single source of truth for per-tab in-flight operations. Exported so the
 * worker's lifecycle code mutates the same map this module persists from.
 */
export const tabInFlightOperations = new Map<number, InFlightIconOperation>();

export function createOperationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function preflightTimeoutAlarmName(operation: InFlightIconOperation): string {
  return `${PREFLIGHT_TIMEOUT_ALARM_PREFIX}${operation.tabId}:${operation.operationId}`;
}

export function parsePreflightTimeoutAlarmName(name: string): { tabId: number; operationId: string } | null {
  if (!name.startsWith(PREFLIGHT_TIMEOUT_ALARM_PREFIX)) {
    return null;
  }

  const value = name.slice(PREFLIGHT_TIMEOUT_ALARM_PREFIX.length);
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const tabId = Number(value.slice(0, separatorIndex));
  const operationId = value.slice(separatorIndex + 1);
  if (!Number.isInteger(tabId) || operationId === '') {
    return null;
  }

  return { tabId, operationId };
}

export function getMatchingInFlightOperation(tabId: number, url?: string): InFlightIconOperation | null {
  const operation = tabInFlightOperations.get(tabId);
  if (!operation) {
    return null;
  }

  if (url && !isSameCaptureUrl(operation.url, url)) {
    return null;
  }

  return operation;
}

export function isCheckInFlightForTab(tabId: number, url?: string): boolean {
  return getMatchingInFlightOperation(tabId, url) !== null;
}

function serializableAutomaticPreflightOperations(): InFlightIconOperation[] {
  return [...tabInFlightOperations.values()].filter(
    operation => operation.trigger === 'automatic-preflight' && operation.timeoutAt !== undefined,
  );
}

export async function persistAutomaticPreflightOperations(): Promise<void> {
  try {
    await chrome.storage.session.set({
      [PREFLIGHT_OPERATION_STORAGE_KEY]: serializableAutomaticPreflightOperations(),
    });
  } catch (error) {
    debugLog('Unable to persist automatic preflight operations:', error);
  }
}

function isValidPersistedInFlightOperation(value: unknown): value is InFlightIconOperation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const operation = value as Partial<InFlightIconOperation>;
  return (
    typeof operation.tabId === 'number' &&
    typeof operation.url === 'string' &&
    typeof operation.statusId === 'string' &&
    typeof operation.operationId === 'string' &&
    operation.trigger === 'automatic-preflight' &&
    typeof operation.startedAt === 'number' &&
    typeof operation.timeoutAt === 'number' &&
    (captureIdentityFromUrl(operation.url)?.sourceId ?? null) === operation.statusId
  );
}

export async function readPersistedAutomaticPreflightOperations(): Promise<InFlightIconOperation[]> {
  try {
    const storage = await chrome.storage.session.get([PREFLIGHT_OPERATION_STORAGE_KEY]);
    const value = storage[PREFLIGHT_OPERATION_STORAGE_KEY];
    return Array.isArray(value) ? value.filter(isValidPersistedInFlightOperation) : [];
  } catch (error) {
    debugLog('Unable to read automatic preflight operations:', error);
    return [];
  }
}
