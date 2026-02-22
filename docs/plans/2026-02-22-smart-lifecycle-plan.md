# Smart Lifecycle + Silent WebSocket — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make media key listening reactive to Meet call state (start/stop on call join/leave) and eliminate WebSocket console errors when Electron is offline.

**Architecture:** The extension already pushes `status_changed` via WebSocket. Electron will react to these push messages to start/stop the full media key + AUHAL lifecycle. The extension will probe with `fetch()` before creating WebSocket connections to avoid browser console errors.

**Tech Stack:** TypeScript, Vitest, Chrome Extension APIs, WebSocket

---

### Task 1: Silent WebSocket reconnection in extension

**Files:**

- Modify: `src/extension/background.ts:1-167`
- Test: `src/__tests__/extension/background.test.ts`

**Step 1: Write failing tests for fetch probe + 10s interval**

Add these tests to `src/__tests__/extension/background.test.ts`. They require a new `globalThis.fetch` mock and updated timer expectations.

```typescript
// Inside the existing describe('background.ts', ...) block:

// Add to beforeEach:
// globalThis.fetch = vi.fn();

// Add to afterEach:
// delete globalThis.fetch;

describe('silent reconnection with fetch probe', () => {
  it('uses 10s reconnect interval instead of 5s', async () => {
    vi.useFakeTimers();
    await load();
    simulateWSClose();

    // Should NOT reconnect at 5s
    globalThis.fetch.mockRejectedValue(new Error('refused'));
    vi.advanceTimersByTime(5000);
    expect(WSConstructorCalls.length).toBe(1); // Only the initial one

    // SHOULD attempt probe at 10s
    vi.advanceTimersByTime(5000);
    expect(globalThis.fetch).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('skips WebSocket when fetch probe fails', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('refused'));
    await load();
    simulateWSClose();

    vi.advanceTimersByTime(10000);
    await vi.advanceTimersByTimeAsync(0); // flush fetch promise

    // Only the initial WS connection, no retry
    expect(WSConstructorCalls.length).toBe(1);

    vi.useRealTimers();
  });

  it('creates WebSocket when fetch probe succeeds', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response());
    await load();
    simulateWSClose();

    vi.advanceTimersByTime(10000);
    await vi.advanceTimersByTimeAsync(0); // flush fetch promise

    // Initial + retry
    expect(WSConstructorCalls.length).toBe(2);

    vi.useRealTimers();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/extension/background.test.ts`
Expected: FAIL — the interval is still 5s and there's no fetch probe.

**Step 3: Implement silent reconnection in background.ts**

In `src/extension/background.ts`, make these changes:

1. Change `RECONNECT_INTERVAL_MS` from `5000` to `10000`
2. Replace `scheduleReconnect()` to use a fetch probe before connecting:

```typescript
// Line 4: Change constant
const RECONNECT_INTERVAL_MS = 10_000;

// Replace the scheduleReconnect function (lines 159-164):
async function tryReconnect(): Promise<void> {
  if (isWsConnected()) return;
  try {
    await fetch(`http://127.0.0.1:18432`);
    connectWS();
  } catch {
    // Electron not running — silently skip
  }
}

function scheduleReconnect(): void {
  if (!reconnectTimer) {
    console.log(`${TAG} Scheduling reconnect every ${RECONNECT_INTERVAL_MS}ms`);
    reconnectTimer = setInterval(tryReconnect, RECONNECT_INTERVAL_MS);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/extension/background.test.ts`
Expected: PASS

**Step 5: Update existing reconnect tests that assumed 5s interval**

The existing test `'onopen clears reconnect timer after reconnect'` uses `vi.advanceTimersByTime(5000)`. Update it to 10000. Also update mock setup for `fetch` in all relevant tests.

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/extension/background.ts src/__tests__/extension/background.test.ts
git commit -m "feat(extension): silent WebSocket reconnection with fetch probe"
```

---

### Task 2: Reactive media key lifecycle in Electron

**Files:**

- Modify: `src/main/index.ts:1-176`
- Test: `src/main/__tests__/index.test.ts`

**Step 1: Write failing tests for reactive lifecycle**

Add these tests to `src/main/__tests__/index.test.ts`. They test that media keys start/stop based on `meet-status` push events.

```typescript
// Inside the existing 'bridge events' describe block:

describe('reactive lifecycle', () => {
  it('starts media keys when call becomes active', () => {
    mockMediaKeysInstance.start.mockClear();
    bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
    expect(mockMediaKeysInstance.start).toHaveBeenCalled();
  });

  it('stops media keys when call becomes inactive', () => {
    // First, make it active
    bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
    mockMediaKeysInstance.stop.mockClear();

    // Then inactive
    bridgeOnHandlers['meet-status']({ active: false, muted: false, tabId: null });
    expect(mockMediaKeysInstance.stop).toHaveBeenCalled();
  });

  it('does not start media keys when disabled', () => {
    getTrayToggle()(false);
    mockMediaKeysInstance.start.mockClear();

    bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
    expect(mockMediaKeysInstance.start).not.toHaveBeenCalled();
  });

  it('stops media keys on bridge disconnect during active call', () => {
    bridgeOnHandlers['meet-status']({ active: true, muted: false, tabId: 1 });
    mockMediaKeysInstance.stop.mockClear();

    bridgeOnHandlers['disconnected']();
    expect(mockMediaKeysInstance.stop).toHaveBeenCalled();
  });

  it('queries status once on reconnect and starts if active', async () => {
    mockBridgeInstance.queryMeetStatus.mockResolvedValue({ active: true, muted: false, tabId: 1 });
    mockMediaKeysInstance.start.mockClear();

    await bridgeOnHandlers['connected']();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockBridgeInstance.queryMeetStatus).toHaveBeenCalled();
    expect(mockMediaKeysInstance.start).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/__tests__/index.test.ts`
Expected: FAIL — media keys currently start at app ready regardless of call state, and `meet-status` handler doesn't call `start()`/`stop()`.

**Step 3: Implement reactive lifecycle in index.ts**

Key changes to `src/main/index.ts`:

1. **Remove** the immediate `mediaKeys.start()` at app ready (line 150). Instead, just create the `MediaKeyManager` but don't start it.
2. **Add** `syncMediaKeys()` function that starts/stops based on call state.
3. **Remove** the `setInterval` periodic polling (lines 153-162).
4. **Update** `meet-status` handler to call `syncMediaKeys()`.
5. **Update** `disconnected` handler to stop media keys.
6. **Update** `connected` handler to query and start if needed.

```typescript
// New function to add after syncAudioInput():
function syncMediaKeys(): void {
  const shouldBeRunning = enabled && lastMeetStatus.active;
  if (shouldBeRunning) {
    if (checkAccessibilityPermission()) {
      mediaKeys.start();
    }
  } else {
    mediaKeys.stop();
  }
}

// Update updateTrayState() to also call syncMediaKeys():
function updateTrayState(): void {
  const state: TrayState = !enabled || !lastMeetStatus.active ? 'idle' : lastMeetStatus.muted ? 'muted' : 'in-call';
  console.log(`${TAG} updateTrayState() → ${state}`);
  tray.setState(state);
  syncConsume();
  syncAudioInput();
  syncMediaKeys();
}

// In app.whenReady():
// - Remove: if (checkAccessibilityPermission()) { mediaKeys.start(); }
// - Remove: the entire setInterval block (lines 153-162)
// - The connected/disconnected/meet-status handlers already call updateTrayState()
//   which now includes syncMediaKeys(), so they're already correct.

// Update tray toggle to use syncMediaKeys instead of direct start/stop:
tray = new MeetPodsTray((newEnabled) => {
  console.log(`${TAG} Tray toggle: enabled=${newEnabled}`);
  enabled = newEnabled;
  updateTrayState();
});
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/__tests__/index.test.ts`
Expected: PASS

**Step 5: Update existing tests that assumed polling or eager startup**

Tests to update in `src/main/__tests__/index.test.ts`:

- `'starts media keys when accessibility is trusted'` — now expects start NOT called at app ready (only on call active)
- `'does not start media keys when accessibility is not trusted'` — same
- `'periodic poll'` describe block — remove entirely (polling is gone)
- `'tray toggle callback'` — update to expect `updateTrayState()` behavior instead of direct `start()`/`stop()`

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 7: Run coverage check**

Run: `npx vitest run --coverage`
Expected: Meets thresholds (lines 100%, functions 100%, branches 95%, statements 99%)

**Step 8: Commit**

```bash
git add src/main/index.ts src/main/__tests__/index.test.ts
git commit -m "feat(main): reactive media key lifecycle driven by Meet call state"
```

---

### Task 3: Integration verification and cleanup

**Files:**

- Review: `src/extension/background.ts`, `src/main/index.ts`
- Test: all test files

**Step 1: Run full test suite with coverage**

Run: `npx vitest run --coverage`
Expected: ALL PASS, coverage thresholds met.

**Step 2: Verify no dead code remains**

Check that:

- `POLL_INTERVAL_MS` constant is removed from `src/main/index.ts`
- No unused imports remain
- The `handleMediaKey()` function still works correctly (it queries status as fallback when `lastMeetStatus.active` is false, which is fine — keeps working as safety net for race conditions)

**Step 3: Manual smoke test checklist**

1. Build: `npm run build`
2. Start Electron: `npx electron .`
3. Verify: media keys are NOT listening (not in a call)
4. Open Google Meet call
5. Verify: media keys start (check Electron console logs)
6. Press play/pause → mute toggles
7. Leave call
8. Verify: media keys stop
9. Quit Electron
10. Check Chrome console: no `ERR_CONNECTION_REFUSED` errors (only silent fetch probes)
11. Restart Electron while on a call → verify it syncs state on reconnect

**Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: cleanup after smart lifecycle implementation"
```
