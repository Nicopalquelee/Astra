import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Volume1 } from 'lucide-react';

type VoiceState = 'inactive' | 'listening' | 'responding';

/**
 * Normaliza textos para TTS en español.
 * Restructura métricas para que se lean correctamente con decimales.
 * - Temperaturas: "22.5°C" -> "22 punto 5 grados"
 * - Porcentajes: "55.5%" -> "55 punto 5 porciento"
 * - Otras métricas: "410.5 ppm" -> "410 punto 5 ppm"
 */
function normalizeForSpanishTTS(text: string): string {
  if (!text) return text;

  let result = text;

  // 1. Eliminar puntos suspensivos (...)
  result = result.replace(/\.\.\./g, '');

  // 2. Temperaturas: "22.5°C", "22,5°C", "22°C" -> "22 punto 5 grados" o "22 grados"
  result = result.replace(/(\d+)([.,])(\d+)\s?°?\s?C\b/gi, (_m, entero, sep, decimal) => {
    return `${entero} punto ${decimal} grados`;
  });
  result = result.replace(/(\d+)\s?°?\s?C\b/gi, (_m, entero) => {
    return `${entero} grados`;
  });

  // 3. Porcentajes: "55.5%" -> "55 punto 5 porciento", "55%" -> "55 porciento"
  result = result.replace(/(\d+)([.,])(\d+)\s?%/g, (_m, entero, sep, decimal) => {
    return `${entero} punto ${decimal} porciento`;
  });
  result = result.replace(/(\d+)\s?%/g, (_m, entero) => {
    return `${entero} porciento`;
  });

  // 4. CO2 (ppm): "410.5 ppm" -> "410 punto 5 ppm", "410 ppm" -> "410 ppm"
  result = result.replace(/(\d+)([.,])(\d+)\s?ppm/gi, (_m, entero, sep, decimal) => {
    return `${entero} punto ${decimal} ppm`;
  });

  // 5. Lux (iluminación): "650.5 lux" -> "650 punto 5 lux", "650 lux" -> "650 lux"
  result = result.replace(/(\d+)([.,])(\d+)\s?lux/gi, (_m, entero, sep, decimal) => {
    return `${entero} punto ${decimal} lux`;
  });

  // 6. Otras unidades: kWh, kW, etc. "12.4 kWh" -> "12 punto 4 kWh"
  result = result.replace(/(\d+)([.,])(\d+)\s?(kWh|kW|L\/h)/gi, (_m, entero, sep, decimal, unidad) => {
    return `${entero} punto ${decimal} ${unidad}`;
  });

  return result;
}

function App() {
  const [voiceState, setVoiceState] = useState<VoiceState>('inactive');
  const [userTranscript, setUserTranscript] = useState('');
  const [astraResponse, setAstraResponse] = useState('');
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
  const [volume, setVolume] = useState(0.8);
  
  // Replaced mute toggle: control volume only

  // Refs para controlar reproducción e interrupciones
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const isSpeakingRef = useRef(false);
  const lastTranscriptRef = useRef<string>('');
  const spokenIndexRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const bufferRef = useRef<string>('');
  const isListeningActiveRef = useRef(false);

  const [sensorData, setSensorData] = useState({
    temperature: 22,
    humidity: 55,
    co2: 410,
    lightLevel: 650,
    doorOpen: false,
    doorOpenTime: null as string | null,
  });

  // Sonidos para UI
  const playSound = (type: 'listen' | 'send' | 'response') => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    switch (type) {
      case 'listen':
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.15);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
        break;
      case 'send':
        oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1500, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
        break;
      case 'response':
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
        break;
    }
  };

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.lang = 'es-ES';
      recognitionInstance.interimResults = false;

      recognitionInstance.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setUserTranscript(transcript);
        lastTranscriptRef.current = transcript;
        // keep state as listening until onend triggers send
        playSound('listen');
      };

      recognitionInstance.onerror = (event: any) => {
        console.error('Error de reconocimiento de voz:', event.error);
        // Limpiar transcript al detectar error
        lastTranscriptRef.current = '';
        setUserTranscript('');
        isListeningActiveRef.current = false;
        setVoiceState('inactive');
      };

      recognitionInstance.onend = () => {
        // Auto-enviar al terminar de hablar
        const transcript = lastTranscriptRef.current;
        const wasListening = isListeningActiveRef.current;
        // Limpiar inmediatamente para evitar reenvíos
        lastTranscriptRef.current = '';
        if (transcript && transcript.trim() && wasListening) {
          isListeningActiveRef.current = false;
          setVoiceState('responding');
          // usar microtask para evitar bloqueo en el handler
          setTimeout(() => sendToAstra(transcript), 0);
        } else {
          isListeningActiveRef.current = false;
          setVoiceState(s => (s === 'listening' ? 'inactive' : s));
        }
      };

      setRecognition(recognitionInstance);
    }

    // Simular datos de sensores en tiempo real
    const sensorInterval = setInterval(() => {
      setSensorData(prev => ({
        ...prev,
        temperature: 20 + Math.random() * 5,
        humidity: 40 + Math.random() * 30,
        co2: 400 + Math.random() * 100,
        lightLevel: Math.floor(300 + Math.random() * 500),
      }));
    }, 5000);

    return () => clearInterval(sensorInterval);
  }, []);

  const sendToAstra = async (userMessage: string) => {
    try {
      console.log('🎙️ Usuario dijo:', userMessage);
      let fullResponse = '';

      // onChunk will buffer incoming text and flush sentences/blocks to the TTS queue
      const onChunk = (chunk: string) => {
        fullResponse += chunk;
        setAstraResponse(fullResponse);
        // accumulate in buffer for chunked TTS
        bufferRef.current += chunk;

        // flush complete sentences or long fragments into the speak queue
        // NO dividir en puntos decimales dentro de números (ej: 22.5, 3.14)
        let flushed = true;
        while (flushed) {
          flushed = false;
          const buf = bufferRef.current;
          if (!buf) break;
          
          // Buscar puntuación final (. ! ?) que NO sea parte de un número decimal
          let foundSplit = false;
          let splitIndex = -1;
          
          for (let i = 0; i < buf.length; i++) {
            const char = buf[i];
            if (char === '.' || char === '!' || char === '?') {
              // Verificar si el punto es parte de un número decimal
              if (char === '.' && i > 0 && i < buf.length - 1) {
                const before = buf[i - 1];
                const after = buf[i + 1];
                // Si hay un dígito antes y después, es un decimal, no dividir aquí
                if (/\d/.test(before) && /\d/.test(after)) {
                  continue;
                }
              }
              // Verificar que hay un espacio después o es el final
              if (i === buf.length - 1) {
                splitIndex = i + 1;
                foundSplit = true;
                break;
              }
              const nextChar = buf[i + 1];
              if (nextChar === ' ' || nextChar === '\n') {
                splitIndex = i + 1;
                foundSplit = true;
                break;
              }
            }
          }
          
          if (foundSplit && splitIndex > 0) {
            const sentence = buf.slice(0, splitIndex).trim();
            queueRef.current.push(sentence);
            bufferRef.current = buf.slice(splitIndex).trim();
            flushed = true;
          } else if (buf.length > 220) {
            // flush a chunk if it's getting too long
            // Buscar un punto seguro para dividir (no dentro de números)
            let splitPoint = 220;
            for (let i = Math.min(220, buf.length - 1); i > 100; i--) {
              const char = buf[i];
              if (char === '.' || char === '!' || char === '?') {
                // Verificar si el punto es parte de un número decimal
                const isDecimalPoint = (char === '.' && i > 0 && i < buf.length - 1 && 
                                       /\d/.test(buf[i-1]) && /\d/.test(buf[i+1]));
                if (!isDecimalPoint) {
                  if (i === buf.length - 1) {
                    splitPoint = i + 1;
                    break;
                  }
                  const nextChar = buf[i + 1];
                  if (nextChar === ' ' || nextChar === '\n') {
                    splitPoint = i + 1;
                    break;
                  }
                }
              }
            }
            const part = buf.slice(0, splitPoint).trim();
            queueRef.current.push(part);
            bufferRef.current = buf.slice(splitPoint).trim();
            flushed = true;
          }
        }

        // Start playback queue if idle
        processQueue();
      };

      // Respuesta mejorada con datos de sensores (streaming)
      const response = await processAstraRequest(userMessage, onChunk, sensorData);
      // push any remaining buffered text
      if (bufferRef.current && bufferRef.current.trim()) {
        queueRef.current.push(bufferRef.current.trim());
        bufferRef.current = '';
      }

      // ensure final text is set
      fullResponse = response;
      setAstraResponse(response);
      console.log('✅ Respuesta final recibida:', response);

      // Wait until queue is drained
      await new Promise<void>(resolve => {
        const interval = setInterval(() => {
          if (!isSpeakingRef.current && queueRef.current.length === 0) {
            clearInterval(interval);
            resolve();
          }
        }, 150);
      });

      setVoiceState('inactive');
    } catch (error) {
      console.error('❌ Error al comunicarse con Astra:', error);
      const fallbackResponse = 'Lo siento, no pude procesar tu solicitud en este momento.';
      setAstraResponse(fallbackResponse);
      await speakResponse(fallbackResponse);
      setVoiceState('inactive');
    }
  };

  // Start/stop listening helpers for hold-to-talk
  const startListening = async () => {
    // interrupt any playback and clear queue to prioritize user
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch (e) {}
      try { URL.revokeObjectURL(audioUrlRef.current || ''); } catch (e) {}
      audioRef.current = null;
      audioUrlRef.current = null;
    }
    queueRef.current = [];
    bufferRef.current = '';
    isSpeakingRef.current = false;
    // Limpiar transcript anterior para evitar reenvíos
    lastTranscriptRef.current = '';
    setUserTranscript('');

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setAstraResponse('');
      isListeningActiveRef.current = true;
      setVoiceState('listening');
      playSound('listen');
      recognition?.start();
    } catch (error) {
      console.error('Error al acceder al micrófono:', error);
      isListeningActiveRef.current = false;
      alert('No se pudo acceder al micrófono. Por favor, concede los permisos necesarios.');
    }
  };

  const stopListening = () => {
    try {
      recognition?.stop();
    } catch (e) {
      console.warn('stopListening error', e);
    }
  };

  // Flush/queue processing helpers
  const processQueue = async () => {
    if (isSpeakingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    try {
      isSpeakingRef.current = true;
      await speakResponse(next);
    } catch (e) {
      console.warn('Error procesando queue chunk', e);
    } finally {
      isSpeakingRef.current = false;
      // process next chunk if present
      if (queueRef.current.length > 0) setTimeout(() => processQueue(), 0);
    }
  };

  const getMockAstraResponse = (msg: string, sensors: typeof sensorData) => {
    const text = msg.toLowerCase();

    // Respuestas con datos de sensores
    if (text.includes('temperatura') || text.includes('clima') || text.includes('calor') || text.includes('frío')) {
      return `La temperatura actual es ${sensors.temperature.toFixed(1)} grados. Humedad al ${sensors.humidity.toFixed(0)}%. ¿Deseas que ajuste el climatizador?`;
    }

    if (text.includes('humedad') || text.includes('aire')) {
      return `La humedad relativa es ${sensors.humidity.toFixed(0)}%. Los niveles son normales. ¿Necesitas que aumente o disminuya?`;
    }

    if (text.includes('luz') || text.includes('iluminación') || text.includes('brillo')) {
      if (text.includes('enciende') || text.includes('prende')) return 'Enciendo las luces del espacio. ¿A qué intensidad deseas?';
      if (text.includes('apaga')) return 'Apago las luces solicitadas.';
      return `Nivel de luz actual: ${sensors.lightLevel} lux. ¿Deseas ajustar la iluminación?`;
    }

    if (text.includes('co2') || text.includes('dióxido') || text.includes('ventilación')) {
      return `Nivel de CO₂: ${sensors.co2.toFixed(0)} ppm. Está dentro de los límites normales. La ventilación es adecuada.`;
    }

    if (text.includes('puerta') || text.includes('ventana')) {
      return sensors.doorOpen ? 'La puerta principal está abierta desde hace algunos minutos.' : 'Todas las puertas y ventanas están cerradas. Tu casa está segura.';
    }

    if (text.includes('enciende') || text.includes('prende') || text.includes('on')) {
      if (text.includes('lava') || text.includes('lavadora')) return 'Encendiendo la lavadora en ciclo normal.';
      return 'He encendido el dispositivo solicitado.';
    }

    if (text.includes('apaga') || text.includes('apagar') || text.includes('off')) {
      return 'He apagado el dispositivo solicitado.';
    }

    if (text.includes('consumo') || text.includes('reporte') || text.includes('energía') || text.includes('energ')) {
      return 'Consumo de hoy: 12.4 kWh. Temperatura promedio: 22°C. Sin alertas. Todo funciona eficientemente.';
    }

    if (text.includes('seguridad') || text.includes('alarma')) {
      return 'La casa está asegurada. No se detectó actividad inusual. Todos los sensores funcionan correctamente.';
    }

    if (text.includes('escena') || text.includes('modo')) {
      return 'Puedo activar modos: Noche (luces bajas y clima 18°C), Ausente (todo apagado y alarma), o Trabajo (iluminación optimizada). ¿Cuál prefieres?';
    }

    const greetings = ['hola', 'buenos', 'buenas'];
    if (greetings.some(g => text.includes(g))) return '¡Hola! Soy Astra, tu asistente inteligente. Puedo ayudarte con luces, climatización, sensores y seguridad. ¿Qué necesitas?';

    return 'Lo siento, no estoy segura de esa solicitud. Puedo ayudarte con controlar luces, temperatura, consultar sensores o revisar seguridad.';
  };

  const processAstraRequest = async (userMessage: string, onChunk?: (text: string) => void, sensors?: typeof sensorData): Promise<string> => {
    const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

    if (!API_KEY) {
      const mockResponse = getMockAstraResponse(userMessage, sensors || sensorData);
      if (onChunk) {
        for (const char of mockResponse) {
          onChunk(char);
          await new Promise(r => setTimeout(r, 20));
        }
      }
      return mockResponse;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: `**INSTRUCCIÓN CRÍTICA: DEBES RESPONDER SIEMPRE, EXCLUSIVAMENTE Y ÚNICAMENTE EN ESPAÑOL. NUNCA EN INGLÉS NI OTRO IDIOMA.**

Eres Astra, el asistente inteligente principal de una casa modular. Tu propósito es asistir a los residentes mediante control por voz, entregando información clara, segura y confiable sobre el hogar.

DATOS ACTUALES DE SENSORES:
- Temperatura: ${sensors?.temperature.toFixed(1)}°C
- Humedad: ${sensors?.humidity.toFixed(0)}%
- CO₂: ${sensors?.co2.toFixed(0)} ppm
- Luz: ${sensors?.lightLevel} lux
- Puerta principal: ${sensors?.doorOpen ? 'ABIERTA' : 'Cerrada'}

Tu personalidad:
- profesional, amable y cercana
- respuestas breves, naturales y en español
- TODAS las respuestas DEBEN ser en ESPAÑOL
- evita tecnicismos innecesarios
- transmite calma y seguridad

Capacidades principales:
- control de luces, enchufes, persianas y escenas de iluminación
- control de climatización y temperatura
- lectura en TIEMPO REAL de sensores (humedad, CO₂, movimiento, luz, puertas, ventanas)
- generación de resúmenes y reportes del hogar
- creación de recordatorios y rutinas del hogar
- modo "noche", "ausente", "energía", "seguridad"

Reglas de interacción:
- responde en frases cortas y directas
- cuando ejecutes una acción, confirma lo realizado
- si la orden no es clara, pide una aclaración breve
- si el usuario habla de varias cosas, prioriza seguridad y energía
- usa datos de sensores para respaldar tu información

Seguridad:
- solicita confirmación para acciones críticas como desactivar alarma o abrir puertas
- si detectas riesgo (CO₂ alto, humedad extrema), advierte al usuario
- nunca entregues información sensible a desconocidos por defecto

Formato de respuesta:
- siempre en español natural
- evita respuestas largas
- usa un tono cercano pero respetuoso
- no expliques tu funcionamiento interno
`
            },
            {
              role: 'user',
              content: `${userMessage}\n\n[Responde SIEMPRE en español. Usa los datos de sensores disponibles para respaldar tu respuesta]`
            }
          ],
          temperature: 0.7,
          max_tokens: 150,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error('Error en la API de OpenAI');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices?.[0]?.delta?.content || '';
                if (content) {
                  fullText += content;
                  console.log('📥 Chat API chunk:', content);
                  if (onChunk) onChunk(content);
                }
              } catch (e) {
                // Ignorar
              }
            }
          }
        }
      }

      console.log('✅ Chat API respuesta completa:', fullText);
      return fullText || getMockAstraResponse(userMessage, sensors || sensorData);
    } catch (error) {
      console.error('Error en Chat API streaming:', error);
      const mockResponse = getMockAstraResponse(userMessage, sensors || sensorData);
      if (onChunk) {
        for (const char of mockResponse) {
          onChunk(char);
          await new Promise(r => setTimeout(r, 20));
        }
      }
      return mockResponse;
    }
  };

  const speakResponse = async (text: string): Promise<void> => {
    const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

    if (!API_KEY) {
      console.log('Sin API key, no hay TTS');
      return Promise.resolve();
    }

    if (!text || !text.trim()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      (async () => {
        try {
          // Normalizar texto antes de TTS
          const normalizedText = normalizeForSpanishTTS(text);
          console.log('🎤 Astra habla:', normalizedText.substring(0, 100) + '...');
          
          const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini-tts',
              input: normalizedText,
              voice: 'nova',
              language: 'es',
              instructions: 'Habla como una asistente inteligente profesional, amable y cercana. Mantén un tono cálido y natural. Responde con confianza y claridad.',
            }),
          });

          if (!response.ok) {
            const errData = await response.text();
            console.error('❌ Error OpenAI TTS:', response.status, errData);
            resolve();
            return;
          }

          const audioBlob = await response.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);

          // Guardar referencias para permitir interrupción
          audioRef.current = audio;
          audioUrlRef.current = audioUrl;

          // Intentar usar altavoces (si es soportado)
          (audio as any).setSinkId?.('default').catch((e: any) => {
            console.log('No se pudo forzar altavoz, usando dispositivo por defecto:', e);
          });

          // Aplicar volumen
          audio.volume = volume;

          audio.onended = () => {
            console.log('✅ Audio finalizado');
            try { URL.revokeObjectURL(audioUrlRef.current || ''); } catch (e) {}
            audioRef.current = null;
            audioUrlRef.current = null;
            isSpeakingRef.current = false;
            resolve();
          };

          audio.onerror = (error) => {
            console.error('❌ Error reproduciendo audio:', error);
            try { URL.revokeObjectURL(audioUrlRef.current || ''); } catch (e) {}
            audioRef.current = null;
            audioUrlRef.current = null;
            isSpeakingRef.current = false;
            resolve();
          };

          isSpeakingRef.current = true;
          audio.play().catch(err => {
            console.error('Error al reproducir:', err);
            try { URL.revokeObjectURL(audioUrlRef.current || ''); } catch (e) {}
            audioRef.current = null;
            audioUrlRef.current = null;
            isSpeakingRef.current = false;
            resolve();
          });
        } catch (error) {
          console.warn('❌ OpenAI TTS falló:', error);
          isSpeakingRef.current = false;
          resolve();
        }
      })();
    });
  };

  const handleVoiceButton = async () => {
    if (voiceState === 'listening') {
      recognition?.stop();
      // Limpiar transcript al detener manualmente
      lastTranscriptRef.current = '';
      setUserTranscript('');
      isListeningActiveRef.current = false;
      setVoiceState('inactive');
      return;
    }

    // Si estamos hablando, interrumpir el audio y pasar a escuchar
    if (voiceState === 'responding') {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        } catch (e) {}
        try { URL.revokeObjectURL(audioUrlRef.current || ''); } catch (e) {}
        audioRef.current = null;
        audioUrlRef.current = null;
        isSpeakingRef.current = false;
      }
      queueRef.current = [];
      bufferRef.current = '';
      // Limpiar transcript anterior
      lastTranscriptRef.current = '';
      // comenzar a escuchar de inmediato
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setUserTranscript('');
        setAstraResponse('');
        isListeningActiveRef.current = true;
        setVoiceState('listening');
        playSound('listen');
        recognition?.start();
      } catch (error) {
        console.error('Error al acceder al micrófono:', error);
        isListeningActiveRef.current = false;
        alert('No se pudo acceder al micrófono. Por favor, concede los permisos necesarios.');
      }
      return;
    }

    // Usar startListening para mantener consistencia
    startListening();
  };

  const handleSendMessage = async () => {
    if (userTranscript) {
      playSound('send');
      setVoiceState('responding');
      setAstraResponse('');
      await sendToAstra(userTranscript);
      setVoiceState('inactive');
      setUserTranscript('');
    }
  };

  const getButtonStyle = () => {
    const baseStyle = "w-56 h-56 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl font-bold text-lg";
    switch (voiceState) {
      case 'listening':
        return `${baseStyle} bg-gradient-to-br from-blue-400 to-blue-600 animate-pulse scale-110 shadow-blue-500/50 shadow-xl`;
      case 'responding':
        return `${baseStyle} bg-gradient-to-br from-purple-500 to-purple-700 opacity-75 shadow-purple-500/50`;
      default:
        return `${baseStyle} bg-gradient-to-br from-blue-500 to-blue-700 hover:scale-105 cursor-pointer shadow-blue-500/50`;
    }
  };

  const getButtonText = () => {
    switch (voiceState) {
      case 'listening':
        return 'Escuchando...';
      case 'responding':
        return 'Procesando...';
      default:
        return 'Hablar con Astra';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0f2744] to-[#0a1628] text-white overflow-hidden">
      {/* Efecto de fondo animado */}
      <div className="fixed inset-0 opacity-10">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-1/2 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
      </div>

      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        input[type='range'] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 8px;
          background: rgba(59, 130, 246, 0.2);
          border-radius: 5px;
          outline: none;
        }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #3b82f6, #1e3a8a);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
        input[type='range']::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #3b82f6, #1e3a8a);
          border-radius: 50%;
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }
        /* Shimmer skeleton */
        .shimmer {
          position: relative;
          overflow: hidden;
          background: rgba(255,255,255,0.02);
        }
        .shimmer::after {
          content: '';
          position: absolute;
          top: 0;
          left: -150%;
          height: 100%;
          width: 250%;
          background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0) 100%);
          animation: shimmer 1.6s linear infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(0%); }
          100% { transform: translateX(40%); }
        }
        .shimmer-line { height: 14px; border-radius: 6px; background: rgba(255,255,255,0.03); margin-bottom: 10px; }
      `}</style>

      <div className="relative container mx-auto px-4 py-8 max-w-4xl">
        <header className="text-center mb-12">
          <h1 className="text-7xl font-bold mb-4 tracking-wider animate-pulse">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-blue-200 text-transparent bg-clip-text">
              ASTRA
            </span>
          </h1>
          <p className="text-xl text-blue-200 font-light">
            Asistente inteligente para casas modulares
          </p>
        </header>

        {/* Control de Volumen */}
        <div className="mb-8 bg-blue-900/20 backdrop-blur-sm rounded-xl p-4 border border-blue-700/30">
          <div className="flex items-center gap-4">
            <Volume1 className="w-5 h-5 text-blue-300" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="flex-1"
            />
            <Volume2 className="w-5 h-5 text-blue-300" />
            <span className="text-sm text-blue-300 w-12">{Math.round(volume * 100)}%</span>
          </div>
        </div>

        {/* Sensores Dashboard */}
        <div className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-blue-900/20 backdrop-blur-sm rounded-lg p-3 border border-blue-700/30 text-center">
            <p className="text-xs text-blue-300 mb-1">Temperatura</p>
            <p className="text-lg font-bold text-blue-100">{sensorData.temperature.toFixed(1)}°C</p>
          </div>
          <div className="bg-blue-900/20 backdrop-blur-sm rounded-lg p-3 border border-blue-700/30 text-center">
            <p className="text-xs text-blue-300 mb-1">Humedad</p>
            <p className="text-lg font-bold text-blue-100">{sensorData.humidity.toFixed(0)}%</p>
          </div>
          <div className="bg-blue-900/20 backdrop-blur-sm rounded-lg p-3 border border-blue-700/30 text-center">
            <p className="text-xs text-blue-300 mb-1">CO₂</p>
            <p className="text-lg font-bold text-blue-100">{sensorData.co2.toFixed(0)}ppm</p>
          </div>
          <div className="bg-blue-900/20 backdrop-blur-sm rounded-lg p-3 border border-blue-700/30 text-center">
            <p className="text-xs text-blue-300 mb-1">Luz</p>
            <p className="text-lg font-bold text-blue-100">{sensorData.lightLevel}lux</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center mb-12 gap-4">
            <div className="flex items-center gap-4">
              <button
                // Hold-to-talk: start on pointer down / touchstart, stop on release
                onMouseDown={() => startListening()}
                onTouchStart={(e) => { e.preventDefault(); startListening(); }}
                onMouseUp={() => stopListening()}
                onTouchEnd={() => stopListening()}
                onMouseLeave={() => { if (voiceState === 'listening') stopListening(); }}
                disabled={voiceState === 'responding'}
                className={getButtonStyle()}
              >
                <div className="text-center">
                  {voiceState === 'listening' ? (
                    <Mic className="w-20 h-20 mx-auto mb-3" />
                  ) : (
                    <MicOff className="w-20 h-20 mx-auto mb-3 opacity-80" />
                  )}
                  <span className="text-base">{getButtonText()}</span>
                </div>
              </button>
            </div>
        </div>

        <div className="text-center mb-8">
          <p className="text-lg text-blue-100 mb-2 font-semibold">
            Controla tu casa modular con voz
          </p>
          <p className="text-sm text-blue-300 opacity-75">
            Prueba: "¿Cuál es la temperatura?", "Enciende las luces", "Muéstrame el reporte"
          </p>
        </div>

        {(userTranscript || astraResponse) && (
          <div className="space-y-4 bg-blue-900/20 backdrop-blur-sm rounded-2xl p-6 border border-blue-700/30 shadow-xl">
            {userTranscript && (
              <div className="bg-gradient-to-r from-blue-900/40 to-transparent rounded-xl p-4 border border-blue-600/30">
                <p className="text-xs text-blue-300 mb-2 font-semibold uppercase tracking-wide">
                  Tú dijiste:
                </p>
                <p className="text-white text-lg">{userTranscript}</p>
              </div>
            )}

            {astraResponse ? (
              <div className="bg-gradient-to-r from-purple-900/40 to-transparent rounded-xl p-4 border border-purple-600/30">
                <p className="text-xs text-purple-200 mb-2 font-semibold uppercase tracking-wide">
                  Astra responde:
                </p>
                <p className="text-blue-50 text-lg leading-relaxed">{astraResponse}</p>
              </div>
            ) : (
              // show shimmer skeleton while responding
              voiceState === 'responding' && (
                <div className="bg-gradient-to-r from-purple-900/20 to-transparent rounded-xl p-4 border border-purple-600/20">
                  <p className="text-xs text-purple-200 mb-2 font-semibold uppercase tracking-wide">
                    Astra responde:
                  </p>
                  <div className="shimmer p-3 rounded">
                    <div className="shimmer-line w-5/6"></div>
                    <div className="shimmer-line w-4/6"></div>
                    <div className="shimmer-line w-3/6"></div>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        <div className="mt-12 text-center text-xs text-blue-400/60 space-y-1">
          <p>✨ Tecnología de reconocimiento de voz y sensores inteligentes</p>
          <p>🏠 Controlando tu hogar modular en tiempo real</p>
        </div>
      </div>
    </div>
  );
}

export default App;
