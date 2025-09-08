# 🤖 Nova Bot - Sistema Simplificado

![Bot Status](https://img.shields.io/badge/Status-Active-green)
![Version](https://img.shields.io/badge/Version-2.0.0-blue)
![Auth](https://img.shields.io/badge/Auth-Custom_Login-orange)
![AI](https://img.shields.io/badge/AI-OpenAI_GPT4-purple)

**Nova Bot** es un chatbot corporativo simplificado para Microsoft Teams que utiliza **autenticación personalizada** con API de Nova y **OpenAI GPT-4** para interacciones inteligentes.

## 📋 Tabla de Contenidos

- [🌟 Características](#-características)
- [🏗️ Arquitectura](#️-arquitectura)
- [🔄 Flujo Visual](#-flujo-visual)
- [⚙️ Instalación](#️-instalación)
- [🛠️ Configuración](#️-configuración)
- [🚀 Uso del Bot](#-uso-del-bot)
- [📁 Estructura del Proyecto](#-estructura-del-proyecto)
- [🌐 API Endpoints](#-api-endpoints)
- [🔧 Desarrollo](#-desarrollo)
- [❓ Troubleshooting](#-troubleshooting)
- [📊 Ejemplos](#-ejemplos)

## 🌟 Características

### ✅ **Funcionalidades Activas**
- 🔐 **Login Personalizado** - Tarjeta con usuario/contraseña
- 🤖 **Chat Inteligente** - Integración con OpenAI GPT-4 Turbo
- 🔑 **Gestión de Tokens** - Manejo seguro de tokens de Nova API
- 👤 **Información de Usuario** - Datos extraídos del token JWT
- 🚪 **Logout Simple** - Comando "logout" para cerrar sesión
- 💾 **Almacenamiento en Memoria** - Datos temporales sin persistencia
- 📱 **Compatible con Teams** - Optimizado para Microsoft Teams

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Microsoft     │    │   Nova Bot      │    │   Nova API      │
│     Teams       │◄──►│   (Node.js)     │◄──►│  Authentication │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   OpenAI API    │
                       │   (GPT-4 Turbo) │
                       └─────────────────┘
```

### **Componentes Principales:**

1. **TeamsBot** - Maneja mensajes y autenticación
2. **OpenAI Service** - Procesa conversaciones con IA
3. **Dialog Bot** - Base para manejo de estados
4. **Memory Storage** - Almacenamiento temporal

## 🔄 Flujo Visual

### **🔐 Flujo de Autenticación**

```
Usuario                    Nova Bot                    Nova API
  │                           │                           │
  │─── Inicia conversación ──►│                           │
  │                           │                           │
  │◄── Tarjeta de Login ──────│                           │
  │                           │                           │
  │─── Envía credenciales ───►│                           │
  │                           │──── POST /Auth/login ────►│
  │                           │                           │
  │                           │◄──── Token + Info ────────│
  │                           │                           │
  │◄─── Bienvenida + Token ───│                           │
  │                           │                           │
```

### **💬 Flujo de Conversación**

```
Usuario Autenticado        Nova Bot                OpenAI API
         │                     │                       │
         │──── Mensaje ───────►│                       │
         │                     │                       │
         │                     │─── Prompt + Context ─►│
         │                     │                       │
         │                     │◄─── Respuesta ────────│
         │                     │                       │
         │◄─── Respuesta ──────│                       │
         │                     │                       │
```

### **🚪 Flujo de Logout**

```
Usuario                    Nova Bot
  │                           │
  │───── "logout" ───────────►│
  │                           │
  │                           │ (Limpia memoria)
  │                           │ (Limpia estados)
  │                           │
  │◄── Sesión cerrada ────────│
  │                           │
  │◄── Nueva tarjeta login ───│
  │                           │
```

## ⚙️ Instalación

### **Prerequisitos**

- Node.js 16+ 
- npm o yarn
- Cuenta de OpenAI con API Key
- Bot Framework registration en Azure

### **Pasos de Instalación**

1. **Clonar el repositorio**
   ```bash
   git clone <repository-url>
   cd nova-bot
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**
   ```bash
   cp .env.example .env
   # Editar .env con tus credenciales
   ```

4. **Ejecutar el bot**
   ```bash
   npm start
   ```

## 🛠️ Configuración

### **Variables de Entorno**

Crea un archivo `.env` con la siguiente configuración:

```bash
# =============================================================================
# CONFIGURACIÓN REQUERIDA
# =============================================================================

# Bot Framework (obligatorio)
MicrosoftAppId=12345678-1234-1234-1234-123456789012
MicrosoftAppPassword=tu_password_secreto_del_bot

# OpenAI (obligatorio)
OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz

# =============================================================================
# CONFIGURACIÓN OPCIONAL
# =============================================================================

# Puerto del servidor (default: 3978)
PORT=3978

# Modo de desarrollo
NODE_ENV=development
```

### **Configuración en Azure**

1. **Crear Bot Service** en Azure Portal
2. **Configurar Messaging Endpoint**: `https://tu-dominio.com/api/messages`
3. **Obtener App ID y Password**
4. **Configurar canales** (Teams)

### **Configuración de OpenAI**

1. Obtener API Key de [OpenAI Platform](https://platform.openai.com)
2. Configurar límites de uso según necesidades
3. Verificar acceso a GPT-4 Turbo

## 🚀 Uso del Bot

### **1. Primer Contacto**

Cuando un usuario inicia conversación:

```
👋 Bienvenido a Nova Bot

Por favor, ingresa tus credenciales para continuar:

┌─────────────────────────────────────┐
│ 🔐 Iniciar Sesión                   │
├─────────────────────────────────────┤
│                                     │
│ Usuario:                            │
│ [________________]                  │
│                                     │
│ Contraseña:                         │
│ [****************]                  │
│                                     │
│ 🔒 Tus credenciales se envían       │
│    de forma segura                  │
│                                     │
│         [🚀 Iniciar Sesión]         │
└─────────────────────────────────────┘
```

### **2. Login Exitoso**

```
✅ ¡Bienvenido, Juan Pérez!

🎉 Login exitoso
👤 Usuario: 91004
🔑 Token: eyJhbGciOiJIUzI1NiIsInR5cCI...

💬 Ya puedes usar todas las funciones del bot.
```

### **3. Comandos Disponibles**

| Comando | Descripción | Ejemplo |
|---------|-------------|---------|
| `cualquier mensaje` | Chat con IA | "¿Cuál es mi información?" |
| `logout` | Cerrar sesión | "logout" |
| `obtener información` | Info del usuario | "muéstrame mi perfil" |

### **4. Ejemplos de Conversación**

```
Usuario: ¿Cuál es mi información?
Bot: 👤 Información del Usuario:
     
     👤 Nombre: Juan Pérez López
     📧 Usuario: 91004
     🔑 Token: eyJhbGciOiJIUzI1NiIs...

Usuario: ¿Qué puedes hacer?
Bot: Puedo ayudarte con:
     • Consultar tu información de usuario
     • Responder preguntas generales
     • Realizar consultas usando tu token
     • Chatear de forma inteligente
     
     ¿En qué te puedo ayudar hoy?
```

## 📁 Estructura del Proyecto

```
nova-bot/
├── 📁 bots/
│   ├── 📄 dialogBot.js          # Base para manejo de estados
│   ├── 📄 teamsBot.js           # ⭐ Bot principal con login
├── 📁 dialogs/
│   ├── 📄 mainDialog.js         # Diálogo principal (opcional)
│   └── 📄 logoutDialog.js       # Diálogo de logout (opcional)
├── 📁 services/
│   ├── 📄 openaiService.js      # ⭐ Servicio OpenAI simplificado
│   └── 📄 conversationService.js # Servicio de conversaciones
├── 📁 utilities/
│   ├── 📄 procesar_card.js      # Procesamiento de tarjetas
│   └── 📄 http_utils.js         # Utilidades HTTP
├── 📄 index.js                  # ⭐ Servidor principal
├── 📄 package.json              # Dependencias del proyecto
├── 📄 .env.example              # Ejemplo de configuración
├── 📄 .env                      # Configuración (no incluir en git)
└── 📄 README.md                 # Esta documentación
```

### **⭐ Archivos Principales**

- **`index.js`** - Configuración del servidor y adaptador
- **`teamsBot.js`** - Lógica principal del bot y autenticación
- **`openaiService.js`** - Integración con OpenAI GPT-4

## 🌐 API Endpoints

### **Bot Endpoints**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/messages` | POST | Recibe mensajes de Teams |
| `/health` | GET | Estado de salud del bot |
| `/diagnostic` | GET | Información de diagnóstico |

### **Endpoint de Salud**

```bash
GET /health
```

**Respuesta:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "bot": "Nova Bot Simplificado",
  "features": {
    "customLogin": true,
    "oauth": false,
    "azure": false,
    "openai": true
  }
}
```

### **Endpoint de Diagnóstico**

```bash
GET /diagnostic
```

**Respuesta:**
```json
{
  "bot": {
    "authenticatedUsers": 3,
    "activeProcesses": 1,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "memory": {
    "used": "45 MB",
    "total": "128 MB"
  },
  "uptime": "3600 segundos",
  "environment": {
    "hasOpenAI": true,
    "hasBotId": true,
    "nodeVersion": "v18.17.0"
  }
}
```

### **API Externa - Nova Authentication**

```bash
POST https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login
Content-Type: application/json

{
  "cveUsuario": "91004",
  "password": "Pruebas"
}
```

**Respuesta Exitosa:**
```json
{
  "info": [
    {
      "EsValido": 0,
      "Mensaje": "Bienvenido",
      "Nombre": "Juan Pérez",
      "Paterno": "López",
      "Materno": "García",
      "CveUsuario": "91004",
      "FechaUltAcceso": null,
      "HoraUltAcceso": null,
      "Token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  ]
}
```

## 🔧 Desarrollo

### **Scripts Disponibles**

```bash
# Iniciar en desarrollo
npm run dev

# Iniciar en producción
npm start

# Verificar sintaxis
npm run lint

# Ejecutar tests
npm test

# Ver logs en tiempo real
npm run logs
```

### **Estructura de Logs**

```
[2024-01-15 10:30:00] [91004] Mensaje recibido: "hola"
[2024-01-15 10:30:01] [91004] Usuario autenticado: Juan Pérez
[2024-01-15 10:30:02] 🤖 Enviando request a OpenAI...
[2024-01-15 10:30:03] ✅ Respuesta de OpenAI recibida
```

### **Agregar Nuevas Funciones**

Para agregar nuevas herramientas en `openaiService.js`:

```javascript
// En defineTools()
{
    type: "function",
    function: {
        name: "nueva_funcion",
        description: "Descripción de la función",
        parameters: {
            type: "object",
            properties: {
                parametro: {
                    type: "string",
                    description: "Descripción del parámetro"
                }
            },
            required: ["parametro"]
        }
    }
}

// En ejecutarHerramienta()
case 'nueva_funcion':
    return await this.nuevaFuncion(parametros.parametro);
```

## ❓ Troubleshooting

### **Problemas Comunes**

#### **🔴 Bot no responde**

**Síntomas:** El bot no responde a mensajes
**Soluciones:**
```bash
# Verificar configuración
curl http://localhost:3978/health

# Revisar logs
npm run logs

# Verificar variables de entorno
echo $OPENAI_API_KEY
```

#### **🔴 Error de autenticación**

**Síntomas:** "Error del servidor" al hacer login
**Soluciones:**
1. Verificar conectividad a Nova API
2. Validar credenciales de prueba
3. Revisar logs del servidor

```bash
# Test manual de la API
curl -X POST https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login \
  -H "Content-Type: application/json" \
  -d '{"cveUsuario":"91004","password":"Pruebas"}'
```

#### **🔴 OpenAI no funciona**

**Síntomas:** "Servicio OpenAI no disponible"
**Soluciones:**
1. Verificar API Key válida
2. Comprobar cuota de OpenAI
3. Revisar conexión a internet

```bash
# Test manual de OpenAI
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### **Logs de Debugging**

**Habilitar logs detallados:**
```bash
NODE_ENV=development npm start
```

**Ubicación de logs:**
- Consola del servidor
- Azure Application Insights (si configurado)

### **Reinicio de Emergencia**

```bash
# Limpiar todo y reiniciar
npm run clean
npm install
npm start

# Verificar estado
curl http://localhost:3978/diagnostic
```

## 📊 Ejemplos

### **Ejemplo 1: Login Completo**

```
Usuario: (inicia conversación)

Bot: 👋 Bienvenido a Nova Bot
     [Muestra tarjeta de login]

Usuario: [Completa: usuario="91004", password="Pruebas"]

Bot: ✅ ¡Bienvenido, Juan Pérez!
     🎉 Login exitoso
     👤 Usuario: 91004
     🔑 Token: eyJhbGci...
     💬 Ya puedes usar todas las funciones del bot.
```

### **Ejemplo 2: Consulta de Información**

```
Usuario: "¿cuál es mi información completa?"

Bot: 📊 Información del Usuario:
     
     👤 Nombre: Juan Pérez López
     📧 Usuario: 91004
     🏢 Apellido Paterno: López
     🏢 Apellido Materno: García
     🔑 Token: eyJhbGci... (activo)
     
     ¿Necesitas algo más?
```

### **Ejemplo 3: Chat Inteligente**

```
Usuario: "explícame qué es un JWT token"

Bot: 🔐 Un JWT (JSON Web Token) es un estándar para transmitir 
     información de manera segura entre partes.
     
     **Características:**
     • Contiene 3 partes: header.payload.signature
     • Se puede verificar y confiar
     • Es compacto y autocontenido
     
     **Tu token actual contiene:**
     • Tu usuario (91004)
     • Información de sesión
     • Fecha de expiración
     
     ¿Te gustaría saber algo específico sobre tokens?
```

### **Ejemplo 4: Logout**

```
Usuario: "logout"

Bot: ✅ Sesión cerrada exitosamente
     
     Hasta luego. Para volver a usar el bot, 
     necesitarás autenticarte nuevamente.
     
     [Muestra nueva tarjeta de login]
```

---

## 📞 Soporte

### **Información del Proyecto**
- **Versión:** 2.0.0 (Simplificada)
- **Autor:** Equipo de Desarrollo
- **Tecnologías:** Node.js, Bot Framework, OpenAI, Teams

### **Recursos Útiles**
- [Bot Framework Documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Microsoft Teams Platform](https://docs.microsoft.com/en-us/microsoftteams/platform/)

### **Contacto**
Para soporte técnico o reportar bugs, contacta al equipo de desarrollo.

---

**🚀 Nova Bot - Versión 2.0.0 Simplificada**
*Sistema de autenticación personalizado con OpenAI GPT-4*