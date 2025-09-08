// services/conversationService.js - Servicio simplificado de conversaciones

import { DateTime } from 'luxon';
/**
 * ConversationService - Manejo simplificado de conversaciones en memoria
 * Nota: Al usar MemoryStorage, las conversaciones se pierden al reiniciar el bot
 */
export default class ConversationService {
    constructor() {
        // Almacenamiento en memoria
        this.conversations = new Map();
        this.messages = new Map();
        
        console.log('💬 ConversationService inicializado (MemoryStorage)');
    }

    /**
     * Crea una nueva conversación
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario
     * @returns {Object} - Información de la conversación creada
     */
    async createConversation(conversationId, userId) {
        try {
            const conversation = {
                id: conversationId,
                userId: userId,
                createdAt: DateTime.now().setZone('America/Mexico_City').toISO(),
                lastActivity: DateTime.now().setZone('America/Mexico_City').toISO(),
                messageCount: 0,
                isActive: true
            };

            this.conversations.set(conversationId, conversation);
            
            // Inicializar array de mensajes para esta conversación
            if (!this.messages.has(conversationId)) {
                this.messages.set(conversationId, []);
            }

            console.log(`💬 [${userId}] Nueva conversación creada: ${conversationId}`);
            return conversation;

        } catch (error) {
            console.error('❌ Error creando conversación:', error);
            throw error;
        }
    }

    /**
     * Guarda un mensaje en la conversación
     * @param {string} message - Contenido del mensaje
     * @param {string} conversationId - ID de la conversación
     * @param {string} userId - ID del usuario ('bot' para mensajes del bot)
     * @returns {Object} - Mensaje guardado
     */
    async saveMessage(message, conversationId, userId = null) {
        try {
            const messageObj = {
                id: this.generateMessageId(),
                message: message,
                conversationId: conversationId,
                userId: userId,
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
                type: userId === 'bot' ? 'assistant' : 'user'
            };

            // Obtener array de mensajes de la conversación
            let conversationMessages = this.messages.get(conversationId) || [];
            
            // Agregar nuevo mensaje
            conversationMessages.push(messageObj);
            
            // Mantener solo los últimos 5 mensajes para no llenar memoria
            // Esto asegura que el contexto no crezca indebidamente
            if (conversationMessages.length > 5) {
                conversationMessages = conversationMessages.slice(-5);
            }
            
            this.messages.set(conversationId, conversationMessages);

            // Actualizar última actividad de la conversación
            await this.updateLastActivity(conversationId);

            console.log(`💬 [${userId || 'unknown'}] Mensaje guardado en ${conversationId}`);
            return messageObj;

        } catch (error) {
            console.error('❌ Error guardando mensaje:', error);
            return null;
        }
    }

    /**
     * Obtiene el historial de conversación
     * @param {string} conversationId - ID de la conversación
     * @param {number} limit - Límite de mensajes (default: 20)
     * @returns {Array} - Array de mensajes
     */
    async getConversationHistory(conversationId, limit = 20) {
        try {
            const conversationMessages = this.messages.get(conversationId) || [];
            
            // Retornar los últimos 'limit' mensajes
            const recent = conversationMessages.slice(-limit);
            
            console.log(`📚 [${conversationId}] Historial obtenido: ${recent.length} mensajes`);
            return recent;

        } catch (error) {
            console.error('❌ Error obteniendo historial:', error);
            return [];
        }
    }

    /**
     * Actualiza la última actividad de una conversación
     * @param {string} conversationId - ID de la conversación
     * @returns {boolean} - Success
     */
    async updateLastActivity(conversationId) {
        try {
            const conversation = this.conversations.get(conversationId);
            
            if (conversation) {
                conversation.lastActivity = DateTime.now().setZone('America/Mexico_City').toISO();
                conversation.messageCount = (conversation.messageCount || 0) + 1;
                this.conversations.set(conversationId, conversation);
                
                return true;
            }

            return false;

        } catch (error) {
            console.error('❌ Error actualizando actividad:', error);
            return false;
        }
    }

    /**
     * Obtiene información de una conversación
     * @param {string} conversationId - ID de la conversación
     * @returns {Object|null} - Información de la conversación
     */
    async getConversationInfo(conversationId) {
        try {
            const conversation = this.conversations.get(conversationId);
            
            if (conversation) {
                const messageCount = this.messages.get(conversationId)?.length || 0;
                
                return {
                    ...conversation,
                    actualMessageCount: messageCount
                };
            }

            return null;

        } catch (error) {
            console.error('❌ Error obteniendo info de conversación:', error);
            return null;
        }
    }

    /**
     * Limpia mensajes antiguos de una conversación
     * @param {string} conversationId - ID de la conversación
     * @param {number} keepLast - Cuántos mensajes mantener (default: 10)
     * @returns {number} - Número de mensajes eliminados
     */
    async cleanOldMessages(conversationId, keepLast = 10) {
        try {
            const conversationMessages = this.messages.get(conversationId) || [];
            
            if (conversationMessages.length <= keepLast) {
                return 0;
            }

            const messagesToKeep = conversationMessages.slice(-keepLast);
            const removedCount = conversationMessages.length - messagesToKeep.length;
            
            this.messages.set(conversationId, messagesToKeep);
            
            console.log(`🧹 [${conversationId}] Limpiados ${removedCount} mensajes antiguos`);
            return removedCount;

        } catch (error) {
            console.error('❌ Error limpiando mensajes:', error);
            return 0;
        }
    }

    /**
     * Elimina una conversación completa
     * @param {string} conversationId - ID de la conversación
     * @returns {boolean} - Success
     */
    async deleteConversation(conversationId) {
        try {
            const hadConversation = this.conversations.has(conversationId);
            const hadMessages = this.messages.has(conversationId);
            
            this.conversations.delete(conversationId);
            this.messages.delete(conversationId);
            
            console.log(`🗑️ [${conversationId}] Conversación eliminada`);
            return hadConversation || hadMessages;

        } catch (error) {
            console.error('❌ Error eliminando conversación:', error);
            return false;
        }
    }

    /**
     * Obtiene estadísticas del servicio
     * @returns {Object} - Estadísticas
     */
    getStats() {
        const totalConversations = this.conversations.size;
        const totalMessages = Array.from(this.messages.values())
            .reduce((total, messages) => total + messages.length, 0);

        const activeConversations = Array.from(this.conversations.values())
            .filter(conv => conv.isActive).length;

        return {
            totalConversations,
            activeConversations,
            totalMessages,
            averageMessagesPerConversation: totalConversations > 0 ? 
                Math.round(totalMessages / totalConversations) : 0,
            timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
        };
    }

    /**
     * Genera un ID único para mensaje
     * @returns {string} - ID del mensaje
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Limpieza general del servicio (para desarrollo)
     * @returns {Object} - Resultados de la limpieza
     */
    cleanup() {
        const stats = this.getStats();
        
        this.conversations.clear();
        this.messages.clear();
        
        console.log('🧹 ConversationService limpiado completamente');
        
        return {
            ...stats,
            action: 'cleanup_complete',
            timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
        };
    }
}

// Crear instancia singleton
const conversationService = new ConversationService();

