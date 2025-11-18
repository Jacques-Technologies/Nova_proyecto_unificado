# 🤖 Nova Bot - Sistema de Chatbot Corporativo

![Bot Status](https://img.shields.io/badge/Status-Active-green)
![Version](https://img.shields.io/badge/Version-4.0.0-blue)
![Auth](https://img.shields.io/badge/Auth-Custom_Login-orange)
![AI](https://img.shields.io/badge/AI-OpenAI_GPT4-purple)
![Platform](https://img.shields.io/badge/Platform-Teams_&_WebChat-blue)

**Nova Bot** es un sistema de chatbot corporativo inteligente diseñado para Microsoft Teams y WebChat. Integra autenticación personalizada con la API de Nova y utiliza OpenAI GPT-4 con herramientas especializadas para proporcionar asistencia contextual y profesional.

## 📋 Tabla de Contenidos

- [🌟 Características](#-características)
- [🏗️ Arquitectura](#️-arquitectura)
- [⚙️ Instalación](#️-instalación)
- [🛠️ Configuración](#️-configuración)
- [🚀 Uso del Bot](#-uso-del-bot)
- [📁 Estructura del Proyecto](#-estructura-del-proyecto)
- [🌐 API Endpoints](#-api-endpoints)
- [🔧 Desarrollo](#-desarrollo)
- [❓ Troubleshooting](#-troubleshooting)

---

## 🌟 Características

### **Funcionalidades Principales**

- 🔐 **Autenticación Personalizada** - Sistema de login con usuario/contraseña integrado con API Nova
- 💾 **Persistencia en Azure Cosmos DB** - Almacenamiento confiable de sesiones e historial (TTL automático)
- 🤖 **IA Conversacional** - OpenAI GPT-4 con contexto completo de conversación
- 🛠️ **Herramientas Especializadas**:
  - Búsqueda en documentos (Azure Cognitive Search)
  - Consulta de saldos de cuentas
  - Consulta de tasas de interés
  - Información del perfil del usuario
  - Obtención de fecha/hora actual
  - Simulador de ahorros (redirige a portal web)
- 🔒 **Sistema Anti-Simulación** - Previene cálculos manuales, redirige a herramientas oficiales
- 💡 **Clarificación Inteligente** - Detecta intenciones ambiguas y solicita aclaración
- 📊 **Métricas a Bubble.io** - Envío automático de estadísticas de uso (canal, herramientas usadas)
- 📱 **Multi-Plataforma** - Soporte para Microsoft Teams y WebChat
- 🔄 **Multi-Bot** - Configuración para múltiples bots simultáneos
- ⚡ **Stateless** - Arquitectura sin estado en memoria, 100% escalable

---

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Microsoft     │    │    Nova Bot      │    │   Nova API      │
│     Teams       │◄──►│    (Node.js)     │◄──►│  Authentication │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                               │
                               ├──────────────────┐
                               │                  │
                               ▼                  ▼
                   ┌──────────────────┐  ┌──────────────────┐
                   │   OpenAI API     │  │  Azure Cosmos DB │
                   │   (GPT-4)        │  │  (Persistencia)  │
                   └──────────────────┘  └──────────────────┘
                               │
                               ▼
                   ┌──────────────────┐
                   │  Azure Search    │
                   │  (Documentos)    │
                   └──────────────────┘
```

### **Componentes Clave**

1. **TeamsBot** - Bot principal con autenticación y lógica conversacional (305 líneas)
2. **OpenAI Service** - Integración con GPT-4 y coordinación de herramientas
3. **Tools Service** - 6 herramientas especializadas para consultas
4. **Auth Service** - Gestión de autenticación y sesiones
5. **Cosmos Service** - Persistencia de sesiones y mensajes
6. **Document Service** - Búsqueda vectorial en documentos
7. **WebChat Controller** - API REST para interfaz web

---

## ⚙️ Instalación

### **Prerequisitos**

- Node.js 18+
- npm 9+
- Cuenta de OpenAI con acceso a GPT-4
- Azure Bot Framework registration
- Azure Cosmos DB account
- Azure Cognitive Search (opcional, para búsqueda de documentos)

### **Pasos de Instalación**

1. **Clonar el repositorio**

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
   # Desarrollo
   npm run dev

   # Producción
   npm start
   ```

---

## 🛠️ Configuración

### **Variables de Entorno Requeridas**

Crea un archivo `.env` en la raíz del proyecto:

```bash
# =============================================================================
# BOT FRAMEWORK - OBLIGATORIO
# =============================================================================
MicrosoftAppId=tu-app-id-aqui
MicrosoftAppPassword=tu-app-password-aqui
MicrosoftAppType=SingleTenant
MicrosoftAppTenantId=tu-tenant-id-aqui

# =============================================================================
# OPENAI - OBLIGATORIO
# =============================================================================
OPENAI_API_KEY=sk-tu-api-key-aqui
OPENAI_ENDPOINT=https://tu-endpoint.openai.azure.com

# =============================================================================
# AZURE COSMOS DB - OBLIGATORIO
# =============================================================================
COSMOS_DB_ENDPOINT=https://tu-cuenta.documents.azure.com:443/
COSMOS_DB_KEY=tu-cosmos-key-aqui
COSMOS_DB_DATABASE_ID=NovaBot
COSMOS_DB_CONTAINER_ID=conversations

# =============================================================================
# AZURE COGNITIVE SEARCH - OPCIONAL
# =============================================================================
AZURE_SEARCH_ENDPOINT=https://tu-servicio.search.windows.net
AZURE_SEARCH_API_KEY=tu-search-key-aqui
AZURE_SEARCH_INDEX_NAME=nova-documents

# =============================================================================
# BUBBLE.IO MÉTRICAS - OPCIONAL
# =============================================================================
BUBBLE_METRICS_URL=https://nova-79590.bubbleapps.io/api/1.1/wf/recepcion-respuesta
BUBBLE_API_KEY=11a0084bcc81e005a839a015b24b6e39

# =============================================================================
# CONFIGURACIÓN DEL SERVIDOR
# =============================================================================
PORT=3978
NODE_ENV=production

# =============================================================================
# MULTI-BOT (OPCIONAL) - Para bots adicionales
# =============================================================================
MicrosoftAppId_Bot2=tu-app-id-bot2
MicrosoftAppPassword_Bot2=tu-app-password-bot2

MicrosoftAppId_Bot3=tu-app-id-bot3
MicrosoftAppPassword_Bot3=tu-app-password-bot3
```

### **Configuración de Azure Cosmos DB**

El bot utiliza **partition key `/user_id`** con TTL automático:

- **Sesiones (type: user)**: TTL de 60 minutos
- **Mensajes (type: message)**: TTL de 24 horas

**No requiere configuración manual** - El bot crea contenedores automáticamente.

---

## 🚀 Uso del Bot

### **1. Login (Teams)**

Cuando un usuario inicia conversación en Teams:

```
👋 ¡Hola! Soy NovaBot, tu asistente virtual.

Para comenzar, necesito que inicies sesión.

┌─────────────────────────────────────┐
│ 🔐 Iniciar Sesión en Nova          │
├─────────────────────────────────────┤
│                                     │
│ 👤 Usuario:                         │
│ [________________]                  │
│                                     │
│ 🔒 Contraseña:                      │
│ [****************]                  │
│                                     │
│         [🚀 Iniciar Sesión]         │
└─────────────────────────────────────┘
```

### **2. Conversación Natural**

Una vez autenticado, el usuario puede hacer preguntas naturales:

```
Usuario: ¿Cuál es mi saldo?

Bot: Consultando tu saldo actual...

     💰 Saldo de Cuentas:
     • Cuenta CLABE *1234: $15,432.50 MXN
     • Cuenta CLABE *5678: $8,901.25 MXN

     Total: $24,333.75 MXN

Usuario: ¿Qué tasas de interés tienen para el 2025?

Bot: 📊 Tasas de Interés - 2025:

     • Enero: 4.25%
     • Febrero: 4.30%
     • Marzo: 4.35%
     ...
```

### **3. Comandos Disponibles**

| Acción | Ejemplo |
|--------|---------|
| Consultar saldo | "¿cuál es mi saldo?" |
| Ver tasas | "tasas de interés del 2025" |
| Buscar información | "busca documentos sobre inversiones" |
| Ver perfil | "muéstrame mi información" |
| Simular ahorro | "quiero simular un ahorro" |
| Cerrar sesión | "logout" o "cerrar sesión" |

### **4. WebChat API**

Para integraciones web, el bot expone una API REST:

```javascript
// Inicializar chat
POST /api/webchat/init
Body: {
  "token": "<token>",
  "perfil": "<perfil>" // opcional (case-insensitive: perfil, Perfil, PERFIL)
}

// Enviar mensaje
POST /api/webchat/ask
Body: {
  "token": "<token>",
  "content": "¿Cuál es mi saldo?",
  "perfil": "<perfil>",        // opcional (case-insensitive: perfil, Perfil)
  "CveUsuario": "<usuario>",   // importante (case-insensitive: CveUsuario, cveUsuario)
  "NumRI": "<numRI>"           // opcional (case-insensitive: NumRI, numRi, numri)
}

// Obtener historial
GET /api/webchat/history?token=<token>

// Limpiar historial
POST /api/webchat/clear
Body: { "token": "<token>" }
```

---

## 📁 Estructura del Proyecto

```
nova-bot/
├── 📁 bots/
│   ├── 📄 dialogBot.js          # Clase base para manejo de actividades
│   └── 📄 teamsBot.js           # ⭐ Bot principal (305 líneas)
├── 📁 cards/
│   └── 📄 loginCard.js          # Adaptive Card de login
├── 📁 services/
│   ├── 📄 authService.js        # ⭐ Autenticación y sesiones
│   ├── 📄 cosmosService.js      # ⭐ Persistencia en Cosmos DB
│   ├── 📄 openaiService.js      # ⭐ Integración con GPT-4
│   ├── 📄 toolsService.js       # ⭐ 6 herramientas especializadas
│   └── 📄 documentService.js    # Búsqueda vectorial
├── 📁 controllers/
│   └── 📄 webchatController.js  # API REST para WebChat
├── 📁 routes/
│   └── 📄 webchatRoute.js       # Rutas de WebChat
├── 📁 backend/
│   ├── 📁 routes/               # Procesamiento de PDF y Word
│   ├── 📁 services/             # Servicios backend
│   └── 📁 controllers/          # Configuración
├── 📄 index.js                  # ⭐ Servidor principal multi-bot
├── �� package.json              # Dependencias (14 deps principales)
├── 📄 .env.example              # Ejemplo de configuración
├── 📄 CLAUDE.md                 # Documentación técnica detallada
└── 📄 README.md                 # Esta documentación
```

### **Archivos Clave (⭐)**

- **`index.js`** (362L) - Servidor Express con soporte multi-bot
- **`teamsBot.js`** (305L) - Lógica principal: login, logout, conversación
- **`openaiService.js`** (346L) - Coordinación GPT-4 + herramientas
- **`toolsService.js`** (435L) - 6 herramientas de consulta
- **`cosmosService.js`** (15KB) - Persistencia con partition key `/user_id`
- **`authService.js`** (8.5KB) - Gestión de autenticación

---

## 🌐 API Endpoints

### **Bot Endpoints (Teams)**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/messages` | POST | Bot principal |
| `/api/messages/bot` | POST | Bot 2 (opcional) |
| `/api/messages/bot2` | POST | Bot 3 (opcional) |

### **WebChat Endpoints**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/webchat/init` | GET/POST | Inicializar chat |
| `/api/webchat/ask` | POST | Enviar mensaje |
| `/api/webchat/history` | GET | Obtener historial |
| `/api/webchat/clear` | POST | Limpiar historial |
| `/api/webchat/status` | GET | Estado de servicios |

### **Información y Salud**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/health` | GET | Estado del servidor |
| `/api/bots` | GET | Info de todos los bots |
| `/api/bots/:botId` | GET | Info de un bot específico |
| `/api/cors-test` | GET | Verificar CORS |

### **Procesamiento de Documentos**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/sendPdf` | POST | Procesar y almacenar PDF |
| `/api/sendWord` | POST | Procesar y almacenar Word (.doc/.docx) |

```

### **Agregar Nuevas Herramientas**

Para agregar una nueva herramienta al bot, edita `services/toolsService.js`:

```javascript
// 1. Definir la herramienta
getToolDefinitions() {
    return [
        // ... herramientas existentes
        {
            type: 'function',
            function: {
                name: 'mi_nueva_herramienta',
                description: 'Descripción clara de qué hace',
                parameters: {
                    type: 'object',
                    properties: {
                        parametro: {
                            type: 'string',
                            description: 'Descripción del parámetro'
                        }
                    },
                    required: ['parametro']
                }
            }
        }
    ];
}

// 2. Implementar la función
async miNuevaHerramienta(parametro, context) {
    try {
        // Tu lógica aquí
        const resultado = await tuAPI(parametro, context.userToken);

        return {
            resultado: resultado,
            mensaje: "Operación exitosa"
        };
    } catch (error) {
        return { error: error.message };
    }
}

// 3. Agregar al switch en executeTool()
async executeTool(toolName, params, context) {
    switch(toolName) {
        // ... casos existentes
        case 'mi_nueva_herramienta':
            return await this.miNuevaHerramienta(params.parametro, context);
        default:
            throw new Error(`Herramienta desconocida: ${toolName}`);
    }
}
```

---

## ❓ Troubleshooting

### **Problema: Bot no responde en Teams**

**Síntomas:** El bot aparece online pero no responde a mensajes

**Solución:**
```bash
# 1. Verificar que el servidor está corriendo
curl http://localhost:3978/health

# 2. Revisar logs del servidor
npm run dev

# 3. Verificar configuración de Bot Framework
# Asegúrate que MicrosoftAppId y MicrosoftAppPassword sean correctos

# 4. Verificar endpoint en Azure
# Messaging endpoint debe apuntar a: https://tu-dominio.com/api/messages
```

### **Problema: Error de autenticación**

**Síntomas:** "Error al autenticar" o "Credenciales inválidas"

**Solución:**
```bash
# 1. Verificar conectividad a API Nova
curl -X POST https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login \
  -H "Content-Type: application/json" \
  -d '{"cveUsuario":"usuario","password":"password"}'

# 2. Verificar que Cosmos DB está disponible
# Revisa COSMOS_DB_ENDPOINT y COSMOS_DB_KEY en .env

# 3. Revisar logs de autenticación
# Busca líneas con "🔐" en la consola
```

### **Problema: OpenAI no responde**

**Síntomas:** "Error procesando con IA" o timeout

**Solución:**
```bash
# 1. Verificar API Key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 2. Verificar cuota de OpenAI
# https://platform.openai.com/account/usage

# 3. Verificar endpoint de Azure OpenAI (si aplica)
# OPENAI_ENDPOINT debe incluir https:// y el dominio completo
```

### **Problema: Cosmos DB no guarda mensajes**

**Síntomas:** Historial se pierde al reiniciar o no se guarda

**Solución:**
```bash
# 1. Verificar configuración de Cosmos DB
echo $COSMOS_DB_ENDPOINT
echo $COSMOS_DB_DATABASE_ID
echo $COSMOS_DB_CONTAINER_ID

# 2. Verificar que el contenedor existe
# Portal Azure → Cosmos DB → Data Explorer

# 3. Verificar partition key
# Debe ser: /user_id

# 4. Revisar logs
# Busca líneas con "💾" en la consola
```

---

## 📞 Información del Proyecto

**Versión:** 4.0.0
**Plataforma:** Node.js 18+
**Licencia:** ISC

### **Tecnologías Utilizadas**

- **Backend:** Node.js + Express
- **Bot Framework:** Microsoft Bot Builder SDK
- **IA:** OpenAI GPT-4.1-mini
- **Persistencia:** Azure Cosmos DB
- **Búsqueda:** Azure Cognitive Search
- **Embeddings:** text-embedding-3-large (1024 dimensiones)

### **Recursos Útiles**

- [Bot Framework Documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Azure Cosmos DB Documentation](https://docs.microsoft.com/en-us/azure/cosmos-db/)
- [Microsoft Teams Platform](https://docs.microsoft.com/en-us/microsoftteams/platform/)

### **Documentación Técnica**

Para documentación técnica detallada sobre la arquitectura interna, patrones de diseño y guías de desarrollo, consulta [CLAUDE.md](CLAUDE.md).

---

**🚀 Nova Bot - Sistema de Chatbot Corporativo**
*Impulsado por OpenAI GPT-4 y Azure Cloud Services*
