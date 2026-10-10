import { browser } from 'wxt/browser';
import {
  isRuntimeResponse,
  type RuntimeRequest,
  type RuntimeResponse,
} from '#/core/messages';

export async function runtimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isRuntimeResponse(response)) throw new TypeError('Runtime returned an invalid response.');
  return response;
}
