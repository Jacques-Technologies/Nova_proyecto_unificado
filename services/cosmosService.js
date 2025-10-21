// services/cosmosService_v3.js - Diseño Ultra-Simplificado
// Partition Key: /user_id
// 2 tipos: user (auth) + message (historial)

import { CosmosClient } from '@azure/cosmos';
import 'dotenv/config';

/**
 * Servicio de Cosmos DB Simplificado v3.0
 * - Partition Key: /user_id
 * - Tipo 1: user (sesión/auth, TTL fijo 60min)
 * - Tipo 2: message (historial, TTL fijo 1 día)
 * - NO hay renovación automática de TTL
 */
export default class CosmosServiceV3 {
    constructor() {
        this.initialized = false;
        this.cosmosAvailable = false;

        console.log('🚀 Inicializando Cosmos DB Service v3.0 (user_id partition)...');
        this.initializeCosmosClient();
    }

    initializeCosmosClient() {
        try {
            const endpoint = process.env.COSMOS_DB_ENDPOINT;
            const key = process.env.COSMOS_DB_KEY;
            this.databaseId = process.env.COSMOS_DB_DATABASE_ID;
            this.containerId = process.env.COSMOS_DB_CONTAINER_ID;

            if (!endpoint || !key || !this.databaseId || !this.containerId) {
                console.warn('⚠️ Cosmos DB no configurado');
                this.initialized = true;
                return;
            }

            this.client = new CosmosClient({
                endpoint,
                key,
                userAgentSuffix: 'NovaBot/3.0.0-SimplifiedAuth'
            });

            this.database = this.client.database(this.databaseId);
            this.container = this.database.container(this.containerId);
            this.cosmosAvailable = true;
            this.initialized = true;

            console.log('✅ Cosmos DB v3 configurado');
            console.log(`   Database: ${this.databaseId}`);
            console.log(`   Container: ${this.containerId}`);
            console.log(`   Partition Key: /user_id`);
        } catch (error) {
            console.error('❌ Error inicializando Cosmos DB:', error.message);
            this.initialized = true;
        }
    }

    isAvailable() {
        return this.cosmosAvailable;
    }

    // ========================================
    // GESTIÓN DE SESIONES/AUTH
    // ========================================

    /**
     * Crea sesión de usuario (login)
     * @param {string} usuario - ID del usuario (ej: "91004")
     * @param {object} userInfo - { nombre, paterno, materno, token }
     * @returns {Promise<object|null>}
     */
    async createUserSession(usuario, userInfo) {
        if (!this.cosmosAvailable) {
            console.warn('⚠️ Cosmos no disponible - sesión no persistida');
            return null;
        }

        try {
            const now = new Date().toISOString();

            const userDoc = {
                id: `user_${usuario}`,
                user_id: usuario,  // PARTITION KEY (Teams: "29:xxx", WebChat: token)
                type: 'user',

                // Datos de autenticación
                usuario: userInfo.usuario || usuario,  // Número de socio real (del API Nova)
                nombre: userInfo.nombre,
                paterno: userInfo.paterno || '',
                materno: userInfo.materno || '',
                token: userInfo.token,

                // Timestamps
                loginAt: now,
                lastActivity: now,

                // TTL fijo de 60 minutos (sin renovación)
                ttl: 3600
            };

            const { resource } = await this.container.items.create(userDoc);
            console.log(`✅ [${usuario}] Sesión creada (TTL fijo: 60min)`);

            return resource;
        } catch (error) {
            // Si ya existe, hacer upsert
            if (error.code === 409) {
                console.log(`🔄 [${usuario}] Sesión ya existe, actualizando...`);
                return await this.renewUserSession(usuario, userInfo);
            }

            console.error(`❌ [${usuario}] Error creando sesión:`, error.message);
            return null;
        }
    }

    /**
     * Obtiene sesión de usuario (verifica auth)
     * @param {string} usuario - ID del usuario
     * @returns {Promise<object|null>} - userInfo con token o null si expiró
     */
    async getUserSession(usuario) {
        if (!this.cosmosAvailable) {
            console.warn('⚠️ Cosmos no disponible');
            return null;
        }

        try {
            const { resource: user } = await this.container
                .item(`user_${usuario}`, usuario)
                .read();

            if (user) {
                console.log(`✅ [${usuario}] Sesión activa (TTL: ${user.ttl}s)`);
                return user;
            }

            return null;
        } catch (error) {
            if (error.code === 404) {
                console.log(`⚠️ [${usuario}] Sesión no encontrada (expiró o no logeado)`);
                return null;
            }

            console.error(`❌ [${usuario}] Error obteniendo sesión:`, error.message);
            return null;
        }
    }

    /**
     * Actualiza sesión existente (para login repetido)
     * @private
     */
    async renewUserSession(usuario, userInfo) {
        try {
            const { resource: user } = await this.container
                .item(`user_${usuario}`, usuario)
                .read();

            // Actualizar datos
            user.usuario = userInfo.usuario || user.usuario;  // Actualizar número de socio si viene
            user.nombre = userInfo.nombre;
            user.paterno = userInfo.paterno || '';
            user.materno = userInfo.materno || '';
            user.token = userInfo.token;
            user.loginAt = new Date().toISOString();
            user.lastActivity = new Date().toISOString();
            user.ttl = 3600;

            const { resource: updated } = await this.container
                .item(`user_${usuario}`, usuario)
                .replace(user);

            console.log(`✅ [${usuario}] Sesión actualizada`);
            return updated;
        } catch (error) {
            console.error(`❌ [${usuario}] Error actualizando sesión:`, error.message);
            return null;
        }
    }

    /**
     * Elimina sesión (logout)
     * @param {string} usuario - ID del usuario
     * @returns {Promise<boolean>}
     */
    async deleteUserSession(usuario) {
        if (!this.cosmosAvailable) return false;

        try {
            await this.container
                .item(`user_${usuario}`, usuario)
                .delete();

            console.log(`🗑️ [${usuario}] Sesión eliminada`);
            return true;
        } catch (error) {
            if (error.code === 404) {
                console.log(`⚠️ [${usuario}] Sesión ya no existe`);
                return true;
            }

            console.error(`❌ [${usuario}] Error eliminando sesión:`, error.message);
            return false;
        }
    }

    // ========================================
    // GESTIÓN DE MENSAJES
    // ========================================

    /**
     * Guarda mensaje en Cosmos
     * @param {string} usuario - ID del usuario
     * @param {string} role - 'user' | 'assistant'
     * @param {string} content - Contenido del mensaje
     * @returns {Promise<object|null>}
     */
    async saveMessage(usuario, role, content) {
        if (!this.cosmosAvailable) {
            console.warn('⚠️ Cosmos no disponible - mensaje no guardado');
            return null;
        }

        try {
            const now = new Date();
            const timestamp = now.toISOString();
            const messageId = `message_${usuario}_${now.getTime()}`;

            const messageDoc = {
                id: messageId,
                user_id: usuario,  // PARTITION KEY
                type: 'message',

                role: role,  // 'user' | 'assistant'
                content: String(content).substring(0, 4000),
                timestamp: timestamp,

                // TTL de 1 día (24 horas)
                ttl: 86400
            };

            const { resource } = await this.container.items.create(messageDoc);
            console.log(`💾 [${usuario}] Mensaje guardado: ${role} (TTL: 1 día)`);

            return resource;
        } catch (error) {
            console.error(`❌ [${usuario}] Error guardando mensaje:`, error.message);
            return null;
        }
    }

    /**
     * Obtiene últimos N mensajes del usuario
     * @param {string} usuario - ID del usuario
     * @param {number} limit - Número de mensajes (default: 10)
     * @returns {Promise<Array>} - [{role, content, timestamp}]
     */
    async getLastMessages(usuario, limit = 10) {
        if (!this.cosmosAvailable) {
            console.warn('⚠️ Cosmos no disponible');
            return [];
        }

        try {
            const query = {
                query: `
                    SELECT c.role, c.content, c.timestamp
                    FROM c
                    WHERE c.user_id = @userId
                      AND c.type = 'message'
                    ORDER BY c.timestamp DESC
                    OFFSET 0 LIMIT @limit
                `,
                parameters: [
                    { name: '@userId', value: usuario },
                    { name: '@limit', value: limit }
                ]
            };

            const { resources: messages } = await this.container.items
                .query(query, { partitionKey: usuario })
                .fetchAll();

            console.log(`📚 [${usuario}] Obtenidos ${messages.length} mensajes`);

            // Retornar en orden cronológico (más antiguo → más reciente)
            return messages.reverse();
        } catch (error) {
            console.error(`❌ [${usuario}] Error obteniendo mensajes:`, error.message);
            return [];
        }
    }

    /**
     * Obtiene últimos mensajes separados por rol (5 user + 5 assistant)
     * @param {string} usuario - ID del usuario
     * @returns {Promise<{userMessages: Array, assistantMessages: Array}>}
     */
    async getLastMessagesByRole(usuario) {
        if (!this.cosmosAvailable) {
            return { userMessages: [], assistantMessages: [] };
        }

        try {
            const allMessages = await this.getLastMessages(usuario, 20);

            const userMessages = allMessages
                .filter(m => m.role === 'user')
                .slice(-5);  // Últimos 5

            const assistantMessages = allMessages
                .filter(m => m.role === 'assistant')
                .slice(-5);  // Últimos 5

            console.log(`📊 [${usuario}] Mensajes por rol: ${userMessages.length} user, ${assistantMessages.length} assistant`);

            return { userMessages, assistantMessages };
        } catch (error) {
            console.error(`❌ [${usuario}] Error obteniendo mensajes por rol:`, error.message);
            return { userMessages: [], assistantMessages: [] };
        }
    }

    /**
     * Limpia mensajes del usuario (útil para "limpiar historial")
     * @param {string} usuario - ID del usuario
     * @returns {Promise<number>} - Número de mensajes eliminados
     */
    async clearUserMessages(usuario) {
        if (!this.cosmosAvailable) return 0;

        try {
            const query = {
                query: `
                    SELECT c.id
                    FROM c
                    WHERE c.user_id = @userId
                      AND c.type = 'message'
                `,
                parameters: [{ name: '@userId', value: usuario }]
            };

            const { resources: messages } = await this.container.items
                .query(query, { partitionKey: usuario })
                .fetchAll();

            let deleted = 0;
            for (const msg of messages) {
                try {
                    await this.container.item(msg.id, usuario).delete();
                    deleted++;
                } catch (e) {
                    console.warn(`⚠️ Error eliminando mensaje ${msg.id}:`, e.message);
                }
            }

            console.log(`🗑️ [${usuario}] Eliminados ${deleted} mensajes`);
            return deleted;
        } catch (error) {
            console.error(`❌ [${usuario}] Error limpiando mensajes:`, error.message);
            return 0;
        }
    }

    // ========================================
    // MÉTODOS DE UTILIDAD/DIAGNÓSTICO
    // ========================================

    /**
     * Obtiene toda la información del usuario (sesión + mensajes)
     * @param {string} usuario - ID del usuario
     * @returns {Promise<{session: object, messages: Array}>}
     */
    async getUserData(usuario) {
        if (!this.cosmosAvailable) {
            return { session: null, messages: [] };
        }

        try {
            const query = {
                query: `
                    SELECT *
                    FROM c
                    WHERE c.user_id = @userId
                    ORDER BY c.timestamp DESC
                `,
                parameters: [{ name: '@userId', value: usuario }]
            };

            const { resources } = await this.container.items
                .query(query, { partitionKey: usuario })
                .fetchAll();

            const session = resources.find(r => r.type === 'user');
            const messages = resources.filter(r => r.type === 'message');

            console.log(`📊 [${usuario}] Sesión: ${session ? 'activa' : 'no encontrada'}, Mensajes: ${messages.length}`);

            return { session, messages };
        } catch (error) {
            console.error(`❌ [${usuario}] Error obteniendo datos:`, error.message);
            return { session: null, messages: [] };
        }
    }

    /**
     * Estadísticas del servicio
     * @returns {object}
     */
    getStats() {
        return {
            available: this.cosmosAvailable,
            database: this.databaseId,
            container: this.containerId,
            partitionKey: '/user_id',
            version: '3.0.0-Simplified',
            ttlRenewal: false,
            documentTypes: {
                user: { ttl: '60min fijo', purpose: 'auth/session' },
                message: { ttl: '24h fijo', purpose: 'chat history' }
            }
        };
    }
}
