// scripts/diagnosticSeguimiento.js - Diagnóstico del sistema de seguimiento

import 'dotenv/config';
import seguimientoService from '../services/seguimientoService.js';
import cosmosService from '../services/cosmosService.js';

const seguimientoService = new SeguimientoService();
const cosmosService = new CosmosService();
/**
 * Script para diagnosticar el sistema de seguimiento
 */
export default class DiagnosticoSeguimiento {
    constructor() {
        this.testUserId = 'test_user_diagnostic';
    }

    async ejecutarDiagnostico() {
        console.log('🔍 ===== DIAGNÓSTICO SISTEMA DE SEGUIMIENTO =====');
        console.log('🛠️ Verificando funcionalidad de persistencia...\n');

        try {
            // 1. Verificar servicios base
            await this.verificarServicios();
            
            // 2. Probar funcionalidad básica
            await this.probarFuncionalidadBasica();
            
            // 3. Probar persistencia
            await this.probarPersistencia();
            
            // 4. Probar límite de 5 mensajes
            await this.probarLimite5Mensajes();
            
            // 5. Limpiar datos de prueba
            await this.limpiarDatosPrueba();
            
            console.log('\n✅ ===== DIAGNÓSTICO COMPLETADO =====');
            console.log('🎉 El sistema de seguimiento está funcionando correctamente');
            
        } catch (error) {
            console.error('\n❌ ===== ERROR EN DIAGNÓSTICO =====');
            console.error('💥 Error:', error.message);
            console.error('📋 Stack:', error.stack);
        }
    }

    async verificarServicios() {
        console.log('🔧 1. Verificando servicios base...');
        
        const seguimientoDisponible = seguimientoService.isAvailable();
        const cosmosDisponible = cosmosService.isAvailable();
        
        console.log(`   📋 SeguimientoService: ${seguimientoDisponible ? '✅ Disponible' : '❌ No disponible'}`);
        console.log(`   💾 Cosmos DB: ${cosmosDisponible ? '✅ Disponible' : '❌ No disponible'}`);
        
        if (!seguimientoDisponible) {
            throw new Error('SeguimientoService no está disponible');
        }
        
        const stats = seguimientoService.obtenerEstadisticasGenerales();
        console.log(`   📊 Usuarios en cache: ${stats.usuariosEnCache}`);
        console.log(`   📊 Mensajes en cache: ${stats.totalMensajesEnCache}`);
        console.log('');
    }

    async probarFuncionalidadBasica() {
        console.log('🧪 2. Probando funcionalidad básica...');
        
        // Crear mensaje de prueba
        const contenido1 = 'Mensaje de prueba 1 - Verificando funcionalidad básica del sistema';
        const mensaje1 = await seguimientoService.agregarMensajeReferencia(
            this.testUserId,
            contenido1,
            'test',
            { prueba: 'funcionalidad_basica' }
        );
        
        if (!mensaje1) {
            throw new Error('No se pudo crear mensaje de referencia');
        }
        
        console.log(`   ✅ Mensaje creado: #${mensaje1.numeroReferencia}`);
        console.log(`   🆔 ID: ${mensaje1.id}`);
        
        // Verificar que se puede recuperar
        const mensajes = await seguimientoService.obtenerMensajesReferencia(this.testUserId);
        
        if (mensajes.length === 0) {
            throw new Error('No se pudo recuperar el mensaje creado');
        }
        
        console.log(`   ✅ Recuperación exitosa: ${mensajes.length} mensaje(s)`);
        console.log('');
    }

    async probarPersistencia() {
        console.log('💾 3. Probando persistencia...');
        
        if (!cosmosService.isAvailable()) {
            console.log('   ⚠️ Cosmos DB no disponible - saltando prueba de persistencia');
            console.log('');
            return;
        }
        
        // Crear varios mensajes
        for (let i = 2; i <= 4; i++) {
            const contenido = `Mensaje de prueba ${i} - Verificando persistencia en Cosmos DB`;
            const mensaje = await seguimientoService.agregarMensajeReferencia(
                this.testUserId,
                contenido,
                'test',
                { prueba: 'persistencia', numero: i }
            );
            
            if (!mensaje) {
                throw new Error(`No se pudo crear mensaje ${i}`);
            }
            
            console.log(`   ✅ Mensaje ${i} creado: #${mensaje.numeroReferencia}`);
        }
        
        // Verificar en Cosmos DB directamente
        await this.verificarEnCosmosDB();
        console.log('');
    }

    async verificarEnCosmosDB() {
        try {
            const query = {
                query: `
                    SELECT c.id, c.numeroReferencia, c.tipo, c.timestamp 
                    FROM c 
                    WHERE c.userId = @userId 
                    AND c.documentType = 'mensaje_referencia'
                    ORDER BY c.timestamp DESC
                `,
                parameters: [{ name: '@userId', value: this.testUserId }]
            };

            const { resources: mensajesDB } = await cosmosService.container.items
                .query(query, { partitionKey: this.testUserId })
                .fetchAll();

            console.log(`   💾 Mensajes en Cosmos DB: ${mensajesDB.length}`);
            
            mensajesDB.forEach((msg, index) => {
                console.log(`      ${index + 1}. #${msg.numeroReferencia} (${msg.id.substr(-8)}) - ${msg.tipo}`);
            });
            
        } catch (error) {
            console.warn(`   ⚠️ Error verificando Cosmos DB: ${error.message}`);
        }
    }

    async probarLimite5Mensajes() {
        console.log('🔢 4. Probando límite de 5 mensajes...');
        
        // Crear mensajes adicionales para llegar a más de 5
        for (let i = 5; i <= 8; i++) {
            const contenido = `Mensaje de prueba ${i} - Verificando límite de 5 mensajes máximo`;
            const mensaje = await seguimientoService.agregarMensajeReferencia(
                this.testUserId,
                contenido,
                'test',
                { prueba: 'limite_5', numero: i }
            );
            
            console.log(`   📝 Mensaje ${i} creado: #${mensaje.numeroReferencia}`);
        }
        
        // Verificar que solo hay 5 mensajes
        const mensajesFinal = await seguimientoService.obtenerMensajesReferencia(this.testUserId);
        
        console.log(`   📊 Total mensajes después de crear 8: ${mensajesFinal.length}`);
        
        if (mensajesFinal.length > 5) {
            throw new Error(`Se mantienen ${mensajesFinal.length} mensajes, deberían ser máximo 5`);
        }
        
        console.log('   ✅ Límite de 5 mensajes funcionando correctamente');
        
        // Mostrar cuáles se mantuvieron
        console.log('   📋 Mensajes mantenidos:');
        mensajesFinal.forEach((msg, index) => {
            console.log(`      ${index + 1}. #${msg.numeroReferencia} - ${msg.tipo}`);
        });
        
        console.log('');
    }

    async limpiarDatosPrueba() {
        console.log('🧹 5. Limpiando datos de prueba...');
        
        const limpiado = await seguimientoService.limpiarSeguimiento(this.testUserId);
        
        if (limpiado) {
            console.log('   ✅ Datos de prueba limpiados exitosamente');
        } else {
            console.warn('   ⚠️ Problemas limpiando datos de prueba');
        }
        
        // Verificar que se limpiaron
        const mensajesDespues = await seguimientoService.obtenerMensajesReferencia(this.testUserId);
        console.log(`   📊 Mensajes después de limpiar: ${mensajesDespues.length}`);
        console.log('');
    }

    async mostrarEstadisticasGenerales() {
        console.log('📊 Estadísticas generales del sistema:');
        
        const stats = seguimientoService.obtenerEstadisticasGenerales();
        console.log('   ', JSON.stringify(stats, null, 4));
        
        if (cosmosService.isAvailable()) {
            const cosmosStats = await cosmosService.getStats();
            console.log('\n💾 Estadísticas de Cosmos DB:');
            console.log('   ', JSON.stringify(cosmosStats, null, 4));
        }
    }
}

// Ejecutar diagnóstico si se llama directamente
if (require.main === module) {
    const diagnostico = new DiagnosticoSeguimiento();
    
    diagnostico.ejecutarDiagnostico()
        .then(() => {
            console.log('\n🎯 Para probar en el bot, usa:');
            console.log('   • `tasas 2025` - Generar referencia automática');
            console.log('   • `historial` - Ver mensajes de referencia');
            console.log('   • `buscar documentos ajustes` - Otra referencia');
            console.log('   • `limpiar seguimiento` - Limpiar todo');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Error en diagnóstico:', error);
            process.exit(1);
        });
}

