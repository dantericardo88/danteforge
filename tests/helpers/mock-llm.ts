// Mock LLM utilities for testing — provides canned responses without API calls
// Used across design, party-mode, and integration tests.

/**
 * A map of prompt substring matchers to canned responses.
 */
export type MockResponseMap = Map<string, string>;

/**
 * Create a mock response map with common design-related responses.
 */
export function createDesignMockResponses(): MockResponseMap {
  const responses: MockResponseMap = new Map();

  responses.set('design', `# Design Agent Report

## Design Summary
Generated a modern login form with email and social authentication.

## Component Inventory
- LoginForm (frame) — main container
- EmailInput (frame) — email field
- PasswordInput (frame) — password field
- SubmitButton (frame) — primary CTA
- SocialAuthSection (frame) — social login buttons

## Design Tokens
\`\`\`css
:root {
  --color-primary: #3B82F6;
  --color-bg: #FFFFFF;
  --text-base: 1rem;
  --space-4: 1rem;
  --radius-md: 0.5rem;
}
\`\`\`

## Verdict: PASS
Design meets accessibility and consistency standards.`);

  responses.set('verify', 'PASS\nAll criteria met. Design tokens are valid and consistent.');

  responses.set('review', `# Current State
Project is a modern web application with React frontend.`);

  return responses;
}

/**
 * Find a matching mock response for a prompt.
 * Matches against substring keys in the response map.
 */
export function findMockResponse(prompt: string, responses: MockResponseMap): string | null {
  const lowerPrompt = prompt.toLowerCase();
  for (const [key, response] of responses) {
    if (lowerPrompt.includes(key.toLowerCase())) {
      return response;
    }
  }
  return null;
}

/**
 * Create a minimal LLM-like response for testing.
 */
export function createStubResponse(content: string): string {
  return content;
}
