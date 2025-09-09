// services/cosmosService.js
import { CosmosClient } from '@azure/cosmos';
import { DateTime } from 'luxon';
import 'dotenv/config';

/**
 * Servicio de Cosmos DB - Persistencia con partición por /userToken
 * - Usa token como identificador principal para conversaciones y mensajes
 * - Elimina funciones de eliminación de conversaciones
 * - Mantiene compatibilidad con formato de mensajes por roles
 */
export default class CosmosService {
  constructor() {
    this.initialized = false;
    this.initializationError = null;

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
        console.warn('⚠️ Cosmos DB no configurado - Variables faltantes:');
        console.warn(`   COSMOS_DB_ENDPOINT: ${!!endpoint}`);
        console.warn(`   COSMOS_DB_KEY: ${!!key}`);
        console.warn(`   COSMOS_DB_DATABASE_ID: ${!!this.databaseId}`);
        console.warn(`   COSMOS_DB_CONTAINER_ID: ${!!this.containerId}`);
        console.warn('ℹ️ Usando MemoryStorage como fallback');
        this.cosmosAvailable = false;
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
    }
  }

  isAvailable() {
    return this.cosmosAvailable && this.initialized;
  }

  getConfigInfo() {
    return {
      available: this.cosmosAvailable,
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
        autoTTL: true,
        upsertOperations: true,
        concurrencySafe: true,
      },
    };
  }

  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** 🔎 Buscar información de conversación por token */
  async findConversationInfoByToken(conversationId, token) {
    if (!this.cosmosAvailable || !token) return null;

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
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - conversación no guardada');
        return null;
      }
      if (!conversationId || !token || !Array.isArray(messages)) return null;

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

  /** 📊 Guardar información de conversación */
  async saveConversationInfo(conversationId, token, userName, additionalData = {}) {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - conversación no guardada');
        return null;
      }

      if (!conversationId || !token) {
        console.error('❌ saveConversationInfo: conversationId o token faltante');
        return null;
      }

      const conversationDocId = `conversation_${conversationId}`;
      const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

      const conversationDoc = {
        id: conversationDocId,
        conversationId: conversationId,
        userToken: token,
        userName: userName || 'Usuario',
        documentType: 'conversation_info',
        createdAt: timestamp,
        lastActivity: timestamp,
        messageCount: 0,
        isActive: true,
        partitionKey: token,
        ttl: 60 * 60 * 24 * 90,
        version: '2.2.0',
        ...additionalData
      };

      console.log(`💾 [${token}] Guardando info de conversación: ${conversationDocId}`);

      const { resource: upsertedItem } = await this.container.items.upsert(conversationDoc);
      
      console.log(`✅ [${token}] Info de conversación guardada exitosamente`);
      return upsertedItem;

    } catch (error) {
      console.error(`❌ Error en saveConversationInfo:`, {
        error: error.message,
        conversationId: conversationId,
        token: token,
        userName: userName
      });
      return null;
    }
  }
    
  /** 📖 Obtener conversación (arreglo por roles) */
  async getConversationMessages(conversationId, token) {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - conversación vacía');
        return [];
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

  /** ➕ Agregar mensaje al arreglo por roles (y persistir) */
  async addMessageToConversation(conversationId, token, role, content, userInfo = null) {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - no se agrega mensaje');
        return false;
      }
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
      return result !== null;
    } catch (error) {
      console.error('❌ Error agregando mensaje (roles):', error);
      return false;
    }
  }

  /** 💾 Guardar mensaje individual + sync a arreglo por roles */
  async saveMessage(message, conversationId, token, userName = null, messageType = 'user') {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - mensaje no guardado');
        return null;
      }
      if (!message || !conversationId || !token) return null;

      const messageId = this.generateMessageId();
      const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

      const messageDoc = {
        id: messageId,
        messageId,
        conversationId,
        userToken: token,
        userName: userName || 'Usuario',
        message: String(message).substring(0, 4000),
        messageType, // 'user' | 'bot' | 'system'
        timestamp,
        dateCreated: timestamp,
        partitionKey: token,
        ttl: 60 * 60 * 24 * 90,
        documentType: 'conversation_message',
        version: '2.2.0',
        isMessage: true,
        hasContent: true,
      };

      const { resource: createdItem } = await this.container.items.create(messageDoc);

      // Sincroniza arreglo por roles (best effort)
      try {
        const role = messageType === 'bot' ? 'assistant' : (messageType === 'system' ? 'system' : 'user');
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
      if (!this.cosmosAvailable) return false;
      const id = `conversation_messages_${conversationId}`;
      await this.container.item(id, token).delete();
      return true;
    } catch (e) {
      if (e.code === 404) return true;
      console.error('❌ Error limpiando conversación (roles):', e.message);
      return false;
    }
  }

  /** 📊 Stats de conversaciones */
  async getConversationMessagesStats() {
    try {
      if (!this.cosmosAvailable) return { available: false };
      const q = {
        query: `
          SELECT 
            COUNT(1) as totalConversations,
            SUM(c.messageCount) as totalMessages,
            AVG(c.messageCount) as avgMessagesPerConversation
          FROM c
          WHERE c.documentType = 'conversation_messages_format'
        `,
      };
      const { resources } = await this.container.items.query(q).fetchAll();
      const stats = resources[0] || { totalConversations: 0, totalMessages: 0, avgMessagesPerConversation: 0 };
      return {
        available: true,
        conversationMessagesFormat: {
          totalConversations: stats.totalConversations,
          totalMessages: stats.totalMessages,
          avgMessagesPerConversation: Math.round(stats.avgMessagesPerConversation || 0),
        },
        timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
      };
    } catch (e) {
      console.error('❌ Error stats (roles):', e);
      return { available: false, error: e.message };
    }
  }

  /** 📚 Historial (mensajes individuales) en orden ascendente */
  async getConversationHistory(conversationId, token, limit = 20) {
    try {
      if (!this.cosmosAvailable) return [];

      console.log(`📚 [${token}] OBTENIENDO HISTORIAL: ${conversationId}`);

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

  /** 🗂️ Info de conversación */
  async getConversationInfo(conversationId, token) {
    try {
      if (!this.cosmosAvailable || !token) return null;
      
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
      if (!this.cosmosAvailable) {
        const id = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return { id };
      }

      const channel = opts.channel || 'web';
      const token = opts.token;
      const md = opts.metadata || {};
      const userName = md.userName || `Usuario`;
      const convId = md.conversationId || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docId = `conversation_${convId}`;
      const nowIso = DateTime.now().setZone('America/Mexico_City').toISO();

      if (!token) {
        console.warn('createOrGetConversation: token requerido');
        return { id: convId };
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
      if (!this.cosmosAvailable || !token) return false;
      if (!conversationId) return false;

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
      if (!this.cosmosAvailable || !token) return false;

      // Limpiar mensajes del formato de roles
      await this.cleanConversationMessages(conversationId, token);

      // Limpiar mensajes individuales
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

      // Resetear contador en conversation_info
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

  /** 📜 getMessages (API /history) — devuelve [{role, content, ts}] */
  async getMessages(conversationId, opts = {}) {
    try {
      if (!this.cosmosAvailable) return [];
      
      const limit = Math.min(Number(opts.limit || 30), 100);
      const token = opts.token;
      
      if (!token) {
        console.warn('getMessages: token requerido');
        return [];
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

      if (opts.before) {
        queryText += ` AND c.timestamp < @before `;
        params.push({ name: '@before', value: opts.before });
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

  /** 📋 Listar conversaciones por token */
  async listConversations(opts = {}) {
    try {
      if (!this.cosmosAvailable) return [];
      
      const token = opts.token;
      const limit = Math.min(Number(opts.limit || 50), 100);
      
      if (!token) {
        console.warn('listConversations: token requerido');
        return [];
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
      if (!this.cosmosAvailable) return false;
      
      const token = opts.token;
      if (!token) {
        console.warn('renameConversation: token requerido');
        return false;
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
      if (!this.cosmosAvailable || !token) return false;

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

  /** 📈 getStats: estadísticas del servicio */
  async getStats() {
    try {
      if (!this.cosmosAvailable) {
        return { available: false, error: this.initializationError };
      }

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
}