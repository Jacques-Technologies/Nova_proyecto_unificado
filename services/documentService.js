// services/documentService.js - VERSIÓN CON FILTRO DE PERFIL PARA WEB
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
                defaultQuery: { 'api-version': '2025-01-01-preview' },
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

    // MÉTODO PRINCIPAL - AHORA ACEPTA PERFIL
    async buscarDocumentos(consulta, userId = 'unknown', options = {}) {
        const { perfil = null } = options;
        console.log(`[${userId}] Buscando: "${consulta}", Perfil: ${perfil || 'sin filtro'}`);
        
        if (!this.searchAvailable) {
            return `Error: Servicio de búsqueda no disponible. ${this.initializationError || ''}`;
        }

        try {
            // Primero intentar búsqueda vectorial si OpenAI está disponible
            if (this.openaiAvailable) {
                const resultadoVectorial = await this.busquedaVectorial(consulta, userId, { perfil, ...options });
                if (resultadoVectorial && resultadoVectorial.length > 100) {
                    return resultadoVectorial;
                }
            }

            // Fallback a búsqueda textual con filtro de perfil
            return await this.busquedaTextual(consulta, userId, { perfil, ...options });

        } catch (error) {
            console.error(`[${userId}] Error en búsqueda:`, error.message);
            return `Error en búsqueda de documentos: ${error.message}`;
        }
    }

    // BÚSQUEDA VECTORIAL CON FILTRO DE PERFIL
    async busquedaVectorial(consulta, userId, options) {
        try {
            const { perfil } = options;
            console.log(`[${userId}] Ejecutando búsqueda vectorial con perfil: ${perfil || 'sin filtro'}...`);
            
            // Generar embedding
            const embedding = await this.createEmbedding(consulta);
            if (!embedding) {
                console.log(`[${userId}] No se pudo generar embedding`);
                return null;
            }

            // Construir configuración de búsqueda según la especificación
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

            // Agregar filtro de perfil si se especifica
            if (perfil) {
                searchOptions.filter = `search.in(Perfil, '${perfil}', '|')`;
                console.log(`[${userId}] Aplicando filtro de perfil: ${searchOptions.filter}`);
            }

            // Buscar en Azure Search
            const searchResults = await this.searchClient.search("*", searchOptions);

            // Procesar resultados
            const documentos = [];
            let totalCount = 0;

            for await (const result of searchResults.results) {
                totalCount++;
                const doc = result.document || {};
                const score = result.score || 0;
                const chunk = (doc.Chunk || '').trim();
                
                // Filtros básicos de calidad
                if (!chunk || chunk.length < 50 || score < 0.3) {
                    console.log(`[${userId}] Documento filtrado por calidad - Score: ${score}, Length: ${chunk.length}`);
                    continue;
                }
                
                documentos.push({
                    fileName: doc.FileName || 'Sin nombre',
                    folder: doc.Folder || '',
                    archivoid: doc.archivoid || '',
                    uniqueid: doc.uniqueid || '',
                    perfil: doc.Perfil || '',
                    chunk: chunk,
                    score: score
                });
                
                if (documentos.length >= 10) break;
            }

            console.log(`[${userId}] Búsqueda vectorial completada - Total encontrados: ${totalCount}, Válidos: ${documentos.length}`);

            if (documentos.length === 0) {
                console.log(`[${userId}] Sin resultados válidos en búsqueda vectorial`);
                return null;
            }

            return this.formatearResultados(consulta, documentos, 'vectorial', perfil);

        } catch (error) {
            console.error(`[${userId}] Error en búsqueda vectorial:`, error.message);
            return null;
        }
    }

    // BÚSQUEDA TEXTUAL CON FILTRO DE PERFIL
    async busquedaTextual(consulta, userId, options) {
        try {
            const { perfil } = options;
            console.log(`[${userId}] Ejecutando búsqueda textual con perfil: ${perfil || 'sin filtro'}...`);
            
            const queryLimpia = this.limpiarQuery(consulta);
            
            const searchOptions = {
                select: ['Chunk', 'archivoid', 'Folder', 'FileName', 'uniqueid', 'Perfil'],
                top: 15,
                searchMode: 'all',
                queryType: 'full',
                searchFields: ['Chunk', 'FileName', 'Folder'],
                count: true
            };

            // Agregar filtro de perfil si se especifica
            if (perfil) {
                searchOptions.filter = `search.in(Perfil, '${perfil}', '|')`;
                console.log(`[${userId}] Aplicando filtro textual de perfil: ${searchOptions.filter}`);
            }

            const searchResults = await this.searchClient.search(queryLimpia, searchOptions);

            const documentos = [];
            let totalCount = 0;

            for await (const result of searchResults.results) {
                totalCount++;
                const doc = result.document || {};
                const chunk = (doc.Chunk || '').trim();
                
                // Filtros básicos
                if (!chunk || chunk.length < 50) {
                    console.log(`[${userId}] Documento filtrado en búsqueda textual - Length: ${chunk.length}`);
                    continue;
                }
                
                documentos.push({
                    fileName: doc.FileName || 'Sin nombre',
                    folder: doc.Folder || '',
                    archivoid: doc.archivoid || '',
                    uniqueid: doc.uniqueid || '',
                    perfil: doc.Perfil || '',
                    chunk: chunk,
                    score: result.score || 0
                });
                
                if (documentos.length >= 10) break;
            }

            console.log(`[${userId}] Búsqueda textual completada - Total encontrados: ${totalCount}, Válidos: ${documentos.length}`);

            if (documentos.length === 0) {
                return `No se encontraron documentos relevantes para: "${consulta}"${perfil ? ` (perfil: ${perfil})` : ''}`;
            }

            return this.formatearResultados(consulta, documentos, 'textual', perfil);

        } catch (error) {
            console.error(`[${userId}] Error en búsqueda textual:`, error.message);
            throw error;
        }
    }

    // FORMATEAR RESULTADOS CON INFORMACIÓN DE PERFIL
    formatearResultados(consulta, documentos, tipoBusqueda, perfil = null) {
        let resultado = `Información encontrada sobre: "${consulta}"`;
        if (perfil) {
            resultado += ` (perfil: ${perfil})`;
        }
        resultado += `\n\n`;
        
        // Mostrar solo el contenido real de los documentos encontrados
        documentos.forEach((doc, index) => {
            resultado += `**Documento ${index + 1}: ${doc.fileName}**\n`;
            if (doc.folder) resultado += `*Carpeta: ${doc.folder}*\n`;
            if (doc.perfil) resultado += `*Perfil: ${doc.perfil}*\n`;
            resultado += `${doc.chunk}\n\n`;
            resultado += `---\n\n`;
        });

        // Información de la búsqueda al final
        resultado += `*Fuentes: ${documentos.length} documento(s) encontrado(s)*\n`;
        resultado += `*Tipo de búsqueda: ${tipoBusqueda}*`;
        if (perfil) {
            resultado += `\n*Filtrado por perfil: ${perfil}*`;
        }
        
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
            error: this.initializationError,
            supportsProfileFilter: true
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

    // MÉTODO DE PRUEBA PARA FILTROS DE PERFIL
    async testProfileFilter(perfil) {
        if (!this.searchAvailable) {
            return { success: false, error: 'Servicio no disponible' };
        }

        try {
            console.log(`Probando filtro de perfil: ${perfil}`);
            
            const searchOptions = {
                select: ['FileName', 'Perfil'],
                filter: `search.in(Perfil, '${perfil}', '|')`,
                top: 5,
                count: true
            };

            const results = await this.searchClient.search("*", searchOptions);
            
            const documentos = [];
            let totalCount = 0;

            for await (const result of results.results) {
                totalCount++;
                documentos.push({
                    fileName: result.document.FileName,
                    perfil: result.document.Perfil
                });
            }

            return {
                success: true,
                totalCount,
                documentos,
                filter: searchOptions.filter
            };

        } catch (error) {
            console.error('Error probando filtro de perfil:', error.message);
            return { success: false, error: error.message };
        }
    }

    cleanup() {
        console.log('Document Service limpiado');
    }
}