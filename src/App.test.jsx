import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, cancelTask, pollResult, submitPhoto } from './api';
import { heicTo } from 'heic-to';

vi.mock('./Lightfall', () => ({ default: () => null }));
vi.mock('heic-to', () => ({ heicTo: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  submitPhoto: vi.fn(),
  pollResult: vi.fn(),
  cancelTask: vi.fn(),
}));

const PHOTO = '/9j/photo';
const HEALTHY = {
  x_min: 100, y_min: 50, x_max: 300, y_max: 150, classification_class: 'healthy',
  classification_confidence: 0.93, detection_confidence: 0.9, uncertain: false,
  top3: [{ label: 'healthy', confidence: 0.93 }], recommendations: 'The fish is healthy.',
};
const SICK = {
  x_min: 320, y_min: 200, x_max: 400, y_max: 260, classification_class: 'fin_rot',
  classification_confidence: 0.62, detection_confidence: 0.8, uncertain: true,
  top3: [{ label: 'fin_rot', confidence: 0.62 }, { label: 'healthy', confidence: 0.3 }, { label: 'oodiniosis', confidence: 0.08 }],
  recommendations: 'Fin rot.',
};
const RESULT = {
  id: '7', diagnosis: 'healthy, fin_rot', confidence: 0.775, recommendations: 'Fin rot.',
  original_image: PHOTO, image_width: 640, image_height: 480, detections: [HEALTHY, SICK],
};

const drawImage = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});   // the app logs failed analyses
  // the photo is 640x480 and shown at half size
  Object.defineProperties(HTMLImageElement.prototype, {
    naturalWidth: { configurable: true, get: () => 640 },
    naturalHeight: { configurable: true, get: () => 480 },
    clientWidth: { configurable: true, get: () => 320 },
    clientHeight: { configurable: true, get: () => 240 },
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage }));
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,CROP');
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

const choose = (file) => {
  const input = document.querySelector('input[type=file]');
  fireEvent.change(input, { target: { files: [file] } });
};
const jpeg = () => new File(['x'], 'fish.jpg', { type: 'image/jpeg' });
const diagnose = () => screen.getByTitle('Diagnose');

// renders the page, uploads a photo and shows `result` (as if it came back from the API)
async function showResult(result = RESULT) {
  submitPhoto.mockResolvedValue({ task_id: 't1' });
  pollResult.mockResolvedValue(result);
  render(<App />);
  choose(jpeg());
  await waitFor(() => expect(diagnose()).toBeEnabled());
  fireEvent.click(diagnose());
  return screen.findByText('Analysis result:');
}
const photo = () => document.querySelector('.image-wrapper img');

describe('choosing a photo', () => {
  it('keeps the button disabled until a photo is chosen, then shows a thumbnail', async () => {
    render(<App />);
    expect(diagnose()).toBeDisabled();

    choose(jpeg());

    await waitFor(() => expect(diagnose()).toBeEnabled());
    expect(document.querySelector('.file-thumb')).toHaveAttribute('src', 'blob:preview');
  });

  it('converts a HEIC photo to JPEG in the browser and uploads the JPEG', async () => {
    let finish;
    heicTo.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    submitPhoto.mockResolvedValue({ task_id: 't1' });
    pollResult.mockResolvedValue(RESULT);
    render(<App />);

    choose(new File(['heic'], 'IMG_0001.HEIC', { type: 'image/heic' }));

    await waitFor(() => expect(heicTo).toHaveBeenCalledTimes(1));
    expect(heicTo.mock.calls[0][0]).toMatchObject({ type: 'image/jpeg', quality: 0.92 });
    expect(diagnose()).toBeDisabled();            // not before the conversion has finished
    finish(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await waitFor(() => expect(diagnose()).toBeEnabled());

    fireEvent.click(diagnose());
    await waitFor(() => expect(submitPhoto).toHaveBeenCalled());
    const uploaded = submitPhoto.mock.calls[0][0];
    expect(uploaded.name).toBe('IMG_0001.jpg');
    expect(uploaded.type).toBe('image/jpeg');
  });
});

describe('result', () => {
  it('draws one box per fish, green for healthy and red otherwise, scaled to the displayed size', async () => {
    await showResult();
    fireEvent.load(photo());

    await waitFor(() => expect(document.querySelectorAll('svg.overlay rect')).toHaveLength(2));
    const [healthy, sick] = document.querySelectorAll('svg.overlay rect');
    expect(photo()).toHaveAttribute('src', `data:image/jpeg;base64,${PHOTO}`);
    expect(healthy).toHaveAttribute('stroke', 'lime');
    expect(sick).toHaveAttribute('stroke', 'red');
    // 320 px shown for 640 px natural: every coordinate is halved
    expect(healthy).toHaveAttribute('x', '50');
    expect(healthy).toHaveAttribute('width', '100');
    expect(sick).toHaveAttribute('y', '100');
    expect(sick).toHaveAttribute('height', '30');
  });

  it('shows a result that came straight from the cache without polling', async () => {
    submitPhoto.mockResolvedValue(RESULT);
    render(<App />);
    choose(jpeg());
    await waitFor(() => expect(diagnose()).toBeEnabled());

    fireEvent.click(diagnose());

    expect(await screen.findByText('Analysis result:')).toBeInTheDocument();
    expect(pollResult).not.toHaveBeenCalled();
  });

  it('opens a panel with the crop, confidence, advice, the uncertainty note and the top three', async () => {
    await showResult();
    fireEvent.load(photo());
    const [, sick] = document.querySelectorAll('svg.overlay rect');

    fireEvent.click(sick);

    expect(await screen.findByText('Diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Fin rot', { selector: '.diagnosis-badge' })).toBeInTheDocument();
    expect(screen.getByText('62.0%')).toBeInTheDocument();
    expect(screen.getByText('Fin rot.', { selector: '.recommendations p' })).toBeInTheDocument();
    expect(screen.getByText(/not sure about this result/)).toBeInTheDocument();
    expect(screen.getByText('Healthy: 30.0%')).toBeInTheDocument();
    expect(screen.getByText('Oodiniosis: 8.0%')).toBeInTheDocument();
    // the crop is cut from the original photo at natural coordinates
    expect(drawImage).toHaveBeenCalledWith(photo(), 320, 200, 80, 60, 0, 0, 80, 60);
    expect(document.querySelector('.diagnosis-img')).toHaveAttribute('src', 'data:image/jpeg;base64,CROP');
  });

  it('labels a healthy fish "Healthy", has no uncertainty note, and closes with the cross', async () => {
    await showResult();
    fireEvent.load(photo());

    fireEvent.click(document.querySelectorAll('svg.overlay rect')[0]);

    expect(await screen.findByText('Healthy')).toBeInTheDocument();
    expect(screen.queryByText(/not sure about this result/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByText('Diagnosis')).not.toBeInTheDocument();
  });

  it('resizes the panel by dragging its edge, between 200 and 800 px', async () => {
    await showResult();
    fireEvent.load(photo());
    fireEvent.click(document.querySelectorAll('svg.overlay rect')[0]);
    const panel = await screen.findByText('Diagnosis').then((h) => h.closest('.side-panel'));
    const handle = panel.querySelector('.resize-handle');
    expect(panel).toHaveStyle({ width: '320px' });

    fireEvent.mouseDown(handle, { clientX: 600 });
    fireEvent.mouseMove(window, { clientX: 500 });
    expect(panel).toHaveStyle({ width: '420px' });
    fireEvent.mouseMove(window, { clientX: -900 });
    expect(panel).toHaveStyle({ width: '800px' });
    fireEvent.mouseMove(window, { clientX: 1500 });
    expect(panel).toHaveStyle({ width: '200px' });
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 100 });
    expect(panel).toHaveStyle({ width: '200px' });    // released: further moves do nothing
  });

  it('still shows the diagnosis when the photo is no longer available on the server', async () => {
    await showResult({ ...RESULT, original_image: null });

    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
    expect(photo()).toBeNull();
    fireEvent.click(screen.getByText(/Fin rot · 62.0%/));
    expect(await screen.findByText('Diagnosis')).toBeInTheDocument();
    expect(document.querySelector('.diagnosis-img')).toBeNull();   // no crop without the photo
  });
});

describe('cancel and errors', () => {
  it('cancels a running analysis: stops polling, tells the server, shows a note and no result', async () => {
    let pollSignal;
    submitPhoto.mockResolvedValue({ task_id: 't1' });
    pollResult.mockImplementation((id, { signal }) => {
      pollSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    cancelTask.mockResolvedValue();
    render(<App />);
    choose(jpeg());
    await waitFor(() => expect(diagnose()).toBeEnabled());
    fireEvent.click(diagnose());
    const cancel = await waitFor(() => {
      const button = document.querySelector('.cancelBtn');
      expect(button).not.toBeNull();
      return button;
    });
    await waitFor(() => expect(pollResult).toHaveBeenCalled());

    fireEvent.click(cancel);

    expect(await screen.findByText('Analysis canceled.')).toBeInTheDocument();
    expect(pollSignal.aborted).toBe(true);
    expect(cancelTask).toHaveBeenCalledWith('t1');
    expect(screen.queryByText('Analysis result:')).not.toBeInTheDocument();
    expect(screen.queryByText(/Could not|error/i)).not.toBeInTheDocument();
  });

  it('shows why a task failed and lets the user try again', async () => {
    submitPhoto.mockResolvedValue({ task_id: 't1' });
    pollResult.mockRejectedValue(new ApiError('The recognition service is unavailable. Try again later.', { kind: 'failed' }));
    render(<App />);
    choose(jpeg());
    await waitFor(() => expect(diagnose()).toBeEnabled());

    fireEvent.click(diagnose());

    expect(await screen.findByText('The recognition service is unavailable. Try again later.')).toBeInTheDocument();
    await waitFor(() => expect(diagnose()).toBeEnabled());     // the spinner is gone
  });

  it('explains a refused upload (413) instead of "Request failed with status code 413"', async () => {
    submitPhoto.mockRejectedValue(Object.assign(new Error('Request failed with status code 413'),
      { response: { status: 413, data: { detail: 'Image is larger than 10 MB' } } }));
    render(<App />);
    choose(jpeg());
    await waitFor(() => expect(diagnose()).toBeEnabled());

    fireEvent.click(diagnose());

    expect(await screen.findByText('File is too large (maximum 10 MB).')).toBeInTheDocument();
    expect(pollResult).not.toHaveBeenCalled();
  });
});
