// services/toolsService.js - Servicio separado para herramientas de OpenAI
import 'dotenv/config';
import axios from 'axios';
import DocumentService from './documentService.js';

const documentService = new DocumentService();

/**
 * ToolsService - Gestiona las 7 herramientas disponibles para el bot
 *
 * Responsabilidades:
 * 1. Definir schemas de herramientas para OpenAI
 * 2. Ejecutar cada herramienta
 * 3. Formatear resultados (mínimamente - deja que la IA interprete)
 * 4. Manejo de errores específicos
 *
 * Herramientas disponibles:
 * - obtener_informacion_usuario: Info del perfil del usuario
 * - obtener_fecha_hora_actual: Fecha/hora en zona México
 * - consultar_tasas_interes: Tasas de interés Nova
 * - consultar_saldo_usuario: Saldos de TODAS las cuentas (la IA filtra según pregunta)
 * - buscar_documentos_nova: Búsqueda en Azure Search (vectorial + textual)
 * - consultar_procedimientos: Búsqueda especializada en procedimientos del portal web (señuelo)
 * - simulador_ahorros: Redirige al usuario al simulador del portal web
 */
export default class ToolsService {
  constructor() {
    this.available = true;
    console.log('✅ ToolsService inicializado con 7 herramientas');
  }

  /**
   * Obtiene definiciones de herramientas en formato OpenAI
   * @returns {Array} Array de 7 tool definitions
   */
  getToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'buscar_documentos_nova',
          description: 'Busca información específica en documentación interna de Nova (APIs, políticas, procedimientos, uso del portal, contraseñas)',
          parameters: {
            type: 'object',
            properties: {
              consulta: {
                type: 'string',
                description: 'Término específico a buscar en la documentación'
              }
            },
            required: ['consulta']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'consultar_procedimientos',
          description: 'Consulta procedimientos específicos del portal web de Nova. USA ESTA HERRAMIENTA cuando el usuario pregunte sobre: cómo consultar su perfil, cómo cambiar su contraseña, cómo cambiar sus datos personales, cómo navegar el portal, cómo usar funcionalidades del sistema.',
          parameters: {
            type: 'object',
            properties: {
              procedimiento: {
                type: 'string',
                description: 'Procedimiento a consultar (ej: "cambiar contraseña", "consultar perfil", "cambiar datos")'
              }
            },
            required: ['procedimiento']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'obtener_fecha_hora_actual',
          description: 'Obtiene fecha y hora actual en zona México',
          parameters: {
            type: 'object',
            properties: {
              formato: {
                type: 'string',
                enum: ['completo', 'fecha', 'hora'],
                default: 'completo'
              }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'obtener_informacion_usuario',
          description: 'Obtiene información del perfil del usuario autenticado',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'consultar_tasas_interes',
          description: 'Consulta tasas de interés mensuales de Nova',
          parameters: {
            type: 'object',
            properties: {
              anio: {
                type: 'integer',
                minimum: 2020,
                maximum: 2030,
                description: 'Año para consultar las tasas'
              }
            },
            required: ['anio']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'consultar_saldo_usuario',
          description: 'Consulta saldos de las cuentas del usuario. Retorna información de TODAS las cuentas (Vista, Fijo 1M, Fijo 3M, Fijo 6M, etc). La IA debe filtrar y mostrar solo lo que el usuario pidió específicamente.',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'simulador_ahorros',
          description: 'Herramienta para cuando el usuario solicita simulaciones de ahorro, inversión o cálculos de rendimientos. Redirige al simulador oficial del portal web.',
          parameters: {
            type: 'object',
            properties: {
              tipo_simulacion: {
                type: 'string',
                description: 'Tipo de simulación solicitada (ahorro, inversión, rendimientos, etc.)',
                default: 'ahorro'
              }
            }
          }
        }
      }
    ];
  }

  /**
   * Ejecuta una herramienta específica
   * @param {string} toolName - Nombre de la herramienta
   * @param {Object} params - Parámetros de la herramienta
   * @param {Object} context - Contexto de ejecución
   * @param {string} context.userToken - Token JWT del usuario
   * @param {Object} context.userInfo - Información del usuario
   * @returns {Promise<string>} Resultado formateado
   */
  async executeTool(toolName, params = {}, context = {}) {
    const { userToken, userInfo } = context;

    switch (toolName) {
      case 'obtener_informacion_usuario':
        return this.obtenerInfoUsuario(userInfo);

      case 'consultar_tasas_interes':
        return await this.consultarTasasInteres(params.anio, userToken, userInfo);

      case 'consultar_saldo_usuario':
        return await this.consultarSaldoUsuario(userToken, userInfo);

      case 'buscar_documentos_nova':
        return await this.buscarDocumentosNova(params.consulta, userInfo, userToken);

      case 'consultar_procedimientos':
        // Herramienta señuelo: reutiliza buscar_documentos_nova internamente
        return await this.buscarDocumentosNova(params.procedimiento, userInfo, userToken);

      case 'simulador_ahorros':
        return this.redirigirSimulador(params.tipo_simulacion);

      default:
        throw new Error(`Herramienta desconocida: ${toolName}`);
    }
  }

  // ========================================
  // IMPLEMENTACIÓN DE HERRAMIENTAS
  // ========================================

  /**
   * Tool 1: Obtener información del usuario
   * @param {Object} userInfo - Información del usuario
   * @returns {string} Info formateada
   */
  obtenerInfoUsuario(userInfo) {
    if (!userInfo) {
      return 'No hay información de usuario disponible';
    }

    let info = 'Información del usuario:\n';
    if (userInfo.nombre) info += `- Nombre: ${userInfo.nombre}\n`;
    if (userInfo.usuario) info += `- Usuario/Socio: ${userInfo.usuario}\n`;
    if (userInfo.paterno) info += `- Apellido paterno: ${userInfo.paterno}\n`;
    if (userInfo.materno) info += `- Apellido materno: ${userInfo.materno}\n`;

    const tieneToken = !!(userInfo.token && userInfo.token.length > 50);
    info += `- Estado: ${tieneToken ? 'Autenticado' : 'Sin autenticar'}`;

    return info;
  }

  /**
   * Tool 2: Consultar tasas de interés
   * @param {number} anio - Año a consultar (2020-2030)
   * @param {string} userToken - Token JWT
   * @param {Object} userInfo - Info del usuario
   * @returns {Promise<string>} Tasas formateadas
   */
  async consultarTasasInteres(anio, userToken, userInfo) {
    if (!userToken || !userInfo) {
      return 'Error: Autenticación requerida para consultar tasas de interés';
    }

    const cveUsuario = userInfo.usuario;
    const numRI = this.extractNumRIFromToken(userToken) || '7';

    const requestBody = {
      usuarioActual: { CveUsuario: cveUsuario },
      data: { NumRI: numRI, Anio: anio }
    };

    const url = process.env.NOVA_API_URL_TASA ||
      'https://pruebas.nova.com.mx/ApiRestNova/api/ConsultaTasa/consultaTasa';

    const result = await this._callNovaAPI(url, requestBody, userToken, `consultar tasas ${anio}`);

    if (!result.success) {
      return `Error: ${result.error}`;
    }

    if (result.data?.info) {
      return this.formatearTasas(result.data.info, anio);
    }

    return `Sin datos de tasas para el año ${anio}`;
  }

  /**
   * Tool 3: Consultar saldo del usuario (Ahorros y Préstamos)
   * @param {string} userToken - Token JWT
   * @param {Object} userInfo - Info del usuario
   * @returns {Promise<string>} Saldo formateado
   */
  async consultarSaldoUsuario(userToken, userInfo) {
    if (!userToken || !userInfo) {
      console.log('⚠️ [consultarSaldo] Sin autenticación');
      return 'Error: Autenticación requerida para consultar saldo';
    }

    const cveUsuario = userInfo.usuario;
    const requestBody = {
      usuarioActual: { CveUsuario: cveUsuario },
      data: { NumSocio: cveUsuario }
    };

    console.log(`🔍 [consultarSaldo] Request para usuario: ${cveUsuario}`);

    const url = process.env.NOVA_API_URL_SALDO ||
      'https://pruebas.nova.com.mx/ApiRestNova/api/SaldoProducto/obtSaldoProducto';

    const result = await this._callNovaAPI(url, requestBody, userToken, 'consultar saldo');

    console.log(`📦 [consultarSaldo] API Response:`, {
      success: result.success,
      hasData: !!result.data,
      dataType: typeof result.data,
      dataKeys: result.data ? Object.keys(result.data) : [],
      status: result.status,
      error: result.error
    });

    if (!result.success) {
      console.log(`❌ [consultarSaldo] Error de API: ${result.error}`);
      return `Error: ${result.error}`;
    }

    if (result.data) {
      // Log de estructura de datos antes de formatear
      console.log(`🔧 [consultarSaldo] Datos recibidos:`, JSON.stringify(result.data, null, 2).substring(0, 500));

      const formatted = this.formatearSaldo(result.data, userInfo);
      console.log(`✅ [consultarSaldo] Respuesta formateada (${formatted.length} chars):`, formatted.substring(0, 200));
      return formatted;
    }

    console.log(`⚠️ [consultarSaldo] Sin datos en respuesta`);
    return 'No se pudo obtener información de saldo';
  }

  /**
   * Tool 4: Buscar en documentos Nova (Azure Search)
   * @param {string} consulta - Término de búsqueda
   * @param {Object} userInfo - Info del usuario
   * @param {string} userToken - Token JWT del usuario
   * @returns {Promise<string>} Resultados de búsqueda
   */
  async buscarDocumentosNova(consulta, userInfo, userToken) {
    const userId = userInfo?.usuario || 'unknown';

    try {
      if (!documentService?.isAvailable?.()) {
        return 'Servicio de búsqueda de documentos no disponible. Verifica la configuración de Azure Search.';
      }

      console.log(`[${userId}] Buscando en documentos: "${consulta}"`);

      // Pasar perfil si existe (WebChat), token y numSocio (Teams)
      const resultado = await documentService.buscarDocumentos(consulta, userId, {
        perfil: userInfo?.perfil || null,  // ← WebChat pasa perfil explícito
        userToken: userToken,               // ← Token para Teams
        numSocio: userInfo?.usuario         // ← NumSocio para Teams
      });

      if (!resultado || typeof resultado !== 'string') {
        return 'No se encontró información relevante en los documentos.';
      }

      if (resultado.length < 50) {
        return 'No se encontraron documentos relevantes para la consulta.';
      }

      return resultado;

    } catch (error) {
      console.error(`[${userId}] Error buscando documentos:`, error.message);
      return `Error en búsqueda de documentos: ${error.message}`;
    }
  }

  /**
   * Tool 5: Simulador de ahorros - Redirige al portal web
   * @param {string} tipo_simulacion - Tipo de simulación solicitada
   * @returns {string} Mensaje de redirección
   */
  redirigirSimulador(tipo_simulacion = 'ahorro') {
    const mensaje = `Para realizar simulaciones de ${tipo_simulacion}, es necesario utilizar el simulador oficial del portal web de Nova.

**¿Cómo acceder al simulador?**
1. Ingresa al portal web de Nova
2. Dirígete a la sección "Simulador de Ahorros"
3. Ingresa los datos de tu inversión (monto, plazo, tipo de cuenta)
4. El simulador te mostrará proyecciones exactas basadas en las tasas vigentes

**Importante:**
- El simulador del portal utiliza las tasas actualizadas en tiempo real
- Te permite comparar diferentes opciones de inversión
- Genera reportes detallados que puedes descargar

Si necesitas información sobre las tasas de interés actuales, puedo consultarlas para ti.`;

    return mensaje;
  }

  // ========================================
  // FORMATTERS
  // ========================================

  /**
   * Formatea datos de tasas de interés
   * @param {Array} tasasData - Array de tasas por mes
   * @param {number} anio - Año
   * @returns {string} Tasas formateadas
   */
  formatearTasas(tasasData, anio) {
    if (!Array.isArray(tasasData) || !tasasData.length) {
      return 'No hay datos de tasas disponibles';
    }

    let respuesta = `Tasas de interés Nova ${anio}:\n\n`;

    tasasData.forEach(item => {
      const mes = (item.Mes || '').toString();
      respuesta += `${mes}:\n`;
      if (item.vista) respuesta += `  - Vista: ${item.vista}%\n`;
      if (item.fijo1) respuesta += `  - Fijo 1M: ${item.fijo1}%\n`;
      if (item.fijo3) respuesta += `  - Fijo 3M: ${item.fijo3}%\n`;
      if (item.fijo6) respuesta += `  - Fijo 6M: ${item.fijo6}%\n`;
      if (item.FAP) respuesta += `  - FAP: ${item.FAP}%\n`;
      if (item.Nov) respuesta += `  - Nov: ${item.Nov}%\n`;
      if (item.Prestamos) respuesta += `  - Préstamos: ${item.Prestamos}%\n`;
      respuesta += '\n';
    });

    return respuesta;
  }

  /**
   * Formatea datos de saldo - RETORNA DATOS RAW PARA QUE LA IA DECIDA QUÉ MOSTRAR
   * Maneja la nueva estructura: { saldoAhorro: {...}, saldoPrestamo: {...}, status: "success" }
   * @param {Object} saldoData - Datos de saldo de la API
   * @param {Object} userInfo - Info del usuario
   * @returns {string} Datos RAW estructurados para que la IA interprete
   */
  formatearSaldo(saldoData, userInfo) {
    console.log('📋 [formatearSaldo] Iniciando formateo...');
    console.log('📋 [formatearSaldo] Estructura recibida:', {
      hasData: !!saldoData,
      dataType: typeof saldoData,
      keys: saldoData ? Object.keys(saldoData) : [],
      hasSaldoAhorro: !!saldoData?.saldoAhorro,
      hasSaldoPrestamo: !!saldoData?.saldoPrestamo,
      status: saldoData?.status
    });

    // Verificar que tengamos datos
    if (!saldoData || typeof saldoData !== 'object') {
      console.log('❌ [formatearSaldo] Sin datos válidos');
      return `No se pudo obtener información de saldo para ${userInfo.nombre || userInfo.usuario}`;
    }

    // Extraer ahorros y préstamos
    const ahorros = saldoData.saldoAhorro?.info || [];
    const prestamos = saldoData.saldoPrestamo?.info || [];
    const hasAhorros = Array.isArray(ahorros) && ahorros.length > 0;
    const hasPrestamos = Array.isArray(prestamos) && prestamos.length > 0;

    console.log('📋 [formatearSaldo] Datos extraídos:', {
      ahorrosCount: ahorros.length,
      prestamosCount: prestamos.length,
      hasAhorros,
      hasPrestamos
    });

    // Si no hay datos de ninguno de los dos
    if (!hasAhorros && !hasPrestamos) {
      return `No se encontraron productos de ahorro ni préstamos asociados al usuario ${userInfo.nombre || userInfo.usuario}. ` +
        'Es posible que:\n' +
        '- El usuario no tenga productos activos\n' +
        '- Los productos no estén asociados correctamente en el sistema\n' +
        '- Se necesite verificar la configuración con el administrador';
    }

    // Construir output con TODA la información disponible
    let output = `Información financiera completa para ${userInfo.nombre || userInfo.usuario}:\n\n`;
    output += '═══════════════════════════════════════════════════════════\n\n';

    // Sección de AHORROS
    if (hasAhorros) {
      output += '📊 PRODUCTOS DE AHORRO:\n';
      output += JSON.stringify(ahorros, null, 2);
      output += '\n\n';
    } else {
      output += '📊 PRODUCTOS DE AHORRO: Sin productos de ahorro\n\n';
    }

    output += '───────────────────────────────────────────────────────────\n\n';

    // Sección de PRÉSTAMOS
    if (hasPrestamos) {
      output += '💳 PRÉSTAMOS:\n';
      output += JSON.stringify(prestamos, null, 2);
      output += '\n\n';
    } else {
      output += '💳 PRÉSTAMOS: Sin préstamos activos\n\n';
    }

    output += '═══════════════════════════════════════════════════════════\n\n';

    // INSTRUCCIONES PARA LA IA
    output += '🤖 INSTRUCCIONES PARA LA IA:\n\n';
    output += '1. **Filtrado por solicitud:**\n';
    output += '   - Si el usuario pregunta por AHORROS específicos (ej: "mi cuenta vista", "saldo fijo 6M"), muestra SOLO esos productos de ahorro.\n';
    output += '   - Si el usuario pregunta por PRÉSTAMOS (ej: "mis préstamos", "cuánto debo"), muestra SOLO préstamos.\n';
    output += '   - Si NO especifica (ej: "mi saldo", "cuánto tengo"), muestra TODO: ahorros Y préstamos.\n\n';

    output += '2. **Estructura de datos:**\n';
    output += '   - AHORROS tienen: Concepto, FechaVencimiento, SaldoTotal, InteresProyectado\n';
    output += '   - PRÉSTAMOS tienen: Concepto, Pago (cuotasPagadas/cuotasTotales), Saldo (monto por pagar)\n\n';

    output += '3. **Presentación:**\n';
    output += '   - Formatea montos en pesos mexicanos: $X,XXX.XX\n';
    output += '   - Agrupa productos similares si hay muchos (ej: varios "AHORRO PLAZO FIJO TIPO 1")\n';
    output += '   - Muestra fechas de vencimiento de manera legible\n';
    output += '   - Para préstamos, explica el progreso (ej: "0 de 48 cuotas pagadas")\n\n';

    output += '4. **Importante:**\n';
    output += '   - Saldos negativos en ahorros pueden indicar ajustes o sobregiros\n';
    output += '   - InteresProyectado NULL significa que no aplica interés para ese producto\n';
    output += '   - Respeta los nombres exactos de productos tal como vienen de la API';

    console.log(`✅ [formatearSaldo] Formateo completado: ${output.length} caracteres`);
    console.log(`📊 [formatearSaldo] Resumen: ${ahorros.length} ahorros, ${prestamos.length} préstamos`);

    return output;
  }

  // ========================================
  // UTILIDADES
  // ========================================

  /**
   * Helper privado para llamadas a la API de Nova
   * Manejo centralizado de errores y timeouts
   * @param {string} url - URL del endpoint
   * @param {Object} body - Cuerpo de la petición
   * @param {string} userToken - Token JWT
   * @param {string} errorContext - Contexto para logging
   * @returns {Promise<Object>} { success, data, error, status }
   */
  async _callNovaAPI(url, body, userToken, errorContext = 'API Nova') {
    try {
      console.log(`🌐 [${errorContext}] Llamando a API Nova...`);

      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
          Accept: 'application/json'
        },
        timeout: 15000
      });

      console.log(`✅ [${errorContext}] API Response: Status ${response.status}`);
      console.log(`📊 [${errorContext}] Response data type: ${typeof response.data}, keys:`,
        response.data && typeof response.data === 'object' ? Object.keys(response.data) : 'N/A');

      return { success: true, data: response.data, status: response.status };
    } catch (error) {
      console.error(`❌ Error en ${errorContext}:`, error.message);

      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, error.response.data);
      }

      if (error.response?.status === 401) {
        return { success: false, error: 'Token expirado. Inicia sesión nuevamente.' };
      }

      return { success: false, error: `Error en ${errorContext}: ${error.message}` };
    }
  }

  /**
   * Extrae NumRI del token JWT
   * @param {string} token - Token JWT (con o sin "Bearer ")
   * @returns {number} NumRI o 7 (default)
   */
  extractNumRIFromToken(token) {
    if (!token) return 7;

    try {
      const payload = JSON.parse(
        Buffer.from(token.replace(/^Bearer\s+/, '').split('.')[1], 'base64').toString()
      );

      const numRI = payload.NumRI || payload.numRI || payload.numri;
      return (numRI && !isNaN(numRI) && numRI > 0) ? parseInt(numRI) : 7;
    } catch {
      return 7; // Default en caso de error
    }
  }

  /**
   * Verifica si el servicio está disponible
   * @returns {boolean}
   */
  isAvailable() {
    return this.available;
  }
}
