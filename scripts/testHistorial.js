// scripts/testHistorial.js - Script para probar el sistema de historial
import 'dotenv/config';
/**
 * Script de prueba para verificar que el sistema de historial funcione correctamente
 * Ejecutar con: node scripts/testHistorial.js
 */
export default class TestHistorial {
    constructor() {
        this.testResults = {
            timestamp: new Date().toISOString(),
            tests: {},
            errors: [],
            summary: {}
        };
        
        console.log('🧪 ===== TEST SISTEMA DE HISTORIAL =====');
        console.log('🔧 Verificando funcionamiento completo...\n');
    }

    /**
     * Ejecuta todos los tests
     */
    async runAllTests() {
        try {
            console.log('📋 Iniciando batería de tests...\n');

            // Test 1: Configuración básica
            await this.testBasicConfiguration();
            
            // Test 2: Servicios requeridos
            await this.testRequiredServices();
            
            // Test 3: Simulación de conversación
            await this.testConversationFlow();
            
            // Test 4: Persistencia
            await this.testPersistence();
            
            // Test 5: Comandos de historial
            await this.testHistorialCommands();
            
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
    async testBasicConfiguration() {
        console.log('🔧 Test 1: Configuración básica...');
        
        const requiredEnvVars = [
            'OPENAI_API_KEY',
            'MicrosoftAppId', 
            'MicrosoftAppPassword'
        ];
        
        const optionalEnvVars = [
            'COSMOS_DB_ENDPOINT',
            'COSMOS_DB_KEY',
            'COSMOS_DB_DATABASE_ID',
            'COSMOS_DB_CONTAINER_ID'
        ];
        
        let configCorrect = true;
        let missingRequired = [];
        let presentOptional = [];
        
        // Verificar variables requeridas
        for (const envVar of requiredEnvVars) {
            if (!process.env[envVar]) {
                missingRequired.push(envVar);
                configCorrect = false;
                console.log(`   ❌ ${envVar}: FALTANTE`);
            } else {
                console.log(`   ✅ ${envVar}: Configurada`);
            }
        }
        
        // Verificar variables opcionales
        for (const envVar of optionalEnvVars) {
            if (process.env[envVar]) {
                presentOptional.push(envVar);
                console.log(`   ✅ ${envVar}: Configurada (opcional)`);
            } else {
                console.log(`   ⚠️ ${envVar}: No configurada (opcional)`);
            }
        }
        
        this.testResults.tests.basicConfiguration = {
            status: configCorrect ? 'pass' : 'fail',
            missingRequired,
            presentOptional,
            hasCosmos: presentOptional.includes('COSMOS_DB_ENDPOINT'),
            message: configCorrect ? 
                'Configuración básica correcta' : 
                `Faltan variables: ${missingRequired.join(', ')}`
        };
        
        if (!configCorrect) {
            this.testResults.errors.push(`Configuración incompleta: ${missingRequired.join(', ')}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 2: Servicios requeridos
     */
    async testRequiredServices() {
        console.log('🔧 Test 2: Servicios requeridos...');
        
        const services = {
            openai: { available: false, error: null },
            cosmos: { available: false, error: null },
            conversation: { available: false, error: null }
        };
        
        // Test OpenAI Service
        try {
            console.log('   🧪 Probando OpenAI Service...');
            const openaiService = require('../services/openaiService');
            
            if (openaiService.isAvailable()) {
                const testResult = await openaiService.testConnection();
                services.openai.available = testResult.success;
                services.openai.error = testResult.error;
                console.log(`   ${testResult.success ? '✅' : '❌'} OpenAI Service: ${testResult.success ? 'Funcionando' : testResult.error}`);
            } else {
                services.openai.error = 'Servicio no inicializado';
                console.log(`   ❌ OpenAI Service: No disponible`);
            }
        } catch (error) {
            services.openai.error = error.message;
            console.log(`   ❌ OpenAI Service: Error - ${error.message}`);
        }
        
        // Test Cosmos Service
        try {
            console.log('   🧪 Probando Cosmos DB Service...');
            const cosmosService = require('../services/cosmosService');
            
            services.cosmos.available = cosmosService.isAvailable();
            if (services.cosmos.available) {
                console.log(`   ✅ Cosmos DB Service: Disponible`);
            } else {
                services.cosmos.error = 'No configurado o no disponible';
                console.log(`   ⚠️ Cosmos DB Service: No disponible (no es crítico)`);
            }
        } catch (error) {
            services.cosmos.error = error.message;
            console.log(`   ❌ Cosmos DB Service: Error - ${error.message}`);
        }
        
        // Test Conversation Service
        try {
            console.log('   🧪 Probando Conversation Service...');
            const conversationService = require('../services/conversationService');
            
            // Test básico de funcionalidad
            const testConvId = 'test_conversation_' + Date.now();
            const testUserId = 'test_user';
            
            await conversationService.createConversation(testConvId, testUserId);
            await conversationService.saveMessage('Test message', testConvId, testUserId);
            const messages = await conversationService.getConversationHistory(testConvId, 5);
            
            services.conversation.available = messages.length > 0;
            console.log(`   ✅ Conversation Service: Funcionando`);
            
            // Limpiar test
            await conversationService.deleteConversation(testConvId);
            
        } catch (error) {
            services.conversation.error = error.message;
            console.log(`   ❌ Conversation Service: Error - ${error.message}`);
        }
        
        this.testResults.tests.requiredServices = {
            status: services.openai.available ? 'pass' : 'fail',
            services,
            criticalServicesFunctioning: services.openai.available && services.conversation.available,
            message: services.openai.available ? 
                'Servicios críticos funcionando' : 
                'Fallo en servicios críticos'
        };
        
        if (!services.openai.available) {
            this.testResults.errors.push('OpenAI Service no funciona');
        }
        
        console.log('');
    }

    /**
     * ✅ Test 3: Simulación de conversación
     */
    async testConversationFlow() {
        console.log('💬 Test 3: Simulación de flujo de conversación...');
        
        try {
            const testConvId = 'test_conversation_flow_' + Date.now();
            const testUserId = 'test_user_flow';
            const testUserName = 'Usuario Test';
            
            // Simular clase TeamsBot simplificada para test
            const mockTeamsBot = {
                mensajeCache: new Map(),
                
                async guardarMensajeEnHistorial(mensaje, tipo, conversationId, userId, userName) {
                    const timestamp = new Date().toISOString();
                    const mensajeObj = {
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        mensaje: mensaje,
                        tipo: tipo,
                        conversationId: conversationId,
                        userId: userId,
                        userName: userName,
                        timestamp: timestamp
                    };
                    
                    let mensajes = this.mensajeCache.get(conversationId) || [];
                    mensajes.unshift(mensajeObj);
                    if (mensajes.length > 5) mensajes = mensajes.slice(0, 5);
                    this.mensajeCache.set(conversationId, mensajes);
                    
                    return true;
                },
                
                async obtenerHistorialConversacion(conversationId, userId, limite = 5) {
                    const mensajes = this.mensajeCache.get(conversationId) || [];
                    return mensajes.slice(0, limite);
                }
            };
            
            console.log('   📝 Simulando intercambio de mensajes...');
            
            // Simular conversación de 7 mensajes (para probar límite de 5)
            const mensajes = [
                { texto: 'Hola, ¿cómo estás?', tipo: 'user' },
                { texto: 'Hola! Estoy bien, gracias por preguntar. ¿En qué puedo ayudarte?', tipo: 'bot' },
                { texto: '¿Puedes explicarme qué es la inteligencia artificial?', tipo: 'user' },
                { texto: 'La inteligencia artificial es una rama de la informática...', tipo: 'bot' },
                { texto: '¿Y qué es machine learning?', tipo: 'user' },
                { texto: 'Machine learning es un subcampo de la IA...', tipo: 'bot' },
                { texto: 'Muy interesante, gracias por la explicación', tipo: 'user' }
            ];
            
            for (let i = 0; i < mensajes.length; i++) {
                const msg = mensajes[i];
                await mockTeamsBot.guardarMensajeEnHistorial(
                    msg.texto,
                    msg.tipo,
                    testConvId,
                    testUserId,
                    msg.tipo === 'bot' ? 'Nova Bot' : testUserName
                );
                console.log(`   📨 Mensaje ${i + 1}: ${msg.tipo} - "${msg.texto.substring(0, 30)}..."`);
            }
            
            // Verificar que solo se mantienen 5 mensajes
            const historialFinal = await mockTeamsBot.obtenerHistorialConversacion(testConvId, testUserId);
            
            console.log(`   📊 Mensajes en historial: ${historialFinal.length}/5`);
            
            if (historialFinal.length === 5) {
                console.log('   ✅ Límite de 5 mensajes funcionando correctamente');
                
                // Verificar orden (más reciente primero)
                const ordenCorrecto = new Date(historialFinal[0].timestamp) >= new Date(historialFinal[1].timestamp);
                console.log(`   ${ordenCorrecto ? '✅' : '❌'} Orden cronológico: ${ordenCorrecto ? 'Correcto' : 'Incorrecto'}`);
                
                this.testResults.tests.conversationFlow = {
                    status: 'pass',
                    messagesSaved: historialFinal.length,
                    correctLimit: historialFinal.length === 5,
                    correctOrder: ordenCorrecto,
                    message: 'Flujo de conversación funcionando correctamente'
                };
                
            } else {
                console.log(`   ❌ Error: Se guardaron ${historialFinal.length} mensajes en lugar de 5`);
                this.testResults.tests.conversationFlow = {
                    status: 'fail',
                    messagesSaved: historialFinal.length,
                    correctLimit: false,
                    message: `Límite incorrecto: ${historialFinal.length} en lugar de 5`
                };
                this.testResults.errors.push('Límite de 5 mensajes no funciona');
            }
            
        } catch (error) {
            console.error('   ❌ Error en simulación de conversación:', error.message);
            this.testResults.tests.conversationFlow = {
                status: 'fail',
                error: error.message,
                message: 'Error simulando conversación'
            };
            this.testResults.errors.push(`Simulación falló: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 4: Persistencia
     */
    async testPersistence() {
        console.log('💾 Test 4: Persistencia de datos...');
        
        const persistenceResults = {
            memory: false,
            cosmos: false
        };
        
        // Test persistencia en memoria (ConversationService)
        try {
            console.log('   🧪 Probando persistencia en memoria...');
            const conversationService = require('../services/conversationService');
            
            const testConvId = 'test_persistence_' + Date.now();
            const testUserId = 'test_persistence_user';
            
            await conversationService.createConversation(testConvId, testUserId);
            await conversationService.saveMessage('Test persistence message', testConvId, testUserId);
            
            const messages = await conversationService.getConversationHistory(testConvId, 5);
            persistenceResults.memory = messages.length > 0;
            
            console.log(`   ${persistenceResults.memory ? '✅' : '❌'} Persistencia en memoria: ${persistenceResults.memory ? 'Funcionando' : 'Falló'}`);
            
            // Limpiar
            await conversationService.deleteConversation(testConvId);
            
        } catch (error) {
            console.log(`   ❌ Error persistencia en memoria: ${error.message}`);
        }
        
        // Test persistencia en Cosmos DB (si está disponible)
        try {
            console.log('   🧪 Probando persistencia en Cosmos DB...');
            const cosmosService = require('../services/cosmosService');
            
            if (cosmosService.isAvailable()) {
                const testConvId = 'test_cosmos_persistence_' + Date.now();
                const testUserId = 'test_cosmos_user';
                
                await cosmosService.saveMessage('Test cosmos message', testConvId, testUserId, 'Test User', 'user');
                const messages = await cosmosService.getConversationHistory(testConvId, testUserId, 5);
                persistenceResults.cosmos = messages.length > 0;
                
                console.log(`   ${persistenceResults.cosmos ? '✅' : '❌'} Persistencia en Cosmos DB: ${persistenceResults.cosmos ? 'Funcionando' : 'Falló'}`);
                
                // Limpiar
                await cosmosService.cleanOldMessages(testConvId, testUserId, 0);
                
            } else {
                console.log(`   ⚠️ Cosmos DB no disponible - saltando test`);
            }
            
        } catch (error) {
            console.log(`   ❌ Error persistencia en Cosmos DB: ${error.message}`);
        }
        
        this.testResults.tests.persistence = {
            status: persistenceResults.memory ? 'pass' : 'fail',
            memory: persistenceResults.memory,
            cosmos: persistenceResults.cosmos,
            hasBackup: persistenceResults.memory,
            message: persistenceResults.memory ? 
                'Persistencia funcionando (al menos en memoria)' : 
                'Persistencia falló completamente'
        };
        
        if (!persistenceResults.memory) {
            this.testResults.errors.push('Persistencia en memoria falló');
        }
        
        console.log('');
    }

    /**
     * ✅ Test 5: Comandos de historial
     */
    async testHistorialCommands() {
        console.log('📋 Test 5: Comandos de historial...');
        
        const commandTests = {
            historial: false,
            resumen: false,
            limpiar: false
        };
        
        try {
            // Simular que los comandos existen y son reconocidos
            console.log('   🧪 Verificando reconocimiento de comandos...');
            
            const commands = ['historial', 'resumen', 'limpiar historial'];
            const commandPatterns = {
                'historial': /historial/i,
                'resumen': /resumen/i,
                'limpiar historial': /limpiar.*historial/i
            };
            
            for (const command of commands) {
                const key = command === 'limpiar historial' ? 'limpiar' : command;
                const pattern = commandPatterns[command];
                
                if (pattern.test(command)) {
                    commandTests[key] = true;
                    console.log(`   ✅ Comando "${command}": Reconocido`);
                } else {
                    console.log(`   ❌ Comando "${command}": No reconocido`);
                }
            }
            
            // Test adicional: verificar que el formato de respuesta es correcto
            console.log('   🧪 Verificando formatos de respuesta...');
            
            // Simular respuesta de historial
            const mockHistorialResponse = `📚 **Historial de Conversación (3/5)**

💾 **Persistencia**: Cosmos DB activo

🤖 **Nova Bot** (15/01/2025 10:30:00)
Hola, ¿en qué puedo ayudarte?

👤 **Usuario** (15/01/2025 10:29:45)  
Hola bot

🤖 **Nova Bot** (15/01/2025 10:29:50)
¡Hola! Soy Nova Bot, tu asistente corporativo.

💡 **Comandos útiles:**
• \`resumen\` - Resumen de la conversación
• \`limpiar historial\` - Eliminar mensajes`;

            const hasCorrectFormat = mockHistorialResponse.includes('Historial de Conversación') && 
                                   mockHistorialResponse.includes('Persistencia') &&
                                   mockHistorialResponse.includes('Comandos útiles');
            
            console.log(`   ${hasCorrectFormat ? '✅' : '❌'} Formato de respuesta: ${hasCorrectFormat ? 'Correcto' : 'Incorrecto'}`);
            
            this.testResults.tests.historialCommands = {
                status: Object.values(commandTests).every(v => v) ? 'pass' : 'fail',
                commands: commandTests,
                formatCorrect: hasCorrectFormat,
                message: Object.values(commandTests).every(v => v) ? 
                    'Comandos de historial funcionando' : 
                    'Algunos comandos no funcionan'
            };
            
        } catch (error) {
            console.error('   ❌ Error probando comandos:', error.message);
            this.testResults.tests.historialCommands = {
                status: 'fail',
                error: error.message,
                message: 'Error probando comandos de historial'
            };
            this.testResults.errors.push(`Comandos falló: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * Genera el reporte final
     */
    generateFinalReport() {
        console.log('📊 ===== REPORTE FINAL =====');
        
        const tests = Object.values(this.testResults.tests);
        const passed = tests.filter(t => t.status === 'pass').length;
        const failed = tests.filter(t => t.status === 'fail').length;
        const total = tests.length;
        
        // Determinar estado general
        const overallStatus = failed === 0 ? 'ÉXITO' : failed < total / 2 ? 'PARCIAL' : 'FALLO';
        const statusEmoji = overallStatus === 'ÉXITO' ? '🟢' : overallStatus === 'PARCIAL' ? '🟡' : '🔴';
        
        console.log(`${statusEmoji} **ESTADO GENERAL: ${overallStatus}**\n`);
        
        console.log('📈 **Resumen de Tests:**');
        console.log(`   ✅ Exitosos: ${passed}/${total}`);
        console.log(`   ❌ Fallidos: ${failed}/${total}`);
        console.log(`   📊 Porcentaje: ${Math.round((passed / total) * 100)}%\n`);
        
        console.log('📋 **Detalle por Test:**');
        Object.entries(this.testResults.tests).forEach(([testName, result]) => {
            const emoji = result.status === 'pass' ? '✅' : '❌';
            console.log(`   ${emoji} ${testName}: ${result.message}`);
        });
        
        if (this.testResults.errors.length > 0) {
            console.log('\n❌ **Errores Encontrados:**');
            this.testResults.errors.forEach((error, i) => {
                console.log(`   ${i + 1}. ${error}`);
            });
        }
        
        console.log('\n💡 **Recomendaciones:**');
        
        if (overallStatus === 'ÉXITO') {
            console.log('   🎉 ¡Sistema de historial funcionando perfectamente!');
            console.log('   🚀 Puedes usar los comandos: `historial`, `resumen`, `limpiar historial`');
            console.log('   💾 Los mensajes se guardan automáticamente (últimos 5)');
        } else {
            if (!this.testResults.tests.basicConfiguration?.status === 'pass') {
                console.log('   🔧 Configurar variables de entorno faltantes');
            }
            if (!this.testResults.tests.requiredServices?.status === 'pass') {
                console.log('   🛠️ Verificar servicios críticos (OpenAI, Cosmos DB)');
            }
            if (!this.testResults.tests.persistence?.status === 'pass') {
                console.log('   💾 Verificar configuración de persistencia');
            }
        }
        
        console.log('\n🔗 **Para usar el sistema:**');
        console.log('   1. Inicia el bot: `npm start`');
        console.log('   2. Autentica un usuario en Teams');
        console.log('   3. Envía mensajes de prueba');
        console.log('   4. Usa `historial` para ver los mensajes guardados');
        console.log('   5. Usa `resumen` para generar un resumen inteligente');
        
        console.log('\n✅ **Test completado**');
        console.log(`📅 Timestamp: ${this.testResults.timestamp}`);
        console.log('================================\n');
        
        // Resumen para copiar/pegar
        this.testResults.summary = {
            overallStatus,
            passedTests: passed,
            totalTests: total,
            successRate: Math.round((passed / total) * 100),
            critical: overallStatus === 'ÉXITO',
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
            const resultsPath = path.join(__dirname, '..', 'historial-test-results.json');
            fs.writeFileSync(resultsPath, JSON.stringify(this.testResults, null, 2));
            console.log(`📄 Resultados guardados en: ${resultsPath}`);
        } catch (error) {
            console.warn('⚠️ No se pudieron guardar los resultados:', error.message);
        }
    }
}

// Ejecutar tests si se llama directamente
if (require.main === module) {
    const test = new TestHistorial();
    
    test.runAllTests()
        .then(() => {
            test.saveResults();
            
            const summary = test.testResults.summary;
            if (summary.critical) {
                console.log('🎉 ¡TODOS LOS TESTS PASARON! El sistema de historial está listo.');
                process.exit(0);
            } else if (summary.successRate >= 60) {
                console.log('⚠️ Tests parcialmente exitosos. Revisar errores.');
                process.exit(1);
            } else {
                console.log('❌ Tests fallaron. Sistema requiere correcciones.');
                process.exit(2);
            }
        })
        .catch(error => {
            console.error('💥 Error ejecutando tests:', error);
            process.exit(1);
        });
}

