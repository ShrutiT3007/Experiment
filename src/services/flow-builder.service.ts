import { QaAdapter } from '../adapters/qa.adapter';
import { ExperimentPlan } from '../schemas/experiment-plan.schema';
import { QaFlowPayload, qaFlowPayloadSchema } from '../schemas/testcase.schema';
import { CreatedTestcase } from './testcase-generator.service';
import { logger } from '../utils/logger';
import { recordFlow } from '../models/flow.model';

export interface BuiltFlow {
  qaFlowId: number;
  payload: QaFlowPayload;
  orderedTestcaseIds: number[];
}

/**
 * Compiles the plan's flow.testcaseOrder + per-step extract/variable
 * chaining into the existing QA Flow representation. This does NOT
 * implement a second flow-execution engine -- it only produces the
 * definition object the QA framework's own flow engine will run.
 */
export class FlowBuilderService {
  constructor(private readonly qa: QaAdapter) {}

  async buildFlow(
    plan: ExperimentPlan,
    createdTestcases: CreatedTestcase[],
    experimentId: number | null,
    serviceName?: string
  ): Promise<BuiltFlow> {
    const byPlanIndex = new Map(createdTestcases.map((tc) => [tc.planIndex, tc]));

    const orderedTestcaseIds = plan.flow.testcaseOrder.map((planIndex) => {
      const tc = byPlanIndex.get(planIndex);
      if (!tc) {
        throw new Error(`No created testcase found for plan index ${planIndex}`);
      }
      return tc.qaTestcaseId;
    });

    // The QA framework's flow definition is a map keyed by the QA testcase
    // ID itself (e.g. { "144": {} }), not by position, and each entry must
    // be an empty object -- the testcase definition already lives in QA
    // (created via createTestCase), so it must not be duplicated here.
    const flow: Record<string, unknown> = Object.fromEntries(
      orderedTestcaseIds.map((id) => [String(id), {}])
    );

    const payload: QaFlowPayload = qaFlowPayloadSchema.parse({
      flowName: plan.flow.name || `Experiment Generated Flow ${Date.now()}`,
      flow,
      data: plan.flow.data ?? {},
      ...(serviceName ? { serviceName } : {})
    });

    const response = await this.qa.createFlow(payload);

    logger.info({
      operation: 'qa.createFlow',
      flowId: response.id,
      testcaseIds: orderedTestcaseIds
    }, 'QA flow created');

    await recordFlow({
      experimentId,
      executionId: null,
      qaFlowId: response.id,
      definition: payload
    });

    return { qaFlowId: response.id, payload, orderedTestcaseIds };
  }
}
