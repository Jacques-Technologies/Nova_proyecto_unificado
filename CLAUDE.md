# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🤖 Project Overview

**Nova Bot v4.0** - Sistema de chatbot corporativo multi-bot para Microsoft Teams y WebChat con arquitectura ultra-simplificada, integración con OpenAI GPT-4, y persistencia 100% en Azure Cosmos DB.

**Versión:** 4.0.0-CleanArchitecture (Última actualización: 2025-10-14)

**Tecnologías principales:**
- Node.js (ES Modules)
- Bot Framework SDK (CloudAdapter)
- OpenAI GPT-4.1-mini + embeddings
- Azure Cosmos DB (**partition key: `/user_id`**)
- Azure Cognitive Search (búsqueda vectorial + textual)

**Mejoras v4.0:**
- ✅ **64% menos código total** (2,500L → 900L)
- ✅ **TeamsBot: 305 líneas** (vs 1,300L en v3.0)
- ✅ **Sin cache local** (100% Cosmos DB)
- ✅ **Sin comandos directos** (todo conversacional con IA)
- ✅ **Código ultra-limpio** y mantenible
- ✅ **Stateless puro** (escala horizontalmente sin límites)

**Evolución del proyecto:**
- v2.0: 2,500 líneas (arquitectura original)
- v3.0: 1,700 líneas (32% reducción, stateless)
- v3.1: 1,200 líneas (52% reducción, ToolsService separado)
- **v4.0: 900 líneas** (64% reducción, arquitectura limpia)

## 🚀 Comandos Esenciales

```bash
# Desarrollo
npm run dev          # Servidor con nodemon (hot reload)
npm start           # Producción

# Testing
npm test            # Ejecutar tests (si existen)
```

## 🏗️ Arquitectura del Sistema v4.0

### Filosofía Clean Architecture
```
- Minimalista: Solo lo esencial
- Funcional: Sin estado en memoria
- Conversacional: Todo mensaje → IA (sin comandos especiales)
- Stateless: 100% Cosmos DB
```

### Flujo de Componentes

```
Usuario (Teams/WebChat) → index.js (CloudAdapter) → TeamsBot v4.0
                                                      ├→ Auth Service v3
                                                      │  └→ Solo Cosmos DB
                                                      ├→ Cosmos Service v3
                                                      │  ├→ user (sesión, TTL 60min)
                                                      │  └→ message (chat, TTL 24h)
                                                      ├→ OpenAI Service v3.1
                                                      │  ├→ GPT-4.1-mini (chat)
                                                      │  ├→ text-embedding-3-large
                                                      │  └→ Coordina → Tools Service
                                                      └→ Tools Service v3.1
                                                         ├→ 5 herramientas
                                                         ├→ Formateo de resultados
                                                         └→ Llamadas API Nova
```

### Sistema Multi-Bot

El servidor en `index.js` puede ejecutar **hasta 3 bots simultáneos**:
- Bot 1: `/api/messages` (principal)
- Bot 2: `/api/messages/bot`
- Bot 3: `/api/messages/bot2`

Cada bot tiene su propio:
- `MicrosoftAppId` y `MicrosoftAppPassword`
- CloudAdapter independiente
- ConversationState + UserState

**Configuración:** Variables de entorno `MicrosoftAppId_Bot2`, `MicrosoftAppPassword_Bot2`, etc.

---

## 📂 Responsabilidades por Archivo

### **bots/teamsBot.js (305L)** - Bot Principal v4.0

**FILOSOFÍA**: Código ultra-limpio, sin cache local, sin comandos especiales.

**Estructura:**
```javascript
// ==========================================
// EVENTOS (20L)
// ==========================================
handleMembersAdded()        // Bienvenida + login card

// ==========================================
// FLUJO PRINCIPAL (40L)
// ==========================================
handleMessage()             // Router: login/logout/IA
processWithAI()            // Procesar con OpenAI

// ==========================================
// LOGIN/LOGOUT (130L)
// ==========================================
handleLoginCommands()       // Router de login
showLoginCard()            // Mostrar tarjeta
loginWithText()            // Login: usuario:password
loginWithCard()            // Login: adaptive card
authenticate()             // Autenticación común
logout()                   // Cerrar sesión
showAccessDenied()         // Acceso denegado

// ==========================================
// UTILIDADES (25L)
// ==========================================
saveMessage()              // Guardar en Cosmos
isLogout()                 // Verificar comando logout
getStats()                 // Estadísticas
cleanup()                  // Limpieza
```

**Características clave:**
- ✅ **Sin cache local**: TODO en Cosmos DB
- ✅ **Sin comandos especiales**: Solo `login` y `logout`
- ✅ **Todo mensaje → IA**: Experiencia conversacional natural
- ✅ **user_id**: Usa `context.activity.from.id` (Teams ID: "29:xxx...")
- ✅ **Stateless**: Reinicio sin pérdida de datos

**Flujo de autenticación:**
```javascript
// 1. Usuario escribe "login usuario:password"
handleMessage() → handleLoginCommands() → loginWithText()
    → authenticate() → auth.authenticateWithNova()
    → auth.setUserAuthenticated(userId, userInfo)  // userId = "29:xxx..."
    → cosmos.createUserSession(userId, userInfo)
```

**Flujo de mensaje con IA:**
```javascript
// 2. Usuario autenticado envía mensaje
handleMessage() → processWithAI()
    → auth.getUserInfo(userId)                    // Obtiene userInfo
    → cosmos.saveMessage(userId, 'user', text)    // Guarda mensaje
    → ai.procesarMensaje(..., userId)             // Procesa con IA
        → openaiService.prepararMensajes(userId)  // Carga historial desde Cosmos
        → cosmos.getLastMessages(userId, 20)      // Query con partition key
    → cosmos.saveMessage(userId, 'assistant', ...) // Guarda respuesta
    → context.sendActivity(response.content)       // Envía al usuario
```

**Comandos disponibles:**
- `login usuario:password` - Login con texto
- `card-login` / `login-card` - Mostrar tarjeta de login
- `logout` / `cerrar sesión` / `salir` - Cerrar sesión
- **TODO lo demás** → Se envía a IA para procesamiento natural

---

### **bots/dialogBot.js (214L)** - Clase Base

- Extiende `TeamsActivityHandler`
- Validación de actividades (tipo, longitud <4000 chars)
- Manejo de errores categorizado (auth, timeout, network)
- Guardado automático de estados
- **NO maneja autenticación ni lógica de negocio**

---

### **index.js (370L)** - Servidor Principal

- Express server con CORS (`*`)
- Inicialización multi-bot
- Endpoints REST:
  - `/api/messages*` - Bots de Teams
  - `/api/webchat/*` - API de WebChat
  - `/api/bots` - Status de bots

---

## 🔧 Servicios Core v3/v4

### **services/authService.js (8.5KB)** - Autenticación

**Configuración:**
- Constructor: `new AuthService(cosmosService)`
- Sin Map en memoria
- TTL fijo de 60 minutos (sin renovación)

**Métodos principales:**

```javascript
// Autenticar con API Nova
async authenticateWithNova(username, password)
// Returns: { success: true, userInfo: {...} }

// Crear sesión (después de login exitoso)
async setUserAuthenticated(user_id, userInfo)
// user_id = Teams userId ("29:xxx") o token (WebChat)

// Verificar si está autenticado
async isUserAuthenticated(user_id)
// Returns: boolean

// Obtener información del usuario
async getUserInfo(user_id)
// Returns: { usuario, nombre, paterno, materno, token, loginAt, ... }

// Cerrar sesión
async clearUserAuthentication(user_id)
// Returns: boolean

// Verificar comando de logout
isLogoutCommand(text)
// Returns: boolean
```

---

### **services/cosmosService.js (15.5KB)** - Persistencia

**⚠️ PARTITION KEY:** `/user_id` (flexible según contexto)

**Configuración:**
- TTL sesiones: **60 minutos fijos**
- TTL mensajes: **24 horas fijas**
- Fallback a memoria si Cosmos no disponible

**2 Tipos de Documentos:**

1. **`user` (Sesión/Auth):**
   ```javascript
   {
     id: "user_29:1AbCdE...",
     user_id: "29:1AbCdE...",    // PARTITION KEY (Teams ID)
     type: "user",
     usuario: "91004",
     nombre: "Juan",
     token: "eyJhbGci...",
     loginAt: "2025-10-14T10:00:00Z",
     ttl: 3600  // 60 minutos
   }
   ```

2. **`message` (Historial):**
   ```javascript
   {
     id: "message_29:1AbCdE..._1728583200000",
     user_id: "29:1AbCdE...",    // PARTITION KEY
     type: "message",
     role: "user",                // 'user' | 'assistant'
     content: "¿Cuál es mi saldo?",
     timestamp: "2025-10-14T10:30:00Z",
     ttl: 86400  // 24 horas
   }
   ```

**Métodos principales:**

```javascript
// === SESIONES ===
async createUserSession(user_id, userInfo)
async getUserSession(user_id)
async deleteUserSession(user_id)

// === MENSAJES ===
async saveMessage(user_id, role, content)
async getLastMessages(user_id, limit = 10)
async clearUserMessages(user_id)

// === UTILIDADES ===
isAvailable()
getStats()
```

---

### **services/openaiService.js (346L)** - IA y Coordinación

**Configuración:**
- Modelo chat: `gpt-4.1-mini`
- Modelo embedding: `text-embedding-3-large`
- API version: `2025-01-01-preview`

**Métodos públicos:**
```javascript
// Procesar mensaje con IA
async procesarMensaje(mensaje, historial, userToken, userInfo, conversationId, userId)
// Returns: { type, content, metadata }

// Verificar disponibilidad
isAvailable()
```

**Flujo procesarMensaje:**
1. `prepararMensajes()` - Carga historial desde Cosmos DB (últimos 20)
2. `openai.chat.completions.create()` - Genera respuesta
3. Si `tool_calls` → `procesarHerramientas()` - Ejecuta herramientas
4. Retorna respuesta final

---

### **services/toolsService.js (435L)** - Herramientas del Bot

**5 Herramientas disponibles:**
1. `buscar_documentos_nova` - Azure Search vectorial + textual
2. `consultar_saldo_usuario` - Saldos de cuentas
3. `consultar_tasas_interes` - Tasas de interés mensuales
4. `obtener_fecha_hora_actual` - Fecha/hora en México
5. `obtener_informacion_usuario` - Info del perfil del usuario

**API pública:**
```javascript
getToolDefinitions()  // Returns: Array de 5 tools
async executeTool(toolName, params, context)
isAvailable()
```

---

### **controllers/webchatController.js (326L)** - API de WebChat

**user_id para WebChat:** `token` completo (JWT, sin decodificar)

**Endpoints:**
1. `POST /api/webchat/init` - Inicializa chat
2. `POST /api/webchat/ask` - Procesa mensaje
3. `GET /api/webchat/history` - Obtiene historial
4. `DELETE /api/webchat/clear` - Limpia historial
5. `GET /api/webchat/status` - Estado de servicios

---

## 🔑 Conceptos Clave v4.0

### Partition Key Flexible: `/user_id`

| Contexto | user_id | Ejemplo |
|----------|---------|---------|
| **Teams** | `context.activity.from.id` | `"29:1AbCdEfGhIj..."` |
| **WebChat** | Token JWT completo | `"eyJhbGciOiJIUzI1NiIs..."` |

**Ventajas:**
- ✅ No decodifica tokens
- ✅ user_id disponible ANTES del login
- ✅ Queries eficientes
- ✅ Escalable sin límites

### Sin Comandos Especiales

**v3.0 (antes):**
```
Usuario: "historial"        → Comando especial
Usuario: "resumen"          → Comando especial
Usuario: "mi info"          → Comando especial
Usuario: "ayuda"            → Comando especial
```

**v4.0 (ahora):**
```
Usuario: "muéstrame mi historial" → IA interpreta y responde
Usuario: "dame un resumen"         → IA interpreta y responde
Usuario: "cuál es mi información"  → IA usa herramienta
Usuario: "ayuda"                   → IA explica cómo usar el bot
```

**Beneficios:**
- ✅ Experiencia más natural
- ✅ IA interpreta intenciones
- ✅ No hay que recordar comandos
- ✅ Código más simple

### Arquitectura Stateless Pura

```javascript
// ❌ v2.0 (con estado en memoria)
this.conversationCache = new Map();
this.userSessions = new Map();

// ✅ v4.0 (sin estado en memoria)
// TODO en Cosmos DB
const userInfo = await auth.getUserInfo(userId);
const messages = await cosmos.getLastMessages(userId, 20);

// ✅ Sobrevive reinicios
// ✅ Escala horizontalmente
// ✅ Sin pérdida de datos
```

---

## 🛠️ Patterns y Convenciones

### Logging Estructurado

```javascript
// Para IDs largos (Teams userId, tokens)
console.log(`📨 [${userId.substring(0,8)}...] Mensaje recibido`);
console.log(`💾 [${userId.substring(0,8)}...] ${role} guardado`);
console.log(`✅ [${userId.substring(0,8)}...] Login exitoso`);
console.error(`❌ [${userId.substring(0,8)}...] Error: ${error.message}`);
```

### Manejo de Errores

```javascript
try {
  await cosmos.saveMessage(userId, role, content);
  console.log(`💾 Mensaje guardado`);
} catch (error) {
  console.warn(`⚠️ Error guardando mensaje:`, error.message);
  // Continuar sin fallar la operación principal
}
```

---

## 📚 Recursos Importantes

- Bot Framework: https://docs.microsoft.com/en-us/azure/bot-service/
- OpenAI API: https://platform.openai.com/docs
- Cosmos DB Partitioning: https://docs.microsoft.com/en-us/azure/cosmos-db/partitioning-overview

---

## 🔍 Debugging

### Ver estado de bots activos
```bash
curl http://localhost:3978/api/bots
```

### Ver estado de servicios
```bash
curl http://localhost:3978/api/webchat/status
```

---

## 📊 Historial de Migraciones

### v2 → v3 (2025-10-14)
- Partition key: `/userToken` → `/user_id`
- AuthService: API simplificada
- CosmosService: Solo 2 tipos de docs
- WebChatController: 1335 → 326 líneas
- **Ver**: [MIGRACION_V3_COMPLETADA.md](MIGRACION_V3_COMPLETADA.md)

### v3 → v4 (2025-10-14)
- TeamsBot: 1,300 → 305 líneas (76% reducción)
- Sin cache local (100% Cosmos DB)
- Sin comandos especiales (todo conversacional)
- Código ultra-limpio
- **Ver**: [MIGRACION_V4_COMPLETADA.md](MIGRACION_V4_COMPLETADA.md)

---

**Versión:** 4.0.0-CleanArchitecture
**Última actualización:** 2025-10-14
**Reducción total de código:** 64% (2,500L → 900L)
**Estado:** ✅ Producción
