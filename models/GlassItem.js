import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const GlassItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true },
  orderNumber: { type: String, required: true },
  glass_name: String,
  quantity: Number,
  weight: String,
  neck_size: String,
  decoration: String,
   rate: { type: Number, default: 0 },
  decoration_no: String,
  decoration_details: {
    type: { type: String },
    decoration_number: String
  },
  team: String,
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed'],
    default: 'Pending'
  },

  team_tracking: teamTrackingSchema
}, { timestamps: true });

export default mongoose.model('GlassItem', GlassItemSchema);