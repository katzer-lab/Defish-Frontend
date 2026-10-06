// api.js: calls to the Defish API (Defish-backend) and the polling loop
import axios from 'axios';

export const POLL_INTERVAL_MS = 1000;
export const POLL_MAX_ATTEMPTS = 420;          // about seven minutes at one request per second
export const POLL_MAX_CONSECUTIVE_ERRORS = 5;  // failed polls in a row before giving up
const POLL_REQUEST_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;

// Base address of the API. Without VITE_API_URL the page talks to /api on its own origin,
// which is what the nginx template in nginx/ provides.
export const apiUrl = () => (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, { kind, status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;     // 'failed' | 'network' | 'timeout'
    this.status = status;
  }
}

export const isAborted = (err) => err?.name === 'AbortError' || axios.isCancel(err);

const abortError = () => new DOMException('Aborted', 'AbortError');

// Texts of a failed task: the backend's short error text mapped to a message for the person.
export function describeFailure(message = '') {
  const http = /HTTP (\d+)/i.exec(message);
  if (/unavailable/i.test(message)) return 'The recognition service is unavailable. Try again later.';
  if (/timed out/i.test(message)) return 'Recognition took too long. Try again.';
  if (http) return `The recognition service returned an error (HTTP ${http[1]}).`;
  return 'Could not analyse the photo. Try again.';
}

// Text for an error of a request (upload or poll).
export function describeError(err) {
  if (err instanceof ApiError) return err.message;
  const status = err?.response?.status;
  if (status === 413) {
    const limit = /larger than ([\d.]+) MB/.exec(err.response.data?.detail ?? '');
    return limit ? `File is too large (maximum ${limit[1]} MB).` : 'File is too large.';
  }
  if (status === 422) return 'The server did not accept the file. Choose an image.';
  if (status >= 500) return 'The server is temporarily unavailable. Try again later.';
  if (!err?.response) return 'Could not reach the server. Check your connection.';
  return 'Could not complete the analysis.';
}

export async function submitPhoto(file, { signal } = {}) {
  const formData = new FormData();
  formData.append('image', file);
  const { data } = await axios.post(`${apiUrl()}/analyze`, formData, { signal, timeout: UPLOAD_TIMEOUT_MS });
  return data;
}

export async function cancelTask(taskId) {
  await axios.post(`${apiUrl()}/cancel/${taskId}`);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Asks for the result of a task until it is ready. Returns the result (an object without `status`)
// or {status: 'canceled'}; throws ApiError for a failed task, for repeated request errors and for a timeout,
// and an AbortError when `signal` is aborted.
export async function pollResult(taskId, {
  signal,
  interval = POLL_INTERVAL_MS,
  maxAttempts = POLL_MAX_ATTEMPTS,
  maxErrors = POLL_MAX_CONSECUTIVE_ERRORS,
} = {}) {
  let errors = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      const { data } = await axios.get(`${apiUrl()}/analyze-result/${taskId}`, {
        signal,
        timeout: POLL_REQUEST_TIMEOUT_MS,
      });
      errors = 0;
      if (data.status === 'failed') throw new ApiError(describeFailure(data.message), { kind: 'failed' });
      if (!data.status || data.status === 'done' || data.status === 'canceled') return data;
    } catch (err) {
      if (isAborted(err) || signal?.aborted) throw abortError();
      if (err instanceof ApiError) throw err;
      errors += 1;
      if (errors >= maxErrors) {
        throw new ApiError(describeError(err), { kind: 'network', status: err.response?.status });
      }
    }
    // also after an error: without a pause a failing server would be hit in a tight loop
    await sleep(interval, signal);
  }
  throw new ApiError('The analysis is taking too long. Try again.', { kind: 'timeout' });
}
