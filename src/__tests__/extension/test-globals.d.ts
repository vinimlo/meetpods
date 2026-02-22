/* eslint-disable no-var */

/**
 * Extends globalThis so tests can assign mock Chrome APIs, WebSocket, DOM objects, etc.
 * These declarations only apply inside the __tests__ folder (vitest mocks).
 */
declare namespace globalThis {
  // Chrome extension API mock
  var chrome: any;
  // Browser globals that may be mocked in tests
  var WebSocket: any;
  var MutationObserver: any;
  var document: any;
  var window: any;
}
