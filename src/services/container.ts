import { Glm5Client } from '../llm/glm5.client';
import { LLMClient } from '../llm/llm.client';
import { QaAdapter } from '../adapters/qa.adapter';
import { MockAdapter } from '../adapters/mock.adapter';
import { ExperimentPlanner } from './experiment-planner.service';
import { TestcaseGeneratorService } from './testcase-generator.service';
import { FlowBuilderService } from './flow-builder.service';
import { ExperimentRunnerService } from './experiment-runner.service';
import { AssertionService } from './assertion.service';
import { EvidenceService } from './evidence.service';
import { CleanupService } from './cleanup.service';
import { ExperimentService } from './experiment.service';

/**
 * Simple manual DI container. Kept intentionally framework-free so the
 * whole service graph is easy to reconstruct with mocks in tests (see
 * tests/unit and tests/integration).
 */
export function buildExperimentService(overrides?: {
  qaAdapter?: QaAdapter;
  mockAdapter?: MockAdapter;
  llmClient?: LLMClient;
  dbId?: number;
}): { experimentService: ExperimentService; qaAdapter: QaAdapter; mockAdapter: MockAdapter } {
  const qaAdapter = overrides?.qaAdapter ?? new QaAdapter();
  const mockAdapter = overrides?.mockAdapter ?? new MockAdapter();
  const llmClient = overrides?.llmClient ?? new Glm5Client();

  const planner = new ExperimentPlanner(llmClient);
  const testcaseGenerator = new TestcaseGeneratorService(qaAdapter);
  const flowBuilder = new FlowBuilderService(qaAdapter);
  const runner = new ExperimentRunnerService(qaAdapter);
  const assertionService = new AssertionService(qaAdapter, overrides?.dbId);
  const evidenceService = new EvidenceService();
  const cleanupService = new CleanupService(qaAdapter, mockAdapter);

  const experimentService = new ExperimentService({
    planner,
    testcaseGenerator,
    flowBuilder,
    runner,
    assertionService,
    evidenceService,
    cleanupService
  });

  return { experimentService, qaAdapter, mockAdapter };
}
