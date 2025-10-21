// services/documentService.js - V4.0 CLEAN (VECTORIAL ONLY)
import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import OpenAI from 'openai';
import axios from 'axios';

/**
 * DocumentService - Búsqueda vectorial semántica en Azure Cognitive Search
 *
 * API Pública:
 * - buscarDocumentos(consulta, userId, options) - Búsqueda vectorial con filtro de perfil
 * - isAvailable() - Estado del servicio
 */
export default class DocumentService {
    constructor() {
        if (DocumentService.instance) {
            return DocumentService.instance;
        }

        this.searchAvailable = false;
        this.openaiAvailable = false;
        this.initializationError = null;

        this.initializeServices();
        DocumentService.instance = this;

        console.log(`📄 DocumentService: Search=${this.searchAvailable}, OpenAI=${this.openaiAvailable}`);
    }

    initializeServices() {
        this.initializeAzureSearch();
        this.initializeOpenAI();
    }

    initializeAzureSearch() {
        try {
            const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
            const apiKey = process.env.AZURE_SEARCH_API_KEY;
            const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

            if (!endpoint || !apiKey) {
                throw new Error('AZURE_SEARCH_ENDPOINT y AZURE_SEARCH_API_KEY requeridas');
            }

            this.searchClient = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
            this.indexName = indexName;
            this.vectorField = 'Embedding';
            this.searchAvailable = true;

        } catch (error) {
            console.error('❌ Azure Search:', error.message);
            this.searchAvailable = false;
            this.initializationError = error.message;
        }
    }

    initializeOpenAI() {
        try {
            const endpoint = process.env.OPENAI_ENDPOINT;
            const apiKey = process.env.OPENAI_API_KEY;

            if (!endpoint || !apiKey) {
                console.log('⚠️ OpenAI no configurado - solo búsqueda textual');
                return;
            }

            const embeddingDeployment = 'text-embedding-3-large';
            const baseURL = `${endpoint}/openai/deployments/${embeddingDeployment}`;

            this.openaiClient = new OpenAI({
                apiKey: apiKey,
                baseURL: baseURL,
                defaultQuery: { 'api-version': '2025-01-01-preview' },
                defaultHeaders: { 'api-key': apiKey, 'Content-Type': 'application/json' },
                timeout: 30000
            });

            this.embeddingModel = embeddingDeployment;
            this.openaiAvailable = true;

        } catch (error) {
            console.error('❌ OpenAI embeddings:', error.message);
            this.openaiAvailable = false;
        }
    }

    // ========================================
    // API PÚBLICA
    // ========================================

    /**
     * Busca documentos con filtro opcional de perfil (solo vectorial)
     * @param {string} consulta - Términos de búsqueda
     * @param {string} userId - ID del usuario (para logs)
     * @param {Object} options - { perfil?, userToken?, numSocio? }
     * @returns {Promise<string>} Resultados formateados o error
     */
    async buscarDocumentos(consulta, userId = 'unknown', options = {}) {
        let { perfil = null, userToken = null, numSocio = null } = options;

        // Si NO viene perfil pero SÍ token y numSocio → obtener del API
        if (!perfil && userToken && numSocio) {
            try {
                perfil = await this.obtenerPerfilDesdeAPI(userToken, numSocio);
                console.log(`🔑 [${userId}] Perfil obtenido del API: ${perfil}`);
            } catch (error) {
                console.warn(`⚠️ [${userId}] No se pudo obtener perfil del API: ${error.message}`);
                perfil = '0';  // Default: perfil "0" si no se pudo obtener
                console.log(`🔑 [${userId}] Usando perfil default: ${perfil}`);
            }
        }

        // Si aún no hay perfil (ej: WebChat sin perfil explícito), usar "0"
        if (!perfil) {
            perfil = '0';
            console.log(`🔑 [${userId}] Sin perfil especificado, usando default: ${perfil}`);
        }

        // Validar que la consulta no esté vacía
        const consultaLimpia = (consulta || '').trim();
        if (!consultaLimpia) {
            consulta = 'consultar documentos disponibles';
            console.log(`⚠️ [${userId}] Consulta vacía, usando default: "${consulta}"`);
        }

        console.log(`🔍 [${userId}] "${consulta}" | Perfil: ${perfil}`);

        if (!this.searchAvailable) {
            return `Error: Azure Search no disponible. ${this.initializationError || ''}`;
        }

        if (!this.openaiAvailable) {
            return 'Error: OpenAI no disponible para búsqueda vectorial. Verifica la configuración.';
        }

        try {
            return await this.busquedaVectorial(consulta, userId, perfil);
        } catch (error) {
            console.error(`❌ [${userId}] Error:`, error.message);
            return `Error en búsqueda vectorial: ${error.message}`;
        }
    }

    isAvailable() {
        return this.searchAvailable;
    }

    // ========================================
    // BÚSQUEDA VECTORIAL
    // ========================================

    async busquedaVectorial(consulta, userId, perfil) {
        // Generar embedding de la consulta
        const embedding = await this.createEmbedding(consulta);
        if (!embedding) {
            throw new Error('No se pudo generar embedding de la consulta');
        }

        // Configurar búsqueda vectorial
        const searchOptions = {
            count: true,
            select: ['Chunk', 'archivoid', 'Folder', 'FileName', 'uniqueid', 'Perfil'],
            vectorFilterMode: 'postFilter',
            vectorQueries: [{
                vector: embedding,
                k: 15,
                fields: this.vectorField,
                kind: 'vector',
                exhaustive: true
            }],
            top: 15
        };

        // Aplicar filtro de perfil si se especifica
        if (perfil) {
            searchOptions.filter = `search.in(Perfil, '${perfil}', '|')`;
        }

        // Ejecutar búsqueda
        const searchResults = await this.searchClient.search("*", searchOptions);
        const documentos = await this.procesarResultados(searchResults);

        // Validar resultados
        if (documentos.length === 0) {
            return `No se encontraron documentos relevantes para: "${consulta}"${perfil ? ` (perfil: ${perfil})` : ''}`;
        }

        console.log(`✅ [${userId}] ${documentos.length} docs encontrados`);
        return this.formatearResultados(consulta, documentos, perfil);
    }


    // ========================================
    // PROCESAMIENTO
    // ========================================

    async procesarResultados(searchResults) {
        const documentos = [];

        for await (const result of searchResults.results) {
            const doc = result.document || {};
            const chunk = (doc.Chunk || '').trim();
            const score = result.score || 0;

            // Filtros de calidad
            if (!chunk || chunk.length < 50 || score < 0.3) continue;

            documentos.push({
                fileName: doc.FileName || 'Sin nombre',
                folder: doc.Folder || '',
                perfil: doc.Perfil || '',
                chunk: chunk,
                score: score
            });

            if (documentos.length >= 10) break;
        }

        return documentos;
    }

    formatearResultados(consulta, documentos, perfil) {
        let resultado = `Información sobre: "${consulta}"`;
        if (perfil) resultado += ` (perfil: ${perfil})`;
        resultado += `\n\n`;

        documentos.forEach((doc) => {
            resultado += `${doc.chunk}\n\n---\n\n`;
        });

        resultado += `*${documentos.length} documento(s) encontrado(s)`;
        if (perfil) resultado += ` | Perfil: ${perfil}`;
        resultado += `*`;

        return resultado;
    }

    // ========================================
    // UTILIDADES
    // ========================================

    /**
     * Obtiene el perfil del usuario desde el API de Nova
     * @param {string} userToken - Token JWT del usuario
     * @param {string} numSocio - Número de socio
     * @returns {Promise<string>} Perfil (TipoServicioLimitado como string)
     */
    async obtenerPerfilDesdeAPI(userToken, numSocio) {
        const url = process.env.NOVA_API_URL_TIPO_SERVICIO ||
                    'https://pruebas.nova.com.mx/ApiRestNova/api/TipoServicio/obtTipoServicioPoSocio';

        const body = {
            usuarioActual: { CveUsuario: numSocio },
            data: { NumSocio: numSocio }
        };

        try {
            const response = await axios.post(url, body, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userToken}`
                },
                timeout: 10000
            });

            const tipoServicio = response.data?.info?.[0]?.TipoServicioLimitado;

            if (tipoServicio === undefined || tipoServicio === null) {
                throw new Error('TipoServicioLimitado no encontrado en respuesta');
            }

            // Convertir a string (1 → "1", 2 → "2", etc.)
            return String(tipoServicio);

        } catch (error) {
            console.error(`❌ Error obteniendo perfil del API:`, error.message);
            throw error;
        }
    }

    async createEmbedding(text) {
        if (!this.openaiAvailable || !text) return null;

        try {
            const cleanText = text.trim().substring(0, 8000);
            const result = await this.openaiClient.embeddings.create({
                input: cleanText,
                model: this.embeddingModel
            });
            return result.data[0]?.embedding || null;
        } catch (error) {
            console.error('❌ Embedding:', error.message);
            return null;
        }
    }

    cleanup() {
        console.log('DocumentService limpiado');
    }
}
