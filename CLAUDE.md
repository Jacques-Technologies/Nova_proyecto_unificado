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
- ✅ **Anti-simulación** (previene cálculos manuales, redirige a portal web)

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
handleMessage()             // Router: login/logout/IA + Adaptive Cards
processWithAI()            // Procesar con OpenAI

// ==========================================
// LOGIN/LOGOUT (100L)
// ==========================================
handleLoginCommands()       // Router de login
showLoginCard()            // Mostrar tarjeta
loginWithText()            // Login: usuario:password
authenticate()             // Autenticación común (card y texto)
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

### **🎴 Adaptive Cards - Sistema de Login**

**IMPORTANTE:** El sistema maneja Adaptive Cards en **modo legacy** (type: message):

```javascript
// Activity recibido cuando el usuario presiona Submit:
{
  type: 'message',              // NO es 'invoke'
  text: '',                     // Vacío
  value: {                      // Datos del formulario
    action: 'login',
    username: '999999',
    password: '...'
  }
}

// Manejado por: handleMessage()
async handleMessage(context, next) {
    // Detectar submit: sin texto pero CON value
    if (context.activity.value && !text) {
        const submitData = context.activity.value;

        if (submitData.action === 'login') {
            const { username, password } = submitData;
            await this.authenticate(context, username, password, userId);
            return await next();
        }
    }
}
```

**⚠️ Nota:** Este es el comportamiento de Teams con manifiestos estándar. No se usa `onAdaptiveCardInvoke()` porque Teams envía `type: 'message'` en lugar de `type: 'invoke'`.

**Estructura de la tarjeta (cards/loginCard.js):**
```javascript
{
    type: 'AdaptiveCard',
    version: '1.0',
    body: [
        { type: 'Input.Text', id: 'username', placeholder: '...' },
        { type: 'Input.Text', id: 'password', style: 'Password' }
    ],
    actions: [{
        type: 'Action.Submit',
        title: '🚀 Iniciar Sesión',
        data: { action: 'login' }  // ← CLAVE para identificar la acción
    }]
}
```

**Flujo completo:**
```
Usuario presiona "Submit" en card
    ↓
Teams envía POST /api/messages
    ↓
CloudAdapter procesa request (type: 'message', value: {...})
    ↓
handleMessage() detecta: value existe && text vacío
    ↓
if (submitData.action === 'login')
    ↓
authenticate(username, password)
    ↓
auth.authenticateWithNova() → API Nova
    ↓
auth.setUserAuthenticated() → Cosmos DB
    ↓
Envía: "✅ ¡Bienvenido {nombre}!"
```

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

**6 Herramientas disponibles:**
1. `buscar_documentos_nova` - Azure Search vectorial + textual
2. `consultar_saldo_usuario` - Saldos de cuentas
3. `consultar_tasas_interes` - Tasas de interés mensuales
4. `obtener_fecha_hora_actual` - Fecha/hora en México
5. `obtener_informacion_usuario` - Info del perfil del usuario
6. `simulador_ahorros` - **NUEVA** - Redirige al simulador del portal web (previene cálculos manuales)

**API pública:**
```javascript
getToolDefinitions()  // Returns: Array de 6 tools
async executeTool(toolName, params, context)
isAvailable()
```

**Nota sobre simulaciones:**
- ✅ El bot NUNCA realiza cálculos de inversión/ahorro por su cuenta
- ✅ Siempre redirige al simulador oficial del portal web
- ✅ Esto garantiza exactitud y cumplimiento regulatorio

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

### Sistema Anti-Simulación

**Problema:** El bot intentaba hacer cálculos financieros manualmente, lo cual es:
- ❌ Inexacto (sin tasas en tiempo real)
- ❌ Riesgoso (errores de cálculo)
- ❌ No regulatorio (sin auditoría)

**Solución v4.0:**

**1. Instrucciones en el prompt del sistema:**
```javascript
// En openaiService.js - prepararMensajes()
IMPORTANTE - SIMULACIONES:
• NUNCA realices cálculos ni simulaciones de inversión, ahorro o rendimientos
• Si el usuario pide una simulación, usa SIEMPRE la herramienta simulador_ahorros
• NO intentes hacer matemáticas ni proyecciones financieras por tu cuenta
• Redirige al usuario al simulador oficial del portal web de Nova
```

**2. Herramienta dedicada `simulador_ahorros`:**
```javascript
// En toolsService.js
redirigirSimulador(tipo_simulacion) {
  // Siempre retorna mensaje de redirección al portal web
  // Incluye instrucciones paso a paso
  // Ofrece consultar tasas de interés como alternativa
}
```

**Flujo cuando usuario pide simulación:**
```
Usuario: "Quiero simular mi ahorro con $10,000 a 6 meses"
    ↓
OpenAI detecta intención de simulación (por prompt del sistema)
    ↓
Llama herramienta simulador_ahorros
    ↓
Bot responde: "Para realizar simulaciones, usa el simulador del portal web..."
    ↓
✅ Usuario es redirigido correctamente
❌ Bot NO hace cálculos manuales
```

**Beneficios:**
- ✅ Cumplimiento regulatorio
- ✅ Datos exactos (tasas en tiempo real)
- ✅ Experiencia de usuario profesional
- ✅ Auditoría completa en portal web

### Sistema de Clarificación de Intenciones

**Problema:** El bot ejecutaba herramientas con mensajes ambiguos, causando:
- ❌ Respuestas incorrectas o irrelevantes
- ❌ Uso innecesario de herramientas/APIs
- ❌ Frustración del usuario por falta de contexto

**Solución v4.0:**

**Detección inteligente de ambigüedad:**
```javascript
// En openaiService.js - prepararMensajes()
IMPORTANTE - CLARIFICACIÓN DE INTENCIONES:
• Si el usuario escribe palabras técnicas sueltas SIN contexto claro, NO asumas su intención
• Palabras técnicas ambiguas: "tasas", "saldo", "documentos", "información", "cuenta"
• EXCEPCIÓN: Saludos y cortesía son naturales → responde normalmente
• Cuando detectes ambigüedad TÉCNICA, pregunta para clarificar
• Solo ejecuta herramientas cuando la intención sea CLARA
```

**Diferenciación clave:**

| Tipo de mensaje | Ejemplo | Respuesta del bot |
|-----------------|---------|-------------------|
| **Saludo/Cortesía** ✅ | "hola", "gracias", "ok", "buenos días" | Responde normalmente (natural) |
| **Técnico CLARO** ✅ | "consulta mi saldo", "tasas del 2025" | Ejecuta herramienta correspondiente |
| **Técnico AMBIGUO** ❌ | "tasas", "saldo", "documentos" | Pregunta para clarificar |

**Ejemplos de clarificación:**

```
Usuario: "tasas"
Bot: "¿Te refieres a las tasas de interés? ¿De qué año te gustaría consultarlas?"

Usuario: "saldo"
Bot: "¿Quieres consultar tu saldo actual de cuentas?"

Usuario: "documentos"
Bot: "¿Qué tipo de documentos buscas? ¿Sobre qué tema específico?"
```

**Flujo con clarificación:**
```
Usuario: "tasas"
    ↓
OpenAI detecta: palabra técnica sin contexto
    ↓
Bot pregunta: "¿Te refieres a las tasas de interés? ¿De qué año?"
    ↓
Usuario: "del 2025"
    ↓
OpenAI detecta: intención clara ahora
    ↓
Ejecuta: consultar_tasas_interes(2025)
    ↓
✅ Respuesta precisa y relevante
```

**Beneficios:**
- ✅ Evita respuestas incorrectas
- ✅ Mejor experiencia conversacional
- ✅ Uso eficiente de herramientas
- ✅ Usuario se siente comprendido

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

### Logs en producción

El sistema mantiene logs esenciales para monitoreo:

```bash
# Mensajes de usuario
📨 [29:18XAK...] "hola..."

# Login
🔐 [29:18XAK...] Login card enviada
✅ [29:18XAK...] Login exitoso: 999999
❌ [29:18XAK...] Login fallido: usuario

# Acceso
🔒 [29:18XAK...] Acceso denegado

# Errores
❌ Error procesando mensaje en Nova Bot Principal
```

**Tip:** Si necesitas debugging detallado para Adaptive Cards, puedes añadir temporalmente:
```javascript
// En handleMessage(), antes del if(context.activity.value)
console.log('Activity:', JSON.stringify(context.activity, null, 2));
console.log('Value:', context.activity.value);
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
