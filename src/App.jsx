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
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [imgNaturalSize, setImgNaturalSize] = useState({
    width: 0,
    height: 0
  });

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

  useEffect(() => {
    if (result) {
      console.group("📐 Debug Scaling");
      console.log("Оригинал (ML):", { 
        w: result.image_width, 
        h: result.image_height 
      });
      console.log("На экране (UI):", { 
        w: imgSize.width, 
        h: imgSize.height 
      });
      console.log("Коэффициенты:", { 
        scaleX: scaleX.toFixed(4), 
        scaleY: scaleY.toFixed(4) 
      });
      
      if (result.detections?.length > 0) {
        const d = result.detections[0].bbox;
        console.log("Пример bbox (первый):", {
          raw: d,
          scaled: [d[0] * scaleX, d[1] * scaleY, d[2] * scaleX, d[3] * scaleY]
        });
      }
      console.groupEnd();
    }
  }, [imgSize, result, scaleX, scaleY]);


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

          {result.original_image && (
          <div className="image-wrapper">
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${result.original_image}`}
              onLoad={(e) => {
                const img = e.target;

                setImgSize({
                  width: img.clientWidth,
                  height: img.clientHeight,
                });

                setImgNaturalSize({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
              }}
            />
            <svg className="overlay"
                width={imgSize.width}
                height={imgSize.height}>
              {result.detections?.map((det, i) => {
                const [x1, y1, x2, y2] = det.bbox;

                return (
                  <rect
                    key={i}
                    x={x1 * scaleX}
                    y={y1 * scaleY}
                    width={(x2 - x1) * scaleX}
                    height={(y2 - y1) * scaleY}
                    fill="transparent"
                    stroke="red"
                    strokeWidth="2"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      console.log("CLICK:", det);
                      console.log("bbox raw:", det.bbox);
                      
                      alert(`${det.class} (${(det.det_confidence * 100).toFixed(1)}%)`);
                    }}
                  />
                );
              })}
            </svg>
          </div>
          )}
        </div>
      )}

      {result && result.error && <p className="error">{result.error}</p>}
      </div>
    </div>
  );
}

export default App;
