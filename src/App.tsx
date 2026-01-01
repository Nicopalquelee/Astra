import { useState, useEffect } from 'react';
import { Mic, MicOff, Send } from 'lucide-react';

type VoiceState = 'inactive' | 'listening' | 'responding' | 'waiting-send';

function App() {
  const [voiceState, setVoiceState] = useState<VoiceState>('inactive');
  const [userTranscript, setUserTranscript] = useState('');
  const [astraResponse, setAstraResponse] = useState('');
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);

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
        setVoiceState('waiting-send');
      };

      recognitionInstance.onerror = (event: any) => {
        console.error('Error de reconocimiento de voz:', event.error);
        setVoiceState('inactive');
      };

      recognitionInstance.onend = () => {
        setVoiceState(s => (s === 'listening' ? 'inactive' : s));
      };

      setRecognition(recognitionInstance);
    }
  }, []);

  const sendToAstra = async (userMessage: string) => {
    try {
      console.log('🎙️ Usuario dijo:', userMessage);
      // Acumular texto para TTS streaming
      let accumulatedText = '';
      let isPlayingStream = false;

      const onChunk = (chunk: string) => {
        accumulatedText += chunk;
        setAstraResponse(accumulatedText);
        console.log('🔄 Texto acumulado:', accumulatedText);

        // Acumular hasta tener una oración completa (., !, ?)
        if ((accumulatedText.includes('.') || accumulatedText.includes('!') || accumulatedText.includes('?')) && !isPlayingStream) {
          isPlayingStream = true;
          // Extraer la primer oración completa
          const match = accumulatedText.match(/^[^.!?]*[.!?]/);
          if (match) {
            const sentenceToSpeak = match[0];
            console.log('🔊 Hablando oración:', sentenceToSpeak);
            speakResponse(sentenceToSpeak).then(() => {
              isPlayingStream = false;
            });
          }
        }
      };

      const response = await processAstraRequest(userMessage, onChunk);
      setAstraResponse(response);
      console.log('✅ Respuesta final recibida:', response);
    } catch (error) {
      console.error('❌ Error al comunicarse con Astra:', error);
      const fallbackResponse = 'Lo siento, no pude procesar tu solicitud en este momento.';
      setAstraResponse(fallbackResponse);
      await speakResponse(fallbackResponse);
      setVoiceState('inactive');
    }
  };

  const getMockAstraResponse = (msg: string) => {
    const text = msg.toLowerCase();

    if (text.includes('enciende') || text.includes('prende') || text.includes('on')) {
      if (text.includes('luz') || text.includes('luces')) return 'Perfecto, enciendo las luces. ¿Quieres que las deje en un brillo específico?';
      if (text.includes('lava') || text.includes('lavadora')) return 'Encendiendo la lavadora en ciclo normal.';
      return 'He encendido el dispositivo solicitado.';
    }

    if (text.includes('apaga') || text.includes('apagar') || text.includes('off')) {
      if (text.includes('luz') || text.includes('luces')) return 'Apago las luces. ¿Deseas programarlas para más tarde?';
      return 'He apagado el dispositivo solicitado.';
    }

    if (text.includes('temperatura') || text.includes('calor') || text.includes('frío')) {
      const match = text.match(/(\d{2})/);
      if (match) return `Ajustando la temperatura a ${match[1]} grados.`;
      return '¿A qué temperatura te gustaría ajustar el termostato?';
    }

    if (text.includes('consumo') || text.includes('reporte') || text.includes('energ')) {
      return 'El consumo estimado de hoy es 12.4 kWh. ¿Quieres el detalle por zona?';
    }

    if (text.includes('seguridad') || text.includes('alarma') || text.includes('puerta')) {
      return 'La casa está asegurada. No se detectó actividad inusual.';
    }

    const greetings = ['hola', 'buenos', 'buenas'];
    if (greetings.some(g => text.includes(g))) return '¡Hola! Soy Astra, ¿en qué puedo ayudarte con tu casa modular?';

    return 'Lo siento, no estoy segura de esa solicitud. ¿Quieres que intente con otra cosa?';
  };

  const processAstraRequest = async (userMessage: string, onChunk?: (text: string) => void): Promise<string> => {
    const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

    if (!API_KEY) {
      // Modo offline / simulación
      const mockResponse = getMockAstraResponse(userMessage);
      if (onChunk) {
        // Simular streaming en modo offline
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

Tu personalidad:
- profesional, amable y cercana
- respuestas breves, naturales y en español
- TODAS las respuestas DEBEN ser en ESPAÑOL
- evita tecnicismos innecesarios
- transmite calma y seguridad

Capacidades principales:
- control de luces, enchufes, persianas y escenas de iluminación
- control de climatización y temperatura
- consulta y lectura de sensores (humedad, CO₂, movimiento, puertas, ventanas)
- generación de resúmenes y reportes del hogar
- creación de recordatorios y rutinas del hogar
- modo “noche”, “ausente”, “energía”, “seguridad”

Reglas de interacción:
- responde en frases cortas y directas
- cuando ejecutes una acción, confirma lo realizado
- si la orden no es clara, pide una aclaración breve
- si el usuario habla de varias cosas, prioriza seguridad y energía
- no inventes datos del hogar si no existen; dilo claramente

Seguridad:
- solicita confirmación para acciones críticas como:
  - desactivar alarma
  - abrir puertas o portones
  - apagar sistemas de seguridad
- si detectas riesgo (gas, humo, intrusión, incendio), prioriza advertir y sugerir actuar
- nunca entregues información sensible a desconocidos por defecto

Límites:
- no des consejos médicos, legales o financieros
- no supongas identidades
- si no puedes hacer algo, dilo amablemente y ofrece alternativas

Formato de respuesta:
- siempre en español natural
- evita respuestas largas
- usa un tono cercano pero respetuoso
- no expliques tu funcionamiento interno

Ejemplos de respuesta:
Usuario: "Astra, apaga las luces del living"
Tú: "Listo, apagué las luces del living."

Usuario: "Astra, abre la puerta principal"
Tú: "Por seguridad necesito confirmación. ¿Deseas abrir la puerta principal ahora?"

Usuario: "Astra, dame un reporte del día"
Tú: "Hoy hubo bajo consumo eléctrico y no se detectaron alertas. Todo en orden."
`
            },
            {
              role: 'user',
              content: `${userMessage}\n\n[Responde SIEMPRE en español]`
            }
          ],
          temperature: 0.7,
          max_tokens: 150,
          stream: true  // Activar streaming
        })
      });

      if (!response.ok) {
        throw new Error('Error en la API de OpenAI');
      }

      // Procesar streaming
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
                // Ignorar líneas que no son JSON válidas
              }
            }
          }
        }
      }

      console.log('✅ Chat API respuesta completa:', fullText);
      return fullText || getMockAstraResponse(userMessage);
    } catch (error) {
      console.error('Error en Chat API streaming:', error);
      const mockResponse = getMockAstraResponse(userMessage);
      if (onChunk) {
        for (const char of mockResponse) {
          onChunk(char);
          await new Promise(r => setTimeout(r, 20));
        }
      }
      return mockResponse;
    }
  };

  const speakResponse = async (text: string) => {
    const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

    if (API_KEY) {
      try {
        console.log('🎤 Astra respuesta:', text.substring(0, 100) + '...');
        
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini-tts',
            input: text,
            voice: 'cedar',
            language: 'es',
            instructions: 'Habla como una asistente inteligente profesional, amable y cercana. Mantén un tono cálido y natural. Responde con confianza y claridad.',
          }),
        });

        if (!response.ok) {
          const errData = await response.text();
          console.error('❌ Error OpenAI TTS:', response.status, errData);
          throw new Error('Error en OpenAI TTS: ' + response.status);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        audio.onended = () => {
          setVoiceState('inactive');
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          console.error('Error reproduciendo audio OpenAI');
          setVoiceState('inactive');
          URL.revokeObjectURL(audioUrl);
        };
        audio.play();
        return;
      } catch (error) {
        console.warn('OpenAI TTS falló:', error);
        setVoiceState('inactive');
      }
    }
  };



  const handleVoiceButton = async () => {
    if (voiceState === 'listening') {
      recognition?.stop();
      setVoiceState('inactive');
      return;
    }

    if (voiceState === 'responding') {
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      setUserTranscript('');
      setAstraResponse('');
      setVoiceState('listening');
      recognition?.start();
    } catch (error) {
      console.error('Error al acceder al micrófono:', error);
      alert('No se pudo acceder al micrófono. Por favor, concede los permisos necesarios.');
    }
  };

  const handleSendMessage = async () => {
    if (userTranscript) {
      setVoiceState('responding');
      setAstraResponse('');
      await sendToAstra(userTranscript);
      setVoiceState('inactive');
      setUserTranscript('');
    }
  };

  const getButtonStyle = () => {
    const baseStyle = "w-48 h-48 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl";

    switch (voiceState) {
      case 'listening':
        return `${baseStyle} bg-gradient-to-br from-blue-400 to-blue-600 animate-pulse scale-110`;
      case 'responding':
        return `${baseStyle} bg-gradient-to-br from-blue-500 to-blue-700 opacity-75`;
      case 'waiting-send':
        return `${baseStyle} bg-gradient-to-br from-green-400 to-green-600 hover:scale-105 cursor-pointer`;
      default:
        return `${baseStyle} bg-gradient-to-br from-blue-500 to-blue-700 hover:scale-105 cursor-pointer`;
    }
  };

  const getButtonText = () => {
    switch (voiceState) {
      case 'listening':
        return 'Escuchando...';
      case 'responding':
        return 'Respondiendo...';
      case 'waiting-send':
        return 'Enviar';
      default:
        return 'Hablar con Astra';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0f2744] to-[#0a1628] text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="text-center mb-12">
          <h1 className="text-7xl font-bold mb-4 tracking-wider">
            <span className="bg-gradient-to-r from-blue-400 to-blue-200 text-transparent bg-clip-text">
              ASTRA
            </span>
          </h1>
          <p className="text-xl text-blue-200 font-light">
            Asistente inteligente para casas modulares
          </p>
        </header>

        <div className="flex flex-col items-center justify-center mb-12 gap-6">
          <button
            onClick={voiceState === 'waiting-send' ? handleSendMessage : handleVoiceButton}
            disabled={voiceState === 'responding'}
            className={getButtonStyle()}
          >
            <div className="text-center">
              {voiceState === 'listening' ? (
                <Mic className="w-16 h-16 mx-auto mb-2" />
              ) : voiceState === 'waiting-send' ? (
                <Send className="w-16 h-16 mx-auto mb-2" />
              ) : (
                <MicOff className="w-16 h-16 mx-auto mb-2 opacity-80" />
              )}
              <span className="text-sm font-medium">{getButtonText()}</span>
            </div>
          </button>

          {voiceState === 'waiting-send' && (
            <button
              onClick={handleVoiceButton}
              className="px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Volver a grabar
            </button>
          )}
        </div>

        <div className="text-center mb-8">
          <p className="text-lg text-blue-100 mb-2">
            Habla con Astra para controlar tu casa modular
          </p>
          <p className="text-sm text-blue-300 opacity-75">
            Di cosas como: "Enciende las luces del living" o "muéstrame el reporte de consumo"
          </p>
        </div>

        {(userTranscript || astraResponse) && (
          <div className="space-y-4 bg-[#0f1e33]/50 backdrop-blur-sm rounded-2xl p-6 border border-blue-900/30 shadow-xl">
            {userTranscript && (
              <div className="bg-blue-900/30 rounded-xl p-4 border border-blue-700/30">
                <p className="text-xs text-blue-300 mb-2 font-semibold uppercase tracking-wide">
                  Tú dijiste:
                </p>
                <p className="text-white text-lg">{userTranscript}</p>
              </div>
            )}

            {astraResponse && (
              <div className="bg-blue-800/20 rounded-xl p-4 border border-blue-600/30">
                <p className="text-xs text-blue-200 mb-2 font-semibold uppercase tracking-wide">
                  Astra responde:
                </p>
                <p className="text-blue-50 text-lg">{astraResponse}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-12 text-center text-xs text-blue-400/60 space-y-1">
          <p>Desarrollado con tecnología de reconocimiento de voz</p>
          <p>Controlando tu hogar inteligente</p>
        </div>
      </div>
    </div>
  );
}

export default App;
