// models/Glass.js
import mongoose from 'mongoose';

const BottleDataSchema = new mongoose.Schema({
  SUBGROUP1: String,
  SUBGROUP2: String,
  CO_ITEM_NO: {
    type: Number,
    default: null
  },
  FORMULA: {
    type: String,
    required: true,
    set: v => v?.toUpperCase() ?? null
  },
  ML: {
    type: Number,
    default: null,
    set: v => isNaN(Number(v)) ? null : Number(v)
  },
  NECKTYPE: {
    type: String,
    default: null
  },
  CAPACITY: {
    type: Number,
    default: null,
    set: v => isNaN(Number(v)) ? null : Number(v)
  },
  SHAPE: {
    type: String,
    default: null
  },
  NECK_DIAM: {
    type: Number,
    default: null,
    set: v => isNaN(Number(v)) ? null : Number(v)
  }
});

export default mongoose.model('BottleData', BottleDataSchema);
