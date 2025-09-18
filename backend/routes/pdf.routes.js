import { Router } from "express";
import { upload } from "../services/uploader/uploader.js";
import { verifyEmbeddingDimension } from "../services/utils/verifyEmmbedingDimension.js";
import { PDFExtract } from "pdf.js-extract";
import { client } from "../services/azureCredentials/azure.credentials.js";
import { getEmbeddingsBatch } from "../services/openIA/openAI.config.js"; // Cambiado a batch
import { config } from "../controllers/config/config.js";
import { logger } from "../services/log/logger.js";

const pdfRoutes = Router();
const processedFiles = new Set();

pdfRoutes.post('/sendPdf', upload.single('pdfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Se requiere un archivo PDF" });
        }

        const fileName = req.file.originalname;
        logger.info(`Procesando archivo PDF: ${fileName}`);

        // Extraer contenido del PDF
        const pdfExtract = new PDFExtract();
        const pdfBuffer = req.file.buffer;
        const data = await pdfExtract.extractBuffer(pdfBuffer);
        
        const totalPages = data.pages.length;
        logger.info(`PDF tiene ${totalPages} páginas`);

        // Extraer todo el texto de una vez
        const fullText = data.pages
            .map(page => page.content
                .map(item => item.str)
                .join(' ')
                .replace(/\s+/g, ' ') // Normalizar espacios
            )
            .join('\n') // Separar páginas con salto de línea
            .trim();

        if (!fullText || fullText.length === 0) {
            return res.status(400).json({ error: "No se pudo extraer texto del PDF o el archivo está vacío" });
        }

        logger.info(`Texto extraído: ${fullText.length} caracteres de ${totalPages} páginas`);

        // Chunking optimizado
        const chunkSize = 2000;
        const chunkOverlap = 150;
        const chunks = createOptimizedPDFChunks(fullText, chunkSize, chunkOverlap);
        
        logger.info(`Creados ${chunks.length} chunks`);

        // Obtener embeddings en batch (mucho más rápido)
        logger.info("Generando embeddings en batch...");
        const startEmbedding = Date.now();
        const embeddings = await getEmbeddingsBatch(chunks);
        const embeddingTime = Date.now() - startEmbedding;
        
        logger.info(`Embeddings generados en ${embeddingTime}ms: ${embeddings.length} embeddings`);

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
                perfil: req.body.perfil
            };
        });

        // Subir a Azure en batches
        logger.info("Subiendo documentos a Azure...");
        const batch = await uploadInBatches(azureDocuments);
        
        logger.info(`${batch.totalUploaded} documentos cargados correctamente en Azure Cognitive Search en ${batch.processingTime}ms`);
        processedFiles.add(fileName);

        res.status(200).json({
            origin: config.PORT,
            fileName: fileName,
            totalPages: totalPages,
            totalChunks: chunks.length,
            totalEmbeddings: embeddings.length,
            documentsUploaded: batch.totalUploaded,
            message: `PDF procesado correctamente: ${batch.totalUploaded} documentos subidos`,
            processingTime: {
                embeddings: embeddingTime,
                upload: batch.processingTime,
                total: embeddingTime + batch.processingTime
            }
        });

    } catch (err) {
        logger.error("Error al procesar el archivo PDF:", err);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

/**
 * Crea chunks optimizados específicamente para PDFs
 */
function createOptimizedPDFChunks(text, chunkSize, chunkOverlap) {
    const chunks = [];
    
    // Dividir por párrafos primero si es posible
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
        const paragraphText = paragraph.trim();
        
        // Si el párrafo solo cabe en el chunk actual
        if (currentChunk.length + paragraphText.length + 2 <= chunkSize) {
            currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraphText;
        } else {
            // Guardar chunk actual si tiene contenido
            if (currentChunk.trim().length > 0) {
                chunks.push(currentChunk.trim());
            }
            
            // Si el párrafo es muy grande, dividirlo
            if (paragraphText.length > chunkSize) {
                const subChunks = splitLargeParagraph(paragraphText, chunkSize, chunkOverlap);
                chunks.push(...subChunks);
                currentChunk = '';
            } else {
                // Iniciar nuevo chunk con este párrafo
                currentChunk = paragraphText;
                
                // Agregar overlap del chunk anterior si existe
                if (chunks.length > 0) {
                    const previousChunk = chunks[chunks.length - 1];
                    const overlapText = getOverlapText(previousChunk, chunkOverlap);
                    if (overlapText) {
                        currentChunk = overlapText + '\n\n' + currentChunk;
                    }
                }
            }
        }
    }
    
    // Agregar el último chunk si tiene contenido
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.filter(chunk => chunk.length > 50); // Filtrar chunks muy pequeños
}

/**
 * Divide párrafos grandes en chunks más pequeños
 */
function splitLargeParagraph(paragraph, chunkSize, chunkOverlap) {
    const chunks = [];
    const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim() + (i < sentences.length - 1 ? '.' : '');
        
        if (currentChunk.length + sentence.length + 1 <= chunkSize) {
            currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence;
        } else {
            if (currentChunk.trim().length > 0) {
                chunks.push(currentChunk.trim());
                
                // Crear overlap para el siguiente chunk
                const overlapText = getOverlapText(currentChunk, chunkOverlap);
                currentChunk = overlapText ? overlapText + ' ' + sentence : sentence;
            } else {
                // Si una sola oración es muy grande, dividirla por palabras
                if (sentence.length > chunkSize) {
                    const wordChunks = splitByWords(sentence, chunkSize, chunkOverlap);
                    chunks.push(...wordChunks);
                    currentChunk = '';
                } else {
                    currentChunk = sentence;
                }
            }
        }
    }
    
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

/**
 * Divide texto muy grande por palabras como último recurso
 */
function splitByWords(text, chunkSize, chunkOverlap) {
    const words = text.split(/\s+/);
    const chunks = [];
    let currentChunk = '';
    
    for (const word of words) {
        if (currentChunk.length + word.length + 1 <= chunkSize) {
            currentChunk += (currentChunk.length > 0 ? ' ' : '') + word;
        } else {
            if (currentChunk.trim().length > 0) {
                chunks.push(currentChunk.trim());
                
                // Crear overlap
                const overlapWords = currentChunk.trim().split(/\s+/).slice(-Math.floor(chunkOverlap / 10));
                currentChunk = overlapWords.join(' ') + ' ' + word;
            } else {
                currentChunk = word;
            }
        }
    }
    
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

/**
 * Obtiene texto de overlap del final de un chunk
 */
function getOverlapText(chunk, overlapSize) {
    if (chunk.length <= overlapSize) {
        return chunk;
    }
    
    const overlapText = chunk.slice(-overlapSize);
    
    // Buscar un buen punto de inicio (espacio, punto, etc.)
    const goodStart = overlapText.search(/[\s.!?]/);
    if (goodStart > 0 && goodStart < overlapSize * 0.3) {
        return overlapText.slice(goodStart + 1).trim();
    }
    
    return overlapText.trim();
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
            
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(documents.length / batchSize);
            logger.info(`Batch ${batchNum}/${totalBatches}: ${result.results.length} documentos subidos`);
            
        } catch (error) {
            logger.error(`Error en batch ${Math.floor(i/batchSize) + 1}:`, error);
            throw error;
        }
    }
    
    const processingTime = Date.now() - startTime;
    return { totalUploaded, processingTime };
}

export { pdfRoutes };