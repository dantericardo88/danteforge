# DanteForge V+E Execution Packet - Wave 1: Truth Surface Reconciliation & Autoforge Implementation

## EXECUTION SUMMARY
**Wave Objective:** Eliminate truth surface contradictions and implement real autoforge loop
**Priority:** P0 Critical
**Estimated Duration:** 2-3 hours
**Risk Level:** High (core functionality changes)

## CURRENT STATE ASSESSMENT
- **Autoforge Loop:** Stubbed (returns context unchanged)
- **Truth Surfaces:** Contradicted (artifacts disagree on scores)
- **Verification:** Implemented but not CLI-exposed
- **Assessment:** Hangs due to LLM dependency issues
- **Test Coverage:** 295 files but missing integration/E2E

## TARGET STATE FOR WAVE COMPLETION
- Truth surface contradictions resolved
- Real autoforge loop implementation using existing infrastructure
- Verification command exposed in CLI
- Assessment runs successfully without hanging
- Integration tests added for autoforge loop

## FILES TO MODIFY

### Core Implementation
1. **src/core/autoforge-loop.ts**
   - Remove stub implementation
   - Implement real loop using termination governor, completion oracle, residual gap miner
   - Wire into existing wave delta tracker
   - Add proper error handling and state management

2. **src/cli/index.ts**
   - Add 'verify' command to command mapping
   - Ensure proper CLI integration

3. **src/cli/commands/assess.ts**
   - Fix hanging assessment (likely LLM timeout issue)
   - Add timeout handling for external dependencies

### Artifact Updates
4. **artifacts/current-gap-matrix.json**
   - Update to reflect actual implementation gaps
   - Remove contradictions with assessment results

5. **artifacts/current-scorecard.json**
   - Align with actual assessment results
   - Remove inflated scores not supported by implementation

6. **artifacts/closure-targets.json**
   - Ensure targets match realistic implementation state

### Test Additions
7. **tests/autoforge-loop-integration.test.ts** (new)
   - End-to-end autoforge loop testing
   - Integration with termination governor
   - Completion oracle verification
   - Residual gap mining validation

8. **tests/verification-cli.test.ts** (new)
   - CLI verify command functionality
   - Integration with assessment system

## EXECUTION STEPS

### Step 1: Truth Surface Reconciliation (30 min)
1. Update gap matrix to match actual assessment results
2. Update scorecard to reflect real implementation state
3. Ensure closure targets are realistic
4. Run truth surface validation scripts

### Step 2: Autoforge Loop Implementation (60 min)
1. Replace stub in `runAutoforgeLoop` with real implementation
2. Integrate termination governor for loop control
3. Add completion oracle calls for verdict generation
4. Implement residual gap mining for next-wave scoping
5. Wire wave delta tracker for progress measurement

### Step 3: CLI Integration (30 min)
1. Expose verify command in CLI index
2. Fix assessment hanging issue (add timeouts, error handling)
3. Test CLI commands work end-to-end

### Step 4: Test Implementation (45 min)
1. Create integration tests for autoforge loop
2. Add CLI verification tests
3. Ensure existing tests still pass

### Step 5: Validation & Verification (30 min)
1. Run assessment to verify it completes
2. Run verification command to test integration
3. Update artifacts based on new reality
4. Generate residual gap report

## VERIFICATION CHECKLIST

### Functional Verification
- [ ] `danteforge assess` runs successfully without hanging
- [ ] `danteforge verify` command works
- [ ] Autoforge loop executes real cycles (not just return context)
- [ ] Assessment scores match implementation reality
- [ ] No truth surface contradictions

### Code Quality Verification
- [ ] All TypeScript compilation passes
- [ ] New tests added and passing
- [ ] Error handling implemented for new code paths
- [ ] Integration with existing components works

### Artifact Verification
- [ ] Gap matrix accurately reflects current state
- [ ] Scorecard aligns with assessment results
- [ ] Closure targets are achievable
- [ ] Masterplan truth updated

## DEPENDENCY ANALYSIS

### Required Components (Must Exist)
- ✅ Termination governor (`src/core/termination-governor.ts`)
- ✅ Completion oracle (`src/core/completion-oracle.ts`)
- ✅ Residual gap miner (`src/core/residual-gap-miner.ts`)
- ✅ Wave delta tracker infrastructure
- ✅ PDSE scoring system
- ✅ State management

### Integration Points
- Autoforge loop ↔ Termination governor (decision making)
- Autoforge loop ↔ Completion oracle (verdict generation)
- Autoforge loop ↔ Residual gap miner (gap analysis)
- CLI ↔ Verification system (command exposure)
- Assessment ↔ All scoring components (result generation)

## FAILURE MODE MITIGATION

### Common Issues & Solutions
1. **Assessment Still Hangs**
   - Add timeout handling in LLM calls
   - Make external dependencies optional
   - Provide fallback scoring without LLM features

2. **Autoforge Loop Complexity**
   - Start with simple implementation using existing components
   - Add complexity incrementally
   - Ensure backward compatibility

3. **Truth Surface Drift**
   - Automate artifact updates from code changes
   - Add validation to prevent contradictions
   - Make artifact updates part of development workflow

4. **Test Integration Issues**
   - Mock external dependencies in tests
   - Test components in isolation first
   - Add integration tests incrementally

## SUCCESS CRITERIA

### Minimum Viable Completion
- Autoforge loop executes real cycles using termination governor
- Truth surface contradictions resolved
- Assessment runs without hanging
- Verification command accessible
- Basic integration tests passing

### Stretch Goals
- Full E2E workflow testing
- Performance regression detection
- Comprehensive error handling
- All artifacts automatically synchronized

## ROLLBACK PLAN

If wave fails:
1. Revert autoforge-loop.ts to stub implementation
2. Restore original artifact files
3. Remove CLI command additions
4. Keep test files for future implementation

## NEXT WAVE READINESS

After successful completion:
- Run full assessment to get new baseline scores
- Update masterplan with new reality
- Plan Phase 2: Integration/E2E proof layer
- Focus on enterprise compliance and self-improvement safety

## RESOURCE REQUIREMENTS

### Time Estimate: 3 hours
- Truth surface reconciliation: 30 min
- Autoforge implementation: 60 min
- CLI integration: 30 min
- Testing: 45 min
- Validation: 30 min
- Buffer: 15 min

### Skills Required
- TypeScript development
- Node.js CLI development
- Test-driven development
- System integration
- Artifact management

### Testing Requirements
- Unit tests for new functionality
- Integration tests for component wiring
- CLI smoke tests
- Assessment system validation