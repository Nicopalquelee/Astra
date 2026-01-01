// hooks/useSensorData.ts
// Hook personalizado para lectura de sensores

import { useState, useEffect } from 'react';

export interface SensorData {
  temperature: number;
  humidity: number;
  co2: number;
  lightLevel: number;
  doorOpen: boolean;
  windowOpen: boolean;
  motionDetected: boolean;
  energyUsage: number;
  waterUsage: number;
  gasSensor: number;
  smokeSensor: boolean;
}

type SensorSource = 'local' | 'api' | 'websocket' | 'mqtt';

const DEFAULT_SENSORS: SensorData = {
  temperature: 22.5,
  humidity: 55,
  co2: 410,
  lightLevel: 650,
  doorOpen: false,
  windowOpen: false,
  motionDetected: false,
  energyUsage: 2.5,
  waterUsage: 0.8,
  gasSensor: 50,
  smokeSensor: false,
};

// ============= OPCIÓN 1: SIMULACIÓN LOCAL =============
const useLocalSensors = () => {
  const [sensors, setSensors] = useState<SensorData>(DEFAULT_SENSORS);

  useEffect(() => {
    const interval = setInterval(() => {
      setSensors(prev => ({
        ...prev,
        temperature: 20 + Math.random() * 5,
        humidity: 40 + Math.random() * 30,
        co2: 400 + Math.random() * 100,
        lightLevel: Math.floor(300 + Math.random() * 500),
        motionDetected: Math.random() > 0.8,
        energyUsage: 1 + Math.random() * 4,
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return sensors;
};

// ============= OPCIÓN 2: API REST =============
const useAPISensors = (apiUrl: string, token: string) => {
  const [sensors, setSensors] = useState<SensorData>(DEFAULT_SENSORS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSensors = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${apiUrl}/sensors`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setSensors(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching sensors');
        console.error('Error fetching sensors:', err);
      } finally {
        setLoading(false);
      }
    };

    // Fetch inicial
    fetchSensors();

    // Polling cada 5 segundos
    const interval = setInterval(fetchSensors, 5000);

    return () => clearInterval(interval);
  }, [apiUrl, token]);

  return { sensors, loading, error };
};

// ============= OPCIÓN 3: WEBSOCKET =============
const useWebSocketSensors = (wsUrl: string) => {
  const [sensors, setSensors] = useState<SensorData>(DEFAULT_SENSORS);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ WebSocket conectado');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setSensors(prev => ({ ...prev, ...data }));
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };

    ws.onclose = () => {
      console.log('❌ WebSocket desconectado');
      setConnected(false);
    };

    return () => ws.close();
  }, [wsUrl]);

  return { sensors, connected };
};

// ============= OPCIÓN 4: MQTT =============
const useMQTTSensors = (brokerUrl: string, topics: string[]) => {
  const [sensors, setSensors] = useState<SensorData>(DEFAULT_SENSORS);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Requiere: npm install mqtt
    import('mqtt').then(({ connect }) => {
      const client = connect(brokerUrl);

      client.on('connect', () => {
        console.log('✅ MQTT conectado');
        setConnected(true);
        topics.forEach(topic => client.subscribe(topic));
      });

      client.on('message', (topic, message) => {
        try {
          const value = JSON.parse(message.toString());
          const sensorType = topic.split('/').pop();

          if (sensorType) {
            setSensors(prev => ({
              ...prev,
              [sensorType]: value,
            }));
          }
        } catch (err) {
          console.error('Error parsing MQTT message:', err);
        }
      });

      client.on('error', (error) => {
        console.error('MQTT error:', error);
        setConnected(false);
      });

      client.on('offline', () => {
        console.log('❌ MQTT desconectado');
        setConnected(false);
      });

      return () => {
        client.end();
      };
    });
  }, [brokerUrl, topics]);

  return { sensors, connected };
};

// ============= HOOK PRINCIPAL =============
export const useSensorData = (source: SensorSource = 'local', config?: any) => {
  switch (source) {
    case 'api':
      return useAPISensors(config.apiUrl, config.token);
    case 'websocket':
      return useWebSocketSensors(config.wsUrl);
    case 'mqtt':
      return useMQTTSensors(config.brokerUrl, config.topics);
    case 'local':
    default:
      return { sensors: useLocalSensors(), loading: false, error: null, connected: true };
  }
};

// ============= UTILIDADES =============

/**
 * Detecta anomalías en sensores
 */
export const detectAnomalies = (sensors: SensorData): string[] => {
  const anomalies: string[] = [];

  if (sensors.temperature > 28) {
    anomalies.push(`⚠️ Temperatura alta: ${sensors.temperature.toFixed(1)}°C`);
  }
  if (sensors.temperature < 16) {
    anomalies.push(`❄️ Temperatura baja: ${sensors.temperature.toFixed(1)}°C`);
  }
  if (sensors.humidity > 70) {
    anomalies.push(`💧 Humedad alta: ${sensors.humidity.toFixed(0)}%`);
  }
  if (sensors.humidity < 30) {
    anomalies.push(`🌵 Humedad baja: ${sensors.humidity.toFixed(0)}%`);
  }
  if (sensors.co2 > 1000) {
    anomalies.push(`🌫️ CO₂ crítico: ${sensors.co2.toFixed(0)} ppm`);
  }
  if (sensors.smokeSensor) {
    anomalies.push(`🔥 ALERTA: Humo detectado`);
  }
  if (sensors.gasSensor > 100) {
    anomalies.push(`⚠️ Gas detectado: ${sensors.gasSensor} ppm`);
  }

  return anomalies;
};

/**
 * Obtiene recomendaciones basadas en sensores
 */
export const getSensorRecommendations = (sensors: SensorData): string[] => {
  const recs: string[] = [];

  if (sensors.temperature > 26 && sensors.humidity > 60) {
    recs.push('Sugiero activar aire acondicionado');
  }
  if (sensors.co2 > 800) {
    recs.push('Es recomendable ventilar la casa');
  }
  if (sensors.energyUsage > 3) {
    recs.push('Consumo energético elevado detectado');
  }
  if (sensors.doorOpen || sensors.windowOpen) {
    recs.push('Hay puertas o ventanas abiertas');
  }
  if (sensors.motionDetected && sensors.lightLevel < 300) {
    recs.push('Hay movimiento con poca luz, ¿enciendo las luces?');
  }

  return recs;
};

/**
 * Formatea datos de sensores para mostrar
 */
export const formatSensorData = (sensors: SensorData): Record<string, string> => {
  return {
    temperatura: `${sensors.temperature.toFixed(1)}°C`,
    humedad: `${sensors.humidity.toFixed(0)}%`,
    co2: `${sensors.co2.toFixed(0)} ppm`,
    luz: `${sensors.lightLevel} lux`,
    puerta: sensors.doorOpen ? 'Abierta' : 'Cerrada',
    ventana: sensors.windowOpen ? 'Abierta' : 'Cerrada',
    movimiento: sensors.motionDetected ? 'Detectado' : 'No hay',
    energía: `${sensors.energyUsage.toFixed(1)} kW`,
    agua: `${sensors.waterUsage.toFixed(1)} L/h`,
  };
};
