export { danteToPrdExecutor } from './dante-to-prd-executor.js';
export { danteGrillMeExecutor } from './dante-grill-me-executor.js';
export { danteTddExecutor } from './dante-tdd-executor.js';
export { danteTriageIssueExecutor } from './dante-triage-issue-executor.js';
export { danteDesignAnInterfaceExecutor } from './dante-design-an-interface-executor.js';

import type { SkillExecutor } from '../runner.js';
import { danteToPrdExecutor } from './dante-to-prd-executor.js';
import { danteGrillMeExecutor } from './dante-grill-me-executor.js';
import { danteTddExecutor } from './dante-tdd-executor.js';
import { danteTriageIssueExecutor } from './dante-triage-issue-executor.js';
import { danteDesignAnInterfaceExecutor } from './dante-design-an-interface-executor.js';

export const SKILL_EXECUTORS: Record<string, SkillExecutor> = {
  'dante-to-prd': danteToPrdExecutor,
  'dante-grill-me': danteGrillMeExecutor,
  'dante-tdd': danteTddExecutor,
  'dante-triage-issue': danteTriageIssueExecutor,
  'dante-design-an-interface': danteDesignAnInterfaceExecutor
};
