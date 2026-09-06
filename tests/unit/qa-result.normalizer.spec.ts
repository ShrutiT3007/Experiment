import {
  normalizeQaExecutionResult,
  getPath
} from '../../src/services/experiment/normalizers/qa-result.normalizer';

const SAMPLE_QA_RESPONSE = {
  result: {
    data: [
      {
        id: 213,
        output: 'Api response is valid ',
        apiResponse: JSON.stringify({
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: { result: null, error: { errorCode: 'ERR-202', message: 'password too short' } }
        })
      },
      {
        id: 214,
        output: 'Api response is valid ',
        apiResponse: JSON.stringify({
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: { result: null, error: { errorCode: 'ERR-102', message: 'Email does not exist' } }
        })
      },
      {
        id: 215,
        output: 'Api response is valid ',
        apiResponse: JSON.stringify({
          status: 500,
          statusText: 'Internal Server Error',
          headers: {},
          data: { result: null, error: { errorCode: 'ERR-202', message: 'password too short' } }
        })
      }
    ],
    message: 'Test execution completed successfully.'
  },
  error: null
};

describe('normalizeQaExecutionResult', () => {
  it('extracts the real HTTP status/body from a JSON-string apiResponse', () => {
    const normalized = normalizeQaExecutionResult(SAMPLE_QA_RESPONSE);

    expect(normalized.testcases.map((t) => t.status)).toEqual([500, 401, 500]);
    expect(normalized.testcases[1].body).toMatchObject({ error: { errorCode: 'ERR-102' } });
    expect(normalized.executionStatus).toBe('COMPLETED');
    expect(normalized.message).toBe('Test execution completed successfully.');
  });

  it('accepts an already-parsed apiResponse object', () => {
    const response = {
      result: {
        data: [
          {
            id: 300,
            output: 'Api response is valid',
            apiResponse: { status: 200, statusText: 'OK', headers: {}, data: { ok: true } }
          }
        ],
        message: 'ok'
      },
      error: null
    };

    const normalized = normalizeQaExecutionResult(response);
    expect(normalized.testcases[0].status).toBe(200);
    expect(normalized.testcases[0].body).toEqual({ ok: true });
    expect(normalized.testcases[0].passedByQa).toBe(true);
  });

  it('never throws on a malformed apiResponse and preserves raw', () => {
    const response = {
      result: {
        data: [{ id: 400, output: 'Api response is valid ', apiResponse: '{not valid json' }],
        message: 'ok'
      },
      error: null
    };

    const normalized = normalizeQaExecutionResult(response);
    expect(normalized.testcases[0]).toMatchObject({
      status: null,
      statusText: null,
      headers: {},
      body: null
    });
    expect(normalized.testcases[0].raw).toEqual(response.result.data[0]);
  });

  it('returns null status when apiResponse has no status field', () => {
    const response = {
      result: {
        data: [{ id: 500, output: 'Api response is valid ', apiResponse: JSON.stringify({ data: {} }) }],
        message: 'ok'
      },
      error: null
    };

    const normalized = normalizeQaExecutionResult(response);
    expect(normalized.testcases[0].status).toBeNull();
  });

  it('preserves the raw QA response at the top level', () => {
    const normalized = normalizeQaExecutionResult(SAMPLE_QA_RESPONSE);
    expect(normalized.raw).toBe(SAMPLE_QA_RESPONSE);
  });

  it('does not treat passedByQa as an experiment assertion result', () => {
    const normalized = normalizeQaExecutionResult(SAMPLE_QA_RESPONSE);
    // QA says "valid" for all three testcases even though two are 500s --
    // passedByQa is QA's own signal, not the Experiment hypothesis result.
    expect(normalized.testcases.every((t) => t.passedByQa)).toBe(true);
    expect(normalized.testcases.map((t) => t.status)).not.toEqual([200, 200, 200]);
  });
});

describe('getPath', () => {
  it('resolves a nested field path', () => {
    expect(getPath({ result: { data: { token: 'abc' } } }, 'result.data.token')).toBe('abc');
  });

  it('returns undefined for a missing path without throwing', () => {
    expect(getPath({ result: { data: {} } }, 'result.data.token')).toBeUndefined();
    expect(getPath(null, 'a.b.c')).toBeUndefined();
  });
});
