// services/seguimientoService.js - CORREGIDO: Persistencia de 5 mensajes funcionando

const { DateTime } = require('luxon');
const cosmosService = require('./cosmosService');

/**
 * Servicio de Seguimiento CORREGIDO - Mantiene historial de 5 mensajes de referencia
 */
class SeguimientoService {
    constructor() {
        // Cache en memoria para acceso rápido
        this.referenciaCache = new Map(); // userId -> [mensajes de referencia]
        this.initialized = false;
        this.contadorGlobal = new Map(); // userId -> siguiente número
        
        console.log('📋 Inicializando SeguimientoService CORREGIDO...');
        this.init();
    }

    async init() {
        try {
            this.cosmosAvailable = cosmosService.isAvailable();
            this.initialized = true;
            
            console.log(`✅ SeguimientoService inicializado - Cosmos DB: ${this.cosmosAvailable ? 'Disponible' : 'Solo memoria'}`);
            
            // Cargar datos existentes si hay Cosmos DB
            if (this.cosmosAvailable) {
                await this.cargarDatosExistentes();
            }
            
        } catch (error) {
            console.error('❌ Error inicializando SeguimientoService:', error);
            this.initialized = false;
        }
    }

    /**
     * ✅ CORREGIDO: Carga datos existentes desde Cosmos DB
     */
    async cargarDatosExistentes() {
        try {
            console.log('📂 Cargando mensajes de referencia existentes desde Cosmos DB...');
            
            const query = {
                query: `
                    SELECT * FROM c 
                    WHERE c.documentType = 'mensaje_referencia'
                    ORDER BY c.timestamp DESC
                `
            };

            const { resources: mensajes } = await cosmosService.container.items
                .query(query)
                .fetchAll();

            // Agrupar por usuario y mantener solo los 5 más recientes
            const mensajesPorUsuario = new Map();
            let maxNumerosPorUsuario = new Map();
            
            mensajes.forEach(msg => {
                const userId = msg.userId;
                if (!mensajesPorUsuario.has(userId)) {
                    mensajesPorUsuario.set(userId, []);
                    maxNumerosPorUsuario.set(userId, 0);
                }
                mensajesPorUsuario.get(userId).push(msg);
                
                // Trackear el número más alto para cada usuario
                if (msg.numeroReferencia > maxNumerosPorUsuario.get(userId)) {
                    maxNumerosPorUsuario.set(userId, msg.numeroReferencia);
                }
            });

            // Cargar al cache manteniendo solo 5 por usuario
            for (const [userId, userMessages] of mensajesPorUsuario.entries()) {
                const ultimosCinco = userMessages
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                    .slice(0, 5);
                
                this.referenciaCache.set(userId, ultimosCinco);
                this.contadorGlobal.set(userId, maxNumerosPorUsuario.get(userId) + 1);
                
                console.log(`📋 Usuario ${userId}: ${ultimosCinco.length} mensajes cargados, próximo número: ${this.contadorGlobal.get(userId)}`);
            }

            console.log(`✅ Datos existentes cargados: ${mensajesPorUsuario.size} usuarios`);
            
        } catch (error) {
            console.warn('⚠️ Error cargando datos existentes:', error.message);
        }
    }

    /**
     * ✅ CORREGIDO: Agrega un nuevo mensaje de referencia
     */
    async agregarMensajeReferencia(userId, contenido, tipo = 'general', metadata = {}) {
        try {
            if (!this.initialized) {
                console.warn('⚠️ SeguimientoService no inicializado');
                return null;
            }

            const timestamp = DateTime.now().setZone('America/Mexico_City').toISO();
            const mensajeId = this.generarId(userId);
            const numeroReferencia = this.obtenerSiguienteNumero(userId);

            const mensajeReferencia = {
                id: mensajeId,
                userId: userId,
                documentType: 'mensaje_referencia',
                contenido: contenido.substring(0, 2000), // ✅ Limitar contenido
                tipo: tipo,
                timestamp: timestamp,
                numeroReferencia: numeroReferencia,
                metadata: {
                    ...metadata,
                    version: '2.1.1',
                    source: 'nova_bot'
                },
                ttl: 60 * 60 * 24 * 30, // TTL: 30 días
                partitionKey: userId
            };

            console.log(`📋 [${userId}] Creando mensaje de referencia #${numeroReferencia} (${tipo})`);
            console.log(`🔍 [${userId}] ID: ${mensajeId}, Contenido: ${contenido.length} chars`);

            // ✅ CORREGIDO: Agregar al cache PRIMERO
            let mensajesUsuario = this.referenciaCache.get(userId) || [];
            mensajesUsuario.unshift(mensajeReferencia); // Agregar al inicio

            // ✅ CORREGIDO: Eliminar antiguos ANTES de guardar el nuevo
            if (mensajesUsuario.length > 5) {
                const mensajesParaEliminar = mensajesUsuario.slice(5); // Todo después del 5to
                mensajesUsuario = mensajesUsuario.slice(0, 5); // Mantener solo 5

                console.log(`🗑️ [${userId}] Eliminando ${mensajesParaEliminar.length} mensajes antiguos`);

                // Eliminar de Cosmos DB los mensajes antiguos, ignorando 404
                if (this.cosmosAvailable) {
                    for (const msgAntiguo of mensajesParaEliminar) {
                        try {
                            await cosmosService.container.item(msgAntiguo.id, userId).delete();
                            console.log(`✅ [${userId}] Eliminado de Cosmos DB: ${msgAntiguo.id} (#${msgAntiguo.numeroReferencia})`);
                        } catch (deleteError) {
                            // Ignorar si el documento no existe
                            if (deleteError.code === 404 || deleteError.message.includes('NotFound')) {
                                console.log(`ℹ️ [${userId}] Mensaje ${msgAntiguo.id} no encontrado en Cosmos DB, ignorando`);
                            } else {
                                console.warn(`⚠️ [${userId}] Error eliminando ${msgAntiguo.id}:`, deleteError.message);
                            }
                        }
                    }
                }
            }

            // Actualizar cache
            this.referenciaCache.set(userId, mensajesUsuario);
            this.contadorGlobal.set(userId, numeroReferencia + 1);

            // ✅ GUARDAR EN COSMOS DB después de limpiar
            if (this.cosmosAvailable) {
                try {
                    const { resource: saved } = await cosmosService.container.items.create(mensajeReferencia);
                    console.log(`💾 [${userId}] Mensaje guardado en Cosmos DB: #${numeroReferencia}`);
                } catch (saveError) {
                    console.error(`❌ [${userId}] Error guardando en Cosmos DB:`, saveError.message);
                    // No fallar si no se puede guardar en Cosmos DB
                }
            }

            console.log(`✅ [${userId}] Mensaje de referencia #${numeroReferencia} creado exitosamente`);
            return mensajeReferencia;

        } catch (error) {
            console.error('❌ Error agregando mensaje de referencia:', error);
            return null;
        }
    }

    /**
     * ✅ CORREGIDO: Obtiene los mensajes de referencia de un usuario
     */
    async obtenerMensajesReferencia(userId) {
        try {
            if (!this.initialized) {
                return [];
            }

            // Intentar desde cache primero
            let mensajes = this.referenciaCache.get(userId) || [];

            // Si no hay cache y Cosmos DB está disponible, cargar desde DB
            if (mensajes.length === 0 && this.cosmosAvailable) {
                try {
                    console.log(`📂 [${userId}] Cargando mensajes desde Cosmos DB...`);
                    
                    const query = {
                        query: `
                            SELECT * FROM c 
                            WHERE c.userId = @userId 
                            AND c.documentType = 'mensaje_referencia'
                            ORDER BY c.timestamp DESC
                        `,
                        parameters: [{ name: '@userId', value: userId }]
                    };

                    const { resources: dbMensajes } = await cosmosService.container.items
                        .query(query, { partitionKey: userId })
                        .fetchAll();

                    mensajes = dbMensajes.slice(0, 5);
                    this.referenciaCache.set(userId, mensajes);

                    // Actualizar contador
                    if (mensajes.length > 0) {
                        const maxNumero = Math.max(...mensajes.map(m => m.numeroReferencia));
                        this.contadorGlobal.set(userId, maxNumero + 1);
                    }

                    console.log(`📂 [${userId}] Cargados ${mensajes.length} mensajes desde Cosmos DB`);

                } catch (error) {
                    console.warn(`⚠️ [${userId}] Error cargando desde Cosmos DB:`, error.message);
                }
            }

            return mensajes.sort((a, b) => b.numeroReferencia - a.numeroReferencia);

        } catch (error) {
            console.error('❌ Error obteniendo mensajes de referencia:', error);
            return [];
        }
    }

    /**
     * ✅ CORREGIDO: Obtiene el siguiente número de referencia
     */
    obtenerSiguienteNumero(userId) {
        if (!this.contadorGlobal.has(userId)) {
            // Inicializar contador basado en mensajes existentes
            const mensajes = this.referenciaCache.get(userId) || [];
            if (mensajes.length === 0) {
                this.contadorGlobal.set(userId, 1);
                return 1;
            } else {
                const maxNumero = Math.max(...mensajes.map(m => m.numeroReferencia));
                this.contadorGlobal.set(userId, maxNumero + 1);
                return maxNumero + 1;
            }
        }
        
        const numero = this.contadorGlobal.get(userId);
        return numero;
    }

    /**
     * ✅ CORREGIDO: Genera un ID único más robusto
     */
    generarId(userId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        const userHash = userId.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
        return `ref_${timestamp}_${Math.abs(userHash)}_${random}`;
    }

    /**
     * ✅ CORREGIDO: Formatear mensajes con mejor información
     */
    async formatearMensajesReferencia(userId, incluirContenido = false) {
        try {
            const mensajes = await this.obtenerMensajesReferencia(userId);

            if (mensajes.length === 0) {
                return `📋 **Historial de Seguimiento**\n\n` +
                       `❌ **No hay mensajes de referencia guardados**\n\n` +
                       `**Los mensajes se crean automáticamente cuando:**\n` +
                       `• Consultas tasas de interés\n` +
                       `• Buscas documentos\n` +
                       `• Realizas consultas importantes\n` +
                       `• El sistema genera análisis detallados\n\n` +
                       `💡 **Prueba**: \`tasas 2025\` o \`buscar documentos\` para generar referencias.`;
            }

            let respuesta = `📋 **Historial de Seguimiento - ${mensajes.length}/5 Referencias**\n\n`;
            respuesta += `💾 **Persistencia**: ${this.cosmosAvailable ? 'Cosmos DB Activo' : 'Solo Memoria'}\n`;
            respuesta += `📊 **Estado**: Sistema funcionando correctamente\n\n`;

            mensajes.forEach((msg, index) => {
                const fecha = DateTime.fromISO(msg.timestamp).toFormat('dd/MM/yyyy HH:mm');
                const tipoEmoji = this.obtenerEmojiTipo(msg.tipo);

                respuesta += `${tipoEmoji} **Referencia #${msg.numeroReferencia}** - ${msg.tipo}\n`;
                respuesta += `📅 ${fecha}  🆔 ${msg.id.substr(-8)}\n`;

                if (incluirContenido) {
                    respuesta += `📝 **Contenido completo**:\n${msg.contenido}\n`;
                } else {
                    const preview = msg.contenido.length > 120 ? 
                        msg.contenido.substring(0, 120) + '...' : 
                        msg.contenido;
                    respuesta += `📝 ${preview}\n`;
                }

                if (msg.metadata && Object.keys(msg.metadata).filter(k => !['version', 'source'].includes(k)).length > 0) {
                    const metaInfo = Object.entries(msg.metadata)
                        .filter(([key]) => !['version', 'source'].includes(key))
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ');
                    
                    if (metaInfo) {
                        respuesta += `🔍 ${metaInfo}\n`;
                    }
                }

                if (index < mensajes.length - 1) {
                    respuesta += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                }
            });

            respuesta += `\n\n💡 **Comandos útiles:**\n`;
            respuesta += `• \`historial detallado\` - Ver contenido completo\n`;
            respuesta += `• \`referencia #N\` - Ver mensaje específico\n`;
            respuesta += `• \`limpiar seguimiento\` - Eliminar todo\n`;
            respuesta += `• \`tasas 2025\` - Generar nueva referencia`;

            return respuesta;

        } catch (error) {
            console.error('❌ Error formateando mensajes de referencia:', error);
            return '❌ Error generando historial de seguimiento';
        }
    }

    /**
     * ✅ NUEVO: Diagnóstico del estado del servicio
     */
    async diagnosticarServicio(userId = null) {
        try {
            const diagnostico = {
                timestamp: DateTime.now().setZone('America/Mexico_City').toISO(),
                servicio: {
                    initialized: this.initialized,
                    cosmosAvailable: this.cosmosAvailable
                },
                cache: {
                    totalUsuarios: this.referenciaCache.size,
                    totalMensajes: Array.from(this.referenciaCache.values()).reduce((total, msgs) => total + msgs.length, 0)
                },
                contadores: Object.fromEntries(this.contadorGlobal.entries())
            };

            if (userId) {
                const mensajesUsuario = this.referenciaCache.get(userId) || [];
                diagnostico.usuario = {
                    userId: userId,
                    mensajesEnCache: mensajesUsuario.length,
                    proximoNumero: this.contadorGlobal.get(userId) || 1,
                    ultimosMensajes: mensajesUsuario.map(m => ({
                        id: m.id,
                        numero: m.numeroReferencia,
                        tipo: m.tipo,
                        timestamp: m.timestamp
                    }))
                };

                // Verificar en Cosmos DB si está disponible
                if (this.cosmosAvailable) {
                    try {
                        const query = {
                            query: `SELECT c.id, c.numeroReferencia, c.tipo, c.timestamp FROM c WHERE c.userId = @userId AND c.documentType = 'mensaje_referencia' ORDER BY c.timestamp DESC`,
                            parameters: [{ name: '@userId', value: userId }]
                        };

                        const { resources: enCosmosDB } = await cosmosService.container.items
                            .query(query, { partitionKey: userId })
                            .fetchAll();

                        diagnostico.usuario.mensajesEnCosmosDB = enCosmosDB.length;
                        diagnostico.usuario.cosmosDBMensajes = enCosmosDB;
                    } catch (cosmosError) {
                        diagnostico.usuario.errorCosmosDB = cosmosError.message;
                    }
                }
            }

            return diagnostico;

        } catch (error) {
            console.error('❌ Error en diagnóstico:', error);
            return { error: error.message };
        }
    }

    /**
     * ✅ CORREGIDO: Limpiar seguimiento completamente
     */
    async limpiarSeguimiento(userId) {
        try {
            const mensajes = await this.obtenerMensajesReferencia(userId);
            
            if (mensajes.length === 0) {
                console.log(`✅ [${userId}] Seguimiento ya está limpio`);
                return true;
            }

            console.log(`🗑️ [${userId}] Limpiando ${mensajes.length} mensajes de referencia...`);

            // Limpiar cache
            this.referenciaCache.delete(userId);
            this.contadorGlobal.delete(userId);

            // Limpiar Cosmos DB
            if (this.cosmosAvailable) {
                let eliminados = 0;
                for (const mensaje of mensajes) {
                    try {
                        await cosmosService.container.item(mensaje.id, userId).delete();
                        eliminados++;
                        console.log(`🗑️ [${userId}] Eliminado: ${mensaje.id} (#${mensaje.numeroReferencia})`);
                    } catch (deleteError) {
                        // Ignorar si el documento no existe
                        if (deleteError.code === 404 || deleteError.message.includes('NotFound')) {
                            console.log(`ℹ️ [${userId}] Mensaje ${mensaje.id} no encontrado en Cosmos DB, ignorando`);
                        } else {
                            console.warn(`⚠️ [${userId}] Error eliminando ${mensaje.id}:`, deleteError.message);
                        }
                    }
                }
                console.log(`✅ [${userId}] Eliminados ${eliminados}/${mensajes.length} mensajes de Cosmos DB`);
            }

            console.log(`✅ [${userId}] Seguimiento limpiado completamente`);
            return true;

        } catch (error) {
            console.error('❌ Error limpiando seguimiento:', error);
            return false;
        }
    }

    // ===== MANTENER MÉTODOS EXISTENTES =====
    
    async obtenerMensajePorNumero(userId, numeroReferencia) {
        try {
            const mensajes = await this.obtenerMensajesReferencia(userId);
            return mensajes.find(msg => msg.numeroReferencia === numeroReferencia) || null;
        } catch (error) {
            console.error('❌ Error obteniendo mensaje por número:', error);
            return null;
        }
    }

    async obtenerEstadisticas(userId) {
        try {
            const mensajes = await this.obtenerMensajesReferencia(userId);

            const estadisticas = {
                totalMensajes: mensajes.length,
                tiposMensajes: {},
                rangoFechas: null,
                mensajeMasReciente: null,
                mensajeMasAntiguo: null
            };

            if (mensajes.length > 0) {
                // Contar tipos
                mensajes.forEach(msg => {
                    estadisticas.tiposMensajes[msg.tipo] = (estadisticas.tiposMensajes[msg.tipo] || 0) + 1;
                });

                // Fechas
                const fechas = mensajes.map(msg => DateTime.fromISO(msg.timestamp));
                estadisticas.mensajeMasReciente = fechas[0].toFormat('dd/MM/yyyy HH:mm');
                estadisticas.mensajeMasAntiguo = fechas[fechas.length - 1].toFormat('dd/MM/yyyy HH:mm');

                const rangoHoras = fechas[0].diff(fechas[fechas.length - 1], 'hours').hours;
                estadisticas.rangoFechas = `${Math.round(rangoHoras)} horas`;
            }

            return estadisticas;

        } catch (error) {
            console.error('❌ Error obteniendo estadísticas:', error);
            return null;
        }
    }

    async exportarSeguimiento(userId, userInfo) {
        try {
            const mensajes = await this.obtenerMensajesReferencia(userId);
            const estadisticas = await this.obtenerEstadisticas(userId);

            if (mensajes.length === 0) {
                return '📋 **Exportación de Seguimiento**\n\nNo hay mensajes de referencia para exportar.';
            }

            const fechaExportacion = DateTime.now().setZone('America/Mexico_City').toFormat('dd/MM/yyyy HH:mm:ss');

            let exportacion = `📋 **NOVA BOT - EXPORTACIÓN DE SEGUIMIENTO**\n`;
            exportacion += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            exportacion += `👤 **Usuario**: ${userInfo?.nombre || 'Desconocido'} (${userId})\n`;
            exportacion += `📅 **Fecha de Exportación**: ${fechaExportacion}\n`;
            exportacion += `📊 **Total de Referencias**: ${estadisticas.totalMensajes}\n`;
            exportacion += `💾 **Persistencia**: ${this.cosmosAvailable ? 'Cosmos DB' : 'Solo Memoria'}\n`;
            exportacion += `🕐 **Rango**: ${estadisticas.rangoFechas || 'N/A'}\n\n`;

            exportacion += `📈 **Estadísticas por Tipo:**\n`;
            Object.entries(estadisticas.tiposMensajes).forEach(([tipo, cantidad]) => {
                const emoji = this.obtenerEmojiTipo(tipo);
                exportacion += `   ${emoji} ${tipo}: ${cantidad}\n`;
            });

            exportacion += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            exportacion += `📝 **HISTORIAL COMPLETO:**\n\n`;

            mensajes.forEach((msg, index) => {
                const fecha = DateTime.fromISO(msg.timestamp).toFormat('dd/MM/yyyy HH:mm:ss');
                const tipoEmoji = this.obtenerEmojiTipo(msg.tipo);

                exportacion += `${index + 1}. ${tipoEmoji} **REFERENCIA #${msg.numeroReferencia}**\n`;
                exportacion += `   🆔 ID: ${msg.id}\n`;
                exportacion += `   📅 Fecha: ${fecha}\n`;
                exportacion += `   🏷️ Tipo: ${msg.tipo}\n`;
                exportacion += `   📝 Contenido:\n`;
                exportacion += `   ${msg.contenido.replace(/\n/g, '\n   ')}\n`;

                if (msg.metadata && Object.keys(msg.metadata).length > 0) {
                    exportacion += `   🔍 Metadata: ${JSON.stringify(msg.metadata, null, 6).replace(/\n/g, '\n   ')}\n`;
                }

                exportacion += `\n`;
            });

            exportacion += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            exportacion += `📋 **Fin de Exportación** - Nova Bot v2.1.1`;

            return exportacion;

        } catch (error) {
            console.error('❌ Error exportando seguimiento:', error);
            return '❌ Error generando exportación de seguimiento';
        }
    }

    obtenerEmojiTipo(tipo) {
        const emojis = {
            'general': '📋',
            'analysis': '📊',
            'recommendation': '💡',
            'status': '🔍',
            'error': '❌',
            'success': '✅',
            'tasas': '💰',
            'documentos': '📖',
            'politicas': '📑',
            'feriados': '📅',
            'consulta': '🔍',
            'sistema': '⚙️'
        };
        return emojis[tipo] || '📋';
    }

    isAvailable() {
        return this.initialized;
    }

    obtenerEstadisticasGenerales() {
        return {
            initialized: this.initialized,
            cosmosAvailable: this.cosmosAvailable,
            usuariosEnCache: this.referenciaCache.size,
            totalMensajesEnCache: Array.from(this.referenciaCache.values()).reduce((total, msgs) => total + msgs.length, 0),
            version: '2.1.1-CORREGIDO',
            timestamp: DateTime.now().setZone('America/Mexico_City').toISO()
        };
    }
}

// Crear instancia singleton
const seguimientoService = new SeguimientoService();

module.exports = seguimientoService;
