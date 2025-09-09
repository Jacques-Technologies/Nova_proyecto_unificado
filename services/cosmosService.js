// services/cosmosService.js - FIXED VERSION
import {CosmosClient} from '@azure/cosmos';
import {DateTime} from 'luxon';
import 'dotenv/config';

/**
 * Servicio de Cosmos DB CORREGIDO - Sin duplicados ni conflictos
 */
export default class CosmosService {
    constructor() {
        this.initialized = false;
        this.initializationError = null;
        
        console.log('🚀 Inicializando Cosmos DB Service con formato de conversación...');
        this.initializeCosmosClient();
    }

    /**
     * Inicializa el cliente de Cosmos DB
     */
    initializeCosmosClient() {
        try {
            // Obtener configuración desde .env
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

            console.log('🔑 Configurando cliente Cosmos DB...');
            this.client = new CosmosClient({ 
                endpoint, 
                key,
                userAgentSuffix: 'NovaBot/2.1.3-ConversationFormat'
            });
            
            this.database = this.client.database(this.databaseId);
            this.container = this.database.container(this.containerId);
            
            this.cosmosAvailable = true;
            this.initialized = true;
            
            console.log('✅ Cosmos DB configurado exitosamente');
            console.log(`   Database: ${this.databaseId}`);
            console.log(`   Container: ${this.containerId}`);
            console.log(`   Partition Key: ${this.partitionKey}`);
            
        } catch (error) {
            this.initializationError = `Error inicializando Cosmos DB: ${error.message}`;
            console.error('❌ Error inicializando Cosmos DB:', error);
            this.cosmosAvailable = false;
        }
    }

    /**
     * ✅ Guardar conversación en formato de mensajes con roles
     */
    async saveConversationMessages(conversationId, userId, messages, userInfo = null) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - conversación en formato de mensajes no guardada');
                return null;
            }

            if (!conversationId || !userId || !Array.isArray(messages)) {
                console.error('❌ saveConversationMessages: Parámetros inválidos');
                return null;
            }

            const conversationDocId = `conversation_messages_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            const conversationDoc = {
                id: conversationDocId,
                conversationId: conversationId,
                userId: userId,
                userName: userInfo?.nombre || 'Usuario',
                documentType: 'conversation_messages_format',
                messages: messages, // Array en el formato solicitado
                messageCount: messages.length,
                lastUpdated: timestamp,
                createdAt: timestamp,
                partitionKey: userId,
                ttl: 60 * 60 * 24 * 90, // TTL: 90 días
                version: '2.1.3-conversation-format',
                format: 'openai_chat_format'
            };

            console.log(`💾 [${userId}] Guardando conversación en formato de mensajes: ${messages.length} mensajes`);
            console.log(`🔍 [${userId}] Documento ID: ${conversationDocId}`);

            const { resource: savedDoc } = await this.container.items.upsert(conversationDoc);
            
            console.log(`✅ [${userId}] Conversación en formato de mensajes guardada exitosamente`);
            return savedDoc;

        } catch (error) {
            console.error(`❌ Error guardando conversación en formato de mensajes:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId,
                messageCount: messages?.length || 0
            });
            return null;
        }
    }

    /**
     * ✅ Obtener conversación en formato de mensajes
     */
    async getConversationMessages(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - retornando conversación vacía');
                return [];
            }

            const conversationDocId = `conversation_messages_${conversationId}`;

            console.log(`📚 [${userId}] Obteniendo conversación en formato de mensajes: ${conversationDocId}`);

            const { resource: conversationDoc } = await this.container
                .item(conversationDocId, userId)
                .read();

            if (conversationDoc && conversationDoc.messages) {
                console.log(`✅ [${userId}] Conversación en formato de mensajes obtenida: ${conversationDoc.messages.length} mensajes`);
                return conversationDoc.messages;
            } else {
                console.log(`ℹ️ [${userId}] No se encontró conversación en formato de mensajes`);
                return [];
            }

        } catch (error) {
            if (error.code === 404) {
                console.log(`ℹ️ [${userId}] Conversación en formato de mensajes no encontrada: ${conversationId}`);
                return [];
            }
            
            console.error(`❌ Error obteniendo conversación en formato de mensajes:`, error);
            return [];
        }
    }

    /**
     * ✅ Agregar mensaje a conversación en formato de roles
     */
    async addMessageToConversation(conversationId, userId, role, content, userInfo = null) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - mensaje no agregado a conversación');
                return false;
            }

            // Validar role
            const validRoles = ['system', 'user', 'assistant'];
            if (!validRoles.includes(role)) {
                console.error(`❌ Role inválido: ${role}. Debe ser: ${validRoles.join(', ')}`);
                return false;
            }

            console.log(`➕ [${userId}] Agregando mensaje a conversación: ${role} - "${content.substring(0, 50)}..."`);

            // Obtener conversación actual
            let currentMessages = await this.getConversationMessages(conversationId, userId);

            // Agregar nuevo mensaje al array
            const newMessage = {
                role: role,
                content: content,
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
            };

            currentMessages.push(newMessage);

            // Mantener solo los últimos 20 mensajes para no llenar demasiado
            if (currentMessages.length > 20) {
                currentMessages = currentMessages.slice(-20);
            }

            // Guardar conversación actualizada
            const result = await this.saveConversationMessages(conversationId, userId, currentMessages, userInfo);
            
            console.log(`✅ [${userId}] Mensaje agregado a conversación. Total mensajes: ${currentMessages.length}`);
            return result !== null;

        } catch (error) {
            console.error(`❌ Error agregando mensaje a conversación:`, error);
            return false;
        }
    }

    /**
     * ✅ Obtener conversación en formato OpenAI (listo para usar)
     */
    async getConversationForOpenAI(conversationId, userId, includeSystem = true) {
        try {
            const messages = await this.getConversationMessages(conversationId, userId);
            
            if (messages.length === 0) {
                return [];
            }

            // Filtrar mensajes según necesidades
            let filteredMessages = includeSystem ? 
                messages : 
                messages.filter(msg => msg.role !== 'system');

            // Remover timestamp si existe (OpenAI no lo necesita)
            const openaiMessages = filteredMessages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            console.log(`🤖 [${userId}] Conversación formateada para OpenAI: ${openaiMessages.length} mensajes`);
            return openaiMessages;

        } catch (error) {
            console.error(`❌ Error formateando conversación para OpenAI:`, error);
            return [];
        }
    }

    /**
     * ✅ CORREGIDO: saveMessage ahora también actualiza la conversación en formato de mensajes
     */
    async saveMessage(message, conversationId, userId, userName = null, messageType = 'user') {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - mensaje no guardado');
                return null;
            }

            if (!message || !conversationId || !userId) {
                console.error('❌ saveMessage: Parámetros requeridos faltantes', {
                    hasMessage: !!message,
                    hasConversationId: !!conversationId,
                    hasUserId: !!userId
                });
                return null;
            }

            const messageId = this.generateMessageId();
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            // Estructura: Mensaje individual (mantener funcionalidad existente)
            const messageDoc = {
                id: messageId,
                messageId: messageId,
                conversationId: conversationId,
                userId: userId,
                userName: userName || 'Usuario',
                message: message.substring(0, 4000),
                messageType: messageType, // 'user' | 'bot' | 'system'
                timestamp: timestamp,
                dateCreated: timestamp,
                partitionKey: userId,
                ttl: 60 * 60 * 24 * 90, // TTL: 90 días
                documentType: 'conversation_message',
                version: '2.1.3',
                isMessage: true,
                hasContent: true
            };

            console.log(`💾 [${userId}] Guardando mensaje individual: ${messageType} (${message.length} chars)`);
            
            const { resource: createdItem } = await this.container.items.create(messageDoc);
            
            console.log(`✅ [${userId}] Mensaje individual guardado: ${messageId}`);

            // También agregar a conversación en formato de mensajes
            try {
                const role = messageType === 'bot' ? 'assistant' : 
                           messageType === 'system' ? 'system' : 'user';
                
                await this.addMessageToConversation(
                    conversationId, 
                    userId, 
                    role, 
                    message,
                    { nombre: userName }
                );
                
                console.log(`🔄 [${userId}] Mensaje también agregado a conversación en formato de roles`);
                
            } catch (conversationError) {
                console.warn(`⚠️ [${userId}] Error agregando a conversación en formato de roles:`, conversationError.message);
                // No fallar si esto no funciona
            }
            
            // Actualizar actividad de conversación después de guardar mensaje
            setImmediate(() => {
                this.updateConversationActivity(conversationId, userId).catch(error => {
                    console.warn(`⚠️ [${userId}] Error actualizando actividad:`, error.message);
                });
            });
            
            return createdItem;

        } catch (error) {
            console.error(`❌ Error guardando mensaje:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId,
                messageType: messageType,
                messageLength: message?.length || 0
            });
            return null;
        }
    }

    /**
     * ✅ Limpiar conversación en formato de mensajes
     */
    async cleanConversationMessages(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                return false;
            }

            const conversationDocId = `conversation_messages_${conversationId}`;

            console.log(`🗑️ [${userId}] Limpiando conversación en formato de mensajes: ${conversationDocId}`);

            await this.container.item(conversationDocId, userId).delete();
            
            console.log(`✅ [${userId}] Conversación en formato de mensajes eliminada`);
            return true;

        } catch (error) {
            if (error.code === 404) {
                console.log(`ℹ️ [${userId}] Conversación en formato de mensajes ya no existe`);
                return true;
            }
            
            console.error(`❌ Error limpiando conversación en formato de mensajes:`, error);
            return false;
        }
    }

    /**
     * ✅ Obtener estadísticas de conversaciones en formato de mensajes
     */
    async getConversationMessagesStats() {
        try {
            if (!this.cosmosAvailable) {
                return { available: false };
            }

            const query = {
                query: `
                    SELECT 
                        COUNT(1) as totalConversations,
                        SUM(c.messageCount) as totalMessages,
                        AVG(c.messageCount) as avgMessagesPerConversation
                    FROM c 
                    WHERE c.documentType = 'conversation_messages_format'
                `
            };

            const { resources } = await this.container.items.query(query).fetchAll();
            
            const stats = resources[0] || {
                totalConversations: 0,
                totalMessages: 0,
                avgMessagesPerConversation: 0
            };

            return {
                available: true,
                conversationMessagesFormat: {
                    totalConversations: stats.totalConversations,
                    totalMessages: stats.totalMessages,
                    avgMessagesPerConversation: Math.round(stats.avgMessagesPerConversation || 0)
                },
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
            };

        } catch (error) {
            console.error('❌ Error obteniendo estadísticas de conversaciones en formato de mensajes:', error);
            return { available: false, error: error.message };
        }
    }

    /**
     * ✅ Obtener historial de conversación desde Cosmos DB
     */
    async getConversationHistory(conversationId, userId, limit = 20) {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - retornando historial vacío');
                return [];
            }

            console.log(`📚 [${userId}] === INICIANDO OBTENCIÓN DE HISTORIAL ===`);
            console.log(`🔍 [${userId}] ConversationId: ${conversationId}`);
            console.log(`🔍 [${userId}] UserId: ${userId}`);
            console.log(`🔍 [${userId}] Límite: ${limit}`);

            // Query principal simplificada
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
                    { name: '@userId', value: userId }
                ]
            };

            console.log(`📋 [${userId}] Ejecutando query principal:`, JSON.stringify(mainQuery, null, 2));

            let messages = [];
            try {
                const { resources: mainResults } = await this.container.items
                    .query(mainQuery, { partitionKey: userId })
                    .fetchAll();

                messages = mainResults;
                console.log(`🔍 [${userId}] Query principal - Documentos encontrados: ${messages.length}`);

            } catch (queryError) {
                console.warn(`⚠️ [${userId}] Error en query principal:`, queryError.message);
            }

            // Si no se encontraron mensajes, probar query más amplia
            if (messages.length === 0) {
                console.log(`🔍 [${userId}] No se encontraron mensajes con query principal. Intentando query amplia...`);
                
                const wideQuery = {
                    query: `
                        SELECT *
                        FROM c 
                        WHERE c.userId = @userId
                        AND c.documentType = 'conversation_message'
                        ORDER BY c.timestamp DESC
                    `,
                    parameters: [{ name: '@userId', value: userId }]
                };

                try {
                    const { resources: wideResults } = await this.container.items
                        .query(wideQuery, { partitionKey: userId })
                        .fetchAll();

                    // Filtrar por conversationId en memoria
                    messages = wideResults.filter(msg => 
                        msg.conversationId === conversationId && 
                        (msg.messageType === 'user' || msg.messageType === 'bot')
                    );

                    console.log(`🔍 [${userId}] Query amplia - Total documentos: ${wideResults.length}`);
                    console.log(`🔍 [${userId}] Query amplia - Mensajes filtrados: ${messages.length}`);

                } catch (wideQueryError) {
                    console.warn(`⚠️ [${userId}] Error en query amplia:`, wideQueryError.message);
                }
            }

            // Formatear mensajes encontrados
            if (messages.length === 0) {
                console.log(`⚠️ [${userId}] No se encontraron mensajes después de todos los intentos`);
                return [];
            }

            console.log(`📝 [${userId}] Formateando ${messages.length} mensajes encontrados...`);

            // Formatear mensajes para el formato esperado
            const sortedMessages = messages
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) // Ordenar por timestamp
                .slice(-limit) // Tomar solo los últimos 'limit' mensajes
                .map((msg, index) => {
                    const formattedMessage = {
                        id: msg.messageId || msg.id,
                        message: msg.message || 'Mensaje vacío',
                        conversationId: msg.conversationId,
                        userId: msg.userId,
                        userName: msg.userName || 'Usuario',
                        timestamp: msg.timestamp,
                        type: msg.messageType === 'bot' ? 'assistant' : 'user', // Mapear correctamente
                        messageType: msg.messageType
                    };
                    
                    console.log(`📝 [${userId}] ${index + 1}. Mensaje formateado: ${formattedMessage.type} - "${formattedMessage.message.substring(0, 30)}..." (${formattedMessage.timestamp})`);
                    return formattedMessage;
                });

            console.log(`✅ [${userId}] === HISTORIAL OBTENIDO EXITOSAMENTE ===`);
            console.log(`📖 [${userId}] Historial final: ${sortedMessages.length} mensajes`);
            
            return sortedMessages;

        } catch (error) {
            console.error(`❌ [${userId}] Error crítico obteniendo historial de Cosmos DB:`, {
                error: error.message,
                stack: error.stack,
                conversationId: conversationId,
                userId: userId
            });
            return [];
        }
    }

    /**
     * ✅ CORREGIDO: Función saveConversationInfo con UPSERT para evitar conflictos
     */
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

    /**
     * Obtiene información de una conversación
     */
    async getConversationInfo(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) return null;

            const conversationDocId = `conversation_${conversationId}`;

            // Si conocemos la partitionKey, usa lectura directa
            if (userId) {
                const { resource: conversationDoc } = await this.container
                    .item(conversationDocId, userId)
                    .read();
                return conversationDoc || null;
            }

            // Si NO conocemos userId, buscar por query (cross-partition)
            return await this.findConversationInfoAnyPartition(conversationId);

        } catch (error) {
            if (error.code === 404) return null;
            console.error(`❌ Error obteniendo info de conversación:`, error);
            return null;
        }
    }

    /**
     * ✅ CORREGIDO: updateConversationActivity SIN errores de concurrencia
     */
    async updateConversationActivity(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                console.log(`ℹ️ [${userId}] Cosmos DB no disponible - saltando actualización de actividad`);
                return false;
            }

            if (!conversationId || !userId) {
                console.error('❌ updateConversationActivity: conversationId o userId faltante');
                return false;
            }

            const conversationDocId = `conversation_${conversationId}`;
            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

            console.log(`🔄 [${userId}] Actualizando actividad de conversación: ${conversationDocId}`);

            try {
                // Intentar leer el documento existente para preservar datos
                let existingDoc = null;
                try {
                    const { resource } = await this.container
                        .item(conversationDocId, userId)
                        .read();
                    existingDoc = resource;
                } catch (readError) {
                    if (readError.code !== 404) {
                        console.warn(`⚠️ [${userId}] Error leyendo documento existente (continuando):`, readError.message);
                    }
                }

                // Crear documento actualizado: Preservar datos existentes si los hay
                const updatedDoc = {
                    id: conversationDocId,
                    conversationId: conversationId,
                    userId: userId,
                    userName: existingDoc?.userName || 'Usuario',
                    documentType: 'conversation_info',
                    createdAt: existingDoc?.createdAt || timestamp,
                    lastActivity: timestamp, // Actualizar timestamp
                    messageCount: (existingDoc?.messageCount || 0) + 1, // Incrementar contador
                    isActive: true,
                    partitionKey: userId,
                    ttl: 60 * 60 * 24 * 90,
                    version: '2.1.3',
                    // Preservar otros campos si existen
                    ...(existingDoc ? {
                        ...existingDoc,
                        // Sobrescribir solo los campos que queremos actualizar
                        lastActivity: timestamp,
                        messageCount: (existingDoc.messageCount || 0) + 1,
                        isActive: true
                    } : {})
                };

                // UPSERT: Funciona SIEMPRE, sin importar si existe o no
                const { resource: finalDoc } = await this.container.items.upsert(updatedDoc);
                
                if (!finalDoc) {
                    console.error(`❌ [${userId}] Upsert retornó documento null`);
                    return false;
                }

                console.log(`✅ [${userId}] Actividad de conversación actualizada exitosamente`);
                console.log(`📊 [${userId}] Mensajes totales: ${finalDoc.messageCount}, Última actividad: ${finalDoc.lastActivity}`);
                
                return true;

            } catch (upsertError) {
                console.error(`❌ [${userId}] Error en upsert:`, upsertError.message);
                return false;
            }

        } catch (error) {
            console.error(`❌ [${userId}] Error general en updateConversationActivity:`, {
                error: error.message,
                conversationId: conversationId,
                userId: userId
            });
            return false;
        }
    }

    /**
     * Elimina mensajes antiguos de una conversación
     */
    async cleanOldMessages(conversationId, userId, keepLast = 50) {
        try {
            if (!this.cosmosAvailable) {
                return 0;
            }

            console.log(`🧹 [${userId}] Limpiando mensajes antiguos (mantener: ${keepLast})`);

            // Obtener todos los mensajes ordenados por timestamp
            const query = {
                query: `
                    SELECT c.id, c.timestamp
                    FROM c 
                    WHERE c.conversationId = @conversationId 
                    AND c.userId = @userId
                    AND c.documentType != 'conversation_info'
                    AND c.documentType != 'conversation_messages_format'
                    ORDER BY c.timestamp DESC
                `,
                parameters: [
                    { name: '@conversationId', value: conversationId },
                    { name: '@userId', value: userId }
                ]
            };

            const { resources: messages } = await this.container.items
                .query(query, { partitionKey: userId })
                .fetchAll();

            if (messages.length <= keepLast) {
                console.log(`ℹ️ [${userId}] No hay mensajes para limpiar (${messages.length} <= ${keepLast})`);
                return 0;
            }

            // Obtener mensajes a eliminar (todos excepto los más recientes)
            const messagesToDelete = messages.slice(keepLast);
            let deletedCount = 0;

            for (const msg of messagesToDelete) {
                try {
                    await this.container.item(msg.id, userId).delete();
                    deletedCount++;
                } catch (error) {
                    console.warn(`⚠️ Error eliminando mensaje ${msg.id}:`, error.message);
                }
            }

            console.log(`✅ [${userId}] Mensajes antiguos eliminados: ${deletedCount}`);
            return deletedCount;

        } catch (error) {
            console.error(`❌ Error limpiando mensajes antiguos:`, error);
            return 0;
        }
    }

    /**
     * ✅ Obtiene estadísticas con información de conversaciones en formato de mensajes
     */
    async getStats() {
        try {
            if (!this.cosmosAvailable) {
                return {
                    available: false,
                    error: this.initializationError
                };
            }

            const statsResults = {
                totalDocuments: 0,
                conversations: 0,
                userMessages: 0,
                botMessages: 0,
                systemMessages: 0,
                conversationMessagesFormat: 0
            };

            // Consultas mejoradas: Incluyendo conversaciones en formato de mensajes
            const queries = [
                {
                    label: 'totalDocuments',
                    query: 'SELECT VALUE COUNT(1) FROM c'
                },
                {
                    label: 'conversations',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.documentType = 'conversation_info'"
                },
                {
                    label: 'userMessages',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'user'"
                },
                {
                    label: 'botMessages',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'bot'"
                },
                {
                    label: 'systemMessages',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.messageType = 'system'"
                },
                {
                    label: 'conversationMessagesFormat',
                    query: "SELECT VALUE COUNT(1) FROM c WHERE c.documentType = 'conversation_messages_format'"
                }
            ];

            for (const q of queries) {
                try {
                    const { resources } = await this.container.items.query({ query: q.query }).fetchAll();
                    statsResults[q.label] = resources[0] || 0;
                } catch (error) {
                    console.warn(`⚠️ Error ejecutando query "${q.label}":`, error.message);
                    statsResults[q.label] = 'ERROR';
                }
            }

            // Actividad reciente
            let recentActivity = null;
            try {
                const recentQuery = {
                    query: "SELECT TOP 1 c.timestamp FROM c WHERE IS_DEFINED(c.messageType) ORDER BY c.timestamp DESC"
                };

                const { resources: recentResults } = await this.container.items
                    .query(recentQuery)
                    .fetchAll();

                if (recentResults.length > 0) {
                    recentActivity = recentResults[0].timestamp;
                }
            } catch (error) {
                console.warn('⚠️ Error obteniendo actividad reciente:', error.message);
            }

            // Obtener estadísticas de conversaciones en formato de mensajes
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
                    recentActivity
                },
                conversationMessagesFormat: conversationMessagesStats.conversationMessagesFormat || null,
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
                version: '2.1.3-ConversationFormat',
                features: [
                    'Historial de mensajes individuales',
                    'Conversaciones en formato OpenAI (system, user, assistant)',
                    'Persistencia dual (individual + conversación)',
                    'TTL automático de 90 días',
                    'UPSERT sin conflictos de concurrencia',
                    'Estadísticas completas',
                    'Limpieza automática de mensajes antiguos'
                ]
            };

        } catch (error) {
            console.error('❌ Error obteniendo estadísticas de Cosmos DB:', error);
            return {
                available: false,
                error: error.message
            };
        }
    }

    /**
     * Genera un ID único para mensaje
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Verifica si Cosmos DB está disponible
     */
    isAvailable() {
        return this.cosmosAvailable && this.initialized;
    }

    /**
     * ✅ Obtiene información de configuración con nuevas características
     */
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
                concurrencySafe: true
            },
            newCapabilities: [
                'Guardado dual: mensajes individuales + formato de conversación',
                'Formato compatible con OpenAI Chat API',
                'Conversaciones como arrays con roles (system, user, assistant)',
                'Persistencia automática en ambos formatos',
                'Estadísticas extendidas',
                'Limpieza granular por tipo de documento'
            ]
        };
    }

    /**
     * ✅ CORREGIDO: Crea (o recupera) una conversación info
     */
    async createOrGetConversation(opts = {}) {
        try {
            if (!this.cosmosAvailable) {
                // Fallback: ID local
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
                token
            };

            const { resource } = await this.container.items.upsert(base);
            return { id: resource?.conversationId || convId };
            
        } catch (e) {
            console.warn('createOrGetConversation error:', e?.message);
            const id = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            return { id };
        }
    }

    /**
     * ✅ CORREGIDO: Append de mensaje (compatible con el controlador)
     */
    async appendMessage(conversationId, msg) {
        try {
            if (!conversationId || !msg?.content) return null;
            
            const userId = msg.userId || msg?.metadata?.CveUsuario || 'anonymous';
            const userName = msg.userName || `Usuario ${userId}`;
            const role = msg.role || 'user';
            const messageType = role === 'assistant' ? 'bot' : (role === 'system' ? 'system' : 'user');

            // Guarda individual + agrega a arreglo por roles (ya lo hace saveMessage -> addMessageToConversation)
            return await this.saveMessage(msg.content, conversationId, userId, userName, messageType);
            
        } catch (e) {
            console.error('appendMessage error:', e);
            return null;
        }
    }

    /**
     * ✅ CORREGIDO: Historial para /history — devuelve [{role, content, ts}]
     */
    async getMessages(conversationId, opts = {}) {
        try {
            if (!this.cosmosAvailable) return [];
            const limit = Math.min(Number(opts.limit || 30), 100);

            // 1) Asegurar userId (partitionKey)
            let userId = opts.userId;
            if (!userId) {
                const info = await this.getConversationInfo(conversationId, undefined);
                userId = info?.userId;
                if (!userId) {
                    console.warn('getMessages: no se pudo resolver userId para', conversationId);
                    return [];
                }
            }

            // 2) Query de mensajes de la conversación (partitioned)
            let queryText = `
                SELECT c.id, c.message, c.messageType, c.timestamp
                FROM c
                WHERE c.conversationId = @conversationId
                AND c.userId = @userId
                AND (c.messageType = 'user' OR c.messageType = 'bot' OR c.messageType = 'system')
            `;

            const params = [
                { name: '@conversationId', value: conversationId },
                { name: '@userId', value: userId }
            ];

            if (opts.before) {
                queryText += ` AND c.timestamp < @before `;
                params.push({ name: '@before', value: opts.before });
            }

            queryText += ` ORDER BY c.timestamp ASC`;

            const { resources } = await this.container.items
                .query({ query: queryText, parameters: params }, { partitionKey: userId })
                .fetchAll();

            // 3) Mapear al formato de salida
            return (resources || [])
                .map(it => ({
                    role: it.messageType === 'bot' ? 'assistant' : (it.messageType === 'system' ? 'system' : 'user'),
                    content: it.message,
                    ts: it.timestamp
                }))
                .slice(-limit);

        } catch (e) {
            console.warn('getMessages error:', e?.message);
            return [];
        }
    }

    /**
     * ✅ CORREGIDO: Lista conversaciones por usuario (sidebar del multi-chat)
     */
    async listConversations(opts = {}) {
        try {
            if (!this.cosmosAvailable) return [];
            
            const owner = opts.owner;
            const limit = Math.min(Number(opts.limit || 50), 200);
            if (!owner) return [];

            const q = {
                query: `
                    SELECT c.id, c.conversationId, c.userId, c.userName, c.title, c.lastActivity, c.createdAt, c.channel, c.metadata
                    FROM c
                    WHERE c.userId = @userId
                    AND c.documentType = 'conversation_info'
                    ORDER BY c.lastActivity DESC
                `,
                parameters: [{ name: '@userId', value: owner }]
            };

            const { resources } = await this.container.items.query(q, { partitionKey: owner }).fetchAll();
            return (resources || []).slice(0, limit).map(r => ({
                id: r.conversationId,
                title: r.title || r.metadata?.title || 'Nuevo chat',
                createdAt: r.createdAt,
                lastMessageAt: r.lastActivity,
                channel: r.channel || 'web',
                metadata: r.metadata || {}
            }));
            
        } catch (e) {
            console.warn('listConversations error:', e?.message);
            return [];
        }
    }

    /**
     * Alias: getUserConversations (por compatibilidad)
     */
    async getUserConversations(userId, { limit = 50, channel = 'web' } = {}) {
        return this.listConversations({ owner: userId, channel, limit });
    }

    /**
     * ✅ CORREGIDO: Renombra conversación (actualiza conversation_info.title)
     */
    async renameConversation(conversationId, title, { by } = {}) {
        try {
            if (!this.cosmosAvailable) return false;
            
            let info = await this.getConversationInfo(conversationId, by);
            const userId = info?.userId || by;
            if (!userId) return false;

            const docId = `conversation_${conversationId}`;
            const now = DateTime.now().setZone('America/Mexico_City').toISO();
            const updated = {
                ...(info || {}),
                id: docId,
                conversationId,
                userId,
                documentType: 'conversation_info',
                title,
                lastActivity: now,
                partitionKey: userId
            };
            
            const { resource } = await this.container.items.upsert(updated);
            return !!resource;
            
        } catch (e) {
            console.warn('renameConversation error:', e?.message);
            return false;
        }
    }

    /**
     * ✅ CORREGIDO: Actualiza metadata arbitraria de conversation_info
     */
    async updateConversationMetadata(conversationId, meta = {}) {
        try {
            if (!this.cosmosAvailable) return false;
            
            let info = await this.getConversationInfo(conversationId, undefined);
            const userId = info?.userId;
            if (!userId) return false;

            const docId = `conversation_${conversationId}`;
            const merged = {
                ...(info || {}),
                id: docId,
                conversationId,
                userId,
                documentType: 'conversation_info',
                metadata: { ...(info?.metadata || {}), ...meta },
                partitionKey: userId
            };
            
            const { resource } = await this.container.items.upsert(merged);
            return !!resource;
            
        } catch (e) {
            console.warn('updateConversationMetadata error:', e?.message);
            return false;
        }
    }

    /**
     * ✅ CORREGIDO: Limpia mensajes de una conversación (individual + arreglo por roles)
     */
    async clearConversation(conversationId) {
        try {
            if (!this.cosmosAvailable) return false;
            
            // Necesitamos el owner para la partición
            const info = await this.getConversationInfo(conversationId, undefined);
            const userId = info?.userId;
            if (!userId) return false;

            // 1) Borrar documento de arreglo por roles (si existe)
            await this.cleanConversationMessages(conversationId, userId);

            // 2) Borrar mensajes individuales
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
                    { name: '@userId', value: userId }
                ]
            };
            
            const { resources } = await this.container.items.query(q, { partitionKey: userId }).fetchAll();
            for (const d of (resources || [])) {
                try { 
                    await this.container.item(d.id, userId).delete(); 
                } catch (_e) {}
            }

            // 3) Resetear counters en conversation_info
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
                partitionKey: userId
            };
            
            await this.container.items.upsert(updated);
            return true;
            
        } catch (e) {
            console.warn('clearConversation error:', e?.message);
            return false;
        }
    }

    /**
     * ✅ CORREGIDO: Eliminar conversación completamente
     */
    async deleteConversation(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) return false;
            
            if (!userId) {
                const info = await this.getConversationInfo(conversationId, undefined);
                userId = info?.userId;
            }
            if (!userId) return false;

            // Eliminar todos los docs de la conversación
            const q = {
                query: `
                    SELECT c.id
                    FROM c 
                    WHERE c.conversationId = @conversationId 
                    AND c.userId = @userId
                `,
                parameters: [
                    { name: '@conversationId', value: conversationId },
                    { name: '@userId', value: userId }
                ]
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
                    console.warn(`⚠️ Error eliminando documento ${doc.id}:`, error.message); 
                }
            }

            await this.cleanConversationMessages(conversationId, userId);
            return deletedCount > 0;
            
        } catch (error) {
            console.error(`❌ Error eliminando conversación:`, error);
            return false;
        }
    }

    /**
     * ✅ CORREGIDO: Soft delete: marca como archivada la conversación
     */
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
                partitionKey: userId
            };
            
            const { resource } = await this.container.items.upsert(updated);
            return !!resource;
            
        } catch (e) {
            console.warn('softDeleteConversation error:', e?.message);
            return false;
        }
    }

    /**
     * ✅ CORREGIDO: Busca conversation_info sin conocer la partitionKey (userId)
     */
    async findConversationInfoAnyPartition(conversationId) {
        if (!this.cosmosAvailable) return null;
        
        const byIdQuery = {
            query: `SELECT TOP 1 * FROM c WHERE c.id = @id`,
            parameters: [{ name: '@id', value: `conversation_${conversationId}` }]
        };
        
        try {
            // Query sin partitionKey => cross-partition
            let { resources } = await this.container.items.query(byIdQuery).fetchAll();
            if (resources?.length) return resources[0];

            const byConvQuery = {
                query: `
                    SELECT TOP 1 *
                    FROM c
                    WHERE c.documentType = 'conversation_info'
                    AND c.conversationId = @conversationId
                `,
                parameters: [{ name: '@conversationId', value: conversationId }]
            };
            
            const res2 = await this.container.items.query(byConvQuery).fetchAll();
            return res2?.resources?.[0] || null;
            
        } catch (e) {
            console.warn('findConversationInfoAnyPartition error:', e?.message);
            return null;
        }
    }
}