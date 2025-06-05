import mongoose from 'mongoose';

// Box schema: name + type
const BoxDataSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }
});
export default mongoose.model('BoxData', BoxDataSchema);