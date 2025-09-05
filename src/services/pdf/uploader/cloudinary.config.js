import { v2 as cloudinary } from 'cloudinary';
import { config } from '../../controllers/config/config.js';

cloudinary.config({
    cloud_name: config.CLOUD_NAME,
    api_key: config.API_KEY,
    api_secret: config.API_SECRET,
    secure: true

})

export { cloudinary }