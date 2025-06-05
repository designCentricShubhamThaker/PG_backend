import mongoose from 'mongoose';

const CapDataSchema = new mongoose.Schema({
  FORMULA: {
    type: String,
    required: true,
    set: v => (typeof v === 'string' ? v.toUpperCase() : v),
    default: null
  },
  CO_ITEM_NO: {
    type: Number,
    required: false,
    default: null
  },
  NECK_DIAM: {
    type: Number,
    required: false,
    default: null,
    set: v => (v === "NONE" ? null : v)
  }
});

export default mongoose.model('CapData', CapDataSchema);
