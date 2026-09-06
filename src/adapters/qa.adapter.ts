import { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { createHttpClient } from '../utils/http';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  QaTestcasePayload,
  QaTestcaseResponse,
  QaFlowPayload,
  QaFlowResponse,
  QaExecutePayload
} from '../schemas/testcase.schema';

export interface QaQueryPayload {
  dbId: number;
  queryType: 'SELECT';
  query: string;
  description?: string;
}

export interface QaQueryResponse {
  id: number;
  result?: unknown;
}

export interface QaDbConfig {
  id: number;
  name?: string;
}

export interface QaExecuteResult {
  /** Raw response from the QA execution endpoint -- shape may vary by
   * QA implementation, hence `unknown`. Normalization happens one layer
   * up in experiment-runner.service.ts, never inside this adapter. */
  raw: unknown;
}

/**
 * All HTTP calls to the existing QA Testing Framework MUST go through this
 * adapter. No other module is permitted to import axios and call
 * env.qaServer directly -- this is the single seam described in the
 * architecture doc (section 15), which also makes it trivial to mock QA
 * entirely in unit/integration tests.
 */
export class QaAdapter {
  private readonly http: AxiosInstance;
  /** Session cookie obtained from POST /api/v1/auth/signin, forwarded to
   * every subsequent QA request. Never logged. */
  private sessionCookie: string | null = null;
  private authInFlight: Promise<void> | null = null;

  constructor(http?: AxiosInstance) {
    this.http =
      http ?? createHttpClient(env.qaServer, env.qaRequestTimeoutMs, 'qa-adapter', { 'x-api-validation': env.qaApiKey });

    this.http.interceptors.request.use(async (config) => {
      if (config.url === '/api/v1/auth/signin') return config;
      await this.ensureAuthenticated();
      if (this.sessionCookie) {
        config.headers = config.headers ?? ({} as any);
        (config.headers as any).Cookie = this.sessionCookie;
      }
      return config;
    });
  }

  /**
   * Signs in to the QA Testing Framework and caches the resulting session
   * cookie for reuse on every subsequent request. No-ops when QA auth
   * credentials aren't configured (e.g. QA instances that don't require
   * auth, or unit tests).
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.sessionCookie) return;
    if (!env.qaAuthEmail || !env.qaAuthPassword) return;
    if (!this.authInFlight) {
      this.authInFlight = this.authenticate().finally(() => {
        this.authInFlight = null;
      });
    }
    return this.authInFlight;
  }

  private async authenticate(): Promise<void> {
    try {
      const response = await this.http.post('/api/v1/auth/signin', {
        email: env.qaAuthEmail,
        password: env.qaAuthPassword
      });

      const setCookie = response.headers['set-cookie'];
      if (!setCookie || setCookie.length === 0) {
        throw AppError.badGateway(
          'QA_INVALID_RESPONSE',
          'QA signin response did not include a Set-Cookie header',
          {}
        );
      }

      this.sessionCookie = setCookie.map((cookie: string) => cookie.split(';')[0]).join('; ');
      logger.info({ operation: 'qa.signin' }, 'QA session authenticated');
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to authenticate with QA service');
    }
  }

  /** Verified testcase response shape: { result: { data: [ { id, ... }, true ] } }. */
  async createTestCase(payload: QaTestcasePayload): Promise<QaTestcaseResponse> {
    try {
      const { data } = await this.http.post('/api/v1/qa-testing/testcases', payload);
      return this.normalizeIdResponse(data);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to create QA testcase');
    }
  }

  /**
   * Verified flow response shape: { result: { data: { id, flowName, flow, data } } }.
   * This is NOT the same shape as the testcase response, so it must not go
   * through the array-indexed `normalizeIdResponse` extraction.
   */
 async createFlow(payload: QaFlowPayload): Promise<QaFlowResponse> {
  try {
    const { data } = await this.http.post(
      '/api/v1/qa-testing/flow',
      payload
    );

    // IMPORTANT: QA flow response is:
    // data.result.data.id
    const flowData = data?.result?.data;

    if (!flowData || typeof flowData.id !== 'number') {
      throw AppError.badGateway(
        'QA_INVALID_RESPONSE',
        'QA flow response did not contain a numeric flow id',
        {
          body: data
        }
      );
    }

    return {
      id: flowData.id,
      ...flowData
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    throw this.wrap(
      err,
      'QA_SERVICE_UNAVAILABLE',
      'Failed to create QA flow'
    );
  }
}

  async getFlow(flowId: number): Promise<unknown> {
    try {
      const { data } = await this.http.get('/api/v1/qa-testing/flow', { params: { flowId } });
      return data;
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to fetch QA flow');
    }
  }

  async patchFlow(flowId: number, payload: Record<string, unknown>): Promise<unknown> {
    try {
      const { data } = await this.http.patch('/api/v1/qa-testing/flow', { flowId, ...payload });
      return data;
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to update QA flow');
    }
  }

  /** Fire-and-poll style execution (asynchronous QA runners). */
  async executeTest(payload: QaExecutePayload): Promise<QaExecuteResult> {
    try {
      const merged: QaExecutePayload = {
        ...payload,
        servicesUrls: { ...env.servicesUrls, ...payload.servicesUrls }
      };
      const { data } = await this.http.post('/api/v1/qa-testing/test', merged);
      return { raw: data };
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to execute QA flow');
    }
  }

  /**
   * Synchronous variant, used when the QA implementation supports blocking
   * execution. Kept as a distinct method (rather than a flag) because the
   * known "testSync lock-leak" issue (see README) means callers must be
   * deliberate about which mode they use.
   */
  async executeTestSync(payload: QaExecutePayload): Promise<QaExecuteResult> {
    try {
      const merged: QaExecutePayload = {
        ...payload,
        servicesUrls: { ...env.servicesUrls, ...payload.servicesUrls }
      };
      const { data } = await this.http.post('/api/v1/qa-testing/test-sync', merged);
      return { raw: data };
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to synchronously execute QA flow');
    }
  }

  async getDbConfigs(): Promise<QaDbConfig[]> {
    try {
      const { data } = await this.http.get('/api/v1/qa-testing/db-config');
      return Array.isArray(data) ? data : data?.items ?? [];
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to fetch QA db-config');
    }
  }

  async createQuery(payload: QaQueryPayload): Promise<QaQueryResponse> {
    try {
      const { data } = await this.http.post('/api/v1/qa-testing/queries', payload);
      return this.normalizeIdResponse(data);
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to create QA query');
    }
  }

  async getQueries(params?: Record<string, unknown>): Promise<unknown> {
    try {
      const { data } = await this.http.get('/api/v1/qa-testing/queries', { params });
      return data;
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to fetch QA queries');
    }
  }

  async verifyExpectedOutput(payload: Record<string, unknown>): Promise<unknown> {
    try {
      const { data } = await this.http.post('/api/v1/qa-testing/verify-expected-output', payload);
      return data;
    } catch (err) {
      throw this.wrap(err, 'QA_SERVICE_UNAVAILABLE', 'Failed to verify expected output');
    }
  }

  /**
   * Read-only testcase discovery, used by the reuse-before-generate
   * strategy (section 11). The QA framework does not currently expose a
   * verified discovery endpoint -- `/api/v1/qa-testing/functions` returns
   * 404 -- so this intentionally returns no candidates rather than calling
   * an unverified/invented endpoint. Callers must treat this as "no
   * reusable testcase found", not as an error.
   */
  async findExistingTestcases(_query: Record<string, unknown>): Promise<QaTestcaseResponse[]> {
    return [];
  }

 /**
  * Extraction target for the testcase/query response shape only:
  * { result: { data: [ { id, ... }, true ] } }. Flow responses have a
  * different shape (`result.data` is an object, not a tuple) and are
  * handled explicitly in createFlow() instead of through this method.
  */
 private normalizeIdResponse(
  data: any
): { id: number } & Record<string, unknown> {
  const id =
    data?.result?.data?.[0]?.id ??
    data?.id ??
    data?.testcaseId ??
    data?.queryId;

  if (typeof id !== 'number') {
    throw AppError.badGateway(
      'QA_INVALID_RESPONSE',
      'QA service returned success but no numeric resource id was found',
      {
        body: data
      }
    );
  }

  return {
    ...data,
    id
  };
}

  private wrap(err: unknown, code: 'QA_SERVICE_UNAVAILABLE', message: string): AppError {
    const anyErr = err as any;
    return AppError.badGateway(code, message, {
      status: anyErr?.response?.status,
      // Only forward a safe subset of the upstream error body.
      body: anyErr?.response?.data
    });
  }
}
