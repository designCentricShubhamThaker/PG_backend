// // uploadData.js (located at root)

// import './config/db.js'; // Connect to MongoDB
// import AccessoriesData from './models/AccessoriesData.js'; // Mongoose model
// import adata from './data/adata.js'; // Your data array

// const uploadData = async () => {
//   try {
 

//     // Insert new data
//     await AccessoriesData.insertMany(adata);
//     console.log('✅ Data uploaded successfully');

//     process.exit(); // Exit script
//   } catch (error) {
//     console.error('❌ Upload failed:', error);
//     process.exit(1);
//   }
// };

// uploadData();
