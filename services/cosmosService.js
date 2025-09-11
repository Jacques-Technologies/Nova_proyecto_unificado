// services/cosmosService.js
import { CosmosClient } from '@azure/cosmos';
import { DateTime } from 'luxon';
import 'dotenv/config';

/**
 * Servicio de Cosmos DB - Persistencia con partición por /userToken
 * + Fallback en memoria por token cuando Cosmos no está disponible
 */
export default class CosmosService {
  constructor() {
    this.initialized = false;
    this.initializationError = null;

    // 🔁 Fallback en memoria: { [token]: { lastConvId, conversations: Map<convId, {info, messages:[]}> } }
    this.memory = new Map();

    console.log('🚀 Inicializando Cosmos DB Service con token como identificador...');
    this.initializeCosmosClient();
  }

  initializeCosmosClient() {
    try {
      const endpoint = process.env.COSMOS_DB_ENDPOINT;
      const key = process.env.COSMOS_DB_KEY;
      this.databaseId = process.env.COSMOS_DB_DATABASE_ID;
      this.containerId = process.env.COSMOS_DB_CONTAINER_ID;
      this.partitionKey = process.env.COSMOS_DB_PARTITION_KEY || '/userToken';

      if (!endpoint || !key || !this.databaseId || !this.containerId) {
        this.initializationError = 'Variables de entorno de Cosmos DB faltantes';
        console.warn('⚠️ Cosmos DB no configurado - usando fallback en memoria');
        this.cosmosAvailable = false;
        this.initialized = true; // inicializado con fallback
        return;
      }

      this.client = new CosmosClient({
        endpoint,
        key,
        userAgentSuffix: 'NovaBot/2.2.0-TokenBased',
      });

      this.database = this.client.database(this.databaseId);
      this.container = this.database.container(this.containerId);
      this.cosmosAvailable = true;
      this.initialized = true;

      console.log('✅ Cosmos DB configurado');
      console.log(`   Database: ${this.databaseId}`);
      console.log(`   Container: ${this.containerId}`);
      console.log(`   Partition Key: ${this.partitionKey}`);
    } catch (error) {
      this.initializationError = `Error inicializando Cosmos DB: ${error.message}`;
      console.error('❌ Error inicializando Cosmos DB:', error);
      this.cosmosAvailable = false;
      this.initialized = true; // inicializado con fallback
    }
  }

  // ===== Helpers memoria =====
  _memEnsure(token) {
    if (!this.memory.has(token)) {
      this.memory.set(token, { lastConvId: null, conversations: new Map() });
    }
    return this.memory.get(token);
  }

  _memCreateConv(token, convId, baseInfo = {}) {
    const bucket = this._memEnsure(token);
    if (!bucket.conversations.has(convId)) {
      const ts = DateTime.now().setZone('America/Mexico_City').toISO();
      bucket.conversations.set(convId, {
        info: {
          id: `conversation_${convId}`,
          conversationId: convId,
          userToken: token,
          documentType: 'conversation_info',
          createdAt: ts,
          lastActivity: ts,
          messageCount: 0,
          isActive: true,
          channel: baseInfo.channel || 'web',
          metadata: baseInfo.metadata || {},
          title: baseInfo.title || baseInfo?.metadata?.title || 'Nuevo chat',
        },
        messages: [], // [{role, content, timestamp}]
      });
      bucket.lastConvId = convId;
    }
    return bucket.conversations.get(convId);
  }

  _memAppendMessage(token, convId, { role, content, ts }) {
    const bucket = this._memEnsure(token);
    const conv = bucket.conversations.get(convId);
    if (!conv) return false;
    conv.messages.push({
      role,
      content,
      timestamp: ts || DateTime.now().setZone('America/Mexico_City').toISO(),
    });
    conv.info.messageCount = (conv.info.messageCount || 0) + 1;
    conv.info.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
    bucket.lastConvId = convId;
    return true;
  }

  isAvailable() {
    return this.initialized === true; // disponible con Cosmos o con memoria
  }

  getConfigInfo() {
    return {
      available: this.isAvailable(),
      initialized: this.initialized,
      database: this.databaseId,
      container: this.containerId,
      partitionKey: this.partitionKey,
      error: this.initializationError,
      version: '2.2.0-TokenBased',
      features: {
        tokenBasedPartitioning: true,
        conversationMessagesFormat: true,
        openaiCompatibleFormat: true,
        autoTTL: this.cosmosAvailable,
        upsertOperations: this.cosmosAvailable,
        concurrencySafe: this.cosmosAvailable,
        memoryFallback: !this.cosmosAvailable,
      },
    };
  }

  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

    async saveConversationInfo(conversationId, userId, userName, additionalData = {}) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - conversación no guardada');
                return null;
            }

            if (!conversationId || !userId) {
                console.error('❌ saveConversationInfo: conversationId o userId faltante');
                return null;
            }

            const conversationDocId = `conversation_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            const conversationDoc = {
                id: conversationDocId,
                conversationId: conversationId,
                userId: userId,
                userName: userName || 'Usuario',
                documentType: 'conversation_info',
                createdAt: timestamp,
                lastActivity: timestamp,
                messageCount: 0,
                isActive: true,
                partitionKey: userId,
                ttl: 60 * 60 * 24 * 90, // TTL: 90 días
                version: '2.1.3',
                ...additionalData
            };

            console.log(`💾 [${userId}] Guardando info de conversación: ${conversationDocId}`);

            const { resource: upsertedItem } = await this.container.items.upsert(conversationDoc);
            
            console.log(`✅ [${userId}] Info de conversación guardada exitosamente`);
            return upsertedItem;

        } catch (error) {
            console.error(`❌ Error en saveConversationInfo:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId,
                userName: userName
            });
            return null;
        }
    }
  /** 🧭 Devuelve el último conversationId activo para un token */
 // services/cosmosService.js - CORRECCIÓN CRÍTICA del método getLatestConversationId

/** 🧭 Devuelve el último conversationId activo para un token - VERSIÓN CORREGIDA */
async getLatestConversationId(token) {
  try {
    console.log(`🔍 getLatestConversationId - Token: ${token?.substring(0, 8)}...`);
    
    if (!token) {
      console.warn('⚠️ getLatestConversationId: token requerido');
      return null;
    }

    if (!this.cosmosAvailable) {
      const bucket = this._memEnsure(token);
      const latestId = bucket.lastConvId;
      console.log(`💾 Memoria: última conversación = ${latestId}`);
      return latestId || null;
    }

    // ✅ MÉTODO 1: Buscar conversation_info más reciente SIN ORDER BY
    console.log('🔍 Método 1: Buscando conversation_info...');
    try {
      const infoQuery = {
        query: `
          SELECT c.conversationId, c.lastActivity, c.isActive
          FROM c
          WHERE c.userToken = @token
            AND c.documentType = 'conversation_info'
            AND c.isActive = true
        `,
        parameters: [{ name: '@token', value: token }],
      };

      const { resources: infoResources } = await this.container.items
        .query(infoQuery, { partitionKey: token })
        .fetchAll();

      console.log(`📊 conversation_info encontrados: ${infoResources?.length || 0}`);

      if (infoResources && infoResources.length > 0) {
        // Ordenar manualmente por lastActivity
        const sortedConversations = infoResources
          .filter(conv => conv.conversationId && conv.isActive)
          .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

        if (sortedConversations.length > 0) {
          const latestConvId = sortedConversations[0].conversationId;
          console.log(`✅ Método 1 exitoso: ${latestConvId}`);
          return latestConvId;
        }
      }
    } catch (error) {
      console.warn('⚠️ Método 1 falló:', error.message);
    }

    // ✅ MÉTODO 2: Buscar directamente en mensajes para encontrar conversación más reciente
    console.log('🔍 Método 2: Buscando en mensajes...');
    try {
      const messageQuery = {
        query: `
          SELECT DISTINCT c.conversationId, c.timestamp
          FROM c
          WHERE c.userToken = @token
            AND IS_DEFINED(c.conversationId)
            AND c.conversationId != ''
            AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
        `,
        parameters: [{ name: '@token', value: token }],
      };

      const { resources: messageResources } = await this.container.items
        .query(messageQuery, { partitionKey: token })
        .fetchAll();

      console.log(`📊 Mensajes con conversationId encontrados: ${messageResources?.length || 0}`);

      if (messageResources && messageResources.length > 0) {
        // Encontrar la conversación con el mensaje más reciente
        const conversationTimestamps = {};
        
        messageResources.forEach(msg => {
          const convId = msg.conversationId;
          const timestamp = new Date(msg.timestamp);
          
          if (!conversationTimestamps[convId] || timestamp > conversationTimestamps[convId]) {
            conversationTimestamps[convId] = timestamp;
          }
        });

        // Encontrar la conversación más reciente
        let latestConvId = null;
        let latestTimestamp = null;
        
        for (const [convId, timestamp] of Object.entries(conversationTimestamps)) {
          if (!latestTimestamp || timestamp > latestTimestamp) {
            latestConvId = convId;
            latestTimestamp = timestamp;
          }
        }

        if (latestConvId) {
          console.log(`✅ Método 2 exitoso: ${latestConvId} (${latestTimestamp})`);
          return latestConvId;
        }
      }
    } catch (error) {
      console.warn('⚠️ Método 2 falló:', error.message);
    }

    // ✅ MÉTODO 3: Query más simple para cualquier documento con conversationId
    console.log('🔍 Método 3: Query simple...');
    try {
      const simpleQuery = {
        query: `
          SELECT TOP 20 c.conversationId, c.timestamp
          FROM c
          WHERE c.userToken = @token
            AND IS_DEFINED(c.conversationId)
        `,
        parameters: [{ name: '@token', value: token }],
      };

      const { resources: simpleResources } = await this.container.items
        .query(simpleQuery, { partitionKey: token })
        .fetchAll();

      console.log(`📊 Documentos con conversationId: ${simpleResources?.length || 0}`);

      if (simpleResources && simpleResources.length > 0) {
        // Ordenar por timestamp y tomar el más reciente
        const sorted = simpleResources
          .filter(doc => doc.conversationId)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (sorted.length > 0) {
          const latestConvId = sorted[0].conversationId;
          console.log(`✅ Método 3 exitoso: ${latestConvId}`);
          return latestConvId;
        }
      }
    } catch (error) {
      console.warn('⚠️ Método 3 falló:', error.message);
    }

    console.log('❌ No se encontró conversación activa para el token');
    return null;

  } catch (e) {
    console.error('❌ getLatestConversationId error general:', e);
    return null;
  }
}

  /** 🔎 Buscar información de conversación por token + conversationId */
  async findConversationInfoByToken(conversationId, token) {
    if (!token) return null;

    if (!this.cosmosAvailable) {
      const bucket = this._memEnsure(token);
      const conv = bucket.conversations.get(conversationId);
      return conv?.info || null;
    }

    const query = {
      query: `
        SELECT TOP 1 *
        FROM c
        WHERE c.conversationId = @conversationId
          AND c.userToken = @token
          AND c.documentType = 'conversation_info'
      `,
      parameters: [
        { name: '@conversationId', value: conversationId },
        { name: '@token', value: token }
      ],
    };

    try {
      const { resources } = await this.container.items
        .query(query, { partitionKey: token })
        .fetchAll();
      return resources?.[0] || null;
    } catch (e) {
      console.warn('findConversationInfoByToken error:', e?.message);
      return null;
    }
  }

  /** 💾 Guardar doc de conversación (arreglo de roles) */
  async saveConversationMessages(conversationId, token, messages, userInfo = null) {
    try {
      if (!conversationId || !token || !Array.isArray(messages)) return null;

      if (!this.cosmosAvailable) {
        const conv = this._memCreateConv(token, conversationId, { metadata: { userName: userInfo?.nombre } });
        conv.messages = messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || DateTime.now().setZone('America/Mexico_City').toISO(),
        }));
        conv.info.messageCount = conv.messages.length;
        conv.info.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
        return { id: `conversation_messages_${conversationId}`, memory: true };
      }

      const id = `conversation_messages_${conversationId}`;
      const ts = DateTime.now().setZone('America/Mexico_City').toISO();

      const conversationDoc = {
        id,
        conversationId,
        userToken: token,
        userName: userInfo?.nombre || 'Usuario',
        documentType: 'conversation_messages_format',
        messages,
        messageCount: messages.length,
        lastUpdated: ts,
        createdAt: ts,
        partitionKey: token,
        ttl: 60 * 60 * 24 * 90,
        version: '2.2.0-token-format',
        format: 'openai_chat_format',
      };

      const { resource } = await this.container.items.upsert(conversationDoc);
      return resource;
    } catch (error) {
      console.error('❌ Error guardando conversación (roles):', error.message);
      return null;
    }
  }

  // services/cosmosService.js - CORRECCIÓN del método getConversationForOpenAIByToken

/** 🧠 Formato OpenAI usando sólo token (toma la conversación más reciente) - VERSIÓN CORREGIDA */
async getConversationForOpenAIByToken(token, includeSystem = true, limit = 30) {
  try {
    console.log(`🧠 getConversationForOpenAIByToken - Token: ${token?.substring(0, 8)}..., Limit: ${limit}`);
    
    if (!token) {
      console.warn('⚠️ getConversationForOpenAIByToken: token requerido');
      return [];
    }

    // ✅ MÉTODO DIRECTO: Obtener mensajes directamente por token sin depender de conversationId
    console.log('🔍 Obteniendo mensajes directamente por token...');
    
    try {
      const messages = await this.getMessagesByToken(token, { limit });
      console.log(`📊 getMessagesByToken retornó: ${messages?.length || 0} mensajes`);
      
      if (messages && messages.length > 0) {
        const filtered = includeSystem ? messages : messages.filter((m) => m.role !== 'system');
        const formatted = filtered.map((m) => ({ 
          role: m.role, 
          content: m.content 
        }));
        
        console.log(`✅ Formato OpenAI: ${formatted.length} mensajes (includeSystem: ${includeSystem})`);
        
        // Log de muestra para debug
        if (formatted.length > 0) {
          console.log(`📝 Primer mensaje: ${formatted[0].role}: ${formatted[0].content?.substring(0, 50)}...`);
          console.log(`📝 Último mensaje: ${formatted[formatted.length - 1].role}: ${formatted[formatted.length - 1].content?.substring(0, 50)}...`);
        }
        
        return formatted;
      } else {
        console.log('⚠️ getMessagesByToken no retornó mensajes');
      }
    } catch (directError) {
      console.error('❌ Error en método directo:', directError.message);
    }

    // ✅ FALLBACK 1: Intentar con conversationId si el método directo falla
    console.log('🔍 Fallback 1: Usando conversationId...');
    try {
      const convId = await this.getLatestConversationId(token);
      console.log(`🎯 ConversationId obtenido: ${convId}`);
      
      if (convId) {
        const msgs = await this.getConversationForOpenAI(convId, token, includeSystem);
        console.log(`📊 getConversationForOpenAI retornó: ${msgs?.length || 0} mensajes`);
        
        if (msgs && msgs.length > 0) {
          const limitedMsgs = msgs.slice(-Math.min(limit, 100));
          console.log(`✅ Fallback 1 exitoso: ${limitedMsgs.length} mensajes`);
          return limitedMsgs;
        }
      }
    } catch (fallbackError) {
      console.warn('⚠️ Fallback 1 falló:', fallbackError.message);
    }

    // ✅ FALLBACK 2: Query directo en Cosmos con formato OpenAI
    if (this.cosmosAvailable) {
      console.log('🔍 Fallback 2: Query directo para formato OpenAI...');
      
      try {
        const directQuery = {
          query: `
            SELECT c.message, c.messageType, c.timestamp
            FROM c
            WHERE c.userToken = @token
              AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
              AND IS_DEFINED(c.message)
              AND c.message != ''
              AND c.message != 'undefined'
              AND c.message != 'null'
          `,
          parameters: [{ name: '@token', value: token }]
        };

        const { resources } = await this.container.items
          .query(directQuery, { partitionKey: token })
          .fetchAll();

        console.log(`📊 Query directo: ${resources?.length || 0} mensajes encontrados`);

        if (resources && resources.length > 0) {
          // Procesar y ordenar mensajes
          const processedMessages = resources
            .filter(msg => msg.message && msg.message.trim() !== '')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .slice(-limit)
            .map(msg => ({
              role: msg.messageType === 'bot' ? 'assistant' : (msg.messageType === 'system' ? 'system' : 'user'),
              content: msg.message
            }));

          const filtered = includeSystem ? processedMessages : processedMessages.filter(m => m.role !== 'system');
          
          console.log(`✅ Fallback 2 exitoso: ${filtered.length} mensajes`);
          
          if (filtered.length > 0) {
            console.log(`📝 Query directo - Primer: ${filtered[0].role}: ${filtered[0].content?.substring(0, 50)}...`);
            console.log(`📝 Query directo - Último: ${filtered[filtered.length - 1].role}: ${filtered[filtered.length - 1].content?.substring(0, 50)}...`);
          }
          
          return filtered;
        }
      } catch (queryError) {
        console.error('❌ Error en query directo:', queryError.message);
      }
    }

    console.log('❌ Todos los métodos fallaron - retornando array vacío');
    return [];

  } catch (e) {
    console.error('❌ getConversationForOpenAIByToken error general:', e);
    return [];
  }
}
  /** 📖 Obtener conversación (arreglo por roles) */
  async getConversationMessages(conversationId, token) {
    try {
      if (!token) return [];

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return [];
        return conv.messages.slice(-20);
      }

      const docId = `conversation_messages_${conversationId}`;

      try {
        const { resource } = await this.container.item(docId, token).read();
        if (resource?.messages) return resource.messages;
      } catch (e) {
        if (e.code !== 404) throw e;
      }

      // Fallback: reconstruir desde mensajes individuales
      const q = {
        query: `
          SELECT c.message, c.messageType, c.timestamp
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.userToken = @token
            AND c.documentType = 'conversation_message'
          ORDER BY c.timestamp ASC
        `,
        parameters: [
          { name: '@conversationId', value: conversationId },
          { name: '@token', value: token }
        ],
      };
      
      const { resources } = await this.container.items
        .query(q, { partitionKey: token })
        .fetchAll();
        
      const mapped = (resources || []).map((m) => ({
        role: m.messageType === 'bot' ? 'assistant' : (m.messageType === 'system' ? 'system' : 'user'),
        content: m.message,
        timestamp: m.timestamp,
      }));
      
      return mapped.slice(-20);
    } catch (error) {
      console.error('❌ Error obteniendo conversación (roles):', error.message);
      return [];
    }
  }

  /** 🧠 Formato OpenAI listo para usar */
  async getConversationForOpenAI(conversationId, token, includeSystem = true) {
    try {
      const msgs = await this.getConversationMessages(conversationId, token);
      if (!msgs.length) return [];
      const filtered = includeSystem ? msgs : msgs.filter((m) => m.role !== 'system');
      return filtered.map((m) => ({ role: m.role, content: m.content }));
    } catch (e) {
      console.error('❌ Error formateando para OpenAI:', e.message);
      return [];
    }
  }

  /** 🧠 Formato OpenAI usando sólo token (toma la conversación más reciente) */
  async getConversationForOpenAIByToken(token, includeSystem = true, limit = 30) {
    try {
      const convId = await this.getLatestConversationId(token);
      if (!convId) return [];
      const msgs = await this.getConversationForOpenAI(convId, token, includeSystem);
      return (msgs || []).slice(-Math.min(limit, 100));
    } catch (e) {
      console.warn('getConversationForOpenAIByToken error:', e?.message);
      return [];
    }
  }

  /** ➕ Agregar mensaje al arreglo por roles (y persistir) */
  async addMessageToConversation(conversationId, token, role, content, userInfo = null) {
    try {
      if (!conversationId || !token) return false;
      const validRoles = ['system', 'user', 'assistant'];
      if (!validRoles.includes(role)) return false;

      let currentMessages = await this.getConversationMessages(conversationId, token);

      currentMessages.push({
        role,
        content,
        timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
      });
      
      if (currentMessages.length > 20) {
        currentMessages = currentMessages.slice(-20);
      }

      const result = await this.saveConversationMessages(
        conversationId,
        token,
        currentMessages,
        userInfo
      );

      // Si estamos en memoria, también asegurar bucket
      if (!this.cosmosAvailable) {
        const conv = this._memCreateConv(token, conversationId, { metadata: { userName: userInfo?.nombre } });
        conv.messages = currentMessages;
        conv.info.messageCount = currentMessages.length;
        conv.info.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
      }

      return result !== null;
    } catch (error) {
      console.error('❌ Error agregando mensaje (roles):', error);
      return false;
    }
  }

 // ============================================
// CORRECCIONES ADICIONALES REQUERIDAS
// ============================================

// 1. MÉTODO appendMessage CORREGIDO en cosmosService.js
async appendMessage(conversationId, msg) {
  try {
    if (!conversationId || !msg?.content) {
      console.warn('❌ appendMessage: conversationId y content requeridos');
      return null;
    }

    const token = msg?.metadata?.token || msg.token;
    if (!token) {
      console.warn('❌ appendMessage: token requerido');
      return null;
    }

    console.log(`💾 appendMessage - ConvId: ${conversationId}, Token: ${token.substring(0, 8)}..., Role: ${msg.role}`);

    const userName = msg.userName || msg.metadata?.userName || `Usuario`;
    const role = msg.role || 'user';
    const messageType = role === 'assistant' ? 'bot' : (role === 'system' ? 'system' : 'user');

    // ✅ CRÍTICO: Asegurar que el contenido es string válido
    const content = String(msg.content || '').trim();
    if (!content || content === 'undefined' || content === 'null') {
      console.warn('❌ appendMessage: contenido inválido');
      return null;
    }

    const result = await this.saveMessage(content, conversationId, token, userName, messageType);
    console.log(`💾 appendMessage resultado:`, !!result);
    
    return result;
  } catch (e) {
    console.error('❌ appendMessage error:', e);
    return null;
  }
}

// 2. MÉTODO saveMessage MEJORADO en cosmosService.js
async saveMessage(message, conversationId, token, userName = null, messageType = 'user') {
  try {
    if (!message || !conversationId || !token) {
      console.warn('❌ saveMessage: parámetros requeridos faltantes');
      return null;
    }

    const role = messageType === 'bot' ? 'assistant' : (messageType === 'system' ? 'system' : 'user');
    const ts = DateTime.now().setZone('America/Mexico_City').toISO();

    console.log(`💾 saveMessage - Token: ${token.substring(0, 8)}..., Role: ${role}, ConvId: ${conversationId}`);
    console.log(`💾 Contenido (${message.length} chars): ${message.substring(0, 100)}...`);

    if (!this.cosmosAvailable) {
      // Persistencia en memoria
      this._memCreateConv(token, conversationId, { metadata: { userName } });
      const success = this._memAppendMessage(token, conversationId, { 
        role, 
        content: String(message).substring(0, 4000), 
        ts 
      });
      console.log(`💾 Mensaje guardado en memoria: ${success}`);
      return success ? { id: this.generateMessageId(), memory: true } : null;
    }

    // ✅ COSMOS: Estructura de documento mejorada
    const messageId = this.generateMessageId();
    const messageDoc = {
      id: messageId,
      messageId,
      conversationId,
      userToken: token,
      userName: userName || 'Usuario',
      message: String(message).substring(0, 4000), // ✅ Asegurar string válido
      messageType, // 'user' | 'bot' | 'system'
      timestamp: ts,
      dateCreated: ts,
      partitionKey: token, // ✅ CRÍTICO: Usar token como partitionKey
      ttl: 60 * 60 * 24 * 90, // 90 días
      documentType: 'conversation_message',
      version: '2.2.0',
      isMessage: true,
      hasContent: true,
      // ✅ NUEVO: Campos adicionales para mejor indexación
      messageLength: String(message).length,
      isValid: true,
      createdBy: 'webchat',
      channel: 'web'
    };

    console.log(`💾 Creando documento en Cosmos: ${messageId}`);
    const { resource: createdItem } = await this.container.items.create(messageDoc);
    console.log(`✅ Documento creado en Cosmos: ${createdItem?.id}`);

    // ✅ Sincroniza arreglo por roles (best effort)
    setImmediate(async () => {
      try {
        await this.addMessageToConversation(conversationId, token, role, message, { nombre: userName });
      } catch (e) {
        console.warn('⚠️ Sync roles falló (continuando):', e.message);
      }
    });

    // ✅ Actualiza actividad (best effort)
    setImmediate(async () => {
      try {
        await this.updateConversationActivity(conversationId, token);
      } catch (e) {
        console.warn('⚠️ updateConversationActivity falló:', e.message);
      }
    });

    return createdItem;
  } catch (error) {
    console.error('❌ Error guardando mensaje:', error.message);
    console.error('❌ Error details:', { code: error.code, statusCode: error.statusCode });
    return null;
  }
}



  /** 🧹 Limpiar mensajes de conversación */
  async cleanConversationMessages(conversationId, token) {
    try {
      if (!token || !conversationId) return false;
      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (conv) conv.messages = [];
        return true;
      }
      const id = `conversation_messages_${conversationId}`;
      await this.container.item(id, token).delete();
      return true;
    } catch (e) {
      if (e.code === 404) return true;
      console.error('❌ Error limpiando conversación (roles):', e.message);
      return false;
    }
  }

  /** 📚 Historial (mensajes individuales) en orden ascendente */
  async getConversationHistory(conversationId, token, limit = 20) {
    try {
      if (!token) return [];

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return [];
        return conv.messages
          .slice(-limit)
          .map((m, idx) => ({
            id: `${conversationId}_${idx}`,
            message: m.content,
            conversationId,
            userToken: token,
            userName: 'Usuario',
            timestamp: m.timestamp,
            type: m.role === 'assistant' ? 'assistant' : 'user',
            messageType: m.role === 'assistant' ? 'bot' : (m.role === 'system' ? 'system' : 'user'),
          }));
      }

      // Cosmos (igual que tu versión)
      const query = {
        query: `
          SELECT *
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.userToken = @token
            AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
          ORDER BY c.timestamp ASC
        `,
        parameters: [
          { name: '@conversationId', value: conversationId },
          { name: '@token', value: token },
        ],
      };

      const { resources } = await this.container.items
        .query(query, { partitionKey: token })
        .fetchAll();

      if (!resources || !resources.length) return [];

      return resources
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-limit)
        .map((m) => ({
          id: m.messageId || m.id,
          message: m.message || 'Mensaje vacío',
          conversationId: m.conversationId,
          userToken: m.userToken,
          userName: m.userName || 'Usuario',
          timestamp: m.timestamp,
          type: m.messageType === 'bot' ? 'assistant' : 'user',
          messageType: m.messageType,
        }));
    } catch (error) {
      console.error('❌ Error obteniendo historial:', error.message);
      return [];
    }
  }

  /** 📜 getMessages (API /history) — devuelve [{role, content, ts}] */
  async getMessages(conversationId, opts = {}) {
    try {
      const limit = Math.min(Number(opts.limit || 30), 100);
      const token = opts.token;
      const before = opts.before || null;
      if (!token) return [];

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return [];
        let list = conv.messages;
        if (before) list = list.filter(m => m.timestamp < before);
        return list.slice(-limit).map(m => ({ role: m.role, content: m.content, ts: m.timestamp }));
      }

      let queryText = `
        SELECT c.id, c.message, c.messageType, c.timestamp
        FROM c
        WHERE c.conversationId = @conversationId
          AND c.userToken = @token
          AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
      `;

      const params = [
        { name: '@conversationId', value: conversationId },
        { name: '@token', value: token },
      ];

      if (before) {
        queryText += ` AND c.timestamp < @before `;
        params.push({ name: '@before', value: before });
      }

      queryText += ` ORDER BY c.timestamp ASC`;

      const { resources } = await this.container.items
        .query({ query: queryText, parameters: params }, { partitionKey: token })
        .fetchAll();

      return (resources || [])
        .map((it) => ({
          role: it.messageType === 'bot' ? 'assistant' : (it.messageType === 'system' ? 'system' : 'user'),
          content: it.message,
          ts: it.timestamp,
        }))
        .slice(-limit);
    } catch (e) {
      console.warn('getMessages error:', e?.message);
      return [];
    }
  }

  /** 📜 Obtener mensajes directamente por token - VERSIÓN MEJORADA CON DIAGNÓSTICO */
async getMessagesByToken(token, { limit = 30, before = null } = {}) {
  try {
    console.log(`🔍 getMessagesByToken - Token: ${token?.substring(0, 8)}..., Limit: ${limit}`);
    
    if (!token) {
      console.warn('⚠️ getMessagesByToken: token requerido');
      return [];
    }

    if (!this.cosmosAvailable) {
      console.log('💾 Usando memoria fallback');
      const bucket = this._memEnsure(token);
      const allMessages = [];
      for (const [, conv] of bucket.conversations) {
        allMessages.push(...conv.messages);
      }
      let list = allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      if (before) list = list.filter(m => m.timestamp < before);
      const result = list.slice(-limit).map(m => ({ role: m.role, content: m.content, ts: m.timestamp }));
      console.log(`💾 Memoria: ${result.length} mensajes encontrados`);
      return result;
    }

    // ✅ SOLUCIÓN: Query SIN ORDER BY para evitar error de índice compuesto
    console.log('🔍 Ejecutando query sin ORDER BY...');
    
    let queryText = `
      SELECT c.message, c.messageType, c.timestamp, c.conversationId, c.documentType
      FROM c
      WHERE c.userToken = @token
        AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
        AND IS_DEFINED(c.message)
        AND c.message != ''
    `;

    const params = [{ name: '@token', value: token }];
    
    if (before) {
      queryText += ` AND c.timestamp < @before`;
      params.push({ name: '@before', value: before });
    }

    // ✅ NO incluir ORDER BY para evitar error de índice compuesto
    console.log(`🔍 Query: ${queryText}`);

    const { resources } = await this.container.items
      .query({ query: queryText, parameters: params }, { partitionKey: token })
      .fetchAll();

    console.log(`📊 Query result: ${resources?.length || 0} items encontrados`);

    let result = [];
    if (resources && resources.length > 0) {
      // ✅ Ordenar manualmente en JavaScript después de la consulta
      console.log(`🔧 Ordenando ${resources.length} mensajes manualmente...`);
      
      const sortedResources = resources
        .filter(item => item.message && item.message.trim() !== '')
        .sort((a, b) => {
          // Ordenar por timestamp ascendente
          const timeA = new Date(a.timestamp);
          const timeB = new Date(b.timestamp);
          return timeA - timeB;
        });

      console.log(`📊 Mensajes después de filtro y ordenamiento: ${sortedResources.length}`);

      // Tomar los últimos N mensajes (más recientes)
      const recentMessages = sortedResources.slice(-limit);
      
      result = recentMessages.map((item) => ({
        role: item.messageType === 'bot' ? 'assistant' : (item.messageType === 'system' ? 'system' : 'user'),
        content: item.message,
        ts: item.timestamp,
        conversationId: item.conversationId
      }));

      console.log(`✅ Resultado final: ${result.length} mensajes`);
      
      // Debug: mostrar contexto
      if (result.length > 0) {
        console.log(`📅 Primer mensaje: ${result[0].ts} - ${result[0].role}: ${result[0].content?.substring(0, 50)}...`);
        console.log(`📅 Último mensaje: ${result[result.length - 1].ts} - ${result[result.length - 1].role}: ${result[result.length - 1].content?.substring(0, 50)}...`);
      }
    } else {
      console.log('⚠️ No se encontraron mensajes en la query principal');
    }

    // ✅ FALLBACK: Si no hay resultados, intentar query más amplia
    if (result.length === 0) {
      console.log('🔍 Fallback: Query más amplia...');
      
      const fallbackQuery = `
        SELECT c.message, c.messageType, c.timestamp, c.conversationId
        FROM c
        WHERE c.userToken = @token
          AND IS_DEFINED(c.message)
          AND c.message != ''
          AND c.message != 'undefined'
          AND c.message != 'null'
      `;

      try {
        const { resources: fallbackResources } = await this.container.items
          .query({ 
            query: fallbackQuery, 
            parameters: [{ name: '@token', value: token }] 
          }, { partitionKey: token })
          .fetchAll();

        console.log(`📊 Fallback query: ${fallbackResources?.length || 0} items encontrados`);

        if (fallbackResources && fallbackResources.length > 0) {
          // Filtrar y procesar mensajes válidos
          const validMessages = fallbackResources
            .filter(item => {
              return item.message && 
                     item.message.trim() !== '' && 
                     item.message !== 'undefined' &&
                     item.message !== 'null' &&
                     item.messageType;
            })
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

          result = validMessages
            .slice(-limit)
            .map((item) => ({
              role: item.messageType === 'bot' ? 'assistant' : (item.messageType === 'system' ? 'system' : 'user'),
              content: item.message,
              ts: item.timestamp,
              conversationId: item.conversationId
            }));

          console.log(`✅ Fallback resultado: ${result.length} mensajes válidos`);
          
          if (result.length > 0) {
            console.log(`📝 Muestra fallback - Primer: ${result[0].role}: ${result[0].content?.substring(0, 50)}...`);
            console.log(`📝 Muestra fallback - Último: ${result[result.length - 1].role}: ${result[result.length - 1].content?.substring(0, 50)}...`);
          }
        }
      } catch (fallbackError) {
        console.error('❌ Error en fallback query:', fallbackError.message);
      }
    }

    console.log(`✅ getMessagesByToken FINAL: ${result.length} mensajes`);
    return result;

  } catch (e) {
    console.error('❌ getMessagesByToken error:', e);
    console.error('❌ Error details:', {
      message: e.message,
      code: e.code,
      statusCode: e.statusCode
    });
    return [];
  }
}

  /** 📜 Método alternativo: getConversationHistoryByToken mejorado */
  async getConversationHistoryByToken(token, limit = 20) {
    try {
      console.log(`🔍 getConversationHistoryByToken - Token: ${token?.substring(0, 8)}..., Limit: ${limit}`);
      
      if (!token) return [];

      // Primero intentar obtener la conversación más reciente
      const convId = await this.getLatestConversationId(token);
      console.log(`🎯 Latest conversationId: ${convId}`);
      
      if (!convId) {
        console.log('⚠️ No se encontró conversación activa');
        return [];
      }

      const result = await this.getConversationHistory(convId, token, limit);
      console.log(`✅ getConversationHistoryByToken resultado: ${result?.length || 0} mensajes`);
      
      return result || [];
    } catch (e) {
      console.error('❌ getConversationHistoryByToken error:', e);
      return [];
    }
  }

  // services/cosmosService.js - MÉTODO DE DEBUG MEJORADO

/** 🔍 Debug completo de datos por token */
async debugTokenDataComplete(token) {
  if (!token) return { error: 'Token requerido' };
  
  if (!this.cosmosAvailable) {
    const bucket = this._memEnsure(token);
    return { 
      error: 'Cosmos no disponible', 
      memoryData: {
        hasData: this.memory.has(token),
        conversations: bucket.conversations.size,
        totalMessages: Array.from(bucket.conversations.values()).reduce((sum, conv) => sum + conv.messages.length, 0)
      }
    };
  }

  try {
    console.log(`🔍 Debug completo para token: ${token.substring(0, 8)}...`);

    const debug = {
      token: token.substring(0, 8) + '...',
      timestamp: new Date().toISOString(),
      queries: {},
      analysis: {},
      recommendations: []
    };

    // 1. Conteo total
    console.log('📊 1. Conteo total de documentos...');
    try {
      const countQuery = {
        query: `SELECT VALUE COUNT(1) FROM c WHERE c.userToken = @token`,
        parameters: [{ name: '@token', value: token }]
      };

      const { resources: countResources } = await this.container.items
        .query(countQuery, { partitionKey: token })
        .fetchAll();

      debug.queries.totalDocuments = {
        success: true,
        count: countResources[0] || 0
      };
    } catch (error) {
      debug.queries.totalDocuments = {
        success: false,
        error: error.message
      };
    }

    // 2. Análisis por tipo de documento
    console.log('📊 2. Análisis por tipo de documento...');
    try {
      const typeQuery = {
        query: `
          SELECT c.documentType, COUNT(1) as count
          FROM c
          WHERE c.userToken = @token
          GROUP BY c.documentType
        `,
        parameters: [{ name: '@token', value: token }]
      };

      const { resources: typeResources } = await this.container.items
        .query(typeQuery, { partitionKey: token })
        .fetchAll();

      debug.queries.documentTypes = {
        success: true,
        types: typeResources || []
      };
    } catch (error) {
      debug.queries.documentTypes = {
        success: false,
        error: error.message
      };
    }

    // 3. Análisis por tipo de mensaje
    console.log('📊 3. Análisis por tipo de mensaje...');
    try {
      const msgTypeQuery = {
        query: `
          SELECT c.messageType, COUNT(1) as count
          FROM c
          WHERE c.userToken = @token
            AND IS_DEFINED(c.messageType)
          GROUP BY c.messageType
        `,
        parameters: [{ name: '@token', value: token }]
      };

      const { resources: msgTypeResources } = await this.container.items
        .query(msgTypeQuery, { partitionKey: token })
        .fetchAll();

      debug.queries.messageTypes = {
        success: true,
        types: msgTypeResources || []
      };
    } catch (error) {
      debug.queries.messageTypes = {
        success: false,
        error: error.message
      };
    }

    // 4. Mensajes más recientes (sin ORDER BY)
    console.log('📊 4. Mensajes recientes...');
    try {
      const recentQuery = {
        query: `
          SELECT TOP 10 c.message, c.messageType, c.timestamp, c.conversationId, c.documentType
          FROM c
          WHERE c.userToken = @token
            AND IS_DEFINED(c.message)
            AND c.message != ''
        `,
        parameters: [{ name: '@token', value: token }]
      };

      const { resources: recentResources } = await this.container.items
        .query(recentQuery, { partitionKey: token })
        .fetchAll();

      // Ordenar manualmente
      const sortedRecent = (recentResources || [])
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5);

      debug.queries.recentMessages = {
        success: true,
        count: recentResources?.length || 0,
        sample: sortedRecent.map(m => ({
          messageType: m.messageType,
          timestamp: m.timestamp,
          conversationId: m.conversationId,
          documentType: m.documentType,
          messagePreview: m.message?.substring(0, 50) + '...'
        }))
      };
    } catch (error) {
      debug.queries.recentMessages = {
        success: false,
        error: error.message
      };
    }

    // 5. Test del método getMessagesByToken
    console.log('📊 5. Test de getMessagesByToken...');
    try {
      const messages = await this.getMessagesByToken(token, { limit: 10 });
      debug.queries.getMessagesByTokenTest = {
        success: true,
        count: messages?.length || 0,
        sample: messages?.slice(0, 3)?.map(m => ({
          role: m.role,
          contentPreview: m.content?.substring(0, 50) + '...',
          timestamp: m.ts
        })) || []
      };
    } catch (error) {
      debug.queries.getMessagesByTokenTest = {
        success: false,
        error: error.message
      };
    }

    // 6. Test de conversación activa
    console.log('📊 6. Test de conversación activa...');
    try {
      const activeConvId = await this.getLatestConversationId(token);
      debug.queries.latestConversation = {
        success: true,
        conversationId: activeConvId,
        found: !!activeConvId
      };

      if (activeConvId) {
        try {
          const convMessages = await this.getConversationForOpenAI(activeConvId, token, true);
          debug.queries.conversationMessages = {
            success: true,
            count: convMessages?.length || 0,
            sample: convMessages?.slice(-3)?.map(m => ({
              role: m.role,
              contentPreview: m.content?.substring(0, 50) + '...'
            })) || []
          };
        } catch (convError) {
          debug.queries.conversationMessages = {
            success: false,
            error: convError.message
          };
        }
      }
    } catch (error) {
      debug.queries.latestConversation = {
        success: false,
        error: error.message
      };
    }

    // Análisis y recomendaciones
    debug.analysis = this._analyzeDebugData(debug.queries);
    debug.recommendations = this._generateRecommendations(debug.queries);

    return debug;

  } catch (error) {
    return { 
      error: error.message, 
      stack: error.stack,
      token: token.substring(0, 8) + '...'
    };
  }
}

/** 📊 Analizar datos de debug */
_analyzeDebugData(queries) {
  const analysis = {
    hasData: false,
    hasMessages: false,
    hasConversations: false,
    primaryIssues: [],
    dataQuality: 'unknown'
  };

  if (queries.totalDocuments?.success) {
    analysis.hasData = queries.totalDocuments.count > 0;
  }

  if (queries.messageTypes?.success) {
    const msgTypes = queries.messageTypes.types || [];
    analysis.hasMessages = msgTypes.some(type => ['user', 'bot', 'system'].includes(type.messageType));
    
    const totalMessages = msgTypes.reduce((sum, type) => sum + (type.count || 0), 0);
    if (totalMessages > 0) {
      analysis.messageStats = {
        total: totalMessages,
        types: msgTypes.reduce((acc, type) => {
          acc[type.messageType] = type.count;
          return acc;
        }, {})
      };
    }
  }

  if (queries.documentTypes?.success) {
    const docTypes = queries.documentTypes.types || [];
    analysis.hasConversations = docTypes.some(type => 
      type.documentType === 'conversation_info' || 
      type.documentType === 'conversation_message'
    );
    
    analysis.documentStats = docTypes.reduce((acc, type) => {
      acc[type.documentType] = type.count;
      return acc;
    }, {});
  }

  // Evaluar calidad de datos
  if (!analysis.hasData) {
    analysis.dataQuality = 'no_data';
    analysis.primaryIssues.push('No hay documentos para este token');
  } else if (!analysis.hasMessages) {
    analysis.dataQuality = 'no_messages';
    analysis.primaryIssues.push('Hay documentos pero no mensajes válidos');
  } else if (!analysis.hasConversations) {
    analysis.dataQuality = 'no_conversations';
    analysis.primaryIssues.push('Hay mensajes pero no estructura de conversaciones');
  } else {
    analysis.dataQuality = 'good';
  }

  // Verificar métodos funcionando
  if (queries.getMessagesByTokenTest?.success) {
    if (queries.getMessagesByTokenTest.count === 0) {
      analysis.primaryIssues.push('getMessagesByToken no retorna mensajes');
    }
  } else {
    analysis.primaryIssues.push('getMessagesByToken falla: ' + queries.getMessagesByTokenTest?.error);
  }

  if (queries.latestConversation?.success) {
    if (!queries.latestConversation.found) {
      analysis.primaryIssues.push('No se encuentra conversación activa');
    }
  } else {
    analysis.primaryIssues.push('getLatestConversationId falla: ' + queries.latestConversation?.error);
  }

  return analysis;
}

/** 💡 Generar recomendaciones basadas en el análisis */
_generateRecommendations(queries) {
  const recommendations = [];

  // Recomendaciones basadas en problemas encontrados
  if (queries.totalDocuments?.success && queries.totalDocuments.count === 0) {
    recommendations.push({
      priority: 'high',
      issue: 'No hay datos',
      action: 'Verificar que el token esté siendo usado correctamente al guardar mensajes',
      technical: 'Revisar que appendMessage esté recibiendo el token correctamente'
    });
  }

  if (queries.getMessagesByTokenTest?.success && queries.getMessagesByTokenTest.count === 0) {
    if (queries.totalDocuments?.count > 0) {
      recommendations.push({
        priority: 'high',
        issue: 'Datos existen pero getMessagesByToken no los encuentra',
        action: 'Problema en la query o filtros del método getMessagesByToken',
        technical: 'Revisar filtros de messageType y documentType en la query'
      });
    }
  }

  if (queries.getMessagesByTokenTest?.success === false) {
    recommendations.push({
      priority: 'critical',
      issue: 'getMessagesByToken falla completamente',
      action: 'Error en la implementación del método',
      technical: 'Revisar sintaxis de query y manejo de errores: ' + queries.getMessagesByTokenTest?.error
    });
  }

  if (queries.latestConversation?.success && !queries.latestConversation.found) {
    recommendations.push({
      priority: 'medium',
      issue: 'No hay conversación activa',
      action: 'Verificar creación de conversation_info documents',
      technical: 'Asegurar que createOrGetConversation esté funcionando'
    });
  }

  if (queries.recentMessages?.success && queries.recentMessages.count === 0) {
    if (queries.totalDocuments?.count > 0) {
      recommendations.push({
        priority: 'medium',
        issue: 'Hay documentos pero no tienen campo message',
        action: 'Verificar estructura de documentos guardados',
        technical: 'Revisar que appendMessage esté guardando el campo message correctamente'
      });
    }
  }

  // Recomendaciones generales
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'info',
      issue: 'Sistema funcionando correctamente',
      action: 'Continuar monitoreando',
      technical: 'Datos y métodos funcionando como esperado'
    });
  }

  return recommendations;
}

  /** 🔍 Método de diagnóstico para verificar datos en Cosmos */
  async debugTokenData(token) {
    if (!this.cosmosAvailable) {
      return { error: 'Cosmos no disponible', memoryData: this.memory.has(token) };
    }

    try {
      // Query básico para ver qué hay en la base de datos para este token
      const basicQuery = {
        query: `
          SELECT TOP 10 c.id, c.documentType, c.messageType, c.conversationId, c.timestamp
          FROM c
          WHERE c.userToken = @token
          ORDER BY c.timestamp DESC
        `,
        parameters: [{ name: '@token', value: token }]
      };

      const { resources } = await this.container.items
        .query(basicQuery, { partitionKey: token })
        .fetchAll();

      const summary = {
        totalDocuments: resources.length,
        documentTypes: {},
        messageTypes: {},
        conversations: new Set(),
        sample: resources.slice(0, 3)
      };

      resources.forEach(doc => {
        summary.documentTypes[doc.documentType] = (summary.documentTypes[doc.documentType] || 0) + 1;
        if (doc.messageType) {
          summary.messageTypes[doc.messageType] = (summary.messageTypes[doc.messageType] || 0) + 1;
        }
        if (doc.conversationId) {
          summary.conversations.add(doc.conversationId);
        }
      });

      summary.conversations = Array.from(summary.conversations);

      return summary;
    } catch (error) {
      return { error: error.message };
    }
  }

  /** 📜 Obtener mensajes por token (conversación más reciente) */
  async getMessagesByToken(token, { limit = 30, before = null } = {}) {
    try {
      if (!token) return [];

      if (!this.cosmosAvailable) {
        // 🔁 Fallback en memoria
        const bucket = this._memEnsure(token);
        const allMessages = [];
        for (const [, conv] of bucket.conversations) {
          allMessages.push(...conv.messages);
        }
        let list = allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        if (before) list = list.filter(m => m.timestamp < before);
        return list.slice(-limit).map(m => ({ role: m.role, content: m.content, ts: m.timestamp }));
      }

      // 🔎 Cosmos: traer todos los mensajes por token
      let queryText = `
        SELECT c.message, c.messageType, c.timestamp
        FROM c
        WHERE c.userToken = @token
          AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
          AND IS_DEFINED(c.message)
          AND c.message != ''
        ORDER BY c.timestamp ASC
      `;

      const params = [{ name: '@token', value: token }];
      if (before) {
        queryText += ` AND c.timestamp < @before `;
        params.push({ name: '@before', value: before });
      }

      const { resources } = await this.container.items
        .query({ query: queryText, parameters: params }, { partitionKey: token })
        .fetchAll();

      return (resources || [])
        .map((it) => ({
          role: it.messageType === 'bot' ? 'assistant' : (it.messageType === 'system' ? 'system' : 'user'),
          content: it.message,
          ts: it.timestamp,
        }))
        .slice(-limit);
    } catch (e) {
      console.warn('getMessagesByToken error:', e?.message);
      return [];
    }
  }

  /** 📚 Historial (mensajes individuales) por token */
  async getConversationHistoryByToken(token, limit = 20) {
    try {
      const convId = await this.getLatestConversationId(token);
      if (!convId) return [];
      return await this.getConversationHistory(convId, token, limit);
    } catch (e) {
      console.warn('getConversationHistoryByToken error:', e?.message);
      return [];
    }
  }

  /** 🗂️ Info de conversación */
  async getConversationInfo(conversationId, token) {
    try {
      if (!token) return null;
      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        return conv?.info || null;
      }
      const id = `conversation_${conversationId}`;
      const { resource } = await this.container.item(id, token).read();
      return resource || null;
    } catch (e) {
      if (e.code === 404) return null;
      console.error('❌ Error getConversationInfo:', e.message);
      return null;
    }
  }

  /** 💾 Crear o recuperar conversation_info */
  async createOrGetConversation(opts = {}) {
    try {
      const channel = opts.channel || 'web';
      const token = opts.token;
      const md = opts.metadata || {};
      const userName = md.userName || `Usuario`;
      const convId = md.conversationId || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docId = `conversation_${convId}`;
      const nowIso = DateTime.now().setZone('America/Mexico_City').toISO();

      if (!token) {
        return { id: convId };
      }

      if (!this.cosmosAvailable) {
        const conv = this._memCreateConv(token, convId, { channel, metadata: md, title: md.title, userName });
        return { id: conv.info.conversationId };
      }

      const base = {
        id: docId,
        conversationId: convId,
        userToken: token,
        userName,
        documentType: 'conversation_info',
        createdAt: nowIso,
        lastActivity: nowIso,
        messageCount: 0,
        isActive: true,
        channel,
        metadata: md,
        partitionKey: token,
        ttl: 60 * 60 * 24 * 90,
        version: '2.2.0',
        title: md.title || 'Nuevo chat',
      };

      const { resource } = await this.container.items.upsert(base);
      return { id: resource?.conversationId || convId };
    } catch (e) {
      console.warn('createOrGetConversation error:', e?.message);
      const id = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return { id };
    }
  }


  /** 🔁 Actualizar actividad/counters */
  async updateConversationActivity(conversationId, token) {
    try {
      if (!token || !conversationId) return false;

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return false;
        conv.info.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
        conv.info.messageCount = (conv.info.messageCount || 0) + 1;
        return true;
      }

      const docId = `conversation_${conversationId}`;
      const ts = DateTime.now().setZone('America/Mexico_City').toISO();

      let existingDoc = null;
      try {
        const { resource } = await this.container.item(docId, token).read();
        existingDoc = resource;
      } catch (e) {
        if (e.code !== 404) console.warn('⚠️ read conversation_info:', e.message);
      }

      const updatedDoc = {
        ...(existingDoc || {}),
        id: docId,
        conversationId,
        userToken: token,
        userName: existingDoc?.userName || 'Usuario',
        documentType: 'conversation_info',
        createdAt: existingDoc?.createdAt || ts,
        lastActivity: ts,
        messageCount: (existingDoc?.messageCount || 0) + 1,
        isActive: true,
        partitionKey: token,
        ttl: 60 * 60 * 24 * 90,
        version: '2.2.0',
      };

      const { resource } = await this.container.items.upsert(updatedDoc);
      return !!resource;
    } catch (e) {
      console.error('❌ updateConversationActivity:', e.message);
      return false;
    }
  }

  /** 🗑️ Limpieza de conversación (mantener info pero limpiar mensajes) */
  async clearConversation(conversationId, token) {
    try {
      if (!token || !conversationId) return false;

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return true;
        conv.messages = [];
        conv.info.messageCount = 0;
        conv.info.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
        return true;
      }

      // Cosmos (igual que tu versión)
      await this.cleanConversationMessages(conversationId, token);

      const q = {
        query: `
          SELECT c.id
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.userToken = @token
            AND c.documentType = 'conversation_message'
        `,
        parameters: [
          { name: '@conversationId', value: conversationId },
          { name: '@token', value: token },
        ],
      };

      const { resources } = await this.container.items
        .query(q, { partitionKey: token })
        .fetchAll();
        
      for (const d of resources || []) {
        try {
          await this.container.item(d.id, token).delete();
        } catch (_e) {}
      }

      const docId = `conversation_${conversationId}`;
      const now = DateTime.now().setZone('America/Mexico_City').toISO();
      
      let existingInfo = null;
      try {
        const { resource } = await this.container.item(docId, token).read();
        existingInfo = resource;
      } catch (e) {
        if (e.code !== 404) throw e;
      }

      const updated = {
        ...(existingInfo || {}),
        id: docId,
        conversationId,
        userToken: token,
        documentType: 'conversation_info',
        lastActivity: now,
        messageCount: 0,
        isActive: true,
        partitionKey: token,
      };
      
      await this.container.items.upsert(updated);
      return true;
    } catch (e) {
      console.warn('clearConversation error:', e?.message);
      return false;
    }
  }

  /** 📋 Listar conversaciones por token */
  async listConversations(opts = {}) {
    try {
      const token = opts.token;
      const limit = Math.min(Number(opts.limit || 50), 100);
      if (!token) return [];

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const list = [];
        for (const [, conv] of bucket.conversations) {
          if (conv.info?.isActive) list.push(conv.info);
        }
        return list
          .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
          .slice(0, limit);
      }

      const query = {
        query: `
          SELECT TOP @limit *
          FROM c
          WHERE c.userToken = @token
            AND c.documentType = 'conversation_info'
            AND c.isActive = true
          ORDER BY c.lastActivity DESC
        `,
        parameters: [
          { name: '@token', value: token },
          { name: '@limit', value: limit }
        ],
      };

      const { resources } = await this.container.items
        .query(query, { partitionKey: token })
        .fetchAll();

      return resources || [];
    } catch (e) {
      console.warn('listConversations error:', e?.message);
      return [];
    }
  }

  /** 📝 Renombrar conversación */
  async renameConversation(conversationId, title, opts = {}) {
    try {
      const token = opts.token;
      if (!token || !conversationId) return false;

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return false;
        conv.info.title = title;
        conv.info.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
        return true;
      }

      const docId = `conversation_${conversationId}`;
      
      let existingDoc = null;
      try {
        const { resource } = await this.container.item(docId, token).read();
        existingDoc = resource;
      } catch (e) {
        if (e.code === 404) return false;
        throw e;
      }

      const updatedDoc = {
        ...existingDoc,
        title,
        lastActivity: DateTime.now().setZone('America/Mexico_City').toISO(),
      };

      const { resource } = await this.container.items.upsert(updatedDoc);
      return !!resource;
    } catch (e) {
      console.warn('renameConversation error:', e?.message);
      return false;
    }
  }

  /** 📊 Actualizar metadata de conversación */
  async updateConversationMetadata(conversationId, metadata, token) {
    try {
      if (!token || !conversationId) return false;

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        const conv = bucket.conversations.get(conversationId);
        if (!conv) return false;
        conv.info = { ...conv.info, ...metadata, lastActivity: DateTime.now().setZone('America/Mexico_City').toISO() };
        return true;
      }

      const docId = `conversation_${conversationId}`;
      
      let existingDoc = null;
      try {
        const { resource } = await this.container.item(docId, token).read();
        existingDoc = resource;
      } catch (e) {
        if (e.code === 404) return false;
        throw e;
      }

      const updatedDoc = {
        ...existingDoc,
        ...metadata,
        lastActivity: DateTime.now().setZone('America/Mexico_City').toISO(),
      };

      const { resource } = await this.container.items.upsert(updatedDoc);
      return !!resource;
    } catch (e) {
      console.warn('updateConversationMetadata error:', e?.message);
      return false;
    }
  }

  /** 📈 getStats */
  async getStats() {
    try {
      if (!this.cosmosAvailable) {
        // Stats en memoria
        let conversations = 0, totalMessages = 0;
        for (const [, bucket] of this.memory) {
          conversations += bucket.conversations.size;
          for (const [, conv] of bucket.conversations) {
            totalMessages += conv.messages.length;
          }
        }
        return {
          available: true,
          initialized: this.initialized,
          database: '[memory]',
          container: '[memory]',
          partitionKey: '/userToken',
          stats: {
            totalDocuments: conversations + totalMessages,
            conversations,
            userMessages: 0,
            botMessages: 0,
            systemMessages: 0,
            conversationMessagesFormat: 0,
            totalMessages,
            recentActivity: null,
          },
          conversationMessagesFormat: null,
          timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
          version: '2.2.0-TokenBased',
          memoryFallback: true,
        };
      }

      // (Cosmos) tu versión original
      const statsResults = {
        totalDocuments: 0,
        conversations: 0,
        userMessages: 0,
        botMessages: 0,
        systemMessages: 0,
        conversationMessagesFormat: 0,
      };

      const queries = [
        { label: 'totalDocuments', query: 'SELECT VALUE COUNT(1) FROM c' },
        { label: 'conversations', query: "SELECT VALUE COUNT(1) FROM c WHERE c.documentType = 'conversation_info'" },
        { label: 'userMessages', query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'user'" },
        { label: 'botMessages', query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'bot'" },
        { label: 'systemMessages', query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'system'" },
        { label: 'conversationMessagesFormat', query: "SELECT VALUE COUNT(1) FROM c WHERE c.documentType = 'conversation_messages_format'" },
      ];

      for (const q of queries) {
        try {
          const { resources } = await this.container.items.query({ query: q.query }).fetchAll();
          statsResults[q.label] = resources[0] || 0;
        } catch (e) {
          console.warn(`⚠️ Query "${q.label}" falló:`, e.message);
          statsResults[q.label] = 'ERROR';
        }
      }

      let recentActivity = null;
      try {
        const recentQuery = {
          query: "SELECT TOP 1 c.timestamp FROM c WHERE IS_DEFINED(c.messageType) ORDER BY c.timestamp DESC",
        };
        const { resources } = await this.container.items.query(recentQuery).fetchAll();
        if (resources.length > 0) recentActivity = resources[0].timestamp;
      } catch (e) {
        console.warn('⚠️ Error actividad reciente:', e.message);
      }

      const conversationMessagesStats = await this.getConversationMessagesStats();

      return {
        available: true,
        initialized: this.initialized,
        database: this.databaseId,
        container: this.containerId,
        partitionKey: this.partitionKey,
        stats: {
          ...statsResults,
          totalMessages:
            (typeof statsResults.userMessages === 'number' ? statsResults.userMessages : 0) +
            (typeof statsResults.botMessages === 'number' ? statsResults.botMessages : 0) +
            (typeof statsResults.systemMessages === 'number' ? statsResults.systemMessages : 0),
          recentActivity,
        },
        conversationMessagesFormat: conversationMessagesStats.conversationMessagesFormat || null,
        timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
        version: '2.2.0-TokenBased',
      };
    } catch (error) {
      console.error('❌ Error getStats:', error);
      return { available: false, error: error.message };
    }
  }

  /** 📊 Stats específicos de conversación en formato de mensajes */
  async getConversationMessagesStats() {
    try {
      if (!this.cosmosAvailable) {
        return { conversationMessagesFormat: 0 };
      }

      const query = {
        query: `
          SELECT VALUE COUNT(1)
          FROM c
          WHERE c.documentType = 'conversation_messages_format'
        `
      };

      const { resources } = await this.container.items.query(query).fetchAll();
      return { conversationMessagesFormat: resources[0] || 0 };
    } catch (e) {
      console.warn('getConversationMessagesStats error:', e.message);
      return { conversationMessagesFormat: 0 };
    }
  }
}