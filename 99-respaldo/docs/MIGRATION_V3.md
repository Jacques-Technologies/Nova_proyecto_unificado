# 🚀 Guía de Migración v3.0 - Cosmos DB Simplificado

## 📊 Resumen de Cambios

### Antes (v2.2)
- **Partition Key:** `/userToken`
- **Almacenamiento:** Map en memoria + Cosmos DB + UserState
- **Tipos de docs:** 3 tipos (conversation_info, conversation_message, conversation_messages_format)
- **TTL:** 90 días fijo
- **Sincronización:** Triple persistencia complicada

### Después (v3.0)
- **Partition Key:** `/user_id`
- **Almacenamiento:** Solo Cosmos DB
- **Tipos de docs:** 2 tipos (user, message)
- **TTL:** 60min (user) auto-renovable, 1 día (message)
- **Sincronización:** Ninguna - fuente única de verdad

---

## 🗄️ Nuevo Esquema de Cosmos DB

### Configuración del Container

```json
{
  "id": "nova-bot-container",
  "partitionKey": {
    "paths": ["/user_id"],
    "kind": "Hash"
  },
  "defaultTtl": -1,
  "indexingPolicy": {
    "automatic": true,
    "indexingMode": "consistent",
    "includedPaths": [
      { "path": "/*" }
    ],
    "compositeIndexes": [
      [
        { "path": "/user_id", "order": "ascending" },
        { "path": "/type", "order": "ascending" }
      ],
      [
        { "path": "/user_id", "order": "ascending" },
        { "path": "/timestamp", "order": "descending" }
      ]
    ]
  }
}
```

### Documento Tipo 1: user

```javascript
{
  "id": "user_91004",
  "user_id": "91004",           // PARTITION KEY
  "type": "user",

  "usuario": "91004",
  "nombre": "Juan",
  "paterno": "Pérez",
  "materno": "García",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",

  "loginAt": "2025-10-10T18:00:00.000Z",
  "lastActivity": "2025-10-10T18:45:00.000Z",

  "ttl": 3600  // 60 minutos
}
```

### Documento Tipo 2: message

```javascript
{
  "id": "message_91004_1728583200000",
  "user_id": "91004",           // PARTITION KEY
  "type": "message",

  "role": "user",               // 'user' | 'assistant'
  "content": "¿Cuál es mi saldo?",
  "timestamp": "2025-10-10T18:30:00.000Z",

  "ttl": 86400  // 24 horas
}
```

---

## 📦 Archivos Nuevos

1. **`services/cosmosService_v3.js`** - Servicio de Cosmos simplificado
   - `createUserSession(usuario, userInfo)`
   - `getUserSession(usuario)`
   - `renewUserTTL(usuario)`
   - `deleteUserSession(usuario)`
   - `saveMessage(usuario, role, content)`
   - `getLastMessages(usuario, limit)`
   - `getLastMessagesByRole(usuario)`
   - `clearUserMessages(usuario)`
   - `getUserData(usuario)`

2. **`services/authService_v3.js`** - Auth sin Map en memoria
   - Elimina `Map authenticatedUsers`
   - Delega todo a Cosmos DB
   - Métodos async para todo

---

## 🔄 Plan de Migración

### Paso 1: Preparación (Sin Downtime)

```bash
# 1. Backup del container actual
az cosmosdb sql container throughput show \
  --account-name <account> \
  --database-name <database> \
  --name <container>

# 2. Verificar que tienes las variables de entorno
cat .env | grep COSMOS
```

### Paso 2: Crear Nuevo Container (Recomendado) o Actualizar Existente

**Opción A: Nuevo Container (más seguro)**

```bash
# Crear container con partition key /user_id
az cosmosdb sql container create \
  --account-name <account> \
  --database-name <database> \
  --name nova-bot-v3 \
  --partition-key-path "/user_id" \
  --throughput 400
```

Actualizar `.env`:
```bash
COSMOS_DB_CONTAINER_ID=nova-bot-v3
```

**Opción B: Actualizar Existente (requiere migración de datos)**

⚠️ **NO PUEDES cambiar partition key de un container existente**

Necesitas:
1. Crear nuevo container con `/user_id`
2. Migrar datos (script abajo)
3. Cambiar variable de entorno

### Paso 3: Testing con Archivos v3

```javascript
// index.js - Cambiar imports temporalmente
import CosmosServiceV3 from './services/cosmosService_v3.js';
import AuthServiceV3 from './services/authService_v3.js';

const cosmosService = new CosmosServiceV3();
const authService = new AuthServiceV3(cosmosService);
```

### Paso 4: Testing Manual

```javascript
// Test 1: Login
const loginResult = await authService.authenticateWithNova('91004', 'password');
if (loginResult.success) {
  await authService.setUserAuthenticated('91004', loginResult.userInfo);
}

// Test 2: Verificar sesión
const isAuth = await authService.isUserAuthenticated('91004');
console.log('Autenticado:', isAuth);

// Test 3: Guardar mensaje
await cosmosService.saveMessage('91004', 'user', 'Hola bot');
await cosmosService.saveMessage('91004', 'assistant', 'Hola! ¿En qué puedo ayudarte?');

// Test 4: Obtener mensajes
const messages = await cosmosService.getLastMessages('91004', 10);
console.log('Mensajes:', messages);

// Test 5: Renovar TTL
await cosmosService.renewUserTTL('91004');

// Test 6: Logout
await authService.clearUserAuthentication('91004');
```

### Paso 5: Migración Completa

Una vez testeado:

```bash
# 1. Renombrar archivos
mv services/cosmosService.js services/cosmosService_old.js
mv services/cosmosService_v3.js services/cosmosService.js

mv services/authService.js services/authService_old.js
mv services/authService_v3.js services/authService.js

# 2. Actualizar imports en archivos que usen estos servicios
# - index.js
# - bots/teamsBot.js
# - routes/webchatRoute.js
# - controllers/webchatController.js
```

### Paso 6: Actualizar TeamsBot

```javascript
// bots/teamsBot.js

// ELIMINAR:
// - this.conversationCache (Map local)
// - this.authenticatedUsers (Map de auth)
// - Métodos de cache local

// MODIFICAR:
async processAuthenticatedMessage(context, text, usuario, convId) {
  try {
    // 1. Renovar TTL PRIMERO
    await cosmosService.renewUserTTL(usuario);

    // 2. Guardar mensaje usuario
    await cosmosService.saveMessage(usuario, 'user', text);

    // 3. Obtener historial
    const messages = await cosmosService.getLastMessages(usuario, 10);

    // 4. Procesar con OpenAI
    const response = await openaiService.procesarMensaje(text, messages);

    // 5. Guardar respuesta bot
    await cosmosService.saveMessage(usuario, 'assistant', response.content);

    // 6. Enviar respuesta
    await this.sendResponse(context, response);
  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
}

// Comando "historial"
async showConversationHistory(context, usuario) {
  const messages = await cosmosService.getLastMessages(usuario, 10);
  // Mostrar mensajes...
}

// Comando "limpiar historial"
async limpiarHistorial(context, usuario) {
  const deleted = await cosmosService.clearUserMessages(usuario);
  await context.sendActivity(`🗑️ Eliminados ${deleted} mensajes`);
}
```

---

## 🧪 Script de Testing

Crear `test-cosmos-v3.js`:

```javascript
import CosmosServiceV3 from './services/cosmosService_v3.js';
import AuthServiceV3 from './services/authService_v3.js';

const cosmosService = new CosmosServiceV3();
const authService = new AuthServiceV3(cosmosService);

async function testAll() {
  console.log('🧪 Iniciando tests...\n');

  const testUser = '91004';
  const testUserInfo = {
    usuario: '91004',
    nombre: 'Juan Test',
    paterno: 'Pérez',
    materno: 'García',
    token: 'test_token_12345'
  };

  try {
    // Test 1: Crear sesión
    console.log('1️⃣ Creando sesión...');
    await authService.setUserAuthenticated(testUser, testUserInfo);

    // Test 2: Verificar sesión
    console.log('2️⃣ Verificando sesión...');
    const isAuth = await authService.isUserAuthenticated(testUser);
    console.log('   Autenticado:', isAuth ? '✅' : '❌');

    // Test 3: Obtener info
    console.log('3️⃣ Obteniendo info usuario...');
    const info = await authService.getUserInfo(testUser);
    console.log('   Nombre:', info?.nombre);

    // Test 4: Guardar mensajes
    console.log('4️⃣ Guardando mensajes...');
    await cosmosService.saveMessage(testUser, 'user', '¿Cuál es mi saldo?');
    await cosmosService.saveMessage(testUser, 'assistant', 'Tu saldo es $10,000 MXN');
    await cosmosService.saveMessage(testUser, 'user', 'Gracias');
    await cosmosService.saveMessage(testUser, 'assistant', '¡De nada!');

    // Test 5: Obtener mensajes
    console.log('5️⃣ Obteniendo mensajes...');
    const messages = await cosmosService.getLastMessages(testUser, 10);
    console.log(`   Total mensajes: ${messages.length}`);
    messages.forEach(m => console.log(`   - ${m.role}: ${m.content.substring(0, 30)}...`));

    // Test 6: Renovar TTL
    console.log('6️⃣ Renovando TTL...');
    const renewed = await cosmosService.renewUserTTL(testUser);
    console.log('   Renovado:', renewed ? '✅' : '❌');

    // Test 7: Obtener todo
    console.log('7️⃣ Obteniendo datos completos...');
    const data = await cosmosService.getUserData(testUser);
    console.log(`   Sesión: ${data.session ? '✅' : '❌'}`);
    console.log(`   Mensajes: ${data.messages.length}`);

    // Test 8: Limpiar mensajes
    console.log('8️⃣ Limpiando mensajes...');
    const deleted = await cosmosService.clearUserMessages(testUser);
    console.log(`   Eliminados: ${deleted}`);

    // Test 9: Logout
    console.log('9️⃣ Cerrando sesión...');
    await authService.clearUserAuthentication(testUser);

    // Test 10: Verificar logout
    console.log('🔟 Verificando logout...');
    const isAuthAfter = await authService.isUserAuthenticated(testUser);
    console.log('   Autenticado:', isAuthAfter ? '❌ ERROR' : '✅');

    console.log('\n✅ Todos los tests completados');
  } catch (error) {
    console.error('\n❌ Error en tests:', error);
  }
}

testAll();
```

Ejecutar:
```bash
node test-cosmos-v3.js
```

---

## 📊 Comparación de Performance

| Operación | v2.2 (Antes) | v3.0 (Después) | Mejora |
|-----------|--------------|----------------|--------|
| Login | 2 writes (UserState + Cosmos) | 1 write (Cosmos) | 50% |
| Verificar Auth | Map.has() + UserState | 1 point-read | Misma |
| Guardar Mensaje | 3 writes (cache + 2x Cosmos) | 1 write (Cosmos) | 66% |
| Obtener Historial | Cache.get() | 1 query partition | Similar |
| Renovar TTL | N/A (manual) | 1 point-read + update | Nuevo |

**RUs estimados por mensaje:** ~10 RU (vs ~30 RU antes)

---

## ⚠️ Consideraciones Importantes

1. **TTL de 60 minutos:** Los usuarios serán deslogeados automáticamente después de 60min de inactividad
2. **Mensajes 24h:** El historial se limpia automáticamente después de 1 día
3. **Sin estado en servidor:** Reiniciar el servidor no afecta sesiones
4. **Múltiples instancias:** Puedes escalar horizontalmente sin problemas

---

## 🔙 Rollback (Si algo falla)

```bash
# Restaurar archivos antiguos
mv services/cosmosService_old.js services/cosmosService.js
mv services/authService_old.js services/authService.js

# Volver al container anterior
# Actualizar .env con COSMOS_DB_CONTAINER_ID anterior
```

---

## ✅ Checklist de Migración

- [ ] Backup de container actual
- [ ] Crear nuevo container con `/user_id`
- [ ] Actualizar `.env` con nuevo container
- [ ] Ejecutar `test-cosmos-v3.js` exitosamente
- [ ] Renombrar archivos v3 → principal
- [ ] Actualizar imports en `index.js`
- [ ] Actualizar `teamsBot.js` (eliminar Maps)
- [ ] Actualizar `webchatController.js`
- [ ] Testing manual con bot en Teams
- [ ] Monitorear logs por 24h
- [ ] Eliminar archivos `_old` después de 1 semana

---

**Versión:** 3.0.0-Simplified
**Fecha:** 2025-10-10
**Autor:** Refactorización Cosmos DB
