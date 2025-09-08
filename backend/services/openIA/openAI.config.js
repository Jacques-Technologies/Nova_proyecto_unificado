import OpenAI from "openai";
import { config } from "../../controllers/config/config.js";

/**
 * Cliente de Azure OpenAI usando el SDK oficial de OpenAI con soporte Azure
 */
export const openAIClient = new OpenAI({
  apiKey: config.AZURE_OPENAI_API_KEY,
  baseURL: `${config.AZURE_OPENAI_ENDPOINT}/openai/deployments/text-embedding-3-large`,
  defaultQuery: { 'api-version': '2024-12-01-preview' },
  defaultHeaders: {
    'api-key': config.AZURE_OPENAI_API_KEY,
  },
});

/**
 * Obtiene embeddings para un arreglo de textos usando Azure OpenAI.
 * ⚠️  DEPRECATED: Usa getEmbeddingsBatch() para mejor rendimiento
 * @param {string[]} inputs
 * @returns {Promise<number[][]>}
 */
export async function getEmbeddings(inputs) {
  console.warn('⚠️  getEmbeddings() está deprecated. Usa getEmbeddingsBatch() para mejor rendimiento.');
  
  try {
    const embeddings = [];
    
    for (const text of inputs) {
      const response = await openAIClient.embeddings.create({
        model: config.AZURE_OPENAI_DEPLOYMENT,
        input: text
      });
      
      embeddings.push(response.data[0].embedding);
    }
    
    return embeddings;
  } catch (error) {
    console.error('Error al obtener embeddings:', error);
    throw error;
  }
}

/**
 * Versión optimizada que procesa todos los inputs en una sola llamada o en batches inteligentes
 * @param {string[]} inputs - Array de textos para convertir a embeddings
 * @param {number} [maxBatchSize=50] - Máximo número de textos por batch
 * @returns {Promise<number[][]>} - Array de embeddings
 */
export async function getEmbeddingsBatch(inputs, maxBatchSize = 50) {
  if (!inputs || inputs.length === 0) {
    return [];
  }

  try {
    const allEmbeddings = [];
    
    // Si hay pocos inputs, procesarlos todos de una vez
    if (inputs.length <= maxBatchSize) {
      const response = await openAIClient.embeddings.create({
        model: config.AZURE_OPENAI_DEPLOYMENT,
        input: inputs,
        dimensions: 1024 // Forzar 1024 dimensiones si es compatible
      });
      
      return response.data.map(item => {
        let embedding = item.embedding;
        
        // Asegurar que cada embedding tenga exactamente 1024 dimensiones
        if (embedding.length !== 1024) {
          embedding = adjustEmbeddingDimensions(embedding, 1024);
        }
        
        return embedding;
      });
    }
    
    // Para datasets grandes, procesar en batches paralelos con límite de concurrencia
    console.log(`Procesando ${inputs.length} textos en batches de ${maxBatchSize}`);
    
    const batches = [];
    for (let i = 0; i < inputs.length; i += maxBatchSize) {
      batches.push(inputs.slice(i, i + maxBatchSize));
    }
    
    // Procesar batches con límite de concurrencia
    const concurrencyLimit = 3; // Máximo 3 batches paralelos
    const results = [];
    
    for (let i = 0; i < batches.length; i += concurrencyLimit) {
      const batchGroup = batches.slice(i, i + concurrencyLimit);
      
      const batchPromises = batchGroup.map(async (batch, batchIndex) => {
        const globalBatchIndex = i + batchIndex;
        console.log(`Procesando batch ${globalBatchIndex + 1}/${batches.length} (${batch.length} textos)`);
        
        try {
          const response = await openAIClient.embeddings.create({
            model: config.AZURE_OPENAI_DEPLOYMENT,
            input: batch,
            dimensions: 1024
          });
          
          return {
            batchIndex: globalBatchIndex,
            embeddings: response.data.map(item => {
              let embedding = item.embedding;
              if (embedding.length !== 1024) {
                embedding = adjustEmbeddingDimensions(embedding, 1024);
              }
              return embedding;
            })
          };
        } catch (error) {
          console.error(`Error en batch ${globalBatchIndex + 1}:`, error);
          throw new Error(`Error en batch ${globalBatchIndex + 1}: ${error.message}`);
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    // Ordenar resultados por batchIndex y combinar
    results.sort((a, b) => a.batchIndex - b.batchIndex);
    for (const result of results) {
      allEmbeddings.push(...result.embeddings);
    }
    
    console.log(`✅ Completados ${allEmbeddings.length} embeddings`);
    return allEmbeddings;
    
  } catch (error) {
    console.error('Error al obtener embeddings en lote:', error);
    throw error;
  }
}

/**
 * Versión alternativa con retry automático para casos de fallo
 * @param {string[]} inputs 
 * @param {number} maxRetries 
 * @returns {Promise<number[][]>}
 */
export async function getEmbeddingsBatchWithRetry(inputs, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Intento ${attempt}/${maxRetries} para obtener embeddings`);
      return await getEmbeddingsBatch(inputs);
    } catch (error) {
      lastError = error;
      console.warn(`Intento ${attempt} falló:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Backoff exponencial
        console.log(`Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Ajusta las dimensiones de un embedding al tamaño requerido
 * @param {number[]} embedding - El embedding original
 * @param {number} targetDimensions - El número de dimensiones objetivo
 * @returns {number[]} - El embedding ajustado
 */
function adjustEmbeddingDimensions(embedding, targetDimensions) {
  if (embedding.length === targetDimensions) {
    return embedding;
  }
  
  if (embedding.length > targetDimensions) {
    // Si tiene más dimensiones, truncar
    return embedding.slice(0, targetDimensions);
  } else {
    // Si tiene menos dimensiones, rellenar con ceros
    const padded = [...embedding];
    while (padded.length < targetDimensions) {
      padded.push(0);
    }
    return padded;
  }
}

/**
 * Función de utilidad para validar la configuración antes de usar las APIs
 * @returns {boolean} - True si la configuración es válida
 */
export function validateConfiguration() {
  const requiredConfigs = [
    'OPENAI_API_KEY',
    'OPENAI_ENDPOINT'
  ];
  
  const missing = requiredConfigs.filter(key => !config[key]);
  
  if (missing.length > 0) {
    console.error('❌ Configuración faltante de Azure OpenAI:', missing);
    return false;
  }
  
  console.log('✅ Configuración de Azure OpenAI válida');
  return true;
}

/**
 * Obtiene información sobre el modelo de embeddings
 */
export async function getModelInfo() {
  try {
    // Esto es solo informativo, no todos los endpoints soportan esta llamada
    console.log('Modelo de embeddings:', config.AZURE_OPENAI_DEPLOYMENT);
    console.log('Endpoint:', config.AZURE_OPENAI_ENDPOINT);
    console.log('API Version:', config.AZURE_OPENAI_API_VERSION);
  } catch (error) {
    console.warn('No se pudo obtener información del modelo:', error.message);
  }
}