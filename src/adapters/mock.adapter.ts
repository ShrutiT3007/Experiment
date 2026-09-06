import { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { createHttpClient } from '../utils/http';
import { AppError } from '../utils/errors';

export interface MockResponseSpec {
  api_name: string;
  context: string;
  stage: string;
  response: {
    status: number;
    body: Record<string, unknown>;
  };
}

export interface MockApiMappingSpec {
  endpoint: string;
  method: string;
  conditions: Record<string, unknown>;
  fieldsToUpdate?: Record<string, unknown>;
  hardCodedUpdates?: Record<string, unknown>;
  script?: string;
}

export interface MockScenario {
  responseId: string;
  mappingId?: string;
  endpoint: string;
}

/**
 * All calls to the Mock Server go through this adapter. Mirrors the
 * QaAdapter pattern so Mock Server integration (section 28) can be added
 * without touching the core deterministic QA execution path.
 *
 * Deletion endpoints are deliberately NOT implemented: the spec is explicit
 * that cleanup endpoints must not be invented and must be verified against
 * the real Mock Server implementation first (section 47/28).
 */
export class MockAdapter {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http = http ?? createHttpClient(env.mockServer, env.qaRequestTimeoutMs, 'mock-adapter');
  }

  async createResponse(spec: MockResponseSpec): Promise<{ id: string }> {
    try {
      const { data } = await this.http.post('/response', spec);
      const id = data?._id ?? data?.id;
      if (!id) {
        throw AppError.badGateway('MOCK_SERVICE_UNAVAILABLE', 'Mock server did not return a response id');
      }
      return { id: String(id) };
    } catch (err) {
      throw this.wrap(err, 'Failed to create mock response');
    }
  }

  async createApiMapping(spec: MockApiMappingSpec): Promise<{ id: string | null }> {
    try {
      const { data } = await this.http.post('/api/', spec);
      return { id: data?._id ?? data?.id ?? null };
    } catch (err) {
      throw this.wrap(err, 'Failed to create mock API mapping');
    }
  }

  async createScenario(params: {
    apiName: string;
    endpoint: string;
    method: string;
    status: number;
    body: Record<string, unknown>;
  }): Promise<MockScenario> {
    const response = await this.createResponse({
      api_name: params.apiName,
      context: 'Experiment',
      stage: '',
      response: { status: params.status, body: params.body }
    });

    const mapping = await this.createApiMapping({
      endpoint: params.endpoint,
      method: params.method,
      conditions: { _id: response.id },
      fieldsToUpdate: {},
      hardCodedUpdates: {},
      script: ''
    });

    return { responseId: response.id, mappingId: mapping.id ?? undefined, endpoint: params.endpoint };
  }

  async getScenario(): Promise<unknown> {
    try {
      const { data } = await this.http.get('/response');
      return data;
    } catch (err) {
      throw this.wrap(err, 'Failed to fetch mock scenario');
    }
  }

  /**
   * Intentionally a no-op placeholder. The current Mock Server API
   * (section 47) does not document a delete/cleanup route. Do not invent
   * one -- surface the limitation instead so operators know a scenario was
   * left behind and can clean it up manually or extend this adapter once
   * a real endpoint exists.
   */
  async cleanupScenario(scenario: MockScenario): Promise<{ cleaned: boolean; reason?: string }> {
    return {
      cleaned: false,
      reason: `No verified deletion endpoint exists on the Mock Server for endpoint ${scenario.endpoint}; manual cleanup required.`
    };
  }

  private wrap(err: unknown, message: string): AppError {
    const anyErr = err as any;
    return AppError.badGateway('MOCK_SERVICE_UNAVAILABLE', message, {
      status: anyErr?.response?.status,
      body: anyErr?.response?.data
    });
  }
}
