// uploadData.js (located at root)

import './config/db.js'; // Connect to MongoDB
import pumpdata from './data/pumpdata.js';
import PumpData from './models/PumpData.js';


const uploadData = async () => {
    try {
        await PumpData.insertMany(pumpdata);
        console.log('✅ Data uploaded successfully');

        process.exit(); // Exit script
    } catch (error) {
        console.error('❌ Upload failed:', error);
        process.exit(1);
    }
};

uploadData();
