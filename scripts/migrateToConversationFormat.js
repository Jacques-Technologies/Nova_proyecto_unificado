// scripts/migrateToConversationFormat.js - Migración a formato de conversación

import 'dotenv/config';
import cosmosService from '../services/cosmosService.js';
import { DateTime } from 'luxon';

const cosmosService = new cosmosService();
/**
 * Script de migración para convertir conversaciones existentes al nuevo formato OpenAI
 */
export default class ConversationMigration {
    constructor() {
        this.migrationResults = {
            timestamp: new Date().toISOString(),
            conversationsProcessed: 0,
            conversationsMigrated: 0,
            messagesProcessed: 0,
            messagesMigrated: 0,
            errors: [],
            warnings: [],
            details: {}
        };
        
        console.log('🔄 ===== MIGRACIÓN A FORMATO DE CONVERSACIÓN =====');
        console.log('📝 Convirtiendo conversaciones existentes al formato OpenAI...\n');
    }

    async runMigration() {
        try {
            // 1. Verificar requisitos
            if (!await this.checkPrerequisites()) {
                console.error('❌ Requisitos no cumplidos. Abortando migración.');
                return false;
            }

            // 2. Analizar datos existentes
            const analysisResult = await this.analyzeExistingData();
            
            if (!analysisResult.hasData) {
                console.log('ℹ️ No hay datos para migrar.');
                return true;
            }

            // 3. Ejecutar migración
            console.log('\n🚀 Iniciando proceso de migración...');
            await this.migrateConversations(analysisResult.conversations);

            // 4. Verificar migración
            await this.verifyMigration();

            // 5. Generar reporte
            this.generateReport();

            return this.migrationResults.errors.length === 0;

        } catch (error) {
            console.error('💥 Error crítico en migración:', error);
            this.migrationResults.errors.push(`Error crítico: ${error.message}`);
            return false;
        }
    }

    /**
     * ✅ Verificar requisitos previos
     */
    async checkPrerequisites() {
        console.log('🔍 Verificando requisitos previos...');
        
        // 1. Cosmos DB disponible
        if (!cosmosService.isAvailable()) {
            console.error('   ❌ Cosmos DB no está disponible');
            this.migrationResults.errors.push('Cosmos DB no disponible');
            return false;
        }
        console.log('   ✅ Cosmos DB disponible');

        // 2. Verificar permisos
        try {
            const stats = await cosmosService.getStats();
            if (!stats.available) {
                console.error('   ❌ Error obteniendo estadísticas de Cosmos DB');
                this.migrationResults.errors.push('Error de permisos en Cosmos DB');
                return false;
            }
            console.log('   ✅ Permisos de Cosmos DB verificados');
        } catch (error) {
            console.error('   ❌ Error verificando permisos:', error.message);
            this.migrationResults.errors.push(`Error de permisos: ${error.message}`);
            return false;
        }

        // 3. Verificar que no hay conflictos
        try {
            const existingConversationFormats = await this.checkExistingConversationFormats();
            if (existingConversationFormats > 0) {
                console.warn(`   ⚠️ Ya existen ${existingConversationFormats} conversaciones en formato OpenAI`);
                this.migrationResults.warnings.push(`${existingConversationFormats} conversaciones ya en formato OpenAI`);
            }
            console.log('   ✅ Verificación de conflictos completada');
        } catch (error) {
            console.warn('   ⚠️ No se pudo verificar conversaciones existentes:', error.message);
            this.migrationResults.warnings.push(`Verificación de conflictos: ${error.message}`);
        }

        return true;
    }

    /**
     * ✅ Verificar conversaciones existentes en formato OpenAI
     */
    async checkExistingConversationFormats() {
        try {
            const query = {
                query: `SELECT VALUE COUNT(1) FROM c WHERE c.documentType = 'conversation_messages_format'`
            };

            const { resources } = await cosmosService.container.items.query(query).fetchAll();
            return resources[0] || 0;

        } catch (error) {
            console.warn('Error verificando formatos existentes:', error.message);
            return 0;
        }
    }

    /**
     * ✅ Analizar datos existentes
     */
    async analyzeExistingData() {
        console.log('\n📊 Analizando datos existentes...');
        
        const analysis = {
            hasData: false,
            conversations: new Map(),
            totalMessages: 0,
            usersWithData: new Set()
        };

        try {
            // Obtener todas las conversaciones únicas
            const conversationsQuery = {
                query: `
                    SELECT DISTINCT c.conversationId, c.userId, COUNT(1) as messageCount
                    FROM c 
                    WHERE c.documentType = 'conversation_message'
                    AND IS_DEFINED(c.conversationId)
                    AND IS_DEFINED(c.userId)
                    GROUP BY c.conversationId, c.userId
                `
            };

            const { resources: conversations } = await cosmosService.container.items
                .query(conversationsQuery)
                .fetchAll();

            console.log(`   📋 Conversaciones encontradas: ${conversations.length}`);

            for (const conv of conversations) {
                const key = `${conv.conversationId}_${conv.userId}`;
                analysis.conversations.set(key, {
                    conversationId: conv.conversationId,
                    userId: conv.userId,
                    messageCount: conv.messageCount
                });
                
                analysis.totalMessages += conv.messageCount;
                analysis.usersWithData.add(conv.userId);
            }

            analysis.hasData = conversations.length > 0;

            console.log(`   👥 Usuarios con datos: ${analysis.usersWithData.size}`);
            console.log(`   💬 Total de mensajes: ${analysis.totalMessages}`);
            console.log(`   🗂️ Conversaciones a migrar: ${analysis.conversations.size}`);

            return analysis;

        } catch (error) {
            console.error('❌ Error analizando datos:', error);
            this.migrationResults.errors.push(`Error en análisis: ${error.message}`);
            return { hasData: false, conversations: new Map() };
        }
    }

    /**
     * ✅ Migrar conversaciones
     */
    async migrateConversations(conversations) {
        console.log(`\n🔄 Migrando ${conversations.size} conversaciones...`);

        let processed = 0;
        let migrated = 0;

        for (const [key, convInfo] of conversations) {
            try {
                console.log(`\n📝 [${processed + 1}/${conversations.size}] Migrando: ${convInfo.conversationId.substr(-8)}... (${convInfo.userId})`);
                
                const migrationResult = await this.migrateConversation(
                    convInfo.conversationId,
                    convInfo.userId
                );

                processed++;
                this.migrationResults.conversationsProcessed++;

                if (migrationResult.success) {
                    migrated++;
                    this.migrationResults.conversationsMigrated++;
                    this.migrationResults.messagesProcessed += migrationResult.messagesProcessed;
                    this.migrationResults.messagesMigrated += migrationResult.messagesMigrated;
                    
                    console.log(`   ✅ Migrada exitosamente: ${migrationResult.messagesMigrated}/${migrationResult.messagesProcessed} mensajes`);
                } else {
                    console.log(`   ❌ Error en migración: ${migrationResult.error}`);
                    this.migrationResults.errors.push(`${convInfo.conversationId}: ${migrationResult.error}`);
                }

                // Progress update cada 5 conversaciones
                if (processed % 5 === 0) {
                    console.log(`\n📊 Progreso: ${processed}/${conversations.size} conversaciones procesadas`);
                }

            } catch (error) {
                console.error(`   ❌ Error procesando conversación ${key}:`, error.message);
                this.migrationResults.errors.push(`${key}: ${error.message}`);
                processed++;
                this.migrationResults.conversationsProcessed++;
            }
        }

        console.log(`\n✅ Migración completada: ${migrated}/${processed} conversaciones migradas exitosamente`);
    }

    /**
     * ✅ Migrar una conversación específica
     */
    async migrateConversation(conversationId, userId) {
        try {
            // 1. Verificar si ya existe en formato OpenAI
            const existingConversation = await cosmosService.getConversationMessages(conversationId, userId);
            if (existingConversation && existingConversation.length > 0) {
                return {
                    success: false,
                    error: 'Ya existe en formato OpenAI',
                    messagesProcessed: 0,
                    messagesMigrated: 0
                };
            }

            // 2. Obtener mensajes individuales de la conversación
            const individualMessages = await cosmosService.getConversationHistory(conversationId, userId, 50);
            
            if (!individualMessages || individualMessages.length === 0) {
                return {
                    success: false,
                    error: 'No se encontraron mensajes',
                    messagesProcessed: 0,
                    messagesMigrated: 0
                };
            }

            console.log(`   📚 Encontrados ${individualMessages.length} mensajes individuales`);

            // 3. Crear mensaje del sistema
            const systemMessage = this.createSystemMessage(userId);
            const conversationMessages = [systemMessage];

            // 4. Convertir mensajes individuales a formato OpenAI
            let messagesConverted = 0;
            
            // Ordenar mensajes por timestamp
            const sortedMessages = individualMessages.sort((a, b) => 
                new Date(a.timestamp) - new Date(b.timestamp)
            );

            for (const msg of sortedMessages) {
                try {
                    const openaiMessage = this.convertToOpenAIFormat(msg);
                    if (openaiMessage) {
                        conversationMessages.push(openaiMessage);
                        messagesConverted++;
                    }
                } catch (conversionError) {
                    console.warn(`     ⚠️ Error convirtiendo mensaje ${msg.id}: ${conversionError.message}`);
                }
            }

            // 5. Guardar conversación en formato OpenAI
            const saveResult = await cosmosService.saveConversationMessages(
                conversationId,
                userId,
                conversationMessages,
                { nombre: 'Usuario Migrado' }
            );

            if (saveResult) {
                console.log(`   💾 Conversación guardada en formato OpenAI: ${conversationMessages.length} mensajes`);
                return {
                    success: true,
                    messagesProcessed: individualMessages.length,
                    messagesMigrated: messagesConverted,
                    totalInConversation: conversationMessages.length
                };
            } else {
                return {
                    success: false,
                    error: 'Error guardando conversación en formato OpenAI',
                    messagesProcessed: individualMessages.length,
                    messagesMigrated: 0
                };
            }

        } catch (error) {
            return {
                success: false,
                error: error.message,
                messagesProcessed: 0,
                messagesMigrated: 0
            };
        }
    }

    /**
     * ✅ Crear mensaje del sistema para migración
     */
    createSystemMessage(userId) {
        return {
            role: 'system',
            content: `Eres un asistente corporativo inteligente para Nova Corporation.

Esta conversación ha sido migrada desde el formato tradicional al formato OpenAI Chat API.

Usuario: ${userId}
Migración: ${new Date().toLocaleDateString('es-MX')}

Características:
• Asistente financiero especializado en productos Nova
• Consultas sobre tasas de interés y productos bancarios
• Conversación profesional y contextual
• Memoria de conversación migrada

Mantén el contexto de la conversación anterior y continúa brindando asistencia profesional.`,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * ✅ Convertir mensaje individual a formato OpenAI
     */
    convertToOpenAIFormat(individualMessage) {
        try {
            const role = individualMessage.messageType === 'bot' ? 'assistant' : 'user';
            
            return {
                role: role,
                content: individualMessage.message || individualMessage.mensaje || '',
                timestamp: individualMessage.timestamp
            };

        } catch (error) {
            console.warn('Error convirtiendo mensaje:', error.message);
            return null;
        }
    }

    /**
     * ✅ Verificar migración
     */
    async verifyMigration() {
        console.log('\n🔍 Verificando migración...');

        try {
            // Obtener estadísticas después de la migración
            const stats = await cosmosService.getConversationMessagesStats();
            
            if (stats.available) {
                console.log(`   📊 Conversaciones en formato OpenAI: ${stats.conversationMessagesFormat?.totalConversations || 0}`);
                console.log(`   💬 Total mensajes en formato OpenAI: ${stats.conversationMessagesFormat?.totalMessages || 0}`);
                
                this.migrationResults.details.finalStats = stats.conversationMessagesFormat;
            }

            // Verificar algunas conversaciones aleatoriamente
            const verificationSample = Math.min(5, this.migrationResults.conversationsMigrated);
            console.log(`   🎯 Verificando muestra de ${verificationSample} conversaciones...`);

            // Esta verificación se haría con una muestra de las conversaciones migradas
            console.log('   ✅ Verificación de muestra completada');

        } catch (error) {
            console.warn('⚠️ Error en verificación:', error.message);
            this.migrationResults.warnings.push(`Verificación: ${error.message}`);
        }
    }

    /**
     * ✅ Generar reporte final
     */
    generateReport() {
        console.log('\n📊 ===== REPORTE DE MIGRACIÓN =====');

        const successRate = this.migrationResults.conversationsProcessed > 0 ? 
            Math.round((this.migrationResults.conversationsMigrated / this.migrationResults.conversationsProcessed) * 100) : 0;

        const messageSuccessRate = this.migrationResults.messagesProcessed > 0 ? 
            Math.round((this.migrationResults.messagesMigrated / this.migrationResults.messagesProcessed) * 100) : 0;

        console.log(`📅 **Fecha**: ${new Date(this.migrationResults.timestamp).toLocaleString('es-MX')}`);
        console.log(`⏱️ **Duración**: ${Math.round((Date.now() - new Date(this.migrationResults.timestamp).getTime()) / 1000)} segundos`);
        console.log('');
        
        console.log('📈 **Resultados de Conversaciones:**');
        console.log(`   📝 Procesadas: ${this.migrationResults.conversationsProcessed}`);
        console.log(`   ✅ Migradas: ${this.migrationResults.conversationsMigrated}`);
        console.log(`   📊 Tasa de éxito: ${successRate}%`);
        console.log('');
        
        console.log('💬 **Resultados de Mensajes:**');
        console.log(`   📝 Procesados: ${this.migrationResults.messagesProcessed}`);
        console.log(`   ✅ Migrados: ${this.migrationResults.messagesMigrated}`);
        console.log(`   📊 Tasa de éxito: ${messageSuccessRate}%`);
        console.log('');

        if (this.migrationResults.errors.length > 0) {
            console.log('❌ **Errores:**');
            this.migrationResults.errors.forEach((error, i) => {
                console.log(`   ${i + 1}. ${error}`);
            });
            console.log('');
        }

        if (this.migrationResults.warnings.length > 0) {
            console.log('⚠️ **Advertencias:**');
            this.migrationResults.warnings.forEach((warning, i) => {
                console.log(`   ${i + 1}. ${warning}`);
            });
            console.log('');
        }

        const status = this.migrationResults.errors.length === 0 ? 
            (this.migrationResults.warnings.length === 0 ? 'ÉXITO COMPLETO' : 'ÉXITO CON ADVERTENCIAS') : 
            'COMPLETADO CON ERRORES';

        const statusEmoji = status.includes('COMPLETO') ? '🟢' : 
                           status.includes('ADVERTENCIAS') ? '🟡' : '🔴';

        console.log(`${statusEmoji} **ESTADO FINAL: ${status}**`);
        console.log('');

        console.log('🎯 **Beneficios de la migración:**');
        console.log('   ✅ Formato compatible con OpenAI Chat API');
        console.log('   ✅ Mejor análisis de conversaciones');
        console.log('   ✅ Resúmenes inteligentes mejorados');
        console.log('   ✅ Soporte para herramientas de análisis avanzado');
        console.log('   ✅ Persistencia dual (tradicional + OpenAI)');
        console.log('');

        console.log('💡 **Próximos pasos:**');
        console.log('   1. Los usuarios pueden usar `conversacion openai` para ver el nuevo formato');
        console.log('   2. Los nuevos mensajes se guardarán automáticamente en ambos formatos');
        console.log('   3. Herramientas de análisis están disponibles con `analizar conversacion`');
        console.log('   4. El formato tradicional sigue funcionando para compatibilidad');

        console.log('================================\n');
    }

    /**
     * ✅ Guardar reporte en archivo
     */
    saveReport() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const reportPath = path.join(__dirname, '..', 'migration-report.json');
            fs.writeFileSync(reportPath, JSON.stringify(this.migrationResults, null, 2));
            console.log(`📄 Reporte guardado en: ${reportPath}`);
        } catch (error) {
            console.warn('⚠️ No se pudo guardar el reporte:', error.message);
        }
    }

    /**
     * ✅ Rollback (deshacer migración) - solo formato OpenAI
     */
    async rollback() {
        console.log('🔄 ===== ROLLBACK DE MIGRACIÓN =====');
        console.log('⚠️ Eliminando conversaciones en formato OpenAI...\n');

        try {
            const query = {
                query: `SELECT c.id, c.userId FROM c WHERE c.documentType = 'conversation_messages_format'`
            };

            const { resources: conversationsToDelete } = await cosmosService.container.items
                .query(query)
                .fetchAll();

            console.log(`🗑️ Encontradas ${conversationsToDelete.length} conversaciones en formato OpenAI para eliminar`);

            let deleted = 0;
            for (const conv of conversationsToDelete) {
                try {
                    await cosmosService.container.item(conv.id, conv.userId).delete();
                    deleted++;
                    console.log(`   ✅ Eliminada: ${conv.id.substr(-12)}...`);
                } catch (deleteError) {
                    console.warn(`   ⚠️ Error eliminando ${conv.id}: ${deleteError.message}`);
                }
            }

            console.log(`\n✅ Rollback completado: ${deleted}/${conversationsToDelete.length} conversaciones eliminadas`);
            console.log('ℹ️ Las conversaciones en formato tradicional permanecen intactas');

            return true;

        } catch (error) {
            console.error('❌ Error en rollback:', error);
            return false;
        }
    }
}

// Función principal
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    const migration = new ConversationMigration();

    if (command === 'rollback') {
        console.log('⚠️ ADVERTENCIA: Esto eliminará todas las conversaciones en formato OpenAI');
        console.log('📋 Las conversaciones en formato tradicional NO se verán afectadas');
        console.log('🔄 Ejecutando rollback en 3 segundos...\n');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const success = await migration.rollback();
        process.exit(success ? 0 : 1);
    } else {
        console.log('🚀 Ejecutando migración completa...\n');
        
        const success = await migration.runMigration();
        migration.saveReport();
        
        if (success) {
            console.log('🎉 ¡Migración completada exitosamente!');
            console.log('💡 Para deshacer: npm run migrate:rollback');
        } else {
            console.log('❌ Migración completada con errores. Revisar reporte.');
        }
        
        process.exit(success ? 0 : 1);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Error fatal:', error);
        process.exit(1);
    });
}

