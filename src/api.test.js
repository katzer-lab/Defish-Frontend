import axios from 'axios';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ApiError, apiUrl, cancelTask, describeError, describeFailure, isAborted, pollResult, submitPhoto,
} from './api';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), isCancel: (e) => e?.__CANCEL__ === true },
}));

const RESULT = { id: '7', diagnosis: 'fin_rot', detections: [] };
const processing = { data: { status: 'processing', task_id: 't1' } };
const networkError = () => Object.assign(new Error('Network Error'), { response: undefined });
const httpError = (status, data = {}) => Object.assign(new Error(`status ${status}`), { response: { status, data } });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('apiUrl', () => {
  it('defaults to /api on the page origin and honours VITE_API_URL without a trailing slash', () => {
    expect(apiUrl()).toBe('/api');
    vi.stubEnv('VITE_API_URL', 'http://localhost:8001/');
    expect(apiUrl()).toBe('http://localhost:8001');
  });
});

describe('pollResult', () => {
  it('keeps asking while the task is processing and returns the result', async () => {
    axios.get
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce({ data: RESULT });

    await expect(pollResult('t1', { interval: 1 })).resolves.toEqual(RESULT);

    expect(axios.get).toHaveBeenCalledTimes(3);
    expect(axios.get.mock.calls[0][0]).toBe('/api/analyze-result/t1');
  });

  it('returns a canceled task as it is', async () => {
    axios.get.mockResolvedValueOnce({ data: { status: 'canceled', task_id: 't1' } });
    await expect(pollResult('t1', { interval: 1 })).resolves.toMatchObject({ status: 'canceled' });
  });

  it.each([
    ['ML service unavailable', 'The recognition service is unavailable. Try again later.'],
    ['ML service timed out', 'Recognition took too long. Try again.'],
    ['ML service returned HTTP 500', 'The recognition service returned an error (HTTP 500).'],
    ['Internal error', 'Could not analyse the photo. Try again.'],
  ])('stops at a failed task (%s) with a readable message', async (serverMessage, expected) => {
    axios.get.mockResolvedValueOnce({ data: { status: 'failed', message: serverMessage, task_id: 't1' } });

    const error = await pollResult('t1', { interval: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('failed');
    expect(error.message).toBe(expected);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('pauses between requests also after an error (it used to retry in a tight loop)', async () => {
    vi.useFakeTimers();
    axios.get.mockRejectedValue(networkError());

    const polling = pollResult('t1').catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(axios.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(axios.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(axios.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await polling).toBeInstanceOf(ApiError);
    expect(axios.get).toHaveBeenCalledTimes(5);   // gives up after five failures in a row
  });

  it('gives up after repeated errors with a message for the kind of error', async () => {
    axios.get.mockRejectedValue(httpError(502));
    const error = await pollResult('t1', { interval: 1 }).catch((e) => e);
    expect(error.kind).toBe('network');
    expect(error.message).toBe('The server is temporarily unavailable. Try again later.');
    expect(axios.get).toHaveBeenCalledTimes(5);
  });

  it('forgives scattered errors: a good answer resets the count', async () => {
    axios.get
      .mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(processing)
      .mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ data: RESULT });

    await expect(pollResult('t1', { interval: 1 })).resolves.toEqual(RESULT);
  });

  it('times out after the maximum number of attempts', async () => {
    axios.get.mockResolvedValue(processing);
    const error = await pollResult('t1', { interval: 1, maxAttempts: 4 }).catch((e) => e);
    expect(error.kind).toBe('timeout');
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  it('stops without further requests when aborted', async () => {
    axios.get.mockResolvedValue(processing);
    const controller = new AbortController();

    const polling = pollResult('t1', { signal: controller.signal });   // default one-second pause
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    const error = await polling.catch((e) => e);
    expect(isAborted(error)).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});

describe('pollResult before it starts', () => {
  it('sends no request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await pollResult('t1', { signal: controller.signal }).catch((e) => e);

    expect(isAborted(error)).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it.each([
    [httpError(413, { detail: 'Image is larger than 10 MB' }), 'File is too large (maximum 10 MB).'],
    [httpError(413), 'File is too large.'],
    [httpError(422), 'The server did not accept the file. Choose an image.'],
    [httpError(500, { detail: 'Task queue error' }), 'The server is temporarily unavailable. Try again later.'],
    [networkError(), 'Could not reach the server. Check your connection.'],
    [httpError(404), 'Could not complete the analysis.'],
  ])('maps %# to a message in the interface language', (error, expected) => {
    expect(describeError(error)).toBe(expected);
  });

  it('describeFailure falls back to a general text', () => {
    expect(describeFailure()).toBe('Could not analyse the photo. Try again.');
  });
});

describe('requests', () => {
  it('submitPhoto sends the file as the form field "image" and returns the answer', async () => {
    axios.post.mockResolvedValueOnce({ data: { task_id: 't1' } });
    const file = new File(['x'], 'fish.jpg', { type: 'image/jpeg' });
    const signal = new AbortController().signal;

    await expect(submitPhoto(file, { signal })).resolves.toEqual({ task_id: 't1' });

    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('/api/analyze');
    expect(body.get('image')).toBe(file);
    expect(options.signal).toBe(signal);
  });

  it('cancelTask posts to the cancel route of the task', async () => {
    axios.post.mockResolvedValueOnce({ data: { status: 'canceled' } });
    await cancelTask('t1');
    expect(axios.post).toHaveBeenCalledWith('/api/cancel/t1');
  });
});
