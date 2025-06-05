
import mongoose from 'mongoose';

const AccessoryDataSchema = new mongoose.Schema({
  name: { type: String, required: true }
});


export default mongoose.model('AccessoryData', AccessoryDataSchema);