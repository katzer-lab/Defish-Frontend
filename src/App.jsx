// App.jsx
import { useRef, useState, useEffect } from 'react';
import Lightfall from './Lightfall';
import { submitPhoto, pollResult, cancelTask, describeError, isAborted } from './api';
import { classLabel } from './classLabels';
import './App.css';

// Outside the component: a new array on every render would make Lightfall recreate the WebGL context.
const LIGHTFALL_COLORS = ['#A6C8FF', '#5227FF', '#FF9FFC'];

function App() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [taskId, setTaskId] = useState(null);
  const [isCanceled, setIsCanceled] = useState(false);
  const abortRef = useRef(null);
  const imgRef = useRef(null);
  const [selectedDet, setSelectedDet] = useState(null);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [imgNaturalSize, setImgNaturalSize] = useState({
    width: 0,
    height: 0
  });
  const [panelWidth, setPanelWidth] = useState(320);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [croppedImage, setCroppedImage] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);

  const scaleX =
    imgNaturalSize.width
      ? imgSize.width / imgNaturalSize.width
      : 1;

  const scaleY =
    imgNaturalSize.height
      ? imgSize.height / imgNaturalSize.height
      : 1;

    const onResizeMouseDown = (e) => {
  resizing.current = true;
  startX.current = e.clientX;
  startWidth.current = panelWidth;
  e.preventDefault();
};

const handleDetClick = (det) => {
  setSelectedDet(det);
  setCroppedImage(null);

  const img = imgRef.current;
  if (!img) return;  // the photo is gone from the server: the panel shows the diagnosis without a crop

  const canvas = document.createElement('canvas');
  
  // coordinates in natural pixels
  const x = det.x_min;
  const y = det.y_min;
  const w = det.x_max - det.x_min;
  const h = det.y_max - det.y_min;

  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

  setCroppedImage(canvas.toDataURL('image/jpeg'));
};

useEffect(() => {
  const onMouseMove = (e) => {
    if (!resizing.current) return;
    const delta = startX.current - e.clientX; // dragging left = increase
    const newWidth = Math.min(800, Math.max(200, startWidth.current + delta));
    setPanelWidth(newWidth);
  };
  const onMouseUp = () => { resizing.current = false; };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}, []);

useEffect(() => () => abortRef.current?.abort(), []);

useEffect(() => {
  if (!file) {
    setFilePreviewUrl(null);
    setUploadFile(null);
    return;
  }

  let objectUrl = null;
  let cancelled = false;

  // Reset right away, otherwise while a new HEIC is converted asynchronously,
  // the analyse button stays active with the old uploadFile of the previous file.
  setUploadFile(null);

  const isHeic = /image\/hei(c|f)/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

  if (isHeic) {
    // Browsers (except Safari) cannot decode HEIC/HEIF in an <img>, and the backend
    // cannot always decode HEIC at all, so it is converted to JPEG on the
    // client once, and that file is used both for the preview and for sending to the analysis.
    import('heic-to')
      .then(({ heicTo }) => heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 }))
      .then((converted) => {
        if (cancelled) return;
        const jpegName = file.name.replace(/\.hei[cf]$/i, '.jpg') || 'converted.jpg';
        const jpegFile = new File([converted], jpegName, { type: 'image/jpeg' });
        setUploadFile(jpegFile);
        objectUrl = URL.createObjectURL(jpegFile);
        setFilePreviewUrl(objectUrl);
      })
      .catch((err) => {
        console.error('Could not convert HEIC:', err);
        if (!cancelled) {
          setFilePreviewUrl(null);
          setUploadFile(null);
        }
      });
  } else {
    setUploadFile(file);
    objectUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objectUrl);
  }

  return () => {
    cancelled = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}, [file]);

useEffect(() => {
  const img = imgRef.current;
  if (!img) return;

  const observer = new ResizeObserver(() => {
    setImgSize({
      width: img.clientWidth,
      height: img.clientHeight,
    });
  });

  observer.observe(img);
  return () => observer.disconnect();
}, [result]);


  const handleUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsCanceled(false);
    setLoading(true);
    setError(null);
    setResult(null);
    setTaskId(null);
    setSelectedDet(null);
    setCroppedImage(null);

    try {
      // 1. send the photo
      const data = await submitPhoto(uploadFile, { signal: controller.signal });

      if (data.id && data.diagnosis) {
        // the result came at once (the same picture was analysed before, the answer is from the cache)
        setResult(data);
      } else if (data.task_id) {
        // 2. the task is accepted: poll the server until the result is ready
        setTaskId(data.task_id);
        const analysisResult = await pollResult(data.task_id, { signal: controller.signal });
        if (analysisResult.status !== 'canceled') setResult(analysisResult);
      } else {
        throw new Error('Unexpected response format from the server');
      }
    } catch (err) {
      if (isAborted(err)) return;  // canceled by the user: the message is already shown
      console.error('Error during the analysis:', err);
      setError(describeError(err));
    } finally {
      // an old request must not turn off the indicator of the new one
      if (abortRef.current === controller) setLoading(false);
    }
  };

  const handleCancel = async () => {
    abortRef.current?.abort();
    setIsCanceled(true);
    setLoading(false);
    setResult(null);

    if (!taskId) return;
    try {
      await cancelTask(taskId);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="app-shell">
      <div className="lightfall-bg">
        <Lightfall
          colors={LIGHTFALL_COLORS}
          backgroundColor="#0A29FF"
          speed={0.5}
          streakCount={1}
          streakWidth={0.2}
          streakLength={1}
          glow={1}
          density={0.3}
          twinkle={1}
          zoom={1}
          backgroundGlow={0.5}
          opacity={1}
          mouseInteraction
          mouseStrength={1}
          mouseRadius={0.1}
        />
      </div>
      <div className="app">
      <h1>🐟 Defish</h1>
      
  <form onSubmit={handleUpload} className="upload-form">
  <label className="icon-btn file-btn" title="Choose a file">
    <input
      type="file"
      accept="image/*"
      onChange={(e) => setFile(e.target.files[0])}
      hidden
    />
    <svg viewBox="0 0 24 24" className="icon" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </label>

  {filePreviewUrl && (
    <img src={filePreviewUrl} alt="" className="file-thumb" />
  )}

  {!loading ? (
    <button type="submit" className="icon-btn submit-btn" disabled={!uploadFile} title="Diagnose">
      <svg viewBox="0 0 24 24" className="icon triangle-icon" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </button>
  ) : (
    <div className="cancel-container">
      <div className="loader-ring"></div>
      <button type="button" className="cancelBtn" onClick={handleCancel}>
        <img src="./cancel.png"/>
      </button>
    </div>
  )}
</form>

      {error && <p className="error">{error}</p>}
      {isCanceled && !loading && <p className="status-note">Analysis canceled.</p>}


      {result && !result.error && result.status !== 'canceled' &&(
        <div className="result">
          <h2>Analysis result:</h2>
          {/* <p><strong>Diagnosis:</strong> {result.diagnosis}</p>
          <p><strong>Probability:</strong> {(result.confidence * 100).toFixed(1)}%</p>
          <p><strong>Recommendations:</strong> {result.recommendations}</p> */}
   <div className="result-content">
          {result.original_image ? (
          <div className="image-wrapper">
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${result.original_image}`}
              onLoad={(e) => {
                const img = e.target;
                setImgNaturalSize({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
                // clientWidth/Height are already correct after onLoad with the CSS max-width
                setImgSize({
                  width: img.clientWidth,
                  height: img.clientHeight,
                });
              }}
              style={{ maxWidth: '800px', maxHeight: '600px', width: '100%', height: 'auto' }}
            />
            <svg className="overlay"
                width={imgSize.width}
                height={imgSize.height}>
              {result.detections?.map((det, i) => {
                const x1 = det.x_min ?? det.bbox?.[0] ?? 0;
                const y1 = det.y_min ?? det.bbox?.[1] ?? 0;
                const x2 = det.x_max ?? det.bbox?.[2] ?? 0;
                const y2 = det.y_max ?? det.bbox?.[3] ?? 0;
                const isHealthy = det.classification_class === 'healthy';
                const strokeColor = isHealthy ? 'lime' : 'red';

                return (
                  <rect
                    key={i}
                    x={x1 * scaleX}
                    y={y1 * scaleY}
                    width={(x2 - x1) * scaleX}
                    height={(y2 - y1) * scaleY}
                    fill="transparent"
                    stroke={strokeColor}
                    strokeWidth="2"
                    style={{ cursor: "pointer" }}
                    onClick={() => handleDetClick(det)}
                  />
                );
              })}
            </svg>
          </div>
          ) : (
          <div className="no-photo">
            <p className="notice">The photo is no longer available on the server, but the diagnosis was received:</p>
            <ul className="detection-list">
              {result.detections?.map((det, i) => (
                <li key={i}>
                  <button type="button" className={`detection-item ${det.classification_class === 'healthy' ? 'healthy' : 'sick'}`}
                          onClick={() => handleDetClick(det)}>
                    {classLabel(det.classification_class)}
                    {' · '}{(det.classification_confidence * 100).toFixed(1)}%
                  </button>
                </li>
              ))}
              {!result.detections?.length && <li className="notice">{result.recommendations}</li>}
            </ul>
          </div>
          )}
      {selectedDet && (
        <div className="side-panel" style={{ width: panelWidth }}>
          <div className="resize-handle" onMouseDown={onResizeMouseDown} />
          <button className="side-panel-close" onClick={() => setSelectedDet(null)}>✕</button>
          <h3>Diagnosis</h3>
          {croppedImage && (
            <img
              className={`diagnosis-img ${selectedDet.classification_class === 'healthy' ? 'healthy' : 'sick'}`}
              src={croppedImage}
              style={{
                width: '100%',
                borderRadius: '8px',
                marginBottom: '16px',
                maxHeight: '300px',
                maxWidth: '100%',
                objectFit: 'contain',
              }}
            />
          )}
          <div className={`diagnosis-badge ${selectedDet.classification_class === 'healthy' ? 'healthy' : 'sick'}`}>
            {classLabel(selectedDet.classification_class)}
          </div>
          <p><strong>Confidence:</strong> {(selectedDet.classification_confidence * 100).toFixed(1)}%</p>
          {selectedDet.uncertain && (
            <p className="uncertain-note">The model is not sure about this result: treat it as a hint.</p>
          )}
          {selectedDet.top3?.length > 0 && (
            <div className="top3">
              <strong>Most probable classes:</strong>
              <ul>
                {selectedDet.top3.map((item) => (
                  <li key={item.label}>{classLabel(item.label)}: {(item.confidence * 100).toFixed(1)}%</li>
                ))}
              </ul>
            </div>
          )}
          <div className="recommendations">
            <strong>Recommendations:</strong>
            <p>{selectedDet.recommendations}</p>
          </div>
        </div>
      )}
        </div>
      </div>
      )}

      {result && result.error && <p className="error">{result.error}</p>}
      </div>
    </div>
  );
}

export default App;
