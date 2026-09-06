export type ErrorCode =
  | 'INVALID_HYPOTHESIS'
  | 'INVALID_EXPERIMENT_PLAN'
  | 'INSUFFICIENT_CONTEXT'
  | 'DISALLOWED_TARGET'
  | 'QA_SERVICE_UNAVAILABLE'
  | 'QA_INVALID_RESPONSE'
  | 'MOCK_SERVICE_UNAVAILABLE'
  | 'LLM_UNAVAILABLE'
  | 'LLM_INVALID_OUTPUT'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly httpStatus: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 400, details);
  }

  static badGateway(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 502, details);
  }

  static internal(message: string, details?: unknown) {
    return new AppError('INTERNAL_ERROR', message, 500, details);
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details
    };
  }
}
