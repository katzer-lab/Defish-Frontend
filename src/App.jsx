// App.jsx
import { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import Lightfall from './Lightfall';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [taskId, setTaskId] = useState(null);
  const [isCanceled, setIsCanceled] = useState(false);
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

  const backend_ip = import.meta.env.VITE_API_URL;

  console.log("ENV:", import.meta.env);
  console.log("API:", import.meta.env.VITE_API_URL);
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

  const img = imgRef.current;
  if (!img) return;

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


  // Функция polling
  const pollResult = async (task_id, interval = 1000, maxAttempts = 1000) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${backend_ip}/analyze-result/${task_id}`);
        const data = response.data;

      if (data.status === 'canceled'){ 
        console.log("Опрос остановлен: задача отменена сервером");
        return data; // ПРЕРЫВАЕМ ЦИКЛ ЗДЕСЬ
      }

          if (!data.status || data.status === 'done') {
            // Результат готов
            return data;
          }

        // if (data.status === 'processing') {
          // Ждем и пробуем снова
          await new Promise(resolve => setTimeout(resolve, interval));
        // }

      } catch (err) {
        console.error('Ошибка при получении результата:', err);
      }

      attempts++;
    }

    throw new Error('Превышено время ожидания результата');
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsCanceled(false);
    setLoading(true);
    setError(null);
    setResult(null);
    setTaskId(null);
    setSelectedDet(null);
    setCroppedImage(null); 

    const formData = new FormData();
    formData.append('image', file);

    try {
      // 1️⃣ Отправляем POST-запрос на анализ
      const task_response = await axios.post(
        `${backend_ip}/analyze`,
        formData
      );

      const data = task_response.data;

      if (data.status === 'canceled') {
        setResult(null); // Очищаем, чтобы ничего не всплывало
        console.log("Результат не установлен, так как задача отменена");
      }
      
      // 🔍 Проверяем, пришел ли результат сразу (из кэша)
      if (data.id && data.diagnosis) {
        // Это результат из кэша - показываем сразу
        console.log('Получен результат из кэша:', data);
        setResult(data);
      } 
      // Если пришел task_id - значит задача в обработке
      else if (data.task_id) {
        console.log('Задача создана, task_id:', data.task_id);
        setTaskId(data.task_id);
        // 2️⃣ Опрашиваем сервер до готовности результата
        const analysisResult = await pollResult(data.task_id);
        setResult(analysisResult);
      } 
      else {
        throw new Error('Неожиданный формат ответа от сервера');
      }

    } catch (err) {
      console.error('Ошибка при анализе:', err);
      setError(err.message || 'Что-то пошло не так');

    } finally {
      setLoading(false);
    }
};

  const handleCancel = async () => {
  if (!taskId) return;

  try {
    await axios.post(
      `${backend_ip}/cancel/${taskId}`
    );
  } catch (e) {
    console.error(e);
  }

  setIsCanceled(true);
  setLoading(false);
  setResult(null);
};

console.log("RESULT:", JSON.stringify(result, null, 2));
  return (
    <div className="app-shell">
      <div className="lightfall-bg">
        <Lightfall
          colors={['#A6C8FF', '#5227FF', '#FF9FFC']}
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
  <input 
    type="file" 
    accept="image/*"
    onChange={(e) => setFile(e.target.files[0])} 
  />

  {!loading ? (
    <button type="submit" disabled={!file}>
      Диагностировать
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


      {result && !result.error && result.status !== 'canceled' &&(
        <div className="result">
          <h2>Результат анализа:</h2>
          {/* <p><strong>Диагноз:</strong> {result.diagnosis}</p>
          <p><strong>Вероятность:</strong> {(result.confidence * 100).toFixed(1)}%</p>
          <p><strong>Рекомендации:</strong> {result.recommendations}</p> */}
   <div className="result-content">
          {result.original_image && (
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
