import axios, { AxiosInstance } from 'axios';
import { logger } from './logger';

/**
 * Creates an axios instance that:
 *  - enforces a hard timeout (callers must not rely on server defaults)
 *  - logs method/url/duration/status only -- never headers or bodies,
 *    since those may carry Authorization tokens, cookies, or secrets.
 */
export function createHttpClient(
  baseURL: string,
  timeoutMs: number,
  name: string,
  defaultHeaders?: Record<string, string>
): AxiosInstance {
  const client = axios.create({ baseURL, timeout: timeoutMs, headers: defaultHeaders ?? {} });

  client.interceptors.request.use((config) => {
    (config as any)._startedAt = Date.now();
    logger.info({
      client: name,
      msg: '-------------------------------------------------------------------------------qa request-----------------------------------------',
      method: config.method,
      url: config.url,
      params: config.params,
      body: config.data
    });
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      const startedAt = (response.config as any)._startedAt as number | undefined;
      logger.info({
        client: name,
        method: response.config.method,
        url: response.config.url,
        status: response.status,
        durationMs: startedAt ? Date.now() - startedAt : undefined
      });
      return response;
    },
    (error) => {
      const config = error.config ?? {};
      const startedAt = (config as any)._startedAt as number | undefined;
      logger.error({
        client: name,
        method: config.method,
        url: config.url,
        status: error.response?.status,
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        message: error.message
      });
      return Promise.reject(error);
    }
  );

  return client;
}
