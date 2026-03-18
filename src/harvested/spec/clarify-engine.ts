// Clarification engine — gap detection and consistency analysis for specs
import { callLLM, isLLMAvailable } from '../../core/llm.js';
import { logger } from '../../core/logger.js';

export interface ClarifyQuestion {
  id: number;
  question: string;
  context: string;
}

export async function generateClarifyQuestions(spec: string): Promise<ClarifyQuestion[]> {
  logger.info('Analyzing spec for ambiguities...');

  if (await isLLMAvailable()) {
    try {
      const prompt = `Analyze this specification and identify gaps, ambiguities, and missing requirements.

For each issue found, output a numbered list in this exact format:
1. [QUESTION] <your question> [CONTEXT] <why this matters>
2. [QUESTION] <your question> [CONTEXT] <why this matters>

Focus on:
- Missing user personas or target audience
- Undefined performance requirements
- Unclear error handling expectations
- Missing security considerations
- Ambiguous acceptance criteria
- Undefined edge cases

=== SPECIFICATION ===
${spec}
=== END SPECIFICATION ===`;

      const response = await callLLM(prompt, undefined, { enrichContext: true });
      return parseQuestions(response);
    } catch (err) {
      logger.warn('LLM clarification failed, using local analysis');
    }
  }

  // Fallback: basic keyword-based gap detection
  return detectBasicGaps(spec);
}

export async function runConsistencyCheck(spec: string, constitution: string): Promise<string[]> {
  logger.info('Running consistency check against constitution...');

  if (await isLLMAvailable()) {
    try {
      const prompt = `Check this specification for consistency with the project constitution.

List any violations, contradictions, or misalignments. For each issue, output one line:
- VIOLATION: <description>

If everything is consistent, respond with "No violations found."

=== CONSTITUTION ===
${constitution}
=== END CONSTITUTION ===

=== SPECIFICATION ===
${spec}
=== END SPECIFICATION ===`;

      const response = await callLLM(prompt, undefined, { enrichContext: true });
      const violations = response
        .split('\n')
        .filter(line => line.trim().startsWith('VIOLATION:') || line.trim().startsWith('- VIOLATION:'))
        .map(line => line.replace(/^-?\s*VIOLATION:\s*/i, '').trim());

      if (violations.length > 0) {
        logger.warn(`Found ${violations.length} consistency issue(s)`);
      } else {
        logger.success('Spec is consistent with constitution');
      }
      return violations;
    } catch (err) {
      logger.warn('LLM consistency check failed');
    }
  }

  return [];
}

function parseQuestions(response: string): ClarifyQuestion[] {
  const questions: ClarifyQuestion[] = [];
  const lines = response.split('\n').filter(l => l.trim());

  let id = 1;
  for (const line of lines) {
    const match = line.match(/^\d+\.\s*\[QUESTION\]\s*(.*?)\s*\[CONTEXT\]\s*(.*)$/i);
    if (match) {
      questions.push({ id: id++, question: match[1]!.trim(), context: match[2]!.trim() });
    } else if (line.match(/^\d+\./)) {
      // Fallback: treat any numbered line as a question
      const text = line.replace(/^\d+\.\s*/, '').trim();
      if (text.length > 10) {
        questions.push({ id: id++, question: text, context: 'Identified during spec analysis' });
      }
    }
  }

  return questions.length > 0 ? questions : detectBasicGaps('');
}

function detectBasicGaps(spec: string): ClarifyQuestion[] {
  const gaps: ClarifyQuestion[] = [];
  let id = 1;

  if (!spec.toLowerCase().includes('persona') && !spec.toLowerCase().includes('user type')) {
    gaps.push({ id: id++, question: 'What is the primary user persona?', context: 'No user persona defined in spec' });
  }
  if (!spec.toLowerCase().includes('performance') && !spec.toLowerCase().includes('latency')) {
    gaps.push({ id: id++, question: 'What are the performance targets?', context: 'Non-functional requirements gap' });
  }
  if (!spec.toLowerCase().includes('error') && !spec.toLowerCase().includes('failure')) {
    gaps.push({ id: id++, question: 'How should errors and failures be handled?', context: 'Error handling not specified' });
  }
  if (!spec.toLowerCase().includes('security') && !spec.toLowerCase().includes('auth')) {
    gaps.push({ id: id++, question: 'What are the security requirements?', context: 'Security considerations missing' });
  }

  return gaps;
}
