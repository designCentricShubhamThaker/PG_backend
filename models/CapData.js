import mongoose from 'mongoose';

const CapDataSchema = new mongoose.Schema({
  FORMULA: {
    type: String,
    required: true,
    set: v => (typeof v === 'string' ? v.toUpperCase() : v),
    default: null
  }
  
});

export default mongoose.model('CapData', CapDataSchema);
