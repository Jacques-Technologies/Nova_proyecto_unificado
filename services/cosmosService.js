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

  /** 🧭 Devuelve el último conversationId activo para un token */
  async getLatestConversationId(token) {
    try {
      if (!token) return null;

      if (!this.cosmosAvailable) {
        const bucket = this._memEnsure(token);
        return bucket.lastConvId || null;
      }

      const q = {
        query: `
          SELECT TOP 1 c.conversationId
          FROM c
          WHERE c.userToken = @token
            AND c.documentType = 'conversation_info'
            AND c.isActive = true
          ORDER BY c.lastActivity DESC
        `,
        parameters: [{ name: '@token', value: token }],
      };

      const { resources } = await this.container.items.query(q, { partitionKey: token }).fetchAll();
      return resources?.[0]?.conversationId || null;
    } catch (e) {
      console.warn('getLatestConversationId error:', e?.message);
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

  /** 💾 Guardar mensaje individual + sync a arreglo por roles */
  async saveMessage(message, conversationId, token, userName = null, messageType = 'user') {
    try {
      if (!message || !conversationId || !token) return null;

      const role = messageType === 'bot' ? 'assistant' : (messageType === 'system' ? 'system' : 'user');
      const ts = DateTime.now().setZone('America/Mexico_City').toISO();

      console.log(`💾 saveMessage - Token: ${token?.substring(0, 8)}..., Role: ${role}, ConvId: ${conversationId}`);

      if (!this.cosmosAvailable) {
        // Persistencia en memoria
        this._memCreateConv(token, conversationId, { metadata: { userName } });
        this._memAppendMessage(token, conversationId, { role, content: String(message).substring(0, 4000), ts });
        console.log(`💾 Mensaje guardado en memoria`);
        return { id: this.generateMessageId(), memory: true };
      }

      // Cosmos
      const messageId = this.generateMessageId();
      const messageDoc = {
        id: messageId,
        messageId,
        conversationId,
        userToken: token,
        userName: userName || 'Usuario',
        message: String(message).substring(0, 4000),
        messageType, // 'user' | 'bot' | 'system'
        timestamp: ts,
        dateCreated: ts,
        partitionKey: token,
        ttl: 60 * 60 * 24 * 90,
        documentType: 'conversation_message',
        version: '2.2.0',
        isMessage: true,
        hasContent: true,
      };

      console.log(`💾 Creando documento en Cosmos: ${messageId}`);
      const { resource: createdItem } = await this.container.items.create(messageDoc);
      console.log(`✅ Documento creado en Cosmos: ${createdItem?.id}`);

      // Sincroniza arreglo por roles (best effort)
      try {
        await this.addMessageToConversation(conversationId, token, role, message, { nombre: userName });
      } catch (e) {
        console.warn('⚠️ Sync roles falló (continuando):', e.message);
      }

      // Actualiza actividad (best effort)
      setImmediate(() => {
        this.updateConversationActivity(conversationId, token).catch((e) =>
          console.warn('⚠️ updateConversationActivity:', e.message)
        );
      });

      return createdItem;
    } catch (error) {
      console.error('❌ Error guardando mensaje:', error.message);
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
// Reemplaza el método getMessagesByToken duplicado en cosmosService.js
// (elimina la segunda definición y usa esta versión mejorada)

/** 📜 Obtener mensajes por token - VERSIÓN MEJORADA CON DIAGNÓSTICO */
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

    // 🔎 Cosmos: primero hacer un conteo básico para diagnóstico
    console.log('🔍 Haciendo conteo de documentos para diagnóstico...');
    const countQuery = {
      query: `SELECT VALUE COUNT(1) FROM c WHERE c.userToken = @token`,
      parameters: [{ name: '@token', value: token }]
    };

    const { resources: countResources } = await this.container.items
      .query(countQuery, { partitionKey: token })
      .fetchAll();
    
    const totalDocs = countResources[0] || 0;
    console.log(`📊 Total documentos para token: ${totalDocs}`);

    if (totalDocs === 0) {
      console.warn('⚠️ No hay documentos para este token');
      return [];
    }

    // 🔎 MÉTODO 1: Buscar mensajes con documentType específico
    console.log('🔍 Buscando mensajes con documentType = conversation_message...');
    let queryText = `
      SELECT c.message, c.messageType, c.timestamp, c.conversationId
      FROM c
      WHERE c.userToken = @token
        AND c.documentType = 'conversation_message'
        AND IS_DEFINED(c.message)
        AND c.message != ''
    `;

    const params = [{ name: '@token', value: token }];
    
    if (before) {
      queryText += ` AND c.timestamp < @before`;
      params.push({ name: '@before', value: before });
    }

    queryText += ` ORDER BY c.timestamp ASC`;

    console.log(`🔍 Ejecutando query Cosmos con ${params.length} parámetros`);

    const { resources } = await this.container.items
      .query({ query: queryText, parameters: params }, { partitionKey: token })
      .fetchAll();

    console.log(`📊 Query con documentType result: ${resources?.length || 0} items`);

    let result = [];
    if (resources && resources.length > 0) {
      result = resources
        .filter(item => item.message && item.message.trim() !== '')
        .map((item) => ({
          role: item.messageType === 'bot' ? 'assistant' : (item.messageType === 'system' ? 'system' : 'user'),
          content: item.message,
          ts: item.timestamp,
        }))
        .slice(-limit);
    }

    // 🔎 MÉTODO 2: Si no encontramos nada, buscar sin filtro de documentType
    if (result.length === 0) {
      console.log('🔍 Buscando mensajes sin filtro de documentType...');
      
      const fallbackQuery = `
        SELECT c.message, c.messageType, c.timestamp, c.documentType
        FROM c
        WHERE c.userToken = @token
          AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
          AND IS_DEFINED(c.message)
          AND c.message != ''
        ORDER BY c.timestamp ASC
      `;

      const { resources: fallbackResources } = await this.container.items
        .query({ 
          query: fallbackQuery, 
          parameters: [{ name: '@token', value: token }] 
        }, { partitionKey: token })
        .fetchAll();

      console.log(`📊 Query fallback result: ${fallbackResources?.length || 0} items`);

      if (fallbackResources && fallbackResources.length > 0) {
        result = fallbackResources
          .filter(item => item.message && item.message.trim() !== '')
          .map((item) => ({
            role: item.messageType === 'bot' ? 'assistant' : (item.messageType === 'system' ? 'system' : 'user'),
            content: item.message,
            ts: item.timestamp,
          }))
          .slice(-limit);
      }
    }

    // 🔎 MÉTODO 3: Diagnóstico si aún no hay resultados
    if (result.length === 0) {
      console.log('🔍 Ejecutando diagnóstico completo...');
      
      const diagnosticQuery = `
        SELECT TOP 10 c.id, c.documentType, c.messageType, c.message, c.timestamp
        FROM c
        WHERE c.userToken = @token
        ORDER BY c.timestamp DESC
      `;

      const { resources: diagResources } = await this.container.items
        .query({ 
          query: diagnosticQuery, 
          parameters: [{ name: '@token', value: token }] 
        }, { partitionKey: token })
        .fetchAll();

      console.log(`🔍 Diagnóstico: encontrados ${diagResources?.length || 0} documentos totales`);
      
      if (diagResources && diagResources.length > 0) {
        console.log('📊 Tipos de documento encontrados:');
        const docTypes = {};
        diagResources.forEach((doc, idx) => {
          docTypes[doc.documentType] = (docTypes[doc.documentType] || 0) + 1;
          console.log(`   ${idx + 1}. DocumentType: ${doc.documentType}, MessageType: ${doc.messageType}, HasMessage: ${!!doc.message}, Message: ${doc.message?.substring(0, 30)}...`);
        });
        console.log('📊 Resumen tipos:', docTypes);

        // Intentar extraer mensajes válidos del diagnóstico
        const validFromDiag = diagResources
          .filter(doc => doc.message && doc.message.trim() !== '' && doc.messageType)
          .map(doc => ({
            role: doc.messageType === 'bot' ? 'assistant' : (doc.messageType === 'system' ? 'system' : 'user'),
            content: doc.message,
            ts: doc.timestamp,
          }));

        if (validFromDiag.length > 0) {
          result = validFromDiag.slice(-limit);
          console.log(`📖 Extraídos del diagnóstico: ${result.length} mensajes`);
        }
      }
    }

    console.log(`✅ getMessagesByToken resultado final: ${result.length} mensajes`);
    
    if (result.length > 0) {
      console.log(`📝 Primer mensaje: ${result[0].role}: ${result[0].content.substring(0, 50)}...`);
      console.log(`📝 Último mensaje: ${result[result.length - 1].role}: ${result[result.length - 1].content.substring(0, 50)}...`);
    }
    
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

  /** ➕ Append universal */
  async appendMessage(conversationId, msg) {
    try {
      if (!conversationId || !msg?.content) return null;

      const token = msg?.metadata?.token || msg.token;
      if (!token) {
        console.warn('appendMessage: token requerido');
        return null;
      }

      const userName = msg.userName || `Usuario`;
      const role = msg.role || 'user';
      const messageType = role === 'assistant' ? 'bot' : (role === 'system' ? 'system' : 'user');

      return await this.saveMessage(msg.content, conversationId, token, userName, messageType);
    } catch (e) {
      console.error('appendMessage error:', e);
      return null;
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