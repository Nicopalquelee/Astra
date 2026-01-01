# ASTRA - Configuración e Integración

## 1. Configurar API Key de OpenAI

En el archivo `src/App.tsx`, línea 57, reemplaza:

```typescript
const API_KEY = 'TU_API_KEY_DE_OPENAI_AQUI';
```

Por tu API key real de OpenAI:

```typescript
const API_KEY = 'sk-...tu-key-aquí';
```

**Importante:** Para producción, usa variables de entorno en lugar de hardcodear la key.

## 2. Integrar con Dispositivos Domóticos

### Luces (Línea 75 en App.tsx)

```typescript
// Cuando detectes comandos de luces, haz una llamada a tu API:
const controlLights = async (room: string, action: 'on' | 'off') => {
  await fetch('https://tu-casa.com/api/lights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, action })
  });
};
```

### Temperatura (Línea 76)

```typescript
const setClimate = async (temperature: number, mode: string) => {
  await fetch('https://tu-casa.com/api/climate', {
    method: 'POST',
    body: JSON.stringify({ temperature, mode })
  });
};
```

### Seguridad (Línea 77)

```typescript
const controlSecurity = async (action: 'lock' | 'unlock' | 'status') => {
  const response = await fetch('https://tu-casa.com/api/security', {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  return await response.json();
};
```

### Sensores (Línea 78)

```typescript
const getSensorData = async () => {
  const response = await fetch('https://tu-casa.com/api/sensors');
  return await response.json(); // { consumo, temperatura, movimiento }
};
```

### Electrodomésticos (Línea 79)

```typescript
const controlAppliance = async (device: string, action: 'on' | 'off') => {
  await fetch('https://tu-casa.com/api/appliances', {
    method: 'POST',
    body: JSON.stringify({ device, action })
  });
};
```

## 3. Modificar el Prompt de Astra

En la función `processAstraRequest` (línea 56-98), puedes personalizar cómo Astra responde modificando el contenido del system message.

## 4. Comandos de Voz Recomendados

- "Enciende las luces del living"
- "Apaga las luces del dormitorio"
- "Sube la temperatura a 22 grados"
- "Muéstrame el consumo eléctrico"
- "Activa la alarma"
- "¿Está todo cerrado?"
- "Enciende el aire acondicionado"

## 5. Tecnologías Usadas

- **Web Speech API**: Reconocimiento de voz (Chrome, Edge, Safari)
- **Speech Synthesis API**: Respuestas por voz
- **OpenAI GPT-4**: Procesamiento de lenguaje natural
- **React + TypeScript**: Framework frontend
- **Tailwind CSS**: Estilos

## 6. Próximos Pasos

1. Conectar con Supabase para guardar historial de comandos
2. Implementar autenticación de usuarios
3. Crear dashboard con estadísticas
4. Agregar control por habitaciones
5. Implementar escenas automatizadas
