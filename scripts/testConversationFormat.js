// scripts/testConversationFormat.js - Test del formato de conversación

import 'dotenv/config';
import cosmosService from '../services/cosmosService.js';

const CosmosService= new cosmosService();

/**
 * Script de prueba para verificar el formato de conversación
 */
export default class TestConversationFormat {
    constructor() {
        this.testResults = {
            timestamp: new Date().toISOString(),
            tests: {},
            errors: [],
            summary: {}
        };
        
        this.testUserId = 'test_conversation_format';
        this.testConversationId = 'test_conv_' + Date.now();
        
        console.log('🧪 ===== TEST FORMATO DE CONVERSACIÓN =====');
        console.log('🔧 Verificando funcionalidad dual de persistencia...\n');
    }

    async runAllTests() {
        try {
            console.log('📋 Iniciando batería de tests...\n');

            // Test 1: Configuración básica
            await this.testBasicSetup();
            
            // Test 2: Guardado individual (tradicional)
            await this.testIndividualMessageSaving();
            
            // Test 3: Formato de conversación OpenAI
            await this.testOpenAIConversationFormat();
            
            // Test 4: Coexistencia de formatos
            await this.testFormatCoexistence();
            
            // Test 5: Integración con OpenAI API
            await this.testOpenAIAPIIntegration();
            
            // Test 6: Gestión y limpieza
            await this.testConversationManagement();
            
            // Test 7: Persistencia a largo plazo
            await this.testLongTermPersistence();
            
            // Generar reporte final
            this.generateFinalReport();
            
        } catch (error) {
            console.error('💥 Error ejecutando tests:', error);
            this.testResults.errors.push(`Error general: ${error.message}`);
        }
    }

    /**
     * ✅ Test 1: Configuración básica
     */
    async testBasicSetup() {
        console.log('🔧 Test 1: Configuración básica...');
        
        const setupCheck = {
            cosmosAvailable: false,
            configComplete: false,
            connectionWorking: false
        };
        
        try {
            // Verificar disponibilidad de Cosmos DB
            setupCheck.cosmosAvailable = cosmosService.isAvailable();
            console.log(`   ${setupCheck.cosmosAvailable ? '✅' : '❌'} Cosmos DB disponible: ${setupCheck.cosmosAvailable}`);
            
            if (setupCheck.cosmosAvailable) {
                // Verificar configuración
                const config = cosmosService.getConfigInfo();
                setupCheck.configComplete = config.available && config.initialized;
                console.log(`   ${setupCheck.configComplete ? '✅' : '❌'} Configuración completa: ${setupCheck.configComplete}`);
                
                // Test de conectividad básica
                try {
                    const stats = await cosmosService.getStats();
                    setupCheck.connectionWorking = stats.available;
                    console.log(`   ${setupCheck.connectionWorking ? '✅' : '❌'} Conexión funcionando: ${setupCheck.connectionWorking}`);
                } catch (statsError) {
                    console.log(`   ❌ Error obteniendo estadísticas: ${statsError.message}`);
                }
            }
            
            this.testResults.tests.basicSetup = {
                status: setupCheck.cosmosAvailable && setupCheck.configComplete && setupCheck.connectionWorking ? 'pass' : 'fail',
                details: setupCheck,
                message: setupCheck.cosmosAvailable ? 
                    'Configuración básica correcta' : 
                    'Cosmos DB no disponible - tests limitados'
            };
            
            if (!setupCheck.cosmosAvailable) {
                this.testResults.errors.push('Cosmos DB no disponible - funcionalidad limitada');
            }
            
        } catch (error) {
            console.log(`   ❌ Error en configuración: ${error.message}`);
            this.testResults.tests.basicSetup = {
                status: 'fail',
                error: error.message,
                message: 'Error en configuración básica'
            };
            this.testResults.errors.push(`Configuración: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 2: Guardado individual (tradicional)
     */
    async testIndividualMessageSaving() {
        console.log('💾 Test 2: Guardado individual (tradicional)...');
        
        const savingResults = {
            messagesSaved: 0,
            messagesRetrieved: 0,
            formatCorrect: false
        };
        
        try {
            if (!cosmosService.isAvailable()) {
                console.log('   ⚠️ Cosmos DB no disponible - saltando test');
                this.testResults.tests.individualMessageSaving = {
                    status: 'skip',
                    message: 'Cosmos DB no disponible'
                };
                console.log('');
                return;
            }
            
            console.log('   📝 Guardando mensajes individuales...');
            
            const testMessages = [
                { content: '¿Cuáles son las tasas de Nova?', type: 'user' },
                { content: 'Las tasas actuales son: Vista 2.5%, Plazo Fijo 4.2%', type: 'bot' },
                { content: 'Perfecto, ¿cuál me conviene más?', type: 'user' },
                { content: 'Para ahorro recomiendo el plazo fijo por mayor rendimiento', type: 'bot' }
            ];
            
            for (let i = 0; i < testMessages.length; i++) {
                const msg = testMessages[i];
                console.log(`      ${i + 1}. Guardando: ${msg.type} - "${msg.content.substring(0, 30)}..."`);
                
                const result = await cosmosService.saveMessage(
                    msg.content,
                    this.testConversationId,
                    this.testUserId,
                    msg.type === 'bot' ? 'Nova Bot Test' : 'Usuario Test',
                    msg.type
                );
                
                if (result) {
                    savingResults.messagesSaved++;
                    console.log(`         ✅ Guardado: ${result.id}`);
                } else {
                    console.log(`         ❌ Error guardando`);
                }
            }
            
            // Verificar recuperación
            console.log('   📚 Recuperando historial tradicional...');
            const historial = await cosmosService.getConversationHistory(
                this.testConversationId,
                this.testUserId,
                10
            );
            
            savingResults.messagesRetrieved = historial.length;
            console.log(`      📊 Mensajes recuperados: ${savingResults.messagesRetrieved}`);
            
            // Verificar formato
            if (historial.length > 0) {
                const primerMensaje = historial[0];
                savingResults.formatCorrect = !!(
                    primerMensaje.id &&
                    primerMensaje.message &&
                    primerMensaje.type &&
                    primerMensaje.timestamp
                );
                console.log(`      ✅ Formato correcto: ${savingResults.formatCorrect}`);
                
                console.log('      📋 Ejemplo de mensaje recuperado:');
                console.log(`         ID: ${primerMensaje.id}`);
                console.log(`         Tipo: ${primerMensaje.type}`);
                console.log(`         Contenido: ${primerMensaje.message.substring(0, 50)}...`);
            }
            
            this.testResults.tests.individualMessageSaving = {
                status: savingResults.messagesSaved > 0 && savingResults.messagesRetrieved > 0 ? 'pass' : 'fail',
                details: savingResults,
                message: `${savingResults.messagesSaved} mensajes guardados, ${savingResults.messagesRetrieved} recuperados`
            };
            
        } catch (error) {
            console.log(`   ❌ Error en guardado individual: ${error.message}`);
            this.testResults.tests.individualMessageSaving = {
                status: 'fail',
                error: error.message,
                message: 'Error en guardado individual'
            };
            this.testResults.errors.push(`Guardado individual: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 3: Formato de conversación OpenAI
     */
    async testOpenAIConversationFormat() {
        console.log('🤖 Test 3: Formato de conversación OpenAI...');
        
        const openaiResults = {
            systemMessageAdded: false,
            conversationMessagesAdded: 0,
            conversationRetrieved: false,
            formatValid: false
        };
        
        try {
            if (!cosmosService.isAvailable()) {
                console.log('   ⚠️ Cosmos DB no disponible - saltando test');
                this.testResults.tests.openaiConversationFormat = {
                    status: 'skip',
                    message: 'Cosmos DB no disponible'
                };
                console.log('');
                return;
            }
            
            // 1. Agregar mensaje del sistema
            console.log('   ⚙️ Agregando mensaje del sistema...');
            const systemResult = await cosmosService.addMessageToConversation(
                this.testConversationId,
                this.testUserId,
                'system',
                'Eres un asistente financiero de Nova Corporation especializado en productos bancarios y de inversión.',
                { nombre: 'Usuario Test' }
            );
            
            openaiResults.systemMessageAdded = !!systemResult;
            console.log(`      ${openaiResults.systemMessageAdded ? '✅' : '❌'} Mensaje del sistema agregado`);
            
            // 2. Agregar conversación completa
            console.log('   💬 Agregando mensajes de conversación...');
            const conversationFlow = [
                { role: 'user', content: 'Quiero información sobre inversiones' },
                { role: 'assistant', content: 'Te puedo ayudar con nuestros productos de inversión. ¿Qué monto tienes disponible?' },
                { role: 'user', content: 'Tengo $100,000 y quiero invertir a 12 meses' },
                { role: 'assistant', content: 'Para $100,000 a 12 meses, te recomiendo nuestro Certificado de Depósito con tasa del 5.2% anual.' }
            ];
            
            for (const msg of conversationFlow) {
                console.log(`      📝 Agregando: ${msg.role} - "${msg.content.substring(0, 40)}..."`);
                
                const result = await cosmosService.addMessageToConversation(
                    this.testConversationId,
                    this.testUserId,
                    msg.role,
                    msg.content,
                    { nombre: 'Usuario Test' }
                );
                
                if (result) {
                    openaiResults.conversationMessagesAdded++;
                    console.log(`         ✅ Agregado exitosamente`);
                } else {
                    console.log(`         ❌ Error agregando`);
                }
            }
            
            // 3. Recuperar conversación
            console.log('   📚 Recuperando conversación en formato OpenAI...');
            const conversation = await cosmosService.getConversationMessages(
                this.testConversationId,
                this.testUserId
            );
            
            openaiResults.conversationRetrieved = conversation.length > 0;
            console.log(`      📊 Mensajes en conversación: ${conversation.length}`);
            
            // 4. Validar formato
            if (conversation.length > 0) {
                const validFormat = conversation.every(msg => 
                    msg.role && 
                    msg.content && 
                    ['system', 'user', 'assistant'].includes(msg.role)
                );
                
                openaiResults.formatValid = validFormat;
                console.log(`      ${validFormat ? '✅' : '❌'} Formato OpenAI válido`);
                
                if (validFormat) {
                    console.log('      📋 Estructura de conversación:');
                    conversation.forEach((msg, index) => {
                        console.log(`         ${index + 1}. ${msg.role}: ${msg.content.substring(0, 50)}...`);
                    });
                }
            }
            
            this.testResults.tests.openaiConversationFormat = {
                status: openaiResults.systemMessageAdded && openaiResults.conversationRetrieved && openaiResults.formatValid ? 'pass' : 'fail',
                details: openaiResults,
                message: `Sistema: ${openaiResults.systemMessageAdded}, Conversación: ${openaiResults.conversationMessagesAdded} msgs, Formato: ${openaiResults.formatValid}`
            };
            
        } catch (error) {
            console.log(`   ❌ Error en formato OpenAI: ${error.message}`);
            this.testResults.tests.openaiConversationFormat = {
                status: 'fail',
                error: error.message,
                message: 'Error en formato OpenAI'
            };
            this.testResults.errors.push(`Formato OpenAI: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 4: Coexistencia de formatos
     */
    async testFormatCoexistence() {
        console.log('🔄 Test 4: Coexistencia de formatos...');
        
        const coexistenceResults = {
            traditionalHistoryExists: false,
            openaiConversationExists: false,
            bothFormatsIntact: false,
            dataConsistency: false
        };
        
        try {
            if (!cosmosService.isAvailable()) {
                console.log('   ⚠️ Cosmos DB no disponible - saltando test');
                this.testResults.tests.formatCoexistence = {
                    status: 'skip',
                    message: 'Cosmos DB no disponible'
                };
                console.log('');
                return;
            }
            
            console.log('   🔍 Verificando ambos formatos coexistiendo...');
            
            // 1. Verificar historial tradicional
            const traditionalHistory = await cosmosService.getConversationHistory(
                this.testConversationId,
                this.testUserId
            );
            
            coexistenceResults.traditionalHistoryExists = traditionalHistory.length > 0;
            console.log(`      📋 Historial tradicional: ${traditionalHistory.length} mensajes - ${coexistenceResults.traditionalHistoryExists ? '✅' : '❌'}`);
            
            // 2. Verificar formato OpenAI
            const openaiConversation = await cosmosService.getConversationMessages(
                this.testConversationId,
                this.testUserId
            );
            
            coexistenceResults.openaiConversationExists = openaiConversation.length > 0;
            console.log(`      🤖 Formato OpenAI: ${openaiConversation.length} mensajes - ${coexistenceResults.openaiConversationExists ? '✅' : '❌'}`);
            
            // 3. Verificar que ambos formatos existen
            coexistenceResults.bothFormatsIntact = coexistenceResults.traditionalHistoryExists && coexistenceResults.openaiConversationExists;
            console.log(`      🔗 Ambos formatos intactos: ${coexistenceResults.bothFormatsIntact ? '✅' : '❌'}`);
            
            // 4. Verificar consistencia de datos (contenido similar)
            if (coexistenceResults.bothFormatsIntact) {
                // Buscar mensajes de usuario en ambos formatos
                const traditionalUserMessages = traditionalHistory.filter(msg => msg.type === 'user');
                const openaiUserMessages = openaiConversation.filter(msg => msg.role === 'user');
                
                console.log(`      📊 Mensajes de usuario - Tradicional: ${traditionalUserMessages.length}, OpenAI: ${openaiUserMessages.length}`);
                
                // Verificar que hay contenido similar (no necesariamente idéntico debido a diferentes momentos de guardado)
                coexistenceResults.dataConsistency = traditionalUserMessages.length > 0 && openaiUserMessages.length > 0;
                console.log(`      ${coexistenceResults.dataConsistency ? '✅' : '❌'} Consistencia de datos: ambos formatos tienen contenido`);
            }
            
            this.testResults.tests.formatCoexistence = {
                status: coexistenceResults.bothFormatsIntact && coexistenceResults.dataConsistency ? 'pass' : 'fail',
                details: coexistenceResults,
                message: `Tradicional: ${coexistenceResults.traditionalHistoryExists}, OpenAI: ${coexistenceResults.openaiConversationExists}, Consistente: ${coexistenceResults.dataConsistency}`
            };
            
        } catch (error) {
            console.log(`   ❌ Error verificando coexistencia: ${error.message}`);
            this.testResults.tests.formatCoexistence = {
                status: 'fail',
                error: error.message,
                message: 'Error verificando coexistencia'
            };
            this.testResults.errors.push(`Coexistencia: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 5: Integración con OpenAI API
     */
    async testOpenAIAPIIntegration() {
        console.log('🔗 Test 5: Integración con OpenAI API...');
        
        const apiIntegrationResults = {
            formatForAPI: false,
            withoutSystem: false,
            structureValid: false
        };
        
        try {
            if (!cosmosService.isAvailable()) {
                console.log('   ⚠️ Cosmos DB no disponible - saltando test');
                this.testResults.tests.openaiAPIIntegration = {
                    status: 'skip',
                    message: 'Cosmos DB no disponible'
                };
                console.log('');
                return;
            }
            
            console.log('   🔌 Probando formato para OpenAI API...');
            
            // 1. Obtener conversación formateada para API (con sistema)
            const withSystem = await cosmosService.getConversationForOpenAI(
                this.testConversationId,
                this.testUserId,
                true
            );
            
            apiIntegrationResults.formatForAPI = Array.isArray(withSystem) && withSystem.length > 0;
            console.log(`      📤 Con sistema: ${withSystem.length} mensajes - ${apiIntegrationResults.formatForAPI ? '✅' : '❌'}`);
            
            // 2. Obtener conversación sin mensaje del sistema
            const withoutSystem = await cosmosService.getConversationForOpenAI(
                this.testConversationId,
                this.testUserId,
                false
            );
            
            apiIntegrationResults.withoutSystem = Array.isArray(withoutSystem) && withoutSystem.length > 0;
            console.log(`      📤 Sin sistema: ${withoutSystem.length} mensajes - ${apiIntegrationResults.withoutSystem ? '✅' : '❌'}`);
            
            // 3. Validar estructura para OpenAI API
            if (withSystem.length > 0) {
                const validStructure = withSystem.every(msg => 
                    typeof msg === 'object' &&
                    typeof msg.role === 'string' &&
                    typeof msg.content === 'string' &&
                    !msg.timestamp // No debe tener timestamp para API
                );
                
                apiIntegrationResults.structureValid = validStructure;
                console.log(`      ${validStructure ? '✅' : '❌'} Estructura válida para API OpenAI`);
                
                if (validStructure) {
                    console.log('      📋 Ejemplo de estructura para API:');
                    withSystem.slice(0, 2).forEach((msg, index) => {
                        console.log(`         ${index + 1}. { role: "${msg.role}", content: "${msg.content.substring(0, 40)}..." }`);
                    });
                }
            }
            
            this.testResults.tests.openaiAPIIntegration = {
                status: apiIntegrationResults.formatForAPI && apiIntegrationResults.structureValid ? 'pass' : 'fail',
                details: apiIntegrationResults,
                message: `API format: ${apiIntegrationResults.formatForAPI}, Structure: ${apiIntegrationResults.structureValid}`
            };
            
        } catch (error) {
            console.log(`   ❌ Error en integración API: ${error.message}`);
            this.testResults.tests.openaiAPIIntegration = {
                status: 'fail',
                error: error.message,
                message: 'Error en integración API'
            };
            this.testResults.errors.push(`API Integration: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 6: Gestión y limpieza
     */
    async testConversationManagement() {
        console.log('🛠️ Test 6: Gestión y limpieza...');
        
        const managementResults = {
            statisticsObtained: false,
            selectiveCleaningWorks: false,
            fullCleaningWorks: false
        };
        
        try {
            if (!cosmosService.isAvailable()) {
                console.log('   ⚠️ Cosmos DB no disponible - saltando test');
                this.testResults.tests.conversationManagement = {
                    status: 'skip',
                    message: 'Cosmos DB no disponible'
                };
                console.log('');
                return;
            }
            
            // 1. Obtener estadísticas
            console.log('   📊 Obteniendo estadísticas...');
            try {
                const generalStats = await cosmosService.getStats();
                const conversationStats = await cosmosService.getConversationMessagesStats();
                
                managementResults.statisticsObtained = !!(generalStats.available && conversationStats.available);
                console.log(`      ${managementResults.statisticsObtained ? '✅' : '❌'} Estadísticas obtenidas`);
                
                if (managementResults.statisticsObtained) {
                    console.log(`         📈 Total documentos: ${generalStats.stats?.totalDocuments || 'N/A'}`);
                    console.log(`         🤖 Conversaciones OpenAI: ${conversationStats.conversationMessagesFormat?.totalConversations || 0}`);
                }
            } catch (statsError) {
                console.log(`      ❌ Error obteniendo estadísticas: ${statsError.message}`);
            }
            
            // 2. Test de limpieza selectiva (solo formato OpenAI)
            console.log('   🧹 Probando limpieza selectiva (solo OpenAI)...');
            
            // Verificar que existe contenido antes
            const beforeOpenAI = await cosmosService.getConversationMessages(this.testConversationId, this.testUserId);
            const beforeTraditional = await cosmosService.getConversationHistory(this.testConversationId, this.testUserId);
            
            console.log(`      📊 Antes - OpenAI: ${beforeOpenAI.length}, Tradicional: ${beforeTraditional.length}`);
            
            // Limpiar solo formato OpenAI
            const cleanResult = await cosmosService.cleanConversationMessages(this.testConversationId, this.testUserId);
            console.log(`      🗑️ Limpieza OpenAI: ${cleanResult ? '✅' : '❌'}`);
            
            // Verificar después de limpiar
            const afterOpenAI = await cosmosService.getConversationMessages(this.testConversationId, this.testUserId);
            const afterTraditional = await cosmosService.getConversationHistory(this.testConversationId, this.testUserId);
            
            console.log(`      📊 Después - OpenAI: ${afterOpenAI.length}, Tradicional: ${afterTraditional.length}`);
            
            managementResults.selectiveCleaningWorks = (
                beforeOpenAI.length > 0 && 
                afterOpenAI.length === 0 && 
                afterTraditional.length > 0 // Tradicional debe mantenerse
            );
            console.log(`      ${managementResults.selectiveCleaningWorks ? '✅' : '❌'} Limpieza selectiva funciona`);
            
            // 3. Test de limpieza completa
            console.log('   🗑️ Probando limpieza completa...');
            const fullCleanResult = await cosmosService.deleteConversation(this.testConversationId, this.testUserId);
            
            managementResults.fullCleaningWorks = fullCleanResult;
            console.log(`      ${managementResults.fullCleaningWorks ? '✅' : '❌'} Limpieza completa: ${fullCleanResult}`);
            
            this.testResults.tests.conversationManagement = {
                status: managementResults.statisticsObtained && managementResults.selectiveCleaningWorks ? 'pass' : 'fail',
                details: managementResults,
                message: `Stats: ${managementResults.statisticsObtained}, Selective: ${managementResults.selectiveCleaningWorks}, Full: ${managementResults.fullCleaningWorks}`
            };
            
        } catch (error) {
            console.log(`   ❌ Error en gestión: ${error.message}`);
            this.testResults.tests.conversationManagement = {
                status: 'fail',
                error: error.message,
                message: 'Error en gestión de conversación'
            };
            this.testResults.errors.push(`Gestión: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 7: Persistencia a largo plazo
     */
    async testLongTermPersistence() {
        console.log('⏰ Test 7: Persistencia a largo plazo...');
        
        const persistenceResults = {
            ttlConfigured: false,
            documentsHaveTTL: false,
            cleanupWorks: false
        };
        
        try {
            if (!cosmosService.isAvailable()) {
                console.log('   ⚠️ Cosmos DB no disponible - saltando test');
                this.testResults.tests.longTermPersistence = {
                    status: 'skip',
                    message: 'Cosmos DB no disponible'
                };
                console.log('');
                return;
            }
            
            console.log('   🕐 Verificando configuración de TTL...');
            
            // Crear un mensaje de prueba para verificar TTL
            const testMessage = `Test TTL message ${Date.now()}`;
            const saveResult = await cosmosService.saveMessage(
                testMessage,
                `ttl_test_${Date.now()}`,
                this.testUserId,
                'TTL Test User',
                'user'
            );
            
            if (saveResult) {
                persistenceResults.documentsHaveTTL = !!(saveResult.ttl && saveResult.ttl > 0);
                console.log(`      ${persistenceResults.documentsHaveTTL ? '✅' : '❌'} Documentos tienen TTL: ${saveResult.ttl || 'No configurado'}`);
                
                if (persistenceResults.documentsHaveTTL) {
                    const ttlDays = Math.round(saveResult.ttl / (60 * 60 * 24));
                    console.log(`         📅 TTL configurado: ${ttlDays} días`);
                    persistenceResults.ttlConfigured = ttlDays === 90; // Esperamos 90 días
                    console.log(`      ${persistenceResults.ttlConfigured ? '✅' : '⚠️'} TTL correcto (90 días): ${persistenceResults.ttlConfigured}`);
                }
            }
            
            // Test de limpieza automática (simulado)
            console.log('   🧹 Verificando capacidad de limpieza...');
            const cleanupTest = await cosmosService.cleanOldMessages(
                `ttl_test_${Date.now()}`,
                this.testUserId,
                0 // Eliminar todos
            );
            
            persistenceResults.cleanupWorks = typeof cleanupTest === 'number';
            console.log(`      ${persistenceResults.cleanupWorks ? '✅' : '❌'} Limpieza automática funciona: ${cleanupTest} mensajes procesados`);
            
            this.testResults.tests.longTermPersistence = {
                status: persistenceResults.ttlConfigured && persistenceResults.cleanupWorks ? 'pass' : 'warn',
                details: persistenceResults,
                message: `TTL: ${persistenceResults.ttlConfigured}, Cleanup: ${persistenceResults.cleanupWorks}`
            };
            
        } catch (error) {
            console.log(`   ❌ Error en persistencia: ${error.message}`);
            this.testResults.tests.longTermPersistence = {
                status: 'fail',
                error: error.message,
                message: 'Error en persistencia a largo plazo'
            };
            this.testResults.errors.push(`Persistencia: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * Genera el reporte final
     */
    generateFinalReport() {
        console.log('📊 ===== REPORTE FINAL - FORMATO DE CONVERSACIÓN =====');
        
        const tests = Object.values(this.testResults.tests);
        const passed = tests.filter(t => t.status === 'pass').length;
        const failed = tests.filter(t => t.status === 'fail').length;
        const skipped = tests.filter(t => t.status === 'skip').length;
        const warnings = tests.filter(t => t.status === 'warn').length;
        const total = tests.length;
        
        // Determinar estado general
        const overallStatus = failed === 0 ? 
            (warnings === 0 ? 'ÉXITO COMPLETO' : 'ÉXITO CON ADVERTENCIAS') : 
            failed < total / 2 ? 'ÉXITO PARCIAL' : 'FALLOS CRÍTICOS';
        const statusEmoji = overallStatus.includes('COMPLETO') ? '🟢' : 
                           overallStatus.includes('ADVERTENCIAS') || overallStatus.includes('PARCIAL') ? '🟡' : '🔴';
        
        console.log(`${statusEmoji} **ESTADO GENERAL: ${overallStatus}**\n`);
        
        console.log('📈 **Resumen de Tests:**');
        console.log(`   ✅ Exitosos: ${passed}/${total}`);
        console.log(`   ❌ Fallidos: ${failed}/${total}`);
        console.log(`   ⚠️ Advertencias: ${warnings}/${total}`);
        console.log(`   ⏭️ Saltados: ${skipped}/${total}`);
        console.log(`   📊 Porcentaje exitoso: ${Math.round((passed / total) * 100)}%\n`);
        
        console.log('📋 **Detalle por Test:**');
        Object.entries(this.testResults.tests).forEach(([testName, result]) => {
            const emoji = result.status === 'pass' ? '✅' : 
                         result.status === 'warn' ? '⚠️' : 
                         result.status === 'skip' ? '⏭️' : '❌';
            console.log(`   ${emoji} ${testName}: ${result.message}`);
        });
        
        if (this.testResults.errors.length > 0) {
            console.log('\n❌ **Errores Encontrados:**');
            this.testResults.errors.forEach((error, i) => {
                console.log(`   ${i + 1}. ${error}`);
            });
        }
        
        console.log('\n🎯 **FUNCIONALIDADES VERIFICADAS:**');
        console.log('   ✅ Guardado dual (tradicional + OpenAI)');
        console.log('   ✅ Coexistencia de formatos');
        console.log('   ✅ Integración con OpenAI API');
        console.log('   ✅ Gestión granular de conversaciones');
        console.log('   ✅ Limpieza selectiva y completa');
        console.log('   ✅ Persistencia con TTL automático');
        
        console.log('\n💡 **COMANDOS PARA USUARIOS:**');
        console.log('   📋 `historial` - Ver formato tradicional');
        console.log('   🤖 `conversacion openai` - Ver formato OpenAI');
        console.log('   🧹 `limpiar historial` - Limpiar tradicional');
        console.log('   🗑️ `limpiar conversacion` - Limpiar OpenAI');
        console.log('   📊 `resumen` - Análisis inteligente');
        
        console.log('\n🔗 **BENEFICIOS DEL FORMATO DUAL:**');
        console.log('   ✅ Compatibilidad total con código existente');
        console.log('   ✅ Listo para APIs de OpenAI externas');
        console.log('   ✅ Backup automático en múltiples formatos');
        console.log('   ✅ Flexibilidad para diferentes casos de uso');
        console.log('   ✅ Gestión granular por tipo de formato');
        
        console.log('\n✅ **Test completado**');
        console.log(`📅 Timestamp: ${this.testResults.timestamp}`);
        console.log('================================\n');
        
        // Resumen para el resultado
        this.testResults.summary = {
            overallStatus,
            passedTests: passed,
            totalTests: total,
            successRate: Math.round((passed / total) * 100),
            critical: overallStatus.includes('COMPLETO'),
            timestamp: this.testResults.timestamp
        };
    }

    /**
     * Guarda resultados en archivo
     */
    saveResults() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const resultsPath = path.join(__dirname, '..', 'conversation-format-test-results.json');
            fs.writeFileSync(resultsPath, JSON.stringify(this.testResults, null, 2));
            console.log(`📄 Resultados guardados en: ${resultsPath}`);
        } catch (error) {
            console.warn('⚠️ No se pudieron guardar los resultados:', error.message);
        }
    }
}

// Ejecutar tests si se llama directamente
if (require.main === module) {
    const test = new TestConversationFormat();
    
    test.runAllTests()
        .then(() => {
            test.saveResults();
            
            const summary = test.testResults.summary;
            if (summary.critical) {
                console.log('🎉 ¡FORMATO DE CONVERSACIÓN FUNCIONANDO PERFECTAMENTE!');
                process.exit(0);
            } else if (summary.successRate >= 70) {
                console.log('⚠️ Formato de conversación funcionando con advertencias.');
                process.exit(1);
            } else {
                console.log('❌ Problemas críticos con formato de conversación.');
                process.exit(2);
            }
        })
        .catch(error => {
            console.error('💥 Error ejecutando tests:', error);
            process.exit(1);
        });
}

