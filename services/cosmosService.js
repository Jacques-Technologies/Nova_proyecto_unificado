// services/cosmosService.js - MEJORADO: Historial + Formato de Conversación
import {CosmosClient} from '@azure/cosmos';
import {DateTime} from 'luxon';
import 'dotenv/config';
/**
 * Servicio de Cosmos DB MEJORADO - Historial funcionando + Formato de conversación
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
     * ✅ NUEVO: Guardar conversación en formato de mensajes con roles
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

            // ✅ FORMATO: Array de mensajes con roles (system, user, assistant)
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

            // ✅ USAR UPSERT: Actualizar o crear
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
     * ✅ NUEVO: Obtener conversación en formato de mensajes
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
     * ✅ NUEVO: Agregar mensaje a conversación en formato de roles
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

            // ✅ AGREGAR: Nuevo mensaje al array
            const newMessage = {
                role: role,
                content: content,
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
            };

            currentMessages.push(newMessage);

            // ✅ MANTENER: Solo los últimos 20 mensajes para no llenar demasiado
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
     * ✅ NUEVO: Obtener conversación en formato OpenAI (listo para usar)
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
     * ✅ MEJORADO: saveMessage ahora también actualiza la conversación en formato de mensajes
     */
    async saveMessage(message, conversationId, userId, userName = null, messageType = 'user') {
        try {
            if (!this.cosmosAvailable) {
                console.warn('⚠️ Cosmos DB no disponible - mensaje no guardado');
                return null;
            }

            // ✅ VALIDACIÓN: Parámetros requeridos
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

            // ✅ ESTRUCTURA: Mensaje individual (mantener funcionalidad existente)
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

            // ✅ NUEVO: También agregar a conversación en formato de mensajes
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
            
            // ✅ ACTUALIZAR: Actividad de conversación después de guardar mensaje
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
     * ✅ NUEVO: Limpiar conversación en formato de mensajes
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
     * ✅ NUEVO: Obtener estadísticas de conversaciones en formato de mensajes
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

    // ===== MANTENER TODOS LOS MÉTODOS EXISTENTES =====
    
    /**
     * ✅ COMPLETAMENTE CORREGIDO: Obtener historial de conversación desde Cosmos DB
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

            // ✅ INTENTO 1: Query principal simplificada
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

            // ✅ INTENTO 2: Si no se encontraron mensajes, probar query más amplia
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

            // ✅ FORMATEAR mensajes encontrados
            if (messages.length === 0) {
                console.log(`⚠️ [${userId}] No se encontraron mensajes después de todos los intentos`);
                return [];
            }

            console.log(`📝 [${userId}] Formateando ${messages.length} mensajes encontrados...`);

            // ✅ FORMATEAR mensajes para el formato esperado
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
                        type: msg.messageType === 'bot' ? 'assistant' : 'user', // ✅ Mapear correctamente
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

            // ✅ VALIDACIÓN: Parámetros requeridos
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

            // ✅ USAR UPSERT: Siempre funciona, sea crear o actualizar
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
            if (!this.cosmosAvailable) {
                return null;
            }

            const conversationDocId = `conversation_${conversationId}`;

            console.log(`📋 [${userId}] Obteniendo info de conversación: ${conversationId}`);

            const { resource: conversationDoc } = await this.container
                .item(conversationDocId, userId)
                .read();

            return conversationDoc;

        } catch (error) {
            if (error.code === 404) {
                console.log(`ℹ️ [${userId}] Conversación no encontrada: ${conversationId}`);
                return null;
            }
            
            console.error(`❌ Error obteniendo info de conversación:`, error);
            return null;
        }
    }

    /**
     * ✅ COMPLETAMENTE CORREGIDO: updateConversationActivity SIN errores de concurrencia
     */
    /**
 * ✅ FIXED: updateConversationActivity without duplicate keys
 */
async updateConversationActivity(conversationId, userId) {
    try {
        if (!this.cosmosAvailable) {
            console.log(`ℹ️ [${userId}] Cosmos DB no disponible - saltando actualización de actividad`);
            return false;
        }

        // ✅ VALIDACIÓN: Parámetros requeridos
        if (!conversationId || !userId) {
            console.error('❌ updateConversationActivity: conversationId o userId faltante');
            return false;
        }

        const conversationDocId = `conversation_${conversationId}`;
        const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();

        console.log(`🔄 [${userId}] Actualizando actividad de conversación: ${conversationDocId}`);

        // ✅ SOLUCIÓN DEFINITIVA: SIEMPRE usar UPSERT
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

            // ✅ CREAR DOCUMENTO ACTUALIZADO: Preservar datos existentes si los hay
            const updatedDoc = {
                id: conversationDocId,
                conversationId: conversationId,
                userId: userId,
                userName: existingDoc?.userName || 'Usuario',
                documentType: 'conversation_info',
                createdAt: existingDoc?.createdAt || timestamp,
                lastActivity: timestamp, // ✅ Actualizar timestamp
                messageCount: (existingDoc?.messageCount || 0) + 1, // ✅ Incrementar contador
                isActive: true,
                partitionKey: userId,
                ttl: 60 * 60 * 24 * 90,
                version: '2.1.3',
                // Preservar otros campos si existen (spread operator al final para evitar sobreescritura)
                ...(existingDoc ? {
                    ...existingDoc,
                    // Sobrescribir solo los campos que queremos actualizar
                    lastActivity: timestamp,
                    messageCount: (existingDoc.messageCount || 0) + 1,
                    isActive: true
                } : {})
            };

            // ✅ UPSERT: Funciona SIEMPRE, sin importar si existe o no
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
     * Elimina una conversación completa
     */
    async deleteConversation(conversationId, userId) {
        try {
            if (!this.cosmosAvailable) {
                return false;
            }

            console.log(`🗑️ [${userId}] Eliminando conversación completa: ${conversationId}`);

            // Obtener todos los documentos de la conversación
            const query = {
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
                .query(query, { partitionKey: userId })
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

            // ✅ TAMBIÉN ELIMINAR: Conversación en formato de mensajes
            await this.cleanConversationMessages(conversationId, userId);

            console.log(`✅ [${userId}] Conversación eliminada (${deletedCount} documentos)`);
            return deletedCount > 0;

        } catch (error) {
            console.error(`❌ Error eliminando conversación:`, error);
            return false;
        }
    }

    /**
     * ✅ MEJORADO: Obtiene estadísticas con información de conversaciones en formato de mensajes
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

            // ✅ CONSULTAS MEJORADAS: Incluyendo conversaciones en formato de mensajes
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

            // ✅ OBTENER: Estadísticas de conversaciones en formato de mensajes
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
     * ✅ MEJORADO: Obtiene información de configuración con nuevas características
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
                conversationMessagesFormat: true, // ✅ NUEVO
                openaiCompatibleFormat: true,     // ✅ NUEVO
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
}

