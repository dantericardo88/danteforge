# Testing Anti-Patterns Reference

> DanteForge testing reference.

## 1. Testing Mock Behavior Instead of Real Behavior

**Problem:** Tests verify that mocks return what you told them to return — not that the actual system works.

**Fix:** Mock at the boundary (network, filesystem, database), not internal functions. Test real behavior paths.

## 2. Test-Only Methods in Production Code

**Problem:** Adding methods like `_getInternalState()` solely for testing pollutes the production API.

**Fix:** Test through the public interface. If you can't test it publicly, the design needs refactoring.

## 3. Mocking Without Understanding Dependencies

**Problem:** Mocking a dependency you haven't read leads to false assumptions about its behavior.

**Fix:** Read the dependency's actual behavior first. Only mock what you understand.

## 4. Incomplete Mocks Creating False Confidence

**Problem:** Mocking only the "happy path" while the real dependency has error states, retries, and edge cases.

**Fix:** Mock the full contract — success, failure, timeout, empty responses.

## 5. Integration Tests as Afterthought

**Problem:** Unit tests pass but the system doesn't work because components weren't tested together.

**Fix:** Write integration tests for critical paths. Unit tests verify logic; integration tests verify wiring.
