// ==========================================
// METRICS SERVICE v1.0
// ==========================================
// Servicio para envío de métricas de uso a Bubble.io
// Trackea: canal, herramientas usadas, documentos consultados

import axios from 'axios';

/**
 * MetricsService - Envía métricas de uso del bot a Bubble.io
 *
 * Métricas enviadas:
 * - canal: "Teams" | "WebChat"
 * - consulta_documento: true | false
 * - consulta_saldo: true | false
 * - consulta_tasas: true | false
 * - documentos: ["título1", "título2"] (opcional)
 */
export default class MetricsService {
  constructor() {
    this.bubbleUrl = process.env.BUBBLE_METRICS_URL;
    this.bubbleApiKey = process.env.BUBBLE_API_KEY;
    this.enabled = !!(this.bubbleUrl && this.bubbleApiKey);

    if (this.enabled) {
      console.log('📊 MetricsService: Habilitado');
    } else {
      console.log('⚠️ MetricsService: Deshabilitado (falta configuración)');
    }
  }

  /**
   * Detecta el canal de origen basado en el formato del userId
   * @param {string} userId - ID del usuario (Teams: "29:xxx", WebChat: JWT)
   * @returns {string} "Teams" | "WebChat" | "Unknown"
   */
  detectChannel(userId) {
    if (!userId) return 'Unknown';

    // Teams userId comienza con "29:"
    if (userId.startsWith('29:')) {
      return 'Teams';
    }

    // WebChat usa JWT (contiene puntos)
    if (userId.includes('.')) {
      return 'WebChat';
    }

    return 'Unknown';
  }

  /**
   * Envía métrica a Bubble.io
   * @param {Object} data - Datos de la métrica
   * @param {string} data.canal - "Teams" | "WebChat"
   * @param {boolean} data.consulta_documento - Si se consultaron documentos
   * @param {boolean} data.consulta_saldo - Si se consultó saldo
   * @param {boolean} data.consulta_tasas - Si se consultaron tasas
   * @param {string[]} [data.documentos] - Array de títulos (opcional)
   */
  async enviarMetrica(data) {
    // Si está deshabilitado, no hacer nada
    if (!this.enabled) {
      return;
    }

    try {
      // Validar estructura de datos (nombres exactos de Bubble.io)
      const payload = {
        canal: data.canal || 'Unknown',
        'consulta documento?': data.consulta_documento || false,
        'consulta saldo?': data.consulta_saldo || false,
        'consulta tasas?': data.consulta_tasas || false
      };

      // Agregar documentos solo si existen y no está vacío
      if (data.documentos && Array.isArray(data.documentos) && data.documentos.length > 0) {
        payload.documentos = data.documentos;
      }

      // Enviar a Bubble.io
      await axios.post(this.bubbleUrl, payload, {
        headers: {
          'Authorization': `Bearer ${this.bubbleApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5 segundos
      });

      console.log(`📊 Métrica enviada a Bubble.io: ${data.canal}`);

    } catch (error) {
      // Solo warning, no afectar el flujo del bot
      console.warn(`⚠️ Error enviando métrica a Bubble.io:`, error.message);
    }
  }

  /**
   * Extrae títulos de documentos desde el resultado formateado de búsqueda
   * @param {string} resultadoFormateado - String con resultados de búsqueda
   * @returns {string[]} Array de títulos
   */
  extraerTitulosDocumentos(resultadoFormateado) {
    if (!resultadoFormateado || typeof resultadoFormateado !== 'string') {
      return [];
    }

    const titulos = [];

    // El formato de Azure Search es: "Nombre del documento: TÍTULO\n..."
    const regex = /Nombre del documento:\s*(.+?)(?:\n|$)/g;
    let match;

    while ((match = regex.exec(resultadoFormateado)) !== null) {
      const titulo = match[1].trim();
      if (titulo && !titulos.includes(titulo)) {
        titulos.push(titulo);
      }
    }

    return titulos;
  }

  /**
   * Crea objeto de métrica desde tool calls de OpenAI
   * @param {string} userId - ID del usuario
   * @param {Array} toolCalls - Array de tool_calls de OpenAI
   * @param {Object} toolResults - Resultados de ejecución de herramientas
   * @returns {Object} Objeto de métrica listo para enviar
   */
  crearMetricaDesdeToolCalls(userId, toolCalls = [], toolResults = {}) {
    const metrica = {
      canal: this.detectChannel(userId),
      consulta_documento: false,
      consulta_saldo: false,
      consulta_tasas: false
    };

    // Analizar cada tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name || toolCall.name;

      switch (toolName) {
        case 'buscar_documentos_nova':
        case 'consultar_procedimientos':
          metrica.consulta_documento = true;
          // Extraer títulos si hay resultado
          if (toolResults[toolCall.id]) {
            const titulos = this.extraerTitulosDocumentos(toolResults[toolCall.id]);
            if (titulos.length > 0) {
              metrica.documentos = titulos;
            }
          }
          break;

        case 'consultar_saldo_usuario':
          metrica.consulta_saldo = true;
          break;

        case 'consultar_tasas_interes':
          metrica.consulta_tasas = true;
          break;

        // Ignorar otras herramientas
        default:
          break;
      }
    }

    return metrica;
  }

  /**
   * Verifica si el servicio está disponible
   * @returns {boolean}
   */
  isAvailable() {
    return this.enabled;
  }

  /**
   * Obtiene estadísticas del servicio
   * @returns {Object}
   */
  getStats() {
    return {
      enabled: this.enabled,
      url: this.bubbleUrl ? '***configured***' : 'not configured',
      apiKey: this.bubbleApiKey ? '***configured***' : 'not configured'
    };
  }
}
