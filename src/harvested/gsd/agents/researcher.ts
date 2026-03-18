// Research agent — gathers context and analysis for a topic
import { callLLM, isLLMAvailable } from '../../../core/llm.js';
import { logger } from '../../../core/logger.js';

/**
 * Research a topic and return structured analysis covering key concepts,
 * patterns, risks, and recommendations. Uses the configured LLM when
 * available; otherwise returns a structured template for manual research.
 */
export async function research(topic: string): Promise<string> {
  logger.info(`Researching: ${topic}`);

  if (await isLLMAvailable()) {
    try {
      const prompt = [
        'You are a senior software engineering researcher. Provide a thorough ',
        'analysis of the following topic. Structure your response with these ',
        'sections, using markdown headers:\n\n',
        '## Key Concepts\nCore ideas and terminology a developer must understand.\n\n',
        '## Relevant Patterns\nDesign patterns, architectural approaches, and best practices.\n\n',
        '## Potential Risks\nPitfalls, edge cases, security concerns, and common mistakes.\n\n',
        '## Recommended Approach\nConcrete, actionable steps to implement or address this topic.\n\n',
        'Topic:\n',
        topic,
      ].join('');

      const response = await callLLM(prompt, undefined, { enrichContext: true });

      if (response.trim().length > 0) {
        logger.success(`Research complete for: ${topic}`);
        return response.trim();
      }

      logger.warn('LLM returned empty research; falling back to local template');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`LLM research failed: ${message}. Falling back to local template.`);
    }
  } else {
    logger.info('No LLM available — generating research template');
  }

  return buildFallbackResearch(topic);
}

/**
 * Produce a structured research template when no LLM is available.
 * Gives the developer a clear outline to fill in manually.
 */
function buildFallbackResearch(topic: string): string {
  return [
    `# Research: ${topic}`,
    '',
    '## Key Concepts',
    `- Identify the core ideas and terminology related to "${topic}"`,
    '- Review official documentation and specifications',
    '',
    '## Relevant Patterns',
    '- Examine established design patterns applicable to this domain',
    '- Look for reference implementations and community best practices',
    '',
    '## Potential Risks',
    '- Consider edge cases and failure modes',
    '- Evaluate security implications and performance concerns',
    '- Check for known issues or deprecation warnings',
    '',
    '## Recommended Approach',
    '- Start with a minimal proof-of-concept',
    '- Validate assumptions with tests before scaling',
    '- Document decisions and trade-offs for future reference',
  ].join('\n');
}
