export function verifyEmbeddingDimension(embedding) {
    if (embedding.length !== 1024) {
        throw new Error(`Dimensión del embedding incorrecta: ${embedding.length}. Se esperaban 1024 dimensiones.`);
    }
    return embedding;
}