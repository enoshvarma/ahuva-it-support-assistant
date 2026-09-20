// Unit tests for auth guard state logic.
// These test the pure state-machine rules that govern when openConsent() fires.
// The Electron IPC layer is not involved.

let passed = 0, failed = 0;
function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

// ── consentShown guard ─────────────────────────────────────────────────────────
console.log("\nauth-guard: consentShown one-shot");
{
  // Simulate the guard logic from openConsent()
  function makeGuard() {
    let shown = false;
    let callCount = 0;
    function openConsent() {
      if (shown) return;
      shown = true;
      callCount++;
    }
    return { openConsent, shown: () => shown, callCount: () => callCount };
  }

  const g = makeGuard();
  g.openConsent();
  g.openConsent();
  g.openConsent();
  assert("called 3x but fires once", g.callCount(), 1);
  assert("shown flag set",            g.shown(), true);
}

// ── deferred consent timer — clears when login modal fires ──────────────────
console.log("\nauth-guard: deferred consent timer");
{
  // Simulate the deferred timer + clear on loginModal logic
  function makeDeferredAuth() {
    const state = {
      consentShown: false,
      _pendingConsentTimer: null,
      consentCalls: 0,
      loginModalOpened: false
    };

    function openConsent() {
      if (state.consentShown) return;
      state.consentShown = true;
      state.consentCalls++;
    }

    function startConnectionNonSSH() {
      state.consentShown = false;
      state._pendingConsentTimer = setTimeout(() => {
        state._pendingConsentTimer = null;
        if (!state.consentShown) openConsent();
      }, 50); // short timeout for test
    }

    function openLoginModal() {
      if (state._pendingConsentTimer) {
        clearTimeout(state._pendingConsentTimer);
        state._pendingConsentTimer = null;
      }
      state.loginModalOpened = true;
    }

    function submitLoginSuccess() {
      state.loginModalOpened = false;
      openConsent();
    }

    return { state, startConnectionNonSSH, openLoginModal, submitLoginSuccess };
  }

  // Scenario A: login modal fires before timer → consent fires exactly once after submit
  const a = makeDeferredAuth();
  a.startConnectionNonSSH();
  a.openLoginModal();        // clears timer
  a.submitLoginSuccess();    // calls openConsent once
  assert("A: timer cleared by loginModal",   a.state._pendingConsentTimer, null);
  assert("A: consent fired once after submit", a.state.consentCalls, 1);
  a.submitLoginSuccess();    // second submit must NOT fire again
  assert("A: double-submit guarded",          a.state.consentCalls, 1);

  // Scenario B: no login prompt — timer fires consent on its own
  const b = makeDeferredAuth();
  b.startConnectionNonSSH();
  // wait for the 50ms timer
  setTimeout(() => {
    assert("B: timer fires consent", b.state.consentCalls, 1);
    // now calling submitLoginSuccess should NOT double-fire
    b.submitLoginSuccess();
    assert("B: no double consent after timer",  b.state.consentCalls, 1);
  }, 100);
}

// ── reset on disconnect ────────────────────────────────────────────────────────
console.log("\nauth-guard: reset on disconnect");
{
  let consentShown = true;
  let authCompleted = true;
  let pendingTimer = setTimeout(() => {}, 9999);

  // simulate setConnected(false)
  function onDisconnect() {
    authCompleted = false;
    consentShown  = false;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  }

  onDisconnect();
  assert("authCompleted reset",    authCompleted, false);
  assert("consentShown reset",     consentShown,  false);
  assert("pendingTimer cleared",   pendingTimer,  null);
}

// ── Summary ────────────────────────────────────────────────────────────────────
// Give async scenario B time to run
setTimeout(() => {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`auth-guard tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
  else console.log("All auth-guard tests passed.");
}, 200);
