// uploadData.js (located at root)

import './config/db.js'; // Connect to MongoDB
import accessoriesdata from './data/accessoriesdata.js';
import AccessoryData from './models/AccessoriesData.js';


const uploadData = async () => {
    try {
        await AccessoryData.insertMany(accessoriesdata);
        console.log('✅ Data uploaded successfully');

        process.exit(); // Exit script
    } catch (error) {
        console.error('❌ Upload failed:', error);
        process.exit(1);
    }
};

uploadData();
