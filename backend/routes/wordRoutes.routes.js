import mammoth from "mammoth";
import { Router } from "express";
import { upload } from "../services/uploader/uploader.js";
import { verifyEmbeddingDimension } from "../services/utils/verifyEmmbedingDimension.js"
import { client } from "../services/azureCredentials/azure.credentials.js";
import WordExtractor from 'word-extractor'
import { getEmbeddingsBatch } from "../services/openIA/openAI.config.js"; // Cambiado a batch
import { config } from "../controllers/config/config.js";
import { logger } from "../services/log/logger.js";

const wordRoutes = Router();
const processedFiles = new Set();

wordRoutes.post('/sendWord', upload.single('wordFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Se requiere un archivo Word" });
        }
        
        const fileName = req.file.originalname;
        logger.info(`Procesando archivo: ${fileName}`);
        
        // Extraer texto según el tipo de archivo
        let extractedText = '';
        if (fileName.endsWith('.docx')) {
            const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
            extractedText = value;
        } else if (fileName.endsWith('.doc')) {
            const extractor = new WordExtractor();
            try {
                const doc = await extractor.extract(req.file.buffer);
                extractedText = doc.getBody();
            } catch (err) {
                logger.error("Error extrayendo texto:", err);
                return res.status(500).json({ error: "Error extrayendo texto del archivo Word" });
            }
        } else {
            return res.status(400).json({ error: "Tipo de archivo no soportado. Solo se admiten .doc y .docx" });
        }

        if (!extractedText || extractedText.trim() === '') {
            return res.status(400).json({ error: "No se pudo extraer texto del archivo Word o el archivo está vacío" });
        }

        logger.info(`Texto extraído: ${extractedText.length} caracteres`);

        // Chunking optimizado
        const chunkSize = 9000;
        const chunkOverlap = 700;
        const chunks = createOptimizedChunks(extractedText, chunkSize, chunkOverlap);
        
        logger.info(`Creados ${chunks.length} chunks`);

        // Obtener embeddings en batch (mucho más rápido)
        logger.info("Generando embeddings...");
        const embeddings = await getEmbeddingsBatch(chunks);
        logger.info(`Embeddings generados: ${embeddings.length}`);

        // Preparar documentos para Azure
        const azureDocuments = chunks.map((chunk, index) => {
            const embedding = verifyEmbeddingDimension(embeddings[index]);
            return {
                '@search.action': 'upload',
                uniqueid: `${req.body.archivoid}${index}`,
                FileName: req.body.FileName,
                Chunk: chunk,
                Embedding: embedding,
                Folder: req.body.Folder,
                archivoid: req.body.archivoid,
                Estado: req.body.Estado,
                Perfil: req.body.perfil
            };
        });

        // Subir a Azure en batches para evitar timeouts
        logger.info("Subiendo documentos a Azure...");
        const batch = await uploadInBatches(azureDocuments);
        
        logger.info(`${batch.totalUploaded} documentos cargados correctamente en Azure Cognitive Search.`);
        processedFiles.add(fileName);

        res.status(200).json({
            origin: config.PORT,
            totalChunks: chunks.length,
            totalEmbeddings: embeddings.length,
            documentsUploaded: batch.totalUploaded,
            message: `${batch.totalUploaded} documentos procesados correctamente`,
            processingTime: batch.processingTime
        });

    } catch (err) {
        logger.error("Error al procesar el archivo Word:", err);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

/**
 * Crea chunks optimizados con mejor manejo del solapamiento
 */
function createOptimizedChunks(text, chunkSize, chunkOverlap) {
    const chunks = [];
    let startIndex = 0;
    
    while (startIndex < text.length) {
        let endIndex = Math.min(startIndex + chunkSize, text.length);
        
        // Si no es el último chunk, buscar un buen punto de corte
        if (endIndex < text.length) {
            // Buscar el último espacio, punto o salto de línea antes del límite
            const searchEnd = Math.max(endIndex - 200, startIndex + chunkSize * 0.8);
            const lastGoodBreak = text.lastIndexOf('\n', endIndex) > searchEnd ? 
                text.lastIndexOf('\n', endIndex) :
                text.lastIndexOf('. ', endIndex) > searchEnd ? 
                text.lastIndexOf('. ', endIndex) + 1 :
                text.lastIndexOf(' ', endIndex);
            
            if (lastGoodBreak > searchEnd) {
                endIndex = lastGoodBreak;
            }
        }
        
        const chunk = text.slice(startIndex, endIndex).trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }
        
        // Calcular el siguiente punto de inicio con solapamiento
        if (endIndex >= text.length) break;
        startIndex = Math.max(endIndex - chunkOverlap, startIndex + 1);
    }
    
    return chunks;
}

/**
 * Sube documentos a Azure en batches para evitar timeouts
 */
async function uploadInBatches(documents, batchSize = 100) {
    const startTime = Date.now();
    let totalUploaded = 0;
    
    for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        try {
            const result = await client.uploadDocuments(batch);
            totalUploaded += result.results.length;
            logger.info(`Batch ${Math.floor(i/batchSize) + 1}: ${result.results.length} documentos subidos`);
        } catch (error) {
            logger.error(`Error en batch ${Math.floor(i/batchSize) + 1}:`, error);
            throw error;
        }
    }
    
    const processingTime = Date.now() - startTime;
    return { totalUploaded, processingTime };
}

export { wordRoutes };