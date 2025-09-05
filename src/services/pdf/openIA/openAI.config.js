import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../../controllers/config/config.js";

const openaiApiKey = `${config.OPENAI_API_KEY}`;
export const openaiEmbeddings = new OpenAIEmbeddings({
    apiKey: openaiApiKey,
    modelName: "text-embedding-3-large",
    dimensions: 1024,
    stripNewLines: true
});
