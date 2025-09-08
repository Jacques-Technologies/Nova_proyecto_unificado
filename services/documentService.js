// services/documentService.js - VERSIÓN SIMPLIFICADA Y FUNCIONAL
import 'dotenv/config';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import OpenAI from 'openai';

export default class DocumentService {
    constructor() {
        if (DocumentService.instance) {
            return DocumentService.instance;
        }
        
        this.searchAvailable = false;
        this.openaiAvailable = false;
        this.initializationError = null;
        
        console.log('Inicializando Document Service...');
        this.initializeAzureSearch();
        this.initializeOpenAI();
        
        DocumentService.instance = this;
        console.log(`Document Service - Search: ${this.searchAvailable}, OpenAI: ${this.openaiAvailable}`);
    }

    initializeAzureSearch() {
        try {
            const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
            const apiKey = process.env.AZURE_SEARCH_API_KEY;
            const indexName = process.env.AZURE_SEARCH_INDEX_NAME

            if (!endpoint || !apiKey) {
                throw new Error('Variables AZURE_SEARCH_ENDPOINT y AZURE_SEARCH_API_KEY requeridas');
            }

            this.searchClient = new SearchClient(
                endpoint,
                indexName,
                new AzureKeyCredential(apiKey)
            );
            
            this.indexName = indexName;
            this.vectorField = 'Embedding';
            this.searchAvailable = true;
            
            console.log('Azure Search configurado correctamente');
            
        } catch (error) {
            console.error('Error inicializando Azure Search:', error.message);
            this.searchAvailable = false;
            this.initializationError = error.message;
        }
    }

    initializeOpenAI() {
        try {
            const endpoint = process.env.OPENAI_ENDPOINT;
            const apiKey = process.env.OPENAI_API_KEY;
            
            if (!endpoint || !apiKey) {
                console.log('OpenAI no configurado - usando solo búsqueda textual');
                return;
            }

            const embeddingDeployment = 'text-embedding-3-large';
            const baseURL = `${endpoint}/openai/deployments/${embeddingDeployment}`;
            
            this.openaiClient = new OpenAI({
                apiKey: apiKey,
                baseURL: baseURL,
                defaultQuery: { 'api-version': '2024-02-15-preview' },
                defaultHeaders: {
                    'api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            this.embeddingModel = embeddingDeployment;
            this.openaiAvailable = true;
            
            console.log('Azure OpenAI para embeddings configurado');

        } catch (error) {
            console.error('Error inicializando Azure OpenAI:', error.message);
            this.openaiAvailable = false;
        }
    }

    // MÉTODO PRINCIPAL - SOLO BUSCAR Y DEVOLVER CONTENIDO REAL
    async buscarDocumentos(consulta, userId = 'unknown', options = {}) {
        console.log(`[${userId}] Buscando: "${consulta}"`);
        
        if (!this.searchAvailable) {
            return `Error: Servicio de búsqueda no disponible. ${this.initializationError || ''}`;
        }

        try {
            // Primero intentar búsqueda vectorial si OpenAI está disponible
            if (this.openaiAvailable) {
                const resultadoVectorial = await this.busquedaVectorial(consulta, userId, options);
                if (resultadoVectorial && resultadoVectorial.length > 100) {
                    return resultadoVectorial;
                }
            }

            // Fallback a búsqueda textual
            return await this.busquedaTextual(consulta, userId, options);

        } catch (error) {
            console.error(`[${userId}] Error en búsqueda:`, error.message);
            return `Error en búsqueda de documentos: ${error.message}`;
        }
    }

    // BÚSQUEDA VECTORIAL
    async busquedaVectorial(consulta, userId, options) {
        try {
            console.log(`[${userId}] Ejecutando búsqueda vectorial...`);
            
            // Generar embedding
            const embedding = await this.createEmbedding(consulta);
            if (!embedding) {
                console.log(`[${userId}] No se pudo generar embedding`);
                return null;
            }

            // Buscar en Azure Search
            const searchResults = await this.searchClient.search("*", {
                vectorQueries: [{
                    kNearestNeighborsCount: 10,
                    fields: this.vectorField,
                    vector: embedding
                }],
                select: ['Chunk', 'FileName', 'Folder'],
                top: 10
            });

            // Procesar resultados
            const documentos = [];
            for await (const result of searchResults.results) {
                const doc = result.document || {};
                const score = result.score || 0;
                const chunk = (doc.Chunk || '').trim();
                
                // Filtros básicos
                if (!chunk || chunk.length < 50 || score < 0.3) continue;
                
                documentos.push({
                    fileName: doc.FileName || 'Sin nombre',
                    folder: doc.Folder || '',
                    chunk: chunk,
                    score: score
                });
                
                if (documentos.length >= 5) break;
            }

            if (documentos.length === 0) {
                console.log(`[${userId}] Sin resultados en búsqueda vectorial`);
                return null;
            }

            return this.formatearResultados(consulta, documentos, 'vectorial');

        } catch (error) {
            console.error(`[${userId}] Error en búsqueda vectorial:`, error.message);
            return null;
        }
    }

    // BÚSQUEDA TEXTUAL
    async busquedaTextual(consulta, userId, options) {
        try {
            console.log(`[${userId}] Ejecutando búsqueda textual...`);
            
            const queryLimpia = this.limpiarQuery(consulta);
            
            const searchResults = await this.searchClient.search(queryLimpia, {
                select: ['Chunk', 'FileName', 'Folder'],
                top: 10,
                searchMode: 'all',
                queryType: 'full',
                searchFields: ['Chunk', 'FileName', 'Folder']
            });

            const documentos = [];
            for await (const result of searchResults.results) {
                const doc = result.document || {};
                const chunk = (doc.Chunk || '').trim();
                
                // Filtros básicos
                if (!chunk || chunk.length < 50) continue;
                
                documentos.push({
                    fileName: doc.FileName || 'Sin nombre',
                    folder: doc.Folder || '',
                    chunk: chunk,
                    score: result.score || 0
                });
                
                if (documentos.length >= 5) break;
            }

            if (documentos.length === 0) {
                return `No se encontraron documentos relevantes para: "${consulta}"`;
            }

            return this.formatearResultados(consulta, documentos, 'textual');

        } catch (error) {
            console.error(`[${userId}] Error en búsqueda textual:`, error.message);
            throw error;
        }
    }

    // FORMATEAR RESULTADOS - SOLO MOSTRAR CONTENIDO REAL DE LOS ARCHIVOS
    formatearResultados(consulta, documentos, tipoBusqueda) {
        let resultado = `Información encontrada sobre: "${consulta}"\n\n`;
        
        // Mostrar solo el contenido real de los documentos encontrados
        documentos.forEach((doc, index) => {
            resultado += `**Documento ${index + 1}: ${doc.fileName}**\n`;
            resultado += `${doc.chunk}\n\n`;
            resultado += `---\n\n`;
        });

        // Información de la búsqueda al final
        resultado += `*Fuentes: ${documentos.length} documento(s) encontrado(s)*\n`;
        resultado += `*Tipo de búsqueda: ${tipoBusqueda}*`;
        
        return resultado;
    }

    // CREAR EMBEDDING
    async createEmbedding(text) {
        if (!this.openaiAvailable || !text) {
            return null;
        }

        try {
            const cleanText = text.trim().substring(0, 8000);
            
            const result = await this.openaiClient.embeddings.create({
                input: cleanText,
                model: this.embeddingModel
            });
            
            return result.data[0]?.embedding || null;
                
        } catch (error) {
            console.error('Error creando embedding:', error.message);
            return null;
        }
    }

    // LIMPIAR QUERY
    limpiarQuery(query) {
        if (!query || typeof query !== 'string') {
            return '*';
        }

        let sanitized = query
            .replace(/[+\-&|!(){}[\]^"~*?:\\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!sanitized) return '*';

        const words = sanitized.split(' ').filter(word => word.length > 1);
        return words.length > 0 ? words.join(' ') : '*';
    }

    // MÉTODOS DE ESTADO Y UTILIDADES

    getConfigInfo() {
        return {
            searchAvailable: this.searchAvailable,
            openaiAvailable: this.openaiAvailable,
            indexName: this.indexName || 'No configurado',
            vectorField: this.vectorField || 'No configurado',
            embeddingModel: this.embeddingModel || 'No configurado',
            error: this.initializationError
        };
    }

    isAvailable() {
        return this.searchAvailable;
    }

    async testConnection() {
        if (!this.searchAvailable) {
            return false;
        }

        try {
            const results = await this.searchClient.search("test", {
                top: 1,
                select: ['FileName']
            });

            // Verificar si hay al menos un resultado
            for await (const result of results.results) {
                return true;
            }
            
            return true; // Conexión OK aunque no haya datos

        } catch (error) {
            console.error('Error en test de conexión:', error.message);
            return false;
        }
    }

    async testEmbeddingConnection() {
        if (!this.openaiAvailable) {
            return false;
        }

        try {
            const testEmbedding = await this.createEmbedding("test");
            return Array.isArray(testEmbedding) && testEmbedding.length > 1000;
        } catch (error) {
            console.error('Error en test de embeddings:', error.message);
            return false;
        }
    }

    cleanup() {
        console.log('Document Service limpiado');
    }
}

// Crear instancia singleton
const documentService = new DocumentService();
module.exports = documentService;