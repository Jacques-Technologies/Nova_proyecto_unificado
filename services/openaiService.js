// services/openaiService.js - V3.1 REFACTORIZADO CON TOOLSSERVICE
import 'dotenv/config';
import OpenAI from 'openai';
import { DateTime } from 'luxon';

import CosmosService from './cosmosService.js';
import ToolsService from './toolsService.js';

const cosmosService = new CosmosService();
const toolsService = new ToolsService();

/**
 * AzureOpenAIService - Servicio principal para interacción con GPT-4
 *
 * Responsabilidades:
 * 1. Gestionar cliente OpenAI (chat completions)
 * 2. Gestionar cliente de embeddings (separado)
 * 3. Procesar mensajes con contexto
 * 4. Coordinar ejecución de herramientas vía ToolsService
 *
 * NO maneja:
 * - Definición de tools → ToolsService
 * - Ejecución de tools → ToolsService
 * - Formateo de resultados → ToolsService
 */
export default class AzureOpenAIService {
  constructor() {
    this.initialized = false;
    this.openaiAvailable = false;
    this.embeddingAvailable = false;
    this.embeddingModel = 'text-embedding-3-large';

    // Obtener definiciones de herramientas desde ToolsService
    this.tools = toolsService.getToolDefinitions();

    console.log('🤖 Inicializando Azure OpenAI Service...');
    this.initializeAzureOpenAI();
  }

  initializeAzureOpenAI() {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      const endpoint = process.env.OPENAI_ENDPOINT;
      const deploymentName = 'gpt-4.1-mini';
      const apiVersion = '2025-01-01-preview';

      // Configuración para embedding deployment
      const embeddingDeployment = process.env.EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
      this.embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';

      if (!apiKey || !endpoint) {
        throw new Error('OPENAI_API_KEY y OPENAI_ENDPOINT requeridos');
      }

      // Cliente para completions (chat)
      this.openai = new OpenAI({
        apiKey,
        baseURL: `${endpoint}/openai/deployments/${deploymentName}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        timeout: 45000
      });

      // Cliente separado para embeddings
      this.embeddingClient = new OpenAI({
        apiKey,
        baseURL: `${endpoint}/openai/deployments/${embeddingDeployment}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        timeout: 30000
      });

      this.deploymentName = deploymentName;
      this.embeddingDeployment = embeddingDeployment;
      this.openaiAvailable = true;
      this.embeddingAvailable = true;
      this.initialized = true;

      console.log('✅ Azure OpenAI configurado correctamente');
      console.log(`   • Modelo de chat: ${deploymentName}`);
      console.log(`   • Modelo de embedding: ${embeddingDeployment}`);
      console.log(`   • Herramientas disponibles: ${this.tools.length}`);
    } catch (error) {
      console.error('❌ Error inicializando Azure OpenAI:', error.message);
      this.openaiAvailable = false;
      this.embeddingAvailable = false;
      this.initialized = false;
    }
  }

  // ========================================
  // MÉTODO PRINCIPAL
  // ========================================

  /**
   * Procesa un mensaje del usuario con contexto completo
   * @param {string} mensaje - Mensaje del usuario
   * @param {Array} historial - Historial de mensajes (fallback)
   * @param {string} userToken - Token JWT del usuario
   * @param {Object} userInfo - Información del usuario
   * @param {string} conversationId - ID de conversación (opcional)
   * @param {string} userId - ID del usuario para Cosmos (Teams: "29:xxx", WebChat: token)
   * @returns {Promise<Object>} { type, content, metadata }
   */
  async procesarMensaje(mensaje, historial = [], userToken = null, userInfo = null, conversationId = null, userId = null) {
    try {
      if (!this.openaiAvailable) {
        return {
          type: 'text',
          content: 'Azure OpenAI no está disponible. Verifica la configuración.'
        };
      }

      // userId para logs (fallback si no se proporciona explícitamente)
      const logUserId = userId || userInfo?.usuario || 'unknown';
      console.log(`💬 [${logUserId}] Procesando mensaje: "${mensaje.substring(0, 50)}..."`);

      // Preparar mensajes para OpenAI (pasamos userId explícito para Cosmos)
      const messages = await this.prepararMensajes(mensaje, historial, userInfo, conversationId, userId);

      // Configuración de la petición
      const requestConfig = {
        model: this.deploymentName,
        messages: messages,
        temperature: 1.0,
        max_completion_tokens: 3000,
        tools: this.tools,
        tool_choice: 'auto'
      };

      // Llamada a OpenAI
      const response = await this.openai.chat.completions.create(requestConfig);
      const messageResponse = response.choices?.[0]?.message;

      if (!messageResponse) {
        throw new Error('Respuesta vacía de Azure OpenAI');
      }

      // Si hay tool_calls, procesarlos
      if (messageResponse.tool_calls) {
        return await this.procesarHerramientas(
          messageResponse,
          messages,
          userToken,
          userInfo,
          conversationId
        );
      }

      // Respuesta directa
      return {
        type: 'text',
        content: messageResponse.content || 'Respuesta vacía',
        metadata: {
          usage: response.usage
        }
      };

    } catch (error) {
      console.error(`❌ Error procesando mensaje:`, error);
      return {
        type: 'text',
        content: `Error: ${error.message}`
      };
    }
  }

  // ========================================
  // PREPARACIÓN DE MENSAJES
  // ========================================

  /**
   * Prepara array de mensajes para OpenAI con contexto completo
   * @param {string} mensaje - Mensaje actual
   * @param {Array} historial - Historial tradicional
   * @param {Object} userInfo - Info del usuario
   * @param {string} conversationId - ID de conversación
   * @param {string} userId - ID del usuario para Cosmos (Teams: "29:xxx", WebChat: token)
   * @returns {Promise<Array>} Mensajes en formato OpenAI
   */
  async prepararMensajes(mensaje, historial, userInfo, conversationId, userId) {
    let messages = [];

    // System message con contexto actual
    const fechaActual = DateTime.now().setZone('America/Mexico_City');
    const userContext = userInfo?.nombre
      ? `Usuario: ${userInfo.nombre} (${userInfo.usuario})`
      : 'Usuario no identificado';

    const systemContent = `Tu nombre es Nova-AI, y eres un Asistente virtual inteligente para la institución financiera Nova.

CONTEXTO:
• ${userContext}
• Fecha/Hora: ${fechaActual.toFormat('dd/MM/yyyy HH:mm:ss')} (${fechaActual.zoneName})

Responde únicamente en español. Si te dan las gracias, responde que es un gusto ayudar y si hay algo más en lo que puedas asistirlos. Utiliza el historial de la conversación como referencia. Utiliza sólo la información de referencia brindada. No respondas nada fuera de los documentos de referencia. No respondas preguntas que no sean de Nova y sus servicios financieros. Si no conoces la respuesta menciona que no cuentas con esa información. Utiliza de manera preferente la información de referencia con más exactitud y apego a la pregunta. Responde de manera muy concreta y puntual, busca hacer listados y presentar la información de una manera útil y accesible.
Utiliza únicamente esta información de referencia para contestar las preguntas del usuario. Se concreto en tus respuestas y amable, busca contestar en pocas palabras. Cada extracto es independiente del anterior y no tienen relación.

INSTRUCCIONES:
• Sé profesional, preciso y útil
• Para información de referencia de todo tipo, usa la herramienta buscar_documentos_nova
• Para consultas de saldo, usa consultar_saldo_usuario
• Para tasas de interés, usa consultar_tasas_interes
• Si no tienes información específica, indícalo claramente
• NO inventes información que no esté en los documentos
• Siempre que sean consultas de información usa la herramienta de buscar_documentos_nova

IMPORTANTE - CLARIFICACIÓN DE INTENCIONES:
• Si el usuario escribe palabras técnicas sueltas SIN contexto claro, NO asumas su intención
• Palabras técnicas ambiguas: "tasas", "saldo", "documentos", "información", "cuenta", "interés"
• EXCEPCIÓN: Saludos y cortesía son naturales: "hola", "gracias", "ok", "adiós", "buenos días" → responde normalmente
• Cuando detectes ambigüedad TÉCNICA, pregunta para clarificar:
  - Ejemplo: Usuario dice "tasas" → Pregunta: "¿Te refieres a las tasas de interés? ¿De qué año te gustaría consultarlas?"
  - Ejemplo: Usuario dice "saldo" → Pregunta: "¿Quieres consultar tu saldo actual de cuentas?"
  - Ejemplo: Usuario dice "documentos" → Pregunta: "¿Qué tipo de documentos buscas? ¿Sobre qué tema específico?"
• Solo ejecuta herramientas cuando la intención sea CLARA:
  - Claro ✅: "consulta mi saldo", "tasas del 2025", "busca documentos sobre préstamos"
  - Ambiguo ❌: "saldo", "tasas", "documentos"

IMPORTANTE - SIMULACIONES:
• NUNCA realices cálculos ni simulaciones de inversión, ahorro o rendimientos
• Si el usuario pide una simulación o cálculo de rendimientos, usa SIEMPRE la herramienta simulador_ahorros
• NO intentes hacer matemáticas ni proyecciones financieras por tu cuenta
• Redirige al usuario al simulador oficial del portal web de Nova`;

    messages.push({ role: 'system', content: systemContent });

    // ✅ V3: Historial de Cosmos DB usando user_id explícito
    // Para Teams: userId = "29:xxx..." (Teams ID)
    // Para WebChat: userId = token JWT completo
    if (cosmosService?.isAvailable?.() && userId) {
      try {
        const mensajesCosmos = await cosmosService.getLastMessages(userId, 10);

        if (mensajesCosmos && mensajesCosmos.length > 0) {
          // Convertir a formato OpenAI
          const mensajesFormato = mensajesCosmos.map(msg => ({
            role: msg.role,
            content: msg.content
          }));
          messages.push(...mensajesFormato);
          console.log(`📚 Historial Cosmos cargado: ${mensajesFormato.length} mensajes (user_id: ${userId.substring(0,8)}...)`);
        }
      } catch (error) {
        console.warn(`⚠️ Error obteniendo historial Cosmos: ${error.message}`);
      }
    }

    // Historial tradicional como fallback
    if (Array.isArray(historial) && historial.length > 0) {
      const recentHistory = historial.slice(-10);
      recentHistory.forEach(item => {
        if (item?.content?.trim() && item.role) {
          messages.push({
            role: item.role,
            content: item.content.trim()
          });
        }
      });
    }

    // Mensaje actual del usuario
    messages.push({
      role: 'user',
      content: mensaje.trim()
    });

    return messages;
  }

  // ========================================
  // PROCESAMIENTO DE HERRAMIENTAS
  // ========================================

  /**
   * Procesa tool_calls ejecutando herramientas y obteniendo respuesta final
   * @param {Object} messageResponse - Mensaje con tool_calls de OpenAI
   * @param {Array} mensajesPrevios - Mensajes previos del contexto
   * @param {string} userToken - Token JWT
   * @param {Object} userInfo - Info del usuario
   * @param {string} conversationId - ID de conversación
   * @returns {Promise<Object>} Respuesta final formateada
   */
  async procesarHerramientas(messageResponse, mensajesPrevios, userToken, userInfo, conversationId) {
    const userId = userInfo?.usuario || 'unknown';
    const resultados = [];

    console.log(`🔧 [${userId}] Procesando ${messageResponse.tool_calls.length} herramienta(s)`);

    // Ejecutar cada tool call usando ToolsService
    for (const call of messageResponse.tool_calls) {
      const { function: fnCall, id } = call;
      const { name, arguments: args } = fnCall;

      try {
        console.log(`   ⚙️ [${userId}] Ejecutando: ${name}`);
        const parametros = JSON.parse(args || '{}');

        // ✅ Delegar ejecución a ToolsService
        const resultado = await toolsService.executeTool(
          name,
          parametros,
          {
            userToken,
            userInfo
          }
        );

        const resultadoString = typeof resultado === 'object' ? JSON.stringify(resultado, null, 2) : String(resultado);

        resultados.push({
          tool_call_id: id,
          content: resultadoString
        });

        console.log(`   ✅ [${userId}] ${name} ejecutado exitosamente`);
        console.log(`   📤 [${userId}] Resultado enviado a OpenAI (${resultadoString.length} chars):`, resultadoString.substring(0, 300));

      } catch (error) {
        console.error(`   ❌ [${userId}] Error ejecutando ${name}:`, error.message);
        resultados.push({
          tool_call_id: id,
          content: `Error ejecutando ${name}: ${error.message}`
        });
      }
    }

    // Construir mensajes finales para OpenAI
    const finalMessages = [
      ...mensajesPrevios,
      messageResponse,
      ...resultados.map(r => ({
        role: 'tool',
        tool_call_id: r.tool_call_id,
        content: r.content
      }))
    ];

    // Llamada final a OpenAI para generar respuesta
    const finalResponse = await this.openai.chat.completions.create({
      model: this.deploymentName,
      messages: finalMessages,
      temperature: 1.0,
      max_completion_tokens: 3500
    });

    const finalContent = finalResponse.choices?.[0]?.message?.content || 'No se pudo generar respuesta final';
    console.log(`🤖 [${userId}] Respuesta final de OpenAI (${finalContent.length} chars):`, finalContent.substring(0, 200));

    return {
      type: 'text',
      content: finalContent,
      metadata: {
        toolsUsed: messageResponse.tool_calls.map(tc => tc.function.name),
        usage: finalResponse.usage
      }
    };
  }

  // ========================================
  // INFORMACIÓN DEL SERVICIO
  // ========================================

  /**
   * Verifica si el servicio está disponible
   * @returns {boolean}
   */
  isAvailable() {
    return this.openaiAvailable && this.initialized;
  }
}
