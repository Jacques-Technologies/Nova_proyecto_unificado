import { config } from "../../controllers/config/config.js";
import { logger } from "../log/logger.js";
export const verifyRequiredEmmbeding = (requiredFields) => {
    return (req, res, next) => {
        if (typeof req.body !== 'object' || req.body === null) {
            return res.status(400).send({
                origin: config.PORT,
                payload: 'Invalid request body',
                requiredFields
            });
        }
        const missingFields = requiredFields.filter(field =>
            !(field in req.body) || req.body[field] === '' || req.body[field] === null || req.body[field] === undefined
        );


        if (missingFields.length > 0) {
            logger.error(`Faltan propiedades: requiredFields: ${missingFields}`);
            return res.status(400).send({
                origin: config.PORT,
                payload: 'Missing required fields',
                missingFields
            });
        }

        next();
    };
};