import type { ExtensionMessage, Platform } from '../types';

export interface PlatformAdapter<TData = unknown> {
  id: Platform;
  matches(location: Location): boolean;
  bootstrap(): Promise<void>;
  teardown(): Promise<void>;
  getLatestData?(): Promise<TData | null>;
  handleMessage?(
    message: ExtensionMessage,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendResponse: (response: any) => void
  ): boolean | Promise<boolean>;
}
