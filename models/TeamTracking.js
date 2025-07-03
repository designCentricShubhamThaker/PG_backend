import mongoose from 'mongoose';

export const teamTrackingSchema = new mongoose.Schema({
  total_completed_qty: { type: Number, default: 0 },
  completed_entries: [{
    qty_completed: { type: Number },
    timestamp: { type: Date, default: Date.now },
    updated_by: String
  }],
 

}, { _id: false });