import type { ExtensionMessage, Platform } from '../types';

export interface PlatformAdapter<TData = any> {
  id: Platform;
  matches(location: Location): boolean;
  bootstrap(): Promise<void>;
  teardown(): Promise<void>;
  getLatestData?(): Promise<TData | null>;
  handleMessage?(
    message: ExtensionMessage,
    sendResponse: (response: any) => void
  ): boolean | Promise<boolean>;
}
