# Test Templates by Service

Quick reference for writing verification tests during code review. Use the pattern matching the service under review.

## Frontend (Vitest + jsdom)

**Location:** Test files live next to source: `src/components/Foo.test.jsx`, `src/utils/bar.test.js`
**Run:** `cd frontend && npx vitest run src/path/to/file.test.jsx`

### Pure function test
```js
import { describe, test, expect } from 'vitest';
import { myFunction } from './myModule';

describe('myFunction', () => {
  test('runtime claim description', () => {
    const result = myFunction(inputThatTriggersBug);
    expect(result).toBe(expectedCorrectValue);
  });
});
```

### Component test (React Testing Library)
```jsx
import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  test('runtime claim description', () => {
    render(<MyComponent prop="value" />);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(screen.getByText('expected text')).toBeInTheDocument();
  });
});
```

### Hook test
```js
import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMyHook } from './useMyHook';

describe('useMyHook', () => {
  test('runtime claim description', () => {
    const { result } = renderHook(() => useMyHook());
    act(() => { result.current.doSomething(); });
    expect(result.current.value).toBe(expected);
  });
});
```

---

## Backend Extensions (Vitest + TypeScript)

**Location:** `backend/extensions/template-builder-bundle/src/shared/foo.test.ts`
**Run:** `cd backend/extensions/template-builder-bundle && npm test -- src/shared/foo.test.ts`

### Unit test with mocks
```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { myFunction } from './myModule';

describe('myFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('runtime claim description', () => {
    const result = myFunction(inputThatTriggersBug);
    expect(result).toBe(expectedCorrectValue);
  });
});
```

### Async test with fake timers
```ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { myAsyncFunction } from './myModule';

describe('myAsyncFunction', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('runtime claim description', async () => {
    const promise = myAsyncFunction(input);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual(expected);
  });
});
```

---

## Tools Server (pytest)

**Location:** `tools-server/tests/test_foo.py`
**Run:** `cd tools-server && python3 -m pytest tests/test_foo.py -v`

### Sync test
```python
import pytest
from module_under_test import my_function

class TestMyFunction:
    def test_runtime_claim_description(self):
        result = my_function(input_that_triggers_bug)
        assert result == expected_correct_value

    def test_raises_on_bad_input(self):
        with pytest.raises(ExpectedError, match="expected message"):
            my_function(bad_input)
```

### Async test (FastAPI endpoints)
```python
import pytest
from httpx import AsyncClient, ASGITransport
from main import app

@pytest.mark.asyncio
async def test_runtime_claim_description():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/endpoint", json={"key": "value"})
    assert response.status_code == 200
    assert response.json()["field"] == expected
```

### Test with mocking
```python
from unittest.mock import patch, AsyncMock

class TestWithMocks:
    @patch("module.dependency", new_callable=AsyncMock)
    async def test_runtime_claim_description(self, mock_dep):
        mock_dep.return_value = {"mocked": "data"}
        result = await function_under_test()
        assert result == expected
```

---

## Naming Convention for Review Tests

Prefix review verification tests so they're easy to identify and clean up:

- `test_review_verify_<finding_title>` (pytest)
- `test('review-verify: <finding title>', ...)` (vitest)

These tests prove a finding is real. After the review, they can be kept as regression tests or removed.
