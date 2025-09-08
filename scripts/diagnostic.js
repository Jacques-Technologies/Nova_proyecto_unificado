// scripts/diagnostic.js - Script de diagnóstico completo para Nova Bot

const axios = require('axios');
const { CosmosClient } = require('@azure/cosmos');
const OpenAI = require('openai');
const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config();

/**
 * Script de diagnóstico completo para verificar todas las configuraciones
 * Ejecutar con: node scripts/diagnostic.js
 */
class NovaBotDiagnostic {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            overall: 'unknown',
            tests: {},
            recommendations: [],
            errors: []
        };
        
        console.log('🔍 ===== DIAGNÓSTICO NOVA BOT =====');
        console.log('🛠️ Verificando configuración completa...\n');
    }

    /**
     * Ejecuta todos los diagnósticos
     */
    async runAllDiagnostics() {
        try {
            // Tests básicos
            await this.checkEnvironmentVariables();
            
            // Tests de servicios
            await this.testBotFrameworkAuth();
            await this.testOpenAI();
            await this.testCosmosDB();
            await this.testAzureSearch();
            await this.testNovaAPI();
            
            // Generar reporte final
            this.generateFinalReport();
            
        } catch (error) {
            console.error('💥 Error ejecutando diagnóstico:', error);
            this.results.overall = 'error';
            this.results.errors.push(`Error general: ${error.message}`);
        }
    }

    /**
     * ✅ Test 1: Variables de entorno
     */
    async checkEnvironmentVariables() {
        console.log('🔐 Test 1: Variables de entorno...');
        
        const requiredVars = {
            'MicrosoftAppId': process.env.MicrosoftAppId,
            'MicrosoftAppPassword': process.env.MicrosoftAppPassword,
            'OPENAI_API_KEY': process.env.OPENAI_API_KEY
        };
        
        const optionalVars = {
            'MicrosoftAppTenantId': process.env.MicrosoftAppTenantId,
            'COSMOS_DB_ENDPOINT': process.env.COSMOS_DB_ENDPOINT,
            'COSMOS_DB_KEY': process.env.COSMOS_DB_KEY,
            'AZURE_SEARCH_ENDPOINT': process.env.AZURE_SEARCH_ENDPOINT,
            'AZURE_SEARCH_API_KEY': process.env.AZURE_SEARCH_API_KEY
        };
        
        let missingRequired = [];
        let presentOptional = [];
        
        // Verificar variables requeridas
        for (const [key, value] of Object.entries(requiredVars)) {
            if (!value) {
                missingRequired.push(key);
                console.log(`   ❌ ${key}: FALTANTE`);
            } else {
                console.log(`   ✅ ${key}: Configurada (${value.substring(0, 10)}...)`);
            }
        }
        
        // Verificar variables opcionales
        for (const [key, value] of Object.entries(optionalVars)) {
            if (value) {
                presentOptional.push(key);
                console.log(`   ✅ ${key}: Configurada (${value.substring(0, 20)}...)`);
            } else {
                console.log(`   ⚠️ ${key}: No configurada`);
            }
        }
        
        this.results.tests.environmentVariables = {
            status: missingRequired.length === 0 ? 'pass' : 'fail',
            missingRequired,
            presentOptional,
            message: missingRequired.length === 0 ? 
                'Todas las variables requeridas están configuradas' :
                `Faltan variables requeridas: ${missingRequired.join(', ')}`
        };
        
        if (missingRequired.length > 0) {
            this.results.recommendations.push(
                `Configurar variables faltantes: ${missingRequired.join(', ')}`
            );
        }
        
        console.log('');
    }

    /**
     * ✅ Test 2: Autenticación Bot Framework
     */
    async testBotFrameworkAuth() {
        console.log('🤖 Test 2: Autenticación Bot Framework...');
        
        const appId = process.env.MicrosoftAppId;
        const appPassword = process.env.MicrosoftAppPassword;
        const tenantId = process.env.MicrosoftAppTenantId;
        
        if (!appId || !appPassword) {
            console.log('   ❌ Credenciales faltantes');
            this.results.tests.botFramework = {
                status: 'fail',
                message: 'Credenciales Bot Framework faltantes'
            };
            return;
        }
        
        try {
            // Usar tenant específico o common
            const actualTenant = tenantId || 'botframework.com';
            const tokenUrl = `https://login.microsoftonline.com/${actualTenant}/oauth2/v2.0/token`;
            
            const requestBody = new URLSearchParams({
                'grant_type': 'client_credentials',
                'client_id': appId,
                'client_secret': appPassword,
                'scope': 'https://api.botframework.com/.default'
            });

            console.log(`   🌐 Probando con tenant: ${actualTenant}`);
            
            const response = await axios.post(tokenUrl, requestBody, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000
            });

            if (response.status === 200 && response.data.access_token) {
                console.log('   ✅ Autenticación Bot Framework exitosa');
                console.log(`   🔑 Token expires in: ${response.data.expires_in} segundos`);
                
                this.results.tests.botFramework = {
                    status: 'pass',
                    message: 'Autenticación Bot Framework funciona correctamente',
                    tokenExpiresIn: response.data.expires_in
                };
            } else {
                throw new Error(`Respuesta inesperada: ${response.status}`);
            }
            
        } catch (error) {
            console.log('   ❌ Error de autenticación Bot Framework');
            console.log(`   📋 Error: ${error.message}`);
            
            let recommendation = 'Verificar credenciales Bot Framework';
            
            if (error.response?.data?.error === 'invalid_client') {
                recommendation = 'App no registrada en Bot Framework Portal - ir a https://dev.botframework.com';
            } else if (error.response?.data?.error === 'unauthorized_client') {
                recommendation = 'AADSTS700016 - Registrar app en Bot Framework Portal con las mismas credenciales';
            }
            
            this.results.tests.botFramework = {
                status: 'fail',
                message: error.message,
                errorCode: error.response?.data?.error
            };
            
            this.results.recommendations.push(recommendation);
            this.results.errors.push(`Bot Framework: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 3: OpenAI
     */
    async testOpenAI() {
        console.log('🧠 Test 3: OpenAI API...');
        
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            console.log('   ❌ OPENAI_API_KEY no configurada');
            this.results.tests.openai = {
                status: 'fail',
                message: 'API Key de OpenAI faltante'
            };
            return;
        }
        
        try {
            const openai = new OpenAI({ apiKey, timeout: 10000 });
            
            console.log('   🧪 Probando conexión con OpenAI...');
            
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: "Test connection" }],
                max_tokens: 5,
                temperature: 0
            });
            
            if (response?.choices?.length > 0) {
                console.log('   ✅ OpenAI API funciona correctamente');
                console.log(`   🤖 Modelo usado: ${response.model}`);
                
                this.results.tests.openai = {
                    status: 'pass',
                    message: 'OpenAI API responde correctamente',
                    model: response.model
                };
            } else {
                throw new Error('Respuesta vacía de OpenAI');
            }
            
        } catch (error) {
            console.log('   ❌ Error conectando con OpenAI');
            console.log(`   📋 Error: ${error.message}`);
            
            let recommendation = 'Verificar API Key de OpenAI';
            
            if (error.message.includes('invalid_api_key')) {
                recommendation = 'API Key de OpenAI inválida';
            } else if (error.message.includes('insufficient_quota')) {
                recommendation = 'Cuota de OpenAI agotada - revisar billing';
            } else if (error.message.includes('rate_limit')) {
                recommendation = 'Límite de rate alcanzado - esperar y reintentar';
            }
            
            this.results.tests.openai = {
                status: 'fail',
                message: error.message
            };
            
            this.results.recommendations.push(recommendation);
            this.results.errors.push(`OpenAI: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 4: Cosmos DB
     */
    async testCosmosDB() {
        console.log('💾 Test 4: Cosmos DB...');
        
        const endpoint = process.env.COSMOS_DB_ENDPOINT;
        const key = process.env.COSMOS_DB_KEY;
        const databaseId = process.env.COSMOS_DB_DATABASE_ID;
        const containerId = process.env.COSMOS_DB_CONTAINER_ID;
        
        if (!endpoint || !key || !databaseId || !containerId) {
            console.log('   ⚠️ Cosmos DB no configurado (variables faltantes)');
            console.log('   ℹ️ El bot usará MemoryStorage (datos temporales)');
            
            this.results.tests.cosmosdb = {
                status: 'skip',
                message: 'Cosmos DB no configurado - usando MemoryStorage'
            };
            
            this.results.recommendations.push(
                'Configurar Cosmos DB para persistencia de datos (opcional)'
            );
            
            console.log('');
            return;
        }
        
        try {
            console.log('   🧪 Probando conexión con Cosmos DB...');
            
            const client = new CosmosClient({ endpoint, key });
            const database = client.database(databaseId);
            const container = database.container(containerId);
            
            // Test de lectura
            await database.read();
            await container.read();
            
            console.log('   ✅ Cosmos DB accesible');
            console.log(`   📊 Database: ${databaseId}, Container: ${containerId}`);
            
            // Test básico de operación
            const testDoc = {
                id: 'diagnostic_test_' + Date.now(),
                test: true,
                timestamp: new Date().toISOString(),
                userId: 'diagnostic'
            };
            
            await container.items.create(testDoc);
            await container.item(testDoc.id, 'diagnostic').delete();
            
            console.log('   ✅ Operaciones de Cosmos DB funcionan');
            
            this.results.tests.cosmosdb = {
                status: 'pass',
                message: 'Cosmos DB configurado y funcional',
                database: databaseId,
                container: containerId
            };
            
        } catch (error) {
            console.log('   ❌ Error conectando con Cosmos DB');
            console.log(`   📋 Error: ${error.message}`);
            
            let recommendation = 'Verificar configuración Cosmos DB';
            
            if (error.code === 401) {
                recommendation = 'Verificar Cosmos DB key - puede ser incorrecta';
            } else if (error.code === 'ENOTFOUND') {
                recommendation = 'Verificar Cosmos DB endpoint - URL incorrecta';
            }
            
            this.results.tests.cosmosdb = {
                status: 'fail',
                message: error.message
            };
            
            this.results.recommendations.push(recommendation);
            this.results.errors.push(`Cosmos DB: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 5: Azure Search
     */
    async testAzureSearch() {
        console.log('🔍 Test 5: Azure Search...');
        
        const endpoint = process.env.AZURE_SEARCH_ENDPOINT || process.env.SERVICE_ENDPOINT;
        const apiKey = process.env.AZURE_SEARCH_API_KEY || process.env.API_KEY;
        const indexName = process.env.AZURE_SEARCH_INDEX_NAME || process.env.INDEX_NAME || 'nova';
        
        if (!endpoint || !apiKey) {
            console.log('   ⚠️ Azure Search no configurado (variables faltantes)');
            console.log('   ℹ️ Funciones de búsqueda de documentos no disponibles');
            
            this.results.tests.azureSearch = {
                status: 'skip',
                message: 'Azure Search no configurado - funciones de búsqueda no disponibles'
            };
            
            this.results.recommendations.push(
                'Configurar Azure Search para búsqueda de documentos (opcional)'
            );
            
            console.log('');
            return;
        }
        
        try {
            console.log('   🧪 Probando conexión con Azure Search...');
            
            const searchClient = new SearchClient(
                endpoint,
                indexName,
                new AzureKeyCredential(apiKey)
            );
            
            // Test básico de búsqueda
            const results = await searchClient.search('*', { top: 1 });
            
            console.log('   ✅ Azure Search accesible');
            console.log(`   📊 Endpoint: ${endpoint}, Index: ${indexName}`);
            
            this.results.tests.azureSearch = {
                status: 'pass',
                message: 'Azure Search configurado y funcional',
                endpoint: endpoint,
                indexName: indexName
            };
            
        } catch (error) {
            console.log('   ❌ Error conectando con Azure Search');
            console.log(`   📋 Error: ${error.message}`);
            
            let recommendation = 'Verificar configuración Azure Search';
            
            if (error.statusCode === 403) {
                recommendation = 'Verificar Azure Search API Key - permisos insuficientes';
            } else if (error.statusCode === 404) {
                recommendation = 'Verificar endpoint o nombre de índice - no encontrado';
            }
            
            this.results.tests.azureSearch = {
                status: 'fail',
                message: error.message
            };
            
            this.results.recommendations.push(recommendation);
            this.results.errors.push(`Azure Search: ${error.message}`);
        }
        
        console.log('');
    }

    /**
     * ✅ Test 6: Nova API (básico)
     */
    async testNovaAPI() {
        console.log('🏢 Test 6: Nova API...');
        
        const novaUrl = process.env.NOVA_API_URL || 'https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login';
        
        try {
            console.log('   🧪 Probando accesibilidad de Nova API...');
            
            // Solo verificar que la API responda (no hacer login real)
            const response = await axios.get(novaUrl.replace('/api/Auth/login', '/'), {
                timeout: 5000,
                validateStatus: (status) => status < 500
            });
            
            console.log(`   ✅ Nova API accesible (status: ${response.status})`);
            console.log(`   🌐 URL: ${novaUrl}`);
            
            this.results.tests.novaAPI = {
                status: 'pass',
                message: 'Nova API es accesible',
                url: novaUrl,
                statusCode: response.status
            };
            
        } catch (error) {
            console.log('   ⚠️ Nova API no accesible o con problemas');
            console.log(`   📋 Error: ${error.message}`);
            
            this.results.tests.novaAPI = {
                status: 'warn',
                message: `Nova API no accesible: ${error.message}`,
                url: novaUrl
            };
            
            this.results.recommendations.push(
                'Verificar conectividad con Nova API (puede afectar autenticación de usuarios)'
            );
        }
        
        console.log('');
    }

    /**
     * Genera el reporte final
     */
    generateFinalReport() {
        console.log('📊 ===== REPORTE FINAL =====');
        
        const testResults = Object.values(this.results.tests);
        const passed = testResults.filter(t => t.status === 'pass').length;
        const failed = testResults.filter(t => t.status === 'fail').length;
        const skipped = testResults.filter(t => t.status === 'skip').length;
        const warnings = testResults.filter(t => t.status === 'warn').length;
        
        // Determinar estado general
        if (failed > 0) {
            this.results.overall = 'fail';
            console.log('🔴 ESTADO GENERAL: FALLOS DETECTADOS');
        } else if (warnings > 0) {
            this.results.overall = 'warn';
            console.log('🟡 ESTADO GENERAL: ADVERTENCIAS');
        } else if (passed > 0) {
            this.results.overall = 'pass';
            console.log('🟢 ESTADO GENERAL: CONFIGURACIÓN CORRECTA');
        }
        
        console.log('\n📈 Resumen de tests:');
        console.log(`   ✅ Exitosos: ${passed}`);
        console.log(`   ❌ Fallidos: ${failed}`);
        console.log(`   ⚠️ Advertencias: ${warnings}`);
        console.log(`   ⏭️ Saltados: ${skipped}`);
        
        if (this.results.errors.length > 0) {
            console.log('\n❌ Errores encontrados:');
            this.results.errors.forEach((error, i) => {
                console.log(`   ${i + 1}. ${error}`);
            });
        }
        
        if (this.results.recommendations.length > 0) {
            console.log('\n💡 Recomendaciones:');
            this.results.recommendations.forEach((rec, i) => {
                console.log(`   ${i + 1}. ${rec}`);
            });
        }
        
        console.log('\n🔗 Recursos útiles:');
        console.log('   Bot Framework Portal: https://dev.botframework.com');
        console.log('   Azure Portal: https://portal.azure.com');
        console.log('   OpenAI Platform: https://platform.openai.com');
        
        console.log('\n📄 Para más información, revisar:');
        console.log('   - Archivo .env.example para configuración completa');
        console.log('   - Logs del bot al iniciar para diagnósticos automáticos');
        console.log('   - Endpoints /health y /diagnostic cuando el bot esté corriendo');
        
        console.log('\n✅ Diagnóstico completado');
        console.log(`📅 Timestamp: ${this.results.timestamp}`);
        console.log('================================\n');
    }

    /**
     * Guarda resultados en archivo JSON
     */
    saveResults() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const resultsPath = path.join(__dirname, '..', 'diagnostic-results.json');
            fs.writeFileSync(resultsPath, JSON.stringify(this.results, null, 2));
            console.log(`📄 Resultados guardados en: ${resultsPath}`);
        } catch (error) {
            console.warn('⚠️ No se pudieron guardar los resultados:', error.message);
        }
    }
}

// Ejecutar diagnóstico si se llama directamente
if (require.main === module) {
    const diagnostic = new NovaBotDiagnostic();
    
    diagnostic.runAllDiagnostics()
        .then(() => {
            diagnostic.saveResults();
            
            // Exit code basado en resultado
            if (diagnostic.results.overall === 'fail') {
                process.exit(1);
            } else if (diagnostic.results.overall === 'warn') {
                process.exit(2);
            } else {
                process.exit(0);
            }
        })
        .catch(error => {
            console.error('💥 Error ejecutando diagnóstico:', error);
            process.exit(1);
        });
}

module.exports = NovaBotDiagnostic;