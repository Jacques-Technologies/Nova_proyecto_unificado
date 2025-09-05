import { Router } from "express";
import { upload } from "../services/pdf/uploader/uploader.js";
// import { generateSafeKey } from "../services/utils/generateSafeKey.js";
import { verifyEmbeddingDimension } from "../services/pdf/utils/verifyEmmbedingDimension.js";
import { PDFExtract } from "pdf.js-extract";
import { client } from "../services/pdf/azureCredentials/azure.credentials.js";
import { openaiEmbeddings } from "../services/pdf/openIA/openAI.config.js";
import { config } from "../controllers/config/config.js";
import { logger } from "../services/pdf/log/logger.js";
// import { verifyRequiredEmmbeding } from "../services/utils/verifyBodyEmmbeding.js";


const pdfRoutes = Router();

const processedFiles = new Set(); // Registro de archivos procesados

pdfRoutes.post('/sendPdf', upload.single('pdfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Se requiere un archivo PDF" });
        }

        const fileName = req.file.originalname;
        // if (processedFiles.has(fileName)) {
        //     return res.status(400).json({ error: "Este archivo ya ha sido procesado" });
        // }

        const pdfExtract = new PDFExtract();
        const pdfBuffer = req.file.buffer;
        const data = await pdfExtract.extractBuffer(pdfBuffer);

        const totalPages = data.pages.length;
        const chunkSize = 2000;
        const chunkOverlap = 150;
        const maxPagesPerBatch = 20;

        const chunks = [];
        const documents = [];

        for (let i = 0; i < totalPages; i += maxPagesPerBatch) {
            const pageBatch = data.pages.slice(i, i + maxPagesPerBatch);
            const batchText = pageBatch.map(page => page.content.map(item => item.str).join(' ')).join(' ');

            for (let startIndex = 0; startIndex < batchText.length; startIndex += chunkSize - chunkOverlap) {
                chunks.push(batchText.slice(startIndex, startIndex + chunkSize));
            }

            for (const page of pageBatch) {
                documents.push({ pageNumber: page.pageNumber, text: page.content.map(item => item.str).join(' ') });
            }
        }

        const embeddings = await openaiEmbeddings.embedDocuments(chunks);
        const azureDocuments = chunks.map((chunk, index) => {
            const embedding = verifyEmbeddingDimension(embeddings[index]);
            return {
                '@search.action': 'upload',
                uniqueid: `${req.body.archivoid}${index}`,
                FileName: req.body.FileName,
                Chunk: chunk,
                Embedding: embedding,
                Folder: req.body.Folder,
                archivoid: req.body.archivoid
            };
        });

        const batch = await client.uploadDocuments(azureDocuments);

        logger.info(`${batch.results.length} documentos cargados correctamente en Azure Cognitive Search.`);

        processedFiles.add(fileName);

        res.status(200).json({
            origin: config.PORT,
            chunks: JSON.stringify(embeddings),
            documents: JSON.stringify(documents),
            message: `${batch.results.length} documentos cargados correctamente en openAI embedings`
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

export { pdfRoutes };
