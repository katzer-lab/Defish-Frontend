// App.jsx
import { useRef, useState, useEffect } from 'react';
import Lightfall from './Lightfall';
import { submitPhoto, pollResult, cancelTask, describeError, isAborted } from './api';
import './App.css';

// Вне компонента: новый массив на каждый рендер заставлял бы Lightfall пересоздавать WebGL-контекст.
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
  
  // координаты в натуральных пикселях
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
    const delta = startX.current - e.clientX; // тянем влево = увеличиваем
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

  // Сбрасываем сразу, иначе пока новый HEIC асинхронно конвертируется,
  // кнопка анализа остаётся активной со старым uploadFile от предыдущего файла.
  setUploadFile(null);

  const isHeic = /image\/hei(c|f)/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

  if (isHeic) {
    // Браузеры (кроме Safari) не умеют декодировать HEIC/HEIF в <img>, а бэкенд
    // не всегда умеет декодировать HEIC вовсе — поэтому конвертируем в JPEG на
    // клиенте один раз и используем этот файл и для превью, и для отправки на анализ.
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
        console.error('Не удалось конвертировать HEIC:', err);
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
      // 1. отправляем фото
      const data = await submitPhoto(uploadFile, { signal: controller.signal });

      if (data.id && data.diagnosis) {
        // результат пришёл сразу (тот же снимок уже анализировали, ответ из кэша)
        setResult(data);
      } else if (data.task_id) {
        // 2. задача принята: опрашиваем сервер до готовности результата
        setTaskId(data.task_id);
        const analysisResult = await pollResult(data.task_id, { signal: controller.signal });
        if (analysisResult.status !== 'canceled') setResult(analysisResult);
      } else {
        throw new Error('Неожиданный формат ответа от сервера');
      }
    } catch (err) {
      if (isAborted(err)) return;  // отмена пользователем: сообщение уже показано
      console.error('Ошибка при анализе:', err);
      setError(describeError(err));
    } finally {
      // старый запрос не должен гасить индикатор нового
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
  <label className="icon-btn file-btn" title="Выбрать файл">
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
    <button type="submit" className="icon-btn submit-btn" disabled={!uploadFile} title="Диагностировать">
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
      {isCanceled && !loading && <p className="status-note">Анализ отменён.</p>}


      {result && !result.error && result.status !== 'canceled' &&(
        <div className="result">
          <h2>Результат анализа:</h2>
          {/* <p><strong>Диагноз:</strong> {result.diagnosis}</p>
          <p><strong>Вероятность:</strong> {(result.confidence * 100).toFixed(1)}%</p>
          <p><strong>Рекомендации:</strong> {result.recommendations}</p> */}
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
                // clientWidth/Height уже корректны после onLoad с CSS max-width
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
            <p className="notice">Фото больше недоступно на сервере, но диагноз получен:</p>
            <ul className="detection-list">
              {result.detections?.map((det, i) => (
                <li key={i}>
                  <button type="button" className={`detection-item ${det.classification_class === 'healthy' ? 'healthy' : 'sick'}`}
                          onClick={() => handleDetClick(det)}>
                    {det.classification_class === 'healthy' ? 'Здоров' : det.classification_class}
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
          <h3>Диагностика</h3>
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
            {selectedDet.classification_class === 'healthy' ? 'Здоров' : `${selectedDet.classification_class}`}
          </div>
          <p><strong>Уверенность:</strong> {(selectedDet.classification_confidence * 100).toFixed(1)}%</p>
          {selectedDet.uncertain && (
            <p className="uncertain-note">Модель не уверена в этом результате: считайте его подсказкой.</p>
          )}
          {selectedDet.top3?.length > 0 && (
            <div className="top3">
              <strong>Наиболее вероятные классы:</strong>
              <ul>
                {selectedDet.top3.map((item) => (
                  <li key={item.label}>{item.label}: {(item.confidence * 100).toFixed(1)}%</li>
                ))}
              </ul>
            </div>
          )}
          <div className="recommendations">
            <strong>Рекомендации:</strong>
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
