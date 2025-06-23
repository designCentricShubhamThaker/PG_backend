import mongoose from 'mongoose';
import { teamTrackingSchema } from './TeamTracking.js';

const DecorationItemSchema = new mongoose.Schema({
  glassItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'GlassItem', required: true },
  orderNumber: { type: String, required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderItem', required: true }, // from parent

  decoration_type: { type: String },
  decoration_number: { type: String },
  decoration_details: {
    type: String, 
  },

  team: { type: String }, 
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed'],
    default: 'Pending'
  },
  team_tracking: teamTrackingSchema
}, { timestamps: true });


export default mongoose.model('DecorationItem', DecorationItemSchema);
