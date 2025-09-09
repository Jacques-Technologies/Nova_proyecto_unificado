// services/cosmosService.js
import { CosmosClient } from '@azure/cosmos';
import { DateTime } from 'luxon';
import 'dotenv/config';

/**
 * Servicio de Cosmos DB CORREGIDO - Persistencia estable con partición por /userId
 * - Resuelve el owner (userId) de una conversación cuando falta o es incorrecto
 * - Reintentos de upsert con la partitionKey correcta
 * - Fallback para reconstruir conversación desde mensajes individuales
 */
export default class CosmosService {
  constructor() {
    this.initialized = false;
    this.initializationError = null;

    console.log('🚀 Inicializando Cosmos DB Service con formato de conversación...');
    this.initializeCosmosClient();
  }

  initializeCosmosClient() {
    try {
      const endpoint = process.env.COSMOS_DB_ENDPOINT;
      const key = process.env.COSMOS_DB_KEY;
      this.databaseId = process.env.COSMOS_DB_DATABASE_ID;
      this.containerId = process.env.COSMOS_DB_CONTAINER_ID;
      this.partitionKey = process.env.COSMOS_DB_PARTITION_KEY || '/userId';

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
        userAgentSuffix: 'NovaBot/2.1.3-ConversationFormat',
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
      version: '2.1.3-ConversationFormat',
      features: {
        individualMessages: true,
        conversationHistory: true,
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

  /** 🔎 Resuelve el owner de la conversación (userId real) */
  async _resolveOwnerUserId(conversationId, hintedUserId) {
    if (hintedUserId) return hintedUserId;
    const info = await this.findConversationInfoAnyPartition(conversationId);
    return info?.userId || 'anonymous';
  }

  /** 🧭 Buscar conversation_info sin conocer la partitionKey */
  async findConversationInfoAnyPartition(conversationId) {
    if (!this.cosmosAvailable) return null;

    const byIdQuery = {
      query: `SELECT TOP 1 * FROM c WHERE c.id = @id`,
      parameters: [{ name: '@id', value: `conversation_${conversationId}` }],
    };

    try {
      let { resources } = await this.container.items.query(byIdQuery).fetchAll();
      if (resources?.length) return resources[0];

      const byConvQuery = {
        query: `
          SELECT TOP 1 *
          FROM c
          WHERE c.documentType = 'conversation_info'
            AND c.conversationId = @conversationId
        `,
        parameters: [{ name: '@conversationId', value: conversationId }],
      };

      const res2 = await this.container.items.query(byConvQuery).fetchAll();
      return res2?.resources?.[0] || null;
    } catch (e) {
      console.warn('findConversationInfoAnyPartition error:', e?.message);
      return null;
    }
  }

  /** 💾 Guardar doc de conversación (arreglo de roles) con reintento por PK */
  async saveConversationMessages(conversationId, userId, messages, userInfo = null) {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - conversación no guardada');
        return null;
      }
      if (!conversationId || !userId || !Array.isArray(messages)) return null;

      const id = `conversation_messages_${conversationId}`;
      const ts = DateTime.now().setZone('America/Mexico_City').toISO();

      const conversationDoc = {
        id,
        conversationId,
        userId,
        userName: userInfo?.nombre || 'Usuario',
        documentType: 'conversation_messages_format',
        messages,
        messageCount: messages.length,
        lastUpdated: ts,
        createdAt: ts,
        partitionKey: userId,
        ttl: 60 * 60 * 24 * 90,
        version: '2.1.3-conversation-format',
        format: 'openai_chat_format',
      };

      try {
        const { resource } = await this.container.items.upsert(conversationDoc);
        return resource;
      } catch (_e) {
        // Reintento: resolver owner y reintentar el upsert
        const owner = await this._resolveOwnerUserId(conversationId, userId);
        const retryDoc = { ...conversationDoc, userId: owner, partitionKey: owner };
        const { resource: savedDoc2 } = await this.container.items.upsert(retryDoc);
        return savedDoc2;
      }
    } catch (error) {
      console.error('❌ Error guardando conversación (roles):', error.message);
      return null;
    }
  }

  /** 📖 Obtener conversación (arreglo por roles) con reintento y fallback */
  async getConversationMessages(conversationId, userId) {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - conversación vacía');
        return [];
      }

      const docId = `conversation_messages_${conversationId}`;
      let effectiveUserId = userId;

      // 1) Intento directo
      if (effectiveUserId) {
        try {
          const { resource } = await this.container.item(docId, effectiveUserId).read();
          if (resource?.messages) return resource.messages;
        } catch (e) {
          if (e.code !== 404) throw e;
        }
      }

      // 2) Resolver owner y reintentar
      effectiveUserId = await this._resolveOwnerUserId(conversationId, effectiveUserId);
      try {
        const { resource } = await this.container.item(docId, effectiveUserId).read();
        if (resource?.messages) return resource.messages;
      } catch (e) {
        if (e.code !== 404) throw e;
      }

      // 3) Fallback: reconstruir desde mensajes individuales (cross-partition)
      const q = {
        query: `
          SELECT c.message, c.messageType, c.timestamp
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.documentType = 'conversation_message'
          ORDER BY c.timestamp ASC
        `,
        parameters: [{ name: '@conversationId', value: conversationId }],
      };
      const { resources } = await this.container.items.query(q).fetchAll();
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
  async getConversationForOpenAI(conversationId, userId, includeSystem = true) {
    try {
      const msgs = await this.getConversationMessages(conversationId, userId);
      if (!msgs.length) return [];
      const filtered = includeSystem ? msgs : msgs.filter((m) => m.role !== 'system');
      return filtered.map((m) => ({ role: m.role, content: m.content }));
    } catch (e) {
      console.error('❌ Error formateando para OpenAI:', e.message);
      return [];
    }
  }

  /** ➕ Agregar mensaje al arreglo por roles (y persistir) */
  async addMessageToConversation(conversationId, userId, role, content, userInfo = null) {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - no se agrega mensaje');
        return false;
      }
      const validRoles = ['system', 'user', 'assistant'];
      if (!validRoles.includes(role)) return false;

      const effectiveUserId = await this._resolveOwnerUserId(conversationId, userId);
      let currentMessages = await this.getConversationMessages(conversationId, effectiveUserId);

      currentMessages.push({
        role,
        content,
        timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
      });
      if (currentMessages.length > 20) currentMessages = currentMessages.slice(-20);

      const result = await this.saveConversationMessages(
        conversationId,
        effectiveUserId,
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
  async saveMessage(message, conversationId, userId, userName = null, messageType = 'user') {
    try {
      if (!this.cosmosAvailable) {
        console.warn('⚠️ Cosmos DB no disponible - mensaje no guardado');
        return null;
      }
      if (!message || !conversationId || !userId) return null;

      const messageId = this.generateMessageId();
      const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

      const messageDoc = {
        id: messageId,
        messageId,
        conversationId,
        userId,
        userName: userName || 'Usuario',
        message: String(message).substring(0, 4000),
        messageType, // 'user' | 'bot' | 'system'
        timestamp,
        dateCreated: timestamp,
        partitionKey: userId,
        ttl: 60 * 60 * 24 * 90,
        documentType: 'conversation_message',
        version: '2.1.3',
        isMessage: true,
        hasContent: true,
      };

      const { resource: createdItem } = await this.container.items.create(messageDoc);

      // Sincroniza arreglo por roles (best effort)
      try {
        const role = messageType === 'bot' ? 'assistant' : (messageType === 'system' ? 'system' : 'user');
        await this.addMessageToConversation(conversationId, userId, role, message, { nombre: userName });
      } catch (e) {
        console.warn('⚠️ Sync roles falló (continuando):', e.message);
      }

      // Actualiza actividad (best effort)
      setImmediate(() => {
        this.updateConversationActivity(conversationId, userId).catch((e) =>
          console.warn('⚠️ updateConversationActivity:', e.message)
        );
      });

      return createdItem;
    } catch (error) {
      console.error('❌ Error guardando mensaje:', error.message);
      return null;
    }
  }

  /** 🧹 Eliminar arreglo por roles */
  async cleanConversationMessages(conversationId, userId) {
    try {
      if (!this.cosmosAvailable) return false;
      const id = `conversation_messages_${conversationId}`;
      await this.container.item(id, userId).delete();
      return true;
    } catch (e) {
      if (e.code === 404) return true;
      console.error('❌ Error limpiando conversación (roles):', e.message);
      return false;
    }
  }

  /** 📊 Stats de arreglo por roles */
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
  async getConversationHistory(conversationId, userId, limit = 20) {
    try {
      if (!this.cosmosAvailable) return [];

      console.log(`📚 [${userId}] OBTENIENDO HISTORIAL: ${conversationId}`);

      const mainQuery = {
        query: `
          SELECT *
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.userId = @userId
            AND (c.messageType = 'user' OR c.messageType = 'bot')
          ORDER BY c.timestamp ASC
        `,
        parameters: [
          { name: '@conversationId', value: conversationId },
          { name: '@userId', value: userId },
        ],
      };

      let messages = [];
      try {
        const { resources } = await this.container.items
          .query(mainQuery, { partitionKey: userId })
          .fetchAll();
        messages = resources;
      } catch (e) {
        console.warn('⚠️ Query principal falló:', e.message);
      }

      if (!messages.length) {
        const wideQuery = {
          query: `
            SELECT *
            FROM c
            WHERE c.userId = @userId
              AND c.documentType = 'conversation_message'
            ORDER BY c.timestamp DESC
          `,
          parameters: [{ name: '@userId', value: userId }],
        };
        const { resources } = await this.container.items.query(wideQuery, { partitionKey: userId }).fetchAll();
        messages = resources.filter(
          (m) => m.conversationId === conversationId && (m.messageType === 'user' || m.messageType === 'bot')
        );
      }

      if (!messages.length) return [];

      return messages
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-limit)
        .map((m) => ({
          id: m.messageId || m.id,
          message: m.message || 'Mensaje vacío',
          conversationId: m.conversationId,
          userId: m.userId,
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

  /** 🗂️ Info de conversación (lectura directa si hay PK) */
  async getConversationInfo(conversationId, userId) {
    try {
      if (!this.cosmosAvailable) return null;
      const id = `conversation_${conversationId}`;

      if (userId) {
        const { resource } = await this.container.item(id, userId).read();
        return resource || null;
      }
      return await this.findConversationInfoAnyPartition(conversationId);
    } catch (e) {
      if (e.code === 404) return null;
      console.error('❌ Error getConversationInfo:', e.message);
      return null;
    }
  }

  /** 💾 Crear o recuperar conversation_info (owner = CveUsuario si existe) */
  async createOrGetConversation(opts = {}) {
    try {
      if (!this.cosmosAvailable) {
        const id = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return { id };
      }

      const channel = opts.channel || 'web';
      const token = opts.token || null;
      const md = opts.metadata || {};
      const userId = md.CveUsuario || md.userId || 'anonymous';
      const userName = md.userName || `Usuario ${userId}`;
      const convId = md.conversationId || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docId = `conversation_${convId}`;
      const nowIso = DateTime.now().setZone('America/Mexico_City').toISO();

      const base = {
        id: docId,
        conversationId: convId,
        userId,
        userName,
        documentType: 'conversation_info',
        createdAt: nowIso,
        lastActivity: nowIso,
        messageCount: 0,
        isActive: true,
        channel,
        metadata: md,
        partitionKey: userId,
        ttl: 60 * 60 * 24 * 90,
        version: '2.1.3',
        title: md.title || 'Nuevo chat',
        token,
      };

      const { resource } = await this.container.items.upsert(base);
      return { id: resource?.conversationId || convId };
    } catch (e) {
      console.warn('createOrGetConversation error:', e?.message);
      const id = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return { id };
    }
  }

  /** ➕ Append universal: resuelve owner si falta */
  async appendMessage(conversationId, msg) {
    try {
      if (!conversationId || !msg?.content) return null;

      let effectiveUserId = msg.userId || msg?.metadata?.CveUsuario;
      if (!effectiveUserId) {
        effectiveUserId = await this._resolveOwnerUserId(conversationId, null);
      }

      const userName = msg.userName || `Usuario ${effectiveUserId}`;
      const role = msg.role || 'user';
      const messageType = role === 'assistant' ? 'bot' : (role === 'system' ? 'system' : 'user');

      return await this.saveMessage(msg.content, conversationId, effectiveUserId, userName, messageType);
    } catch (e) {
      console.error('appendMessage error:', e);
      return null;
    }
  }

  /** 🔁 Actualizar actividad/counters sin colisiones de concurrencia */
  async updateConversationActivity(conversationId, userId) {
    try {
      if (!this.cosmosAvailable) return false;
      if (!conversationId || !userId) return false;

      const docId = `conversation_${conversationId}`;
      const ts = DateTime.now().setZone('America/Mexico_City').toISO();

      let existingDoc = null;
      try {
        const { resource } = await this.container.item(docId, userId).read();
        existingDoc = resource;
      } catch (e) {
        if (e.code !== 404) console.warn('⚠️ read conversation_info:', e.message);
      }

      const updatedDoc = {
        ...(existingDoc || {}),
        id: docId,
        conversationId,
        userId,
        userName: existingDoc?.userName || 'Usuario',
        documentType: 'conversation_info',
        createdAt: existingDoc?.createdAt || ts,
        lastActivity: ts,
        messageCount: (existingDoc?.messageCount || 0) + 1,
        isActive: true,
        partitionKey: userId,
        ttl: 60 * 60 * 24 * 90,
        version: '2.1.3',
      };

      const { resource } = await this.container.items.upsert(updatedDoc);
      return !!resource;
    } catch (e) {
      console.error('❌ updateConversationActivity:', e.message);
      return false;
    }
  }

  /** 🗑️ Limpieza lógica: borra mensajes (roles + individuales) y resetea counters */
  async clearConversation(conversationId) {
    try {
      if (!this.cosmosAvailable) return false;

      const info = await this.getConversationInfo(conversationId, undefined);
      const userId = info?.userId;
      if (!userId) return false;

      await this.cleanConversationMessages(conversationId, userId);

      const q = {
        query: `
          SELECT c.id
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.userId = @userId
            AND c.documentType != 'conversation_info'
        `,
        parameters: [
          { name: '@conversationId', value: conversationId },
          { name: '@userId', value: userId },
        ],
      };

      const { resources } = await this.container.items.query(q, { partitionKey: userId }).fetchAll();
      for (const d of resources || []) {
        try {
          await this.container.item(d.id, userId).delete();
        } catch (_e) {}
      }

      const docId = `conversation_${conversationId}`;
      const now = DateTime.now().setZone('America/Mexico_City').toISO();
      const updated = {
        ...(info || {}),
        id: docId,
        conversationId,
        userId,
        documentType: 'conversation_info',
        lastActivity: now,
        messageCount: 0,
        isActive: true,
        partitionKey: userId,
      };
      await this.container.items.upsert(updated);
      return true;
    } catch (e) {
      console.warn('clearConversation error:', e?.message);
      return false;
    }
  }

  /** 🧨 Eliminar conversación (duro) */
  async deleteConversation(conversationId, userOrOpts) {
    try {
      if (!this.cosmosAvailable) return false;

      let userId = typeof userOrOpts === 'string' ? userOrOpts : (userOrOpts?.by || null);
      if (!userId) userId = await this._resolveOwnerUserId(conversationId, null);
      if (!userId) return false;

      const q = {
        query: `
          SELECT c.id
          FROM c
          WHERE c.conversationId = @conversationId
            AND c.userId = @userId
        `,
        parameters: [
          { name: '@conversationId', value: conversationId },
          { name: '@userId', value: userId },
        ],
      };

      const { resources: docs } = await this.container.items
        .query(q, { partitionKey: userId })
        .fetchAll();

      let deletedCount = 0;
      for (const doc of docs) {
        try {
          await this.container.item(doc.id, userId).delete();
          deletedCount++;
        } catch (error) {
          console.warn(`⚠️ Error eliminando doc ${doc.id}:`, error.message);
        }
      }
      await this.cleanConversationMessages(conversationId, userId);
      return deletedCount > 0;
    } catch (error) {
      console.error('❌ deleteConversation:', error);
      return false;
    }
  }

  /** 🧰 Soft delete */
  async softDeleteConversation(conversationId, opts = {}) {
    try {
      if (!this.cosmosAvailable) return false;

      const info = await this.getConversationInfo(conversationId, opts.by || undefined);
      const userId = info?.userId || opts.by;
      if (!userId) return false;

      const docId = `conversation_${conversationId}`;
      const updated = {
        ...(info || {}),
        id: docId,
        conversationId,
        userId,
        documentType: 'conversation_info',
        isActive: false,
        archived: true,
        partitionKey: userId,
      };

      const { resource } = await this.container.items.upsert(updated);
      return !!resource;
    } catch (e) {
      console.warn('softDeleteConversation error:', e?.message);
      return false;
    }
  }

  /** 📜 getMessages (API /history) — devuelve [{role, content, ts}] */
  async getMessages(conversationId, opts = {}) {
    try {
      if (!this.cosmosAvailable) return [];
      const limit = Math.min(Number(opts.limit || 30), 100);

      let userId = opts.userId;
      if (!userId) {
        userId = await this._resolveOwnerUserId(conversationId, null);
        if (!userId) {
          console.warn('getMessages: no se pudo resolver userId para', conversationId);
          return [];
        }
      }

      let queryText = `
        SELECT c.id, c.message, c.messageType, c.timestamp
        FROM c
        WHERE c.conversationId = @conversationId
          AND c.userId = @userId
          AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
      `;

      const params = [
        { name: '@conversationId', value: conversationId },
        { name: '@userId', value: userId },
      ];

      if (opts.before) {
        queryText += ` AND c.timestamp < @before `;
        params.push({ name: '@before', value: opts.before });
      }

      queryText += ` ORDER BY c.timestamp ASC`;

      const { resources } = await this.container.items
        .query({ query: queryText, parameters: params }, { partitionKey: userId })
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

  /** 📈 getStats: incluye conversations, messages y formato por roles */
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
        version: '2.1.3-ConversationFormat',
      };
    } catch (error) {
      console.error('❌ Error getStats:', error);
      return { available: false, error: error.message };
    }
  }
}
