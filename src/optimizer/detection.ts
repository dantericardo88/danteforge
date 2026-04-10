import fs from 'fs/promises';
interface VerifyResult {
  passed: string[];
  warnings: string[];
  failures: string[];
}

export async function checkForIncompleteWork(result: VerifyResult): Promise<void> {
  try {
    const patterns = ['TODO', 'FIXME'];
    const mockPatterns = ['mock', 'Mock'];
    const files = await fs.readdir('.');
    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.md')) {
        const content = await fs.readFile(file, 'utf8');
        for (const pattern of patterns) {
          if (content.includes(pattern)) {
            result.failures.push(`Incomplete work found in ${file}: ${pattern}`);
          }
        }
        for (const pattern of mockPatterns) {
          if (content.includes(pattern)) {
            result.warnings.push(`Potential mock in ${file}: ${pattern}`);
          }
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.warnings.push(`Could not check for incomplete work: ${errorMessage}`);
  }
}