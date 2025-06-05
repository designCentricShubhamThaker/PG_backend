import mongoose from 'mongoose';

const PumpDataSchema = new mongoose.Schema({
  name: { type: String, required: true },
  neck: { type: String, required: true }
});
export default mongoose.model('PumpData', PumpDataSchema);