// services/openaiService.ts
// Servicio centralizado para OpenAI Chat y TTS

import { SensorData } from '../hooks/useSensorData';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

interface TTSOptions {
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'cedar';
  speed?: number;
  volume?: number;
  language?: string;
}

class OpenAIService {
  private apiKey: string;
  private baseURL = 'https://api.openai.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Genera un prompt del sistema que incluye contexto de sensores
   */
  private generateSystemPrompt(sensors: SensorData, customPrompt?: string): string {
    const sensorContext = `
DATOS ACTUALES DE SENSORES (EN TIEMPO REAL):
- Temperatura: ${sensors.temperature.toFixed(1)}°C
- Humedad Relativa: ${sensors.humidity.toFixed(0)}%
- Nivel de CO₂: ${sensors.co2.toFixed(0)} ppm
- Luz: ${sensors.lightLevel} lux
- Puerta Principal: ${sensors.doorOpen ? 'ABIERTA' : 'Cerrada'}
- Ventanas: ${sensors.windowOpen ? 'ABIERTAS' : 'Cerradas'}
- Movimiento: ${sensors.motionDetected ? 'Detectado' : 'No hay'}
- Consumo Energético: ${sensors.energyUsage.toFixed(1)} kW
- Consumo de Agua: ${sensors.waterUsage.toFixed(2)} L/h
- Sensor de Gas: ${sensors.gasSensor} ppm
- Humo: ${sensors.smokeSensor ? 'DETECTADO' : 'Ninguno'}
`;

    return customPrompt
      ? `${customPrompt}\n\n${sensorContext}`
      : `**INSTRUCCIÓN CRÍTICA: RESPONDE SIEMPRE, EXCLUSIVAMENTE Y ÚNICAMENTE EN ESPAÑOL.**

Eres Astra, el asistente inteligente de una casa modular. Tu propósito es asistir a los residentes mediante control por voz.

${sensorContext}

Tu personalidad:
- Profesional, amable y cercana
- Respuestas breves y naturales
- Evitas tecnicismos innecesarios
- Transmites calma y seguridad
- Usas los datos de sensores para respaldar tu información

Capacidades principales:
- Control de luces, enchufes, persianas y escenas
- Control de climatización basado en datos reales
- Lectura y consultas de sensores en tiempo real
- Generación de reportes y resúmenes
- Creación de rutinas automáticas
- Modos: Noche, Ausente, Trabajo, Seguridad, Energía

Reglas de interacción:
- Responde en frases cortas y directas
- Confirma acciones ejecutadas
- Si algo no es claro, pide clarificación breve
- Prioriza seguridad sobre todo
- Usa datos de sensores para hacer recomendaciones inteligentes

Seguridad:
- Solicita confirmación para acciones críticas (alarma, puertas)
- Si detectas riesgo (humo, gas, CO₂ alto), advierte inmediatamente
- Nunca des información sensible a desconocidos

Formato de respuesta:
- Siempre en español
- Evita respuestas largas
- Tono cercano y respetuoso
- No expliques tu funcionamiento`;
  }

  /**
   * Chat streaming con soporte para sensores
   */
  async chatStream(
    userMessage: string,
    sensors: SensorData,
    onChunk?: (chunk: string) => void,
    options?: ChatOptions
  ): Promise<string> {
    const systemPrompt = this.generateSystemPrompt(sensors, options?.systemPrompt);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userMessage,
            },
          ],
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 150,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
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
                  if (onChunk) onChunk(content);
                }
              } catch (e) {
                // Ignorar líneas inválidas
              }
            }
          }
        }
      }

      return fullText;
    } catch (error) {
      console.error('Error en Chat API:', error);
      throw error;
    }
  }

  /**
   * Chat sin streaming (más simple)
   */
  async chat(
    userMessage: string,
    sensors: SensorData,
    options?: ChatOptions
  ): Promise<string> {
    const systemPrompt = this.generateSystemPrompt(sensors, options?.systemPrompt);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userMessage,
            },
          ],
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 150,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      console.error('Error en Chat API:', error);
      throw error;
    }
  }

  /**
   * Text-to-Speech mejorado
   */
  async textToSpeech(
    text: string,
    volume: number = 0.8,
    options?: TTSOptions
  ): Promise<AudioBuffer> {
    if (!text || !text.trim()) {
      throw new Error('El texto no puede estar vacío');
    }

    try {
      const response = await fetch(`${this.baseURL}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          input: text,
          voice: options?.voice || 'cedar',
          speed: options?.speed || 1.0,
          language: options?.language || 'es',
          instructions:
            'Habla como una asistente inteligente profesional, amable y cercana. Mantén un tono cálido y natural. Responde con confianza y claridad.',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`TTS error: ${response.status} - ${error}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.volume = Math.min(Math.max(volume, 0), 1);

      return audio as any; // Simplificación para este ejemplo
    } catch (error) {
      console.error('Error en TTS:', error);
      throw error;
    }
  }

  /**
   * Reproduce audio con promesa
   */
  async playAudio(text: string, volume: number = 0.8): Promise<void> {
    return new Promise((resolve, reject) => {
      this.textToSpeech(text, volume)
        .then((audio) => {
          (audio as any).onended = () => resolve();
          (audio as any).onerror = (err: any) => reject(err);
          (audio as any).play().catch(reject);
        })
        .catch(reject);
    });
  }

  /**
   * Embeds para búsqueda semántica
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embeddings error: ${response.status}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      console.error('Error obteniendo embeddings:', error);
      throw error;
    }
  }
}

/**
 * Instancia singleton del servicio
 */
let openaiService: OpenAIService | null = null;

export const initOpenAIService = (apiKey: string): OpenAIService => {
  if (!openaiService) {
    openaiService = new OpenAIService(apiKey);
  }
  return openaiService;
};

export const getOpenAIService = (): OpenAIService => {
  if (!openaiService) {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('VITE_OPENAI_API_KEY no configurado');
    }
    openaiService = new OpenAIService(apiKey);
  }
  return openaiService;
};

export default OpenAIService;
