import type { CapturePlatform, ExtensionMessage } from '../types';

export type CaptureEmptyReason = 'no-post' | 'no-text';
export type CaptureResult<TData> = { data: TData } | { empty: CaptureEmptyReason };

export interface PlatformAdapter<TData = unknown> {
  id: CapturePlatform;
  matches(location: Location): boolean;
  bootstrap(): Promise<void>;
  teardown(): Promise<void>;
  getLatestData?(): Promise<TData | null>;
  getCaptureResult?(): Promise<CaptureResult<TData>>;
  handleMessage?(
    message: ExtensionMessage,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendResponse: (response: any) => void
  ): boolean | Promise<boolean>;
}
