# PRD-WORLDMODEL-V1: Causal Coherence Architecture

**World Model Prediction + Time Machine Measurement + Causal Attribution**

**Version:** 1.0
**Created:** 2026-04-30
**Status:** Approved for Execution Post-Trio-Ships
**Target Repos:** DanteForge (primary), DanteAgents/DanteCode/DanteDojo/DanteHarvest (consumers)
**Implementation Agents:** substrate-Claude (primary), Codex (extraction), DanteCode (dimension closure), web-Claude (refinement)
**Discovery Discipline:** Verify Time Machine Phase 1 (DecisionNode schema canonical) shipped before beginning. This PRD builds on the unified ecosystem schema.
**Build Window:** Phase 1 (LLM-as-predictor) 1-2 weeks. Phase 2 (Dojo-trained mid-tier) weeks-to-months gated on accumulated training data. Phase 3 (full world model research) multi-year horizon.
**Current Baseline:** Trio shipping. Time Machine Phase 1 operational. DELEGATE-52 byte-identical restoration validated (0 unmitigated divergences across 48 document types).

---

## 1. Executive Summary

This PRD specifies the synthesis architecture identified during the LeCun Davos 2026 / AMI Labs analysis combined with the existing DanteForge Time Machine vision. The synthesis is structurally novel: neither LeCun's world model approach nor the time machine's counterfactual replay alone closes the causal reasoning loop. Combined through causal attribution as the training signal between them, they form closed-loop causal reasoning across software, scientific, and embodied domains.

Three layers, each tractable at a different scope:

**Layer 1 - Forward prediction.** Before any DanteForge convergence loop runs an improvement, a predictor generates expected outcome with confidence interval. The prediction is stored in the DecisionNode alongside the eventual measured outcome. Three implementation tiers: LLM-as-predictor (minimum viable, weeks), Dojo-fine-tuned predictor on accumulated history (mid-tier, weeks-to-months), full JEPA-style world model on high-dimensional sensory data (research horizon, multi-year).

**Layer 2 - Backward measurement.** The Time Machine already records actual outcomes via the DecisionNode hash chain. The new work integrates measurement into the existing convergence loop so prediction-outcome pairs accumulate as training data for Layer 3.

**Layer 3 - Causal attribution as training signal.** A new module classifies prediction-outcome pairs as causally-aligned (prediction matched outcome direction with statistical significance), correlation-driven (prediction missed outcome direction or matched only by chance), or noise (no signal). This classification updates a causal weight matrix that future predictions consult. Predictions get refined toward measured causal weight rather than text-correlation strength. This is the empirical validation of LeCun's diagnosis: current AI lacks causal reasoning because no system measures whether its predictions were causally accurate or just correlated.

The synthesis lands as a 19th dimension in the DanteForge harsh scorer: **Causal Coherence**. Measured by tracking how well predictions match outcomes across recent convergence runs. A 9.0 means 90% directional accuracy. A 5.0 means random. The dimension becomes its own feedback signal for whether the substrate is operating with genuine causal understanding versus pattern-matching. This is constitutional in nature, similar to how Article XIII (Context Economy) was a constitutional addition. Article XV: Causal Coherence becomes the principle that DanteForge's improvements must be predictable in advance and the predictions must be measurable in retrospect.

This PRD is post-trio. Do not begin until the trio ships and the Time Machine Phase 1 (DecisionNode schema as canonical ecosystem type) is operational. The prediction layer requires the DecisionNode schema as the substrate it reads and writes against.

---

## 2. Existing Substrate (Read Before Building)

This PRD assumes the following exists post-trio-ships. Implementation agents must verify each before extension.

**DanteForge v1.1 sealed.** Pass 18 package extractions complete. `@danteforge/evidence-chain` v1.1, `@danteforge/truth-loop`, `@danteforge/three-way-gate` published. Sister repos consume these as dependencies.

**Time Machine Phase 1 operational.** DecisionNode schema canonical across DanteForge, DanteCode, DanteAgents, DanteHarvest, DanteDojo. Every product emits compatible JSONL into the unified decision graph. The four-layer DanteForge architecture (Ore, Forge, Time Machine, Parallel Universes) is the framework this PRD extends.

**Convergence loop architecture.** The five forge temperatures (spark, ember, blaze, nova, inferno) plus magic and ascend run measure-improve-measure cycles against the 18-dimension harsh scorer. Each cycle writes a DecisionNode with the improvement intent, the executed action, the resulting state, and the score delta.

**Empirical validation foundation.** DELEGATE-52 round-trip validation produced 0 unmitigated divergences across 48 document types. The surgical patch as reset function is empirically proven. This is the substrate that makes counterfactual replay possible — every branch starts from a verified, uncorrupted baseline.

**Article XIII Context Economy ratified.** Token efficiency as constitutional principle, RTK harvest pattern shipped. Article XIV (Brand Asset Protocol) ratified or pending. This PRD's Article XV (Causal Coherence) follows the same ratification pattern.

**Implementation agents:** before any new work, verify the trio shipped per existing PRDs. If trio is incomplete, this PRD is on hold. The synthesis architecture builds on the substrate that PRD-FORGE-V1.1, PRD-CODE-V2, and PRD-AGENTS-V1 deliver. Without that substrate stable, the synthesis cannot ground itself empirically.

---

## 3. The Architecture This PRD Ships

The end-state architecture this PRD delivers is the following operational pattern:

**Founder runs `danteforge nova "build auth system"`** through normal workflow.

**DanteForge convergence loop internally orchestrates with prediction layer:**

1. Spec/plan/tasks generation runs as currently specified
2. Before the first execution wave, the new predictor module generates expected outcomes for each task in the wave (predicted score delta per dimension, predicted cost, predicted latency, confidence interval per prediction)
3. Predictions stored in pre-execution DecisionNodes with `predicted: {scoreImpact, cost, latency, confidence}` field
4. Execution wave runs as currently specified
5. Post-execution measurement runs the harsh scorer
6. Measured outcomes stored in post-execution DecisionNodes with `output: {qualityScore, costUsd, latencyMs}` field
7. Causal attribution module compares prediction to measurement
8. Attribution result classifies decision as causally-aligned, correlation-driven, or noise
9. Causal weight matrix updates with new evidence
10. Next prediction reads updated matrix when generating its forecast
11. Loop continues with refined predictions until convergence target hit

**The founder sees this through a new CLI command:**

```
danteforge causal-status

  DanteForge Causal Coherence Status
  -------------------------------------------------
  Causal Coherence Score: 7.4/10 (target 9.0)
  
  Recent prediction accuracy:
    Dimension          Predicted  Measured  Aligned
    Functionality      +0.4       +0.5      yes
    Testing            +0.3       +0.1      partial
    Error Handling     +0.6       +0.6      yes
    Security           +0.2       -0.1      no
  
  Causal attribution (last 50 decisions):
    Causally-aligned:   38 (76%)
    Correlation-driven: 9 (18%)
    Noise:              3 (6%)
  
  Calibration: predictor is well-calibrated on Functionality
  and Error Handling. Underestimates Testing improvements.
  Overestimates Security improvements.
  
  Recommendation: predictor needs more Security training data.
  Run `danteforge dojo train --dimension security` if Dojo is configured.
```

That's the operational shape. The convergence loop now operates with explicit prediction-then-measurement-then-attribution. The harsh scorer dimension Causal Coherence measures whether the substrate is operating with genuine causal understanding. The causal weight matrix accumulates evidence about which predictions hold and which don't.

The three phases below ship the components that make this possible at increasing levels of sophistication.

---

## 4. Phase 1: LLM-as-Predictor Minimum Viable (Weeks 1-2)

The smallest valuable version uses the existing provider abstraction (Claude, GPT, Codex, DanteCode, Ollama) as the predictor. Cost is a few cents per prediction call. Architectural shape lands immediately. The full LeCun-style world model arrives in Phase 3.

### 4.1 New Build: predictor Package

Create `packages/predictor/` as a new sibling to `evidence-chain`, `truth-loop`, `three-way-gate`.

**Public API:**
```typescript
interface PredictionRequest {
  decisionNode: Partial<DecisionNode>;
  currentState: ProjectState;
  proposedAction: ImprovementAction;
  contextWindow: DecisionNode[];
  budgetEnvelope: { maxUSD: number; maxLatencyMs: number };
}

interface PredictionResult {
  predicted: {
    scoreImpact: Record<DimensionName, number>;
    costUSD: number;
    latencyMs: number;
    confidence: number;
  };
  rationale: string;
  predictorVersion: string;
  receipt: ProofAnchoredReceipt;
}

async function predict(request: PredictionRequest): Promise<PredictionResult>;
```

**Implementation:**
- Predictor wraps existing LLM provider abstraction
- Prompt template includes: current state, proposed action, last 10 prediction-outcome pairs from same dimension, causal weight matrix excerpt for relevant dimensions
- Response parsed into structured prediction with explicit confidence
- Receipt emitted via @danteforge/evidence-chain
- Cost tracked through coin-purse for budget enforcement

**Constitutional integration:**
- Article XIII Context Economy: prediction prompts use compressed context, only sacred content (errors, warnings, prior failure modes) preserved verbatim
- Three-way gate: predictions don't promote artifacts, but predictor calls gated on having sufficient context (causal weight matrix < 20 entries for dimension marks prediction low-confidence)
- Fail-closed: missing context returns low-confidence prediction rather than confident guess

**Acceptance:**
- Prediction request returns valid structured PredictionResult within configured budget
- Predictions stored in DecisionNode `predicted` field before execution wave runs
- Cost telemetry emits to .danteforge/economy/
- Receipt verifies via evidence-chain verifyBundle
- Test suite: 20 predictions on synthetic improvements, parser handles all responses correctly

**LOC budget:** ~400 LOC across types, predictor logic, prompt templates. KiloCode-disciplined.

### 4.2 Implement: Causal Attribution Module

Create `packages/causal-attribution/` as the bridge layer between predictor and measurement.

**Public API:**
```typescript
interface AttributionRequest {
  decisionNode: DecisionNode;
  recentHistory: DecisionNode[];
}

type AttributionClassification = 
  | 'causally-aligned'        
  | 'correlation-driven'      
  | 'noise';                  

interface AttributionResult {
  classification: AttributionClassification;
  confidence: number;
  contributingFactors: string[];
  weightUpdate: CausalWeightDelta;
  receipt: ProofAnchoredReceipt;
}

async function attribute(request: AttributionRequest): Promise<AttributionResult>;
```

**Attribution algorithm (Phase 1 simple version):**
- Direction match: did predicted score impact and measured score impact have same sign?
- Magnitude alignment: how close was predicted magnitude to measured magnitude (within 50% bands)?
- Statistical significance: is this prediction-measurement pair within the noise band of recent history, or is it a meaningful signal?
- Classification:
  - causally-aligned: direction match + magnitude within 50% + significance above noise band
  - correlation-driven: direction match but magnitude off, or match within noise band
  - noise: direction mismatch or no significance

**Phase 1 simplification:** Pearl's do-calculus formal causal inference deferred to Phase 3 research. Phase 1 uses simple statistical alignment as proxy. This is adequate for bootstrapping the causal weight matrix; sophistication arrives later.

**Causal weight matrix structure:**
```typescript
interface CausalWeightMatrix {
  perDimensionAccuracy: Record<DimensionName, {
    sampleCount: number;
    directionAccuracy: number;
    magnitudeCalibration: number;
    confidenceCalibration: number;
    lastUpdated: string;
  }>;
  perActionTypeAccuracy: Record<ActionType, /* same shape */>;
  globalCausalCoherence: number;
  version: string;
  evidenceRef: string;
}
```

**Acceptance:**
- Attribution correctly classifies known synthetic test cases (20 hand-crafted prediction-outcome pairs)
- Causal weight matrix updates correctly after each attribution
- Statistical significance calculation produces reasonable noise band on real DanteForge convergence data
- Receipt emitted for each attribution with full reasoning

**LOC budget:** ~500 LOC across attribution algorithm, statistical helpers, weight matrix updates, types.

### 4.3 Integrate: Convergence Loop Extension

Extend the existing convergence loop in DanteForge to call predictor before action and attribution after measurement.

**Existing loop:**
```
spec → plan → tasks → execute_wave → measure → improve → measure → ...
```

**Extended loop:**
```
spec → plan → tasks → predict_wave → execute_wave → measure → attribute → 
update_causal_matrix → improve_using_updated_matrix → predict_next → ...
```

**Implementation in `src/spine/convergence/`:**
- Before each `execute_wave`, call `predict()` on the planned action
- Store prediction in pre-execution DecisionNode
- Run `execute_wave` as currently specified
- Run `measure` as currently specified
- Store measurement in post-execution DecisionNode
- Call `attribute()` on the prediction-measurement pair
- Update causal weight matrix
- Next `improve` call reads updated matrix when selecting next action

**Backward compatibility:**
- Convergence loops without predictor configured fall back to current behavior
- `--no-predictor` flag explicitly disables prediction layer for cost-sensitive runs
- Default for new installs: predictor enabled with budget cap of $0.50 per convergence run for prediction calls

**Acceptance:**
- All five forge temperatures run with prediction layer enabled by default
- Prediction overhead per convergence run stays under $0.50 budget cap
- Attribution runs successfully on every prediction-measurement pair
- Causal weight matrix grows monotonically with convergence runs
- `danteforge causal-status` command displays current state correctly

**LOC budget:** ~400 LOC for convergence loop extension plus CLI command implementation.

### 4.4 New Dimension: Causal Coherence (Dimension 19)

Add dimension 19 to the existing 18-dimension harsh scorer.

**Dimension definition:**

| Property | Value |
|----------|-------|
| Weight | 5% (initial; increases as data accumulates) |
| Measurement | Global causal coherence from causal weight matrix |
| Computation | weighted average of (direction accuracy × confidence calibration × sample size weight) across all dimensions |
| Threshold for 9.0+ | 90% direction accuracy AND well-calibrated confidence AND minimum 50 attributions |
| Gap remediation | Recommend Dojo training on dimensions with low accuracy |

**Constitutional addition - Article XV: Causal Coherence:**

Draft text:
> Article XV: Causal Coherence. DanteForge's improvements must be predictable in advance and the predictions must be measurable in retrospect. Improvements that cannot be predicted suggest the substrate does not understand what it is doing. Predictions that cannot be measured against outcomes suggest the verification layer does not catch what matters. Causal Coherence is the property that prediction-outcome alignment is empirically measured, attribution is constitutionally required, and refinement of prediction follows measured causal weight rather than text-correlation strength.
>
> Enforcement: every convergence run records prediction-outcome pairs in DecisionNodes. Causal attribution classifies each pair. The causal weight matrix accumulates evidence. The Causal Coherence dimension measures the substrate's overall causal reasoning quality.

Founder ratification required before Article XV becomes constitutional. Substrate-side implementation can ship before ratification; constitutional status awaits founder approval.

**Acceptance:**
- Dimension 19 added to harsh scorer with documented criteria
- Article XV draft text approved or revised by founder
- `danteforge causal-status` reflects dimension score correctly
- Existing convergence loops continue working with new dimension active

**LOC budget:** ~200 LOC for dimension integration plus documentation updates.

### 4.5 Phase 1 End-to-End Test

Phase 1 is complete when this works:

Founder runs `danteforge nova "build auth system"` on a test project. The convergence loop:
1. Spec, plan, tasks generated
2. Before each execution wave, predictor generates expected outcomes per dimension
3. Execution runs, measurement runs
4. Attribution classifies each prediction-outcome pair
5. Causal weight matrix updates
6. After 5+ convergence runs, `danteforge causal-status` shows meaningful data:
   - Causal Coherence score with sample size
   - Per-dimension prediction accuracy
   - Calibration analysis
   - Recommendations for predictor refinement

If this works, Phase 1 is complete and the prediction layer is proven at minimum viable level.

### 4.6 Phase 1 Acceptance Criteria

1. predictor package operational, returns valid PredictionResult within budget on all dimension types
2. causal-attribution package operational, correctly classifies test cases and updates weight matrix
3. Convergence loop calls predict-execute-measure-attribute in correct order with full evidence chain
4. Dimension 19 (Causal Coherence) added to harsh scorer
5. Article XV draft approved or revised
6. `danteforge causal-status` command works
7. End-to-end test passes: nova run produces meaningful causal coherence data after 5+ convergence runs
8. Total Phase 1 prediction overhead under $0.50 per convergence run
9. Causal weight matrix persists across DanteForge sessions correctly

---

## 5. Phase 2: Dojo-Trained Mid-Tier Predictor (Months 1-3 Post-Phase-1)

Phase 2 trains a custom predictor on accumulated DanteForge convergence history. Replaces or supplements the LLM-as-predictor with a fine-tuned model that's substantially cheaper and faster, with calibration improving as more data accumulates.

### 5.1 Data Pipeline: harvest_convergence_history

Extend DanteHarvest with a new package that extracts training data from accumulated DecisionNodes.

**Package: `packages/harvest-convergence-history/`**

**Function:**
- Walk DecisionNode JSONL across all Dante products
- Extract prediction-execution-measurement-attribution tuples
- Format as training data for Dojo: (current_state, proposed_action, predicted_outcome, actual_outcome, attribution_class)
- Filter for high-quality examples (well-attributed, sufficient context, complete data)
- Output JSONL ready for Dojo training pipeline

**Acceptance:**
- Pipeline correctly extracts tuples from real DecisionNode history
- Training data passes Dojo's input validation
- Filtering produces clean dataset (>90% high-quality examples after filtering)

**LOC budget:** ~300 LOC.

**Activation trigger:** When DanteForge has accumulated 500+ attributed prediction-outcome pairs from real convergence runs.

### 5.2 Dojo Training: predictor-base-v1

Use existing Dojo infrastructure to fine-tune a base model on the convergence history dataset.

**Training approach:**
- Base model: Qwen2.5-7B-Instruct or Llama-3.1-8B-Instruct (selected based on Dojo's existing infrastructure)
- Method: QLoRA fine-tuning with prediction task as primary objective
- Training data: prediction-outcome pairs from Phase 1 accumulated history
- Held-out validation: 20% of pairs reserved for accuracy measurement
- Acceptance threshold: F1 0.85+ on direction prediction, MAE within 30% on magnitude

**Acceptance:**
- Trained model passes validation thresholds
- Inference latency under 500ms per prediction
- Cost per prediction approximately 1/100th of LLM-as-predictor (local inference vs API call)

**Activation trigger:** Phase 2.1 data pipeline produces sufficient training data.

### 5.3 Predictor Provider Integration

Add `dojo-predictor.ts` adapter to llm-adapters package.

**Adapter:**
- Calls local Dojo-served predictor model
- Same predictor interface as Phase 1 LLM-as-predictor
- Falls back to LLM-as-predictor if Dojo predictor returns low-confidence or fails
- Tracks predictor accuracy metrics for ongoing comparison

**Provider routing:**
- Default new predictor calls go through dojo-predictor
- LLM-as-predictor reserved for novel dimensions or low-confidence Dojo predictions
- Routing decision based on dimension-specific accuracy metrics from causal weight matrix

**Acceptance:**
- Dojo-predictor handles 80%+ of predictions on dimensions with sufficient training data
- LLM-as-predictor fallback works correctly for novel dimensions
- Per-prediction cost drops 50x+ versus pure LLM-as-predictor

**LOC budget:** ~250 LOC for adapter plus routing logic.

### 5.4 Continuous Improvement Loop

Extend Phase 1's causal attribution to drive continuous predictor refinement.

**Mechanism:**
- New attribution data automatically extends training dataset
- Dojo training pipeline triggers re-training when accumulated new examples exceed threshold (e.g., +200 high-quality examples)
- Re-trained model deployed automatically if it beats current model on held-out set
- Causal weight matrix updates to reflect new predictor performance
- Older predictor versions kept for ablation testing

**Constitutional integration:**
- Time Machine records every predictor version as a DecisionNode
- Counterfactual replay can compare same convergence run with different predictor versions
- Article XV (Causal Coherence) extends to include predictor evolution as a measured property

**Acceptance:**
- Re-training triggers correctly on accumulated examples
- Deployment gate prevents regressions (new model must beat old on held-out set)
- Predictor version history queryable via Time Machine
- Causal Coherence score improves over predictor generations

**LOC budget:** ~400 LOC across training pipeline integration and version management.

### 5.5 Phase 2 Acceptance Criteria

1. Convergence history pipeline operational, producing clean training data
2. Dojo predictor v1 trained and validated, beats LLM-as-predictor on validation set
3. Predictor adapter integrates Dojo predictor as default with LLM fallback
4. Continuous improvement loop triggers re-training automatically
5. Per-prediction cost drops 50x+ versus Phase 1
6. Causal Coherence dimension scores improve as predictor matures
7. Predictor evolution tracked via Time Machine

---

## 6. Phase 3: Full World Model Integration (Multi-Year Research Horizon)

Phase 3 is the genuine research contribution. The implementation tier where DanteForge's prediction layer becomes a JEPA-style world model in LeCun's sense - trained on high-dimensional sensory data (video, screen recordings, multimodal observations of agent behavior), capable of forward prediction in domains beyond what text-based prediction captures.

This phase is post-Phase-2 and proceeds at research timeline rather than build sprint timeline. The architecture below specifies what Phase 3 looks like; the sequencing of when to start is governed by Phase 2 outcomes plus research feasibility.

### 6.1 Research Questions

Three open questions Phase 3 needs to resolve before sustained build effort:

**Question 1: Does multimodal sensory input meaningfully improve causal prediction accuracy in DanteForge's domain?**

The hypothesis behind LeCun's world models is that physical reality requires high-dimensional sensory grounding. Software development is partially physical (agent behavior on screens, developer interactions, IDE state) but mostly symbolic (code, tests, configurations). Whether a JEPA-style world model adds enough accuracy over Phase 2's Dojo predictor to justify the substantial increase in training cost is an empirical question.

Phase 3 starts with a smaller-scale experiment: train a multimodal predictor on a subset of DanteForge convergence data that includes screen recordings (DanteAgents WhatsApp interactions, DanteCode IDE behavior), measure accuracy improvement over Phase 2 baseline.

**Question 2: What's the right architecture for software-domain world models?**

JEPA was designed for video prediction. Software-domain predictions require different architectural choices: long-context reasoning over code structure, formal verification of action consequences, integration with the DecisionNode graph as structured prior.

Phase 3 architecture work specifies and tests several architectural variants: pure JEPA on screen recordings, JEPA-plus-graph-prior on screen-recordings-plus-DecisionNode-context, transformer-with-video-encoder, etc. Comparative evaluation determines which variant produces best causal prediction accuracy.

**Question 3: How does the world model integrate with formal causal calculus?**

Pearl's do-calculus provides mathematical foundation for causal inference. Phase 1 attribution uses simple statistical alignment as proxy. Phase 3 attribution should integrate proper structural causal models. The research question is how to learn structural causal models from DecisionNode data and use them for counterfactual replay rather than the simpler alignment proxy.

### 6.2 Architecture Sketch (Speculative)

The world model component sits in DanteAgents (per the multimodal expansion in PRD-AGENTS-V2-Multimodal-Perception). Specifically:

**Perception layer:** Nemotron 3 Nano Omni (or successor) processes high-dimensional sensory input - screen recordings during DanteCode execution, voice inputs, image inputs from WhatsApp, video of agent behavior.

**World model layer:** New component (potentially JEPA-style) that learns to predict next-state in observation space rather than next-token in text space. Trained on perception layer outputs paired with subsequent observed outcomes.

**Causal abstraction layer:** Bridges world model predictions in observation space with DecisionNode predictions in symbolic space. Both feed into causal attribution.

**Structural causal model layer:** Pearl-style SCM learned from DecisionNode graph plus world model predictions. Used for proper counterfactual replay in Phase 3.

This architecture is not specified to ship-ready level in this PRD because Phase 3 research questions need empirical answers first. Phase 3 starts with research, produces specifications based on research findings, then specifies build work.

### 6.3 Phase 3 Activation Criteria

Phase 3 begins when:

1. Phase 2 has been operational for 6+ months with sustained Causal Coherence score 8.0+
2. DanteAgents v2 multimodal expansion has shipped (per PRD-AGENTS-V2)
3. Sufficient multimodal training data accumulated through normal Dante operations
4. Research feasibility analysis indicates JEPA-style approach is tractable on available compute
5. Founder explicitly approves multi-year research investment

Until activation criteria met, Phase 3 specification stays in this PRD as architectural vision, not active build scope.

### 6.4 The Eventual Paper

The research paper this work produces:

**Title:** *Causal Coherence: Closed-Loop Causal Reasoning in Human-AI Collaboration via Predictive World Models and Counterfactual Decision Histories*

**Core claim:** Combining JEPA-style world models for forward prediction with cryptographic decision history graphs for backward measurement, with causal attribution as the training signal between them, produces empirically measurable causal reasoning capability that neither approach achieves alone.

**Empirical results:** Phase 1 prediction-outcome alignment baseline. Phase 2 Dojo predictor improvements over Phase 1. Phase 3 world model improvements over Phase 2 (if successful).

**Citation context:** LeCun et al. on world models. Pearl on causal calculus. DELEGATE-52 on document corruption. Cemri et al. on multi-agent failure modes. Kim et al. on agent scaling laws. Meta-Harness on harness optimization. Each addresses one piece of the causal reasoning problem; this paper addresses the integration.

This is the eventual research-grade external publication. Phase 3 work produces it. Don't write it before Phase 1 ships and Phase 2 produces empirical baseline. Building before claiming, per the discipline established throughout.

---

## 7. Failure Modes and Recovery

| Failure Mode | Detection | Recovery |
|--------------|-----------|----------|
| Predictor returns malformed response | Schema validation fails | Retry with cleaner prompt; on second failure, mark prediction as unavailable for this decision |
| Predictor cost exceeds budget envelope | Coin-purse threshold | Disable predictor for remaining wave, log degraded mode |
| Attribution classifies all decisions as noise | Causal weight matrix shows no signal | Predictor needs training data; recommend more convergence runs before relying on dimension |
| Causal weight matrix corruption | Hash chain validation fails | Restore from time machine, replay attributions from clean state |
| Dojo predictor returns systematic bias | Causal coherence score drops | Disable Dojo predictor, fall back to LLM-as-predictor, trigger Dojo retraining |
| Predictor over-confident on novel dimensions | Confidence calibration metric drops | Reduce predictor weight on novel dimensions, require larger sample before influence |
| Article XV ratification rejected by founder | Founder feedback | Substrate continues operating, dimension stays at lower constitutional weight |
| Phase 2 training data insufficient | Pipeline produces fewer than 500 examples | Wait for more convergence history accumulation |
| Phase 3 research finds world model adds no value | Empirical comparison shows Phase 2 baseline beats Phase 3 | Stop Phase 3, document negative result, continue with Phase 2 architecture |

**Strictness mode default:** standard. Production deployments use strict.

---

## 8. Success Definition

PRD-WORLDMODEL-V1 is complete in tiers, each with separate success criteria.

**Phase 1 success:**
1. Predictor operational with full evidence chain
2. Attribution classifies prediction-outcome pairs correctly
3. Causal weight matrix accumulates evidence over convergence runs
4. Dimension 19 (Causal Coherence) integrated into harsh scorer
5. Article XV drafted and decision pending or made
6. End-to-end test on real DanteForge work produces meaningful causal coherence data
7. Total cost overhead under $0.50 per convergence run
8. Causal Coherence score reaches 5.0+ on test project after 50+ convergence runs

**Phase 2 success:**
1. Dojo predictor v1 trained and beats LLM-as-predictor baseline
2. Predictor adapter routes 80%+ of predictions through Dojo predictor
3. Continuous improvement loop operational
4. Causal Coherence score reaches 7.5+ on production work after 6 months
5. Per-prediction cost drops 50x+ versus Phase 1
6. Predictor evolution tracked via Time Machine

**Phase 3 success (when activated):**
1. Research questions answered through empirical experimentation
2. Architecture specification produced based on research findings
3. World model integration shows measurable accuracy improvement over Phase 2
4. Research paper drafted with three-layer empirical foundation
5. Causal Coherence score reaches 9.0+ on production work

**Constitutional success:**
1. Article XV (Causal Coherence) ratified or formally rejected with rationale
2. All Articles I-XIV continue to operate correctly with new dimension active
3. Three-way gate enforced on all predictor calls and attributions
4. Time Machine reversibility preserved across prediction layer
5. Article XIII Context Economy respected in predictor prompt design

**Strategic success:**
1. The synthesis architecture from the LeCun-plus-time-machine analysis becomes operational
2. DanteForge has empirical evidence of causal reasoning capability that no other system has
3. The research paper space identified in the convergence analysis becomes accessible
4. Builder-mode demos can show prediction-outcome alignment as concrete value-add

---

## 9. Out of Scope for This PRD

Explicit non-goals to keep scope tight:

- Phase 3 detailed implementation specification (research must precede build)
- Replacement of existing harsh scorer (Causal Coherence is dimension 19, not replacement)
- Integration with non-Dante external systems (extension is Dante-internal first)
- Public release announcement (operational stability before external claims)
- Real-time prediction during interactive sessions (batch prediction at wave level only)
- Multimodal prediction in Phase 1 or Phase 2 (deferred to Phase 3 with PRD-AGENTS-V2)
- Pearl-formal causal calculus in Phase 1 attribution (statistical alignment proxy is adequate for bootstrapping)
- Cross-product causal attribution beyond DanteForge in Phase 1 (other products consume the schema but attribution lives in DanteForge initially)

---

## 10. Open Questions for Implementation Agents

Resolve by inspecting current state at build time:

1. Has Time Machine Phase 1 (DecisionNode schema as canonical type, JSONL emission across products) shipped? If not, this PRD is on hold.
2. What's the current state of `packages/evidence-chain` v1.1? Has aggregateChildReceipts shipped? Predictor receipts depend on it.
3. Is the convergence loop currently in `src/spine/convergence/` or elsewhere? Phase 1 integration point depends on actual location.
4. What's the existing harsh scorer dimension count? PRD assumes 18; verify before adding dimension 19.
5. Has Dojo's training pipeline shipped sufficiently for Phase 2.2? Phase 2 starts when Dojo can ingest the convergence history dataset.
6. Has DanteAgents v2 multimodal expansion shipped per PRD-AGENTS-V2? Phase 3 prerequisites depend on it.
7. What's the current Article numbering after Article XIV (Brand Asset Protocol)? Verify Article XV is the next available number.

---

## 11. Constitutional Discipline

This PRD operates under the Dante Constitution. All Articles I-XIV apply. Article XV proposed via this PRD.

**Article IX KiloCode Discipline:** Files under 500 LOC. The package-by-package structure specifies LOC budgets per module.

**Article X OSS Pattern Learning:** Patterns harvested from LeCun world model research and Pearl causal calculus literature attributed in `.danteforge/OSS_HARVEST/world_model_patterns.md` and `.danteforge/OSS_HARVEST/causal_calculus_patterns.md`.

**Article XI Production-Ready Criteria:** All 10 criteria met at each phase acceptance gate.

**Article XII Anti-Stub Enforcement:** Predictor implementations must execute real predictions. Attribution must compute real classifications. Causal weight matrix must update real evidence. No stubbed components in production paths.

**Article XIII Context Economy:** Predictor prompts use compressed context with sacred content preservation. Attribution operates on minimal necessary context.

**Article XIV Brand Asset Protocol:** When predictor calls produce outputs naming real-world entities (less common in software domain, more common in DanteCreative when it activates), entity verification still required.

**Article XV (Proposed) Causal Coherence:** As specified in section 4.4. Founder ratification required.

**Three-Way Gate:** Forge policy (predictor calls permitted within budget), evidence chain integrity (all predictions and attributions have receipts), harsh score (Causal Coherence dimension contributes to overall score). All three GREEN required.

**Fail-Closed Semantics:** Predictor failures return low-confidence rather than confident guesses. Attribution failures return noise classification rather than spurious alignment. Missing data classified as unknown rather than assumed.

---

## 12. Build Calendar (Indicative)

Phase 1, post-trio-ships:

| Day | Focus |
|-----|-------|
| 1-2 | predictor package: types, prompt templates, LLM-as-predictor implementation |
| 3 | causal-attribution package: classification algorithm, weight matrix |
| 4 | Convergence loop extension: predict-execute-measure-attribute integration |
| 5 | Dimension 19 (Causal Coherence) integration into harsh scorer |
| 6 | CLI command (causal-status), Article XV draft for founder review |
| 7 | End-to-end test, Phase 1 acceptance gate |

Total Phase 1: 7 days at demonstrated rate.

Phase 2 calendar TBD when Phase 1 complete and accumulated data sufficient. Indicative window: 10-14 days for full Phase 2 build once data is ready (data accumulation takes 1-2 months of normal operations).

Phase 3 calendar TBD per research timeline.

---

## 13. Final Handoff Notes for Implementation Agents

This PRD is the canonical specification for the synthesis architecture from the LeCun-plus-time-machine analysis. Hand it to substrate-Claude (primary architectural), Codex (substantial multi-file passes for predictor and attribution), DanteCode (dimension closure on Causal Coherence), or web-Claude (refinement and cross-PRD coordination).

Framing for handoff:

> This is PRD-WORLDMODEL-V1, the synthesis architecture combining LeCun's world model approach with the existing time machine vision through causal attribution as training signal. Phase 1 ships as soon as trio is sealed and Time Machine Phase 1 is operational. Phase 2 follows when accumulated data permits. Phase 3 is multi-year research horizon. Read all sections fully. Do not begin until Time Machine Phase 1 (DecisionNode schema canonical) is shipped. The synthesis is the architectural contribution; implementation tiers follow research feasibility.

Implementation agents have full autonomy to:
- Re-sequence work within a phase if dependencies dictate
- Skip PRD sections describing already-shipped functionality from prior PRDs
- Adjust the build calendar based on actual state and Time Machine Phase 1 timing
- Recommend scope changes if research findings warrant
- Defer Phase 3 indefinitely if Phase 2 produces sufficient causal coherence

Implementation agents must NOT:
- Begin Phase 1 before Time Machine Phase 1 ships
- Skip founder ratification of Article XV before treating it as constitutional
- Bypass three-way gate
- Violate KiloCode discipline (files >500 LOC)
- Claim Phase 3 success without empirical comparison versus Phase 2 baseline
- Add dimensions to harsh scorer beyond Causal Coherence without separate authorization

---

## 14. Document Version History

- **v1.0 (2026-04-30):** Initial canonical specification. Synthesizes conversation-developed architecture (LeCun world models plus existing time machine vision plus causal attribution as training signal) into executable PRD across three phases. Authorized for execution post-trio-ships and post-Time-Machine-Phase-1.

---

**END OF PRD-WORLDMODEL-V1**

*Implementation begins when an agent (substrate-Claude, Codex, web-Claude, or DanteCode) is given this PRD plus access to current DanteForge state showing Time Machine Phase 1 shipped. Phase 1 starts with predictor package and causal-attribution package. Phase 2 starts when accumulated data permits. Phase 3 starts when research feasibility confirmed. Strictness mode standard. Three-way gate enforced. Constitutional discipline non-negotiable. End state: closed-loop causal reasoning architecture operational at empirically validated tier, Causal Coherence as 19th dimension measuring substrate's causal reasoning capability, research paper foundation for external positioning when external work begins.*
